import assert from 'node:assert/strict';
import test from 'node:test';
import { replacementDatabase, replacementInput } from '../../test-support/daily-reimport.mjs';
import { inspectDailyNote, writeHistoricalDailyNote } from './daily-note.ts';
import { queryRows } from '../read-models/sql.ts';
import { runDatabaseTransaction, verifyDatabaseIntegrity } from './persistence/sqlite-transaction.ts';

function contents(db) {
  return queryRows(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .map(({ name }) => [name, queryRows(db, `SELECT * FROM "${name}"`)]);
}

test('replacement previews without mutation, deletes every old day record, and never accumulates duplicates', () => {
  const db = replacementDatabase();
  try {
    const original = replacementInput();
    writeHistoricalDailyNote(db, original);
    writeHistoricalDailyNote(db, replacementInput('2026-08-21'));
    // Date ownership deliberately covers legacy/external rows and every receipt.
    db.run(`INSERT INTO transactions (account_id, date, amount, description) VALUES (1, '2026-08-20', 99, 'external');
      INSERT INTO daily_meals (day, food) VALUES ('2026-08-20', 'unlinked legacy food');
      INSERT INTO imported_notes (note_date, file_name, file_path) VALUES ('2026-08-20', 'legacy duplicate.md', 'Journal/legacy duplicate.md');`);
    const otherDay = queryRows(db, "SELECT * FROM sessions WHERE date = '2026-08-21'");
    const shared = queryRows(db, 'SELECT * FROM engagements');
    const before = contents(db);
    const changed = {
      ...original, replaceExisting: true, sourceChecksum: 'changed',
      sourceText: original.sourceText
        .replace('09:00-10:00 | Practice | original study\n', '')
        .replace('original workout', 'new workout')
        .replace('12.5 | Cash | Practice | original money', '-7 | Cash | Practice | new money')
        .replace('Eggs | 100', 'Eggs | 200')
        .replace('[30min, 5km]', '[45min, 6km]')
        .replace('distance_km | 5', 'distance_km | 6')
        .replace('original stoicism', 'new stoicism')
        .replace('Gold | 2000', 'Gold | 2500'),
    };
    const preview = inspectDailyNote(db, changed);
    assert.equal(preview.ready, true, preview.errors.join('\n'));
    assert.equal(preview.imported, true);
    assert.equal(preview.replacement.records.sessions, 2);
    assert.equal(preview.replacement.records.transactions, 2);
    assert.equal(preview.replacement.records.daily_meals, 2);
    assert.equal(preview.replacement.records.imported_notes, 2);
    assert.deepEqual(contents(db), before, 'preview rolls back deletion and admin staging');
    assert.equal(preview.preview.sessions.length, 1);
    assert.equal(preview.preview.transactions[0].amount, -7);
    for (let repeat = 0; repeat < 3; repeat++) {
      const result = runDatabaseTransaction(db, () => writeHistoricalDailyNote(db, changed));
      assert.equal(result.replaced, true);
      assert.equal(queryRows(db, "SELECT * FROM sessions WHERE date = '2026-08-20'").length, 1);
      assert.equal(queryRows(db, "SELECT amount FROM transactions WHERE date = '2026-08-20'")[0].amount, -7);
      assert.equal(queryRows(db, "SELECT * FROM transactions WHERE date = '2026-08-20'").length, 1);
      assert.equal(queryRows(db, "SELECT amount_g FROM daily_meals WHERE day = '2026-08-20'")[0].amount_g, 200);
      assert.equal(queryRows(db, "SELECT * FROM daily_meals WHERE day = '2026-08-20'").length, 1);
      assert.equal(queryRows(db, "SELECT * FROM stoicism_entries WHERE date = '2026-08-20'").length, 1);
      assert.equal(queryRows(db, "SELECT notes FROM stoicism_entries WHERE date = '2026-08-20'")[0].notes, 'new stoicism');
      assert.equal(queryRows(db, "SELECT * FROM imported_notes WHERE note_date = '2026-08-20'").length, 1);
      assert.equal(queryRows(db, "SELECT * FROM engagement_measurements WHERE measurement_date = '2026-08-20'").length, 1);
      assert.equal(queryRows(db, "SELECT * FROM session_exercises WHERE session_id IN (SELECT id FROM sessions WHERE date = '2026-08-20')").length, 1);
      assert.equal(queryRows(db, "SELECT value FROM valuation_rates JOIN valuation_rate_sets ON rate_set_id = valuation_rate_sets.id WHERE rate_date = '2026-08-20' AND unit_key = 'GOLD'")[0].value, 2500);
      assert.deepEqual(queryRows(db, "SELECT * FROM sessions WHERE date = '2026-08-21'"), otherDay);
      assert.deepEqual(queryRows(db, 'SELECT * FROM engagements'), shared);
      verifyDatabaseIntegrity(db);
    }
    const empty = {
      ...changed,
      sourceText: `#### EH Daily Form\ndate: 2026-08-20\n##### Daily Metrics\nmood: 0\n${original.sourceText.slice(original.sourceText.indexOf('##### Meals'), original.sourceText.indexOf('##### Transactions')).replace('Eggs | 100', '')}#### END`,
    };
    const emptyPreview = inspectDailyNote(db, empty);
    assert.equal(emptyPreview.ready, true, emptyPreview.errors.join('\n'));
    writeHistoricalDailyNote(db, empty);
    for (const [table, column] of [
      ['sessions', 'date'], ['transactions', 'date'], ['daily_meals', 'day'],
      ['engagement_milestones', 'date'], ['engagement_measurements', 'measurement_date'],
      ['valuation_rate_sets', 'rate_date'], ['stoicism_entries', 'date'],
    ]) assert.equal(queryRows(db, `SELECT * FROM ${table} WHERE ${column} = '2026-08-20'`).length, 0, table);
    assert.equal(queryRows(db, 'SELECT * FROM exercise_sets').length, 1, 'only the other day remains');
    verifyDatabaseIntegrity(db);
  } finally { db.close(); }
});

test('invalid replacement and late SQL failure roll back all deletions and inserted rows', () => {
  const db = replacementDatabase();
  try {
    const input = replacementInput();
    writeHistoricalDailyNote(db, input);
    const before = contents(db);
    const invalid = { ...input, replaceExisting: true, sourceText: input.sourceText.replace('Cash | Practice', 'Missing account | Practice') };
    assert.equal(inspectDailyNote(db, invalid).ready, false);
    assert.throws(() => writeHistoricalDailyNote(db, invalid), /Unknown account/);
    assert.deepEqual(contents(db), before);
    db.run("CREATE TRIGGER fail_new_receipt BEFORE INSERT ON imported_notes BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END");
    assert.throws(() => writeHistoricalDailyNote(db, { ...input, replaceExisting: true }), /simulated write failure/);
    assert.deepEqual(contents(db), before);
  } finally { db.close(); }
});

test('replacement blocks shared Admin Events and cross-date milestone measurements without changing records', () => {
  const db = replacementDatabase();
  try {
    const input = replacementInput();
    writeHistoricalDailyNote(db, input);
    const before = contents(db);
    const admin = { ...input, replaceExisting: true, sourceText: input.sourceText.replace('##### Admin Events\nENTRIES:', '##### Admin Events\nENTRIES:\nACCOUNT_ALIAS | Cash | Pocket') };
    assert.match(inspectDailyNote(db, admin).errors.join('\n'), /empty Admin Events/);
    assert.throws(() => writeHistoricalDailyNote(db, admin), /empty Admin Events/);
    assert.deepEqual(contents(db), before);
    db.run("INSERT INTO engagement_measurements (milestone_id, metric_name, metric_value, measurement_date) VALUES (1, 'later', '7', '2026-08-21')");
    const crossDate = contents(db);
    assert.match(inspectDailyNote(db, { ...input, replaceExisting: true }).errors.join('\n'), /another or unknown date/);
    assert.throws(() => writeHistoricalDailyNote(db, { ...input, replaceExisting: true }), /another or unknown date/);
    assert.deepEqual(contents(db), crossDate);
  } finally { db.close(); }
});

test('ordinary duplicate and future import guards remain, while today can be explicitly replaced', () => {
  const db = replacementDatabase();
  try {
    const input = { ...replacementInput(), todayDate: '2026-08-20' };
    writeHistoricalDailyNote(db, input);
    assert.throws(() => writeHistoricalDailyNote(db, input), /already represented/);
    assert.equal(writeHistoricalDailyNote(db, { ...input, replaceExisting: true }).replaced, true);
    const before = contents(db);
    assert.throws(() => writeHistoricalDailyNote(db, { ...input, replaceExisting: true, todayDate: '2026-08-19' }), /Future Daily Forms/);
    assert.deepEqual(contents(db), before);
  } finally { db.close(); }
});

test('ambiguous or unrecognized replacement sections cannot silently discard old data', () => {
  const db = replacementDatabase();
  try {
    const input = replacementInput();
    writeHistoricalDailyNote(db, input);
    const before = contents(db);
    for (const [sourceText, message] of [
      [input.sourceText + '\n' + input.sourceText, /exactly one complete/],
      [input.sourceText.replace('##### Transactions', '##### Sessions\nENTRIES:\n##### Transactions'), /duplicate/],
      [input.sourceText.replace('##### Transactions', '##### Transaction'), /unrecognized section/],
      [input.sourceText.replace('##### Transactions\nENTRIES:', '##### Transactions'), /requires an ENTRIES/],
      [input.sourceText.replace('date: 2026-08-20', 'date: 2026-08-21'), /targets 2026-08-20/],
    ]) {
      const replacement = { ...input, replaceExisting: true, sourceText };
      assert.equal(inspectDailyNote(db, replacement).ready, false);
      assert.throws(() => writeHistoricalDailyNote(db, replacement), message);
      assert.deepEqual(contents(db), before);
    }
  } finally { db.close(); }
});
