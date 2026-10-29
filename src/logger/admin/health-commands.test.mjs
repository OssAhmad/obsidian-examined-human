import '../../../test-support/plugin-module-hooks.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { replacementDatabase, replacementInput } from '../../../test-support/daily-reimport.mjs';
import { createSchemaV1Database } from '../../../test-support/database.mjs';
import { inspectDailyNote, writeHistoricalDailyNote } from '../daily-note.ts';
import { queryRows } from '../../read-models/sql.ts';
import { queryCommandCatalog } from '../../read-models/command-catalog.ts';
import { queryDailyHealth, queryHealthCatalog, hasMedicalSchema } from '../../read-models/medical.ts';
import { applyAdminEvents } from './command-handlers.ts';
import { runDatabaseTransaction } from '../persistence/sqlite-transaction.ts';
import { writeMedicalForm } from '../medical.ts';
const { healthCatalogCommand } = await import('../../HealthCommandForms.ts');

const commands = [
  'MEASUREMENT_CREATE | Glucose | number | mg/dL | [Sugar]',
  'MEASUREMENT_CREATE | Impression | text | |',
  'PROCEDURE_CREATE | Ultrasound | [Scan]',
  'MEDICATION_CREATE | Example 10 mg tablet | tablet | [Daily tablet]',
  'SYMPTOM_CREATE | Headache | [Head pain]',
];
function snapshot(db) {
  return JSON.stringify(queryRows(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .map(({ name }) => [name, queryRows(db, `SELECT * FROM "${name}"`)]));
}
function inputWithCommands(lines = commands) {
  const input = replacementInput();
  input.sourceText = input.sourceText.replace('##### Admin Events\nENTRIES:', `##### Admin Events\nENTRIES:\n${lines.join('\n')}`)
    .replace('#### END', '##### Medical\n###### Medication\nENTRIES:\n08:30 | Daily tablet | 1 | actual intake\n###### Symptoms\nENTRIES:\n10:30 | Head pain | original description\n#### END');
  return input;
}
function apply(db, command) {
  const [name, ...args] = command.split('|').map(field => field.trim());
  const errors = [];
  applyAdminEvents(db, [{ command: name, args }], '2026-08-20', errors);
  if (errors.length) throw new Error(errors.join('\n'));
}

test('health definitions stage before same-form observations; preview rolls back and import persists them', () => {
  const db = replacementDatabase();
  try {
    const input = inputWithCommands();
    const before = snapshot(db);
    const preview = inspectDailyNote(db, input);
    assert.equal(preview.ready, true, preview.errors.join('\n'));
    assert.equal(snapshot(db), before);
    assert.equal(queryCommandCatalog(db).health.entries.medication.length, 0);
    writeHistoricalDailyNote(db, input);
    const catalog = queryCommandCatalog(db).health;
    assert.equal(catalog.available, true);
    assert.deepEqual(Object.keys(catalog.entries).sort(), ['measurement', 'medication', 'procedure', 'symptom']);
    assert.equal(catalog.entries.measurement.length, 2);
    assert.equal(queryDailyHealth(db, input.noteDate).intakes[0].unit, 'tablet');
    assert.equal(queryDailyHealth(db, input.noteDate).occurrences[0].name, 'Headache');
    assert.equal(queryRows(db, "SELECT name FROM sqlite_master WHERE name='people'").length, 0);
    assert.equal(queryRows(db, "PRAGMA table_info(reports)").some(row => row.name === 'person_id'), false);
    const reimport = inspectDailyNote(db, { ...input, replaceExisting: true });
    assert.equal(reimport.ready, false);
    assert.match(reimport.errors.join('\n'), /Admin Events/);
  } finally { db.close(); }
});

test('health catalog edits replace aliases without changing historical dose units', () => {
  const db = replacementDatabase();
  try {
    writeHistoricalDailyNote(db, inputWithCommands());
    for (const command of [
      'MEDICATION_UPDATE | Daily tablet | Example renamed tablet | capsule | [New tablet]',
      'MEASUREMENT_UPDATE | Sugar | Blood glucose | number | mmol/L | [New glucose]',
      'PROCEDURE_UPDATE | Scan | Sonography | [New scan]',
      'SYMPTOM_UPDATE | Head pain | Head pain revised |',
    ]) apply(db, command);
    const medication = queryHealthCatalog(db, 'medication')[0];
    assert.equal(medication.name, 'Example renamed tablet');
    assert.deepEqual(medication.aliases, ['new tablet']);
    assert.equal(medication.unit, 'capsule');
    assert.equal(queryDailyHealth(db, '2026-08-20').intakes[0].unit, 'tablet');
    assert.deepEqual(queryHealthCatalog(db, 'symptom')[0].aliases, []);
  } finally { db.close(); }
});

test('invalid health commands and unresolved health rows cannot leave partial definitions', () => {
  for (const extra of [
    'SYMPTOM_CREATE | Collision | [Headache]',
    'MEASUREMENT_CREATE | Missing unit | number | |',
    'MEASUREMENT_CREATE | Invalid text unit | text | mg |',
    'MEDICATION_UPDATE | Unknown | Renamed | tablet |',
    'SYMPTOM_CREATE | Missing fields | | extra',
    'PERSON_CREATE | Not supported',
  ]) {
    const db = replacementDatabase();
    try {
      const input = inputWithCommands([...commands, extra]);
      const before = snapshot(db);
      assert.equal(inspectDailyNote(db, input).ready, false, extra);
      assert.equal(snapshot(db), before, extra);
      assert.throws(() => writeHistoricalDailyNote(db, input), undefined, extra);
      assert.equal(snapshot(db), before, extra);
    } finally { db.close(); }
  }
  const db = replacementDatabase();
  try {
    const input = inputWithCommands();
    input.sourceText = input.sourceText.replace('10:30 | Head pain', '10:30 | Unknown symptom');
    const before = snapshot(db);
    assert.equal(inspectDailyNote(db, input).ready, false);
    assert.throws(() => writeHistoricalDailyNote(db, input));
    assert.equal(snapshot(db), before);
  } finally { db.close(); }
});

test('health editor commands retain empty units and complete optional alias lists', () => {
  assert.equal(healthCatalogCommand('measurement', { name: 'Finding', valueType: 'text', unit: '', aliases: [] }), 'MEASUREMENT_CREATE | Finding | text |  | ');
  assert.equal(healthCatalogCommand('symptom', { name: 'Headache', valueType: '', unit: '', aliases: ['Head pain'] }, 'Old name'), 'SYMPTOM_UPDATE | Old name | Headache | [Head pain]');
  assert.throws(() => healthCatalogCommand('medication', { name: 'Tablet', unit: '', valueType: '', aliases: [] }), /unit is required/);
  assert.throws(() => healthCatalogCommand('symptom', { name: 'Name|extra', unit: '', valueType: '', aliases: [] }), /vertical bar/);
  assert.throws(() => healthCatalogCommand('symptom', { name: 'Name', unit: '', valueType: '', aliases: ['A,B'] }), /commas/);
});

test('simple single-owner upgrade removes the obsolete owner table and report column', async () => {
  const db = createSchemaV1Database();
  try {
    db.run('DELETE FROM schema_migrations WHERE version=7; CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT NOT NULL); ALTER TABLE reports ADD COLUMN person_id INTEGER REFERENCES people(id);');
    assert.equal(hasMedicalSchema(db), false);
    const sql = await readFile(new URL('../../../migrations/007_remove_people.sql', import.meta.url), 'utf8');
    runDatabaseTransaction(db, db => db.run(sql), false);
    assert.equal(hasMedicalSchema(db), true);
    assert.deepEqual(queryRows(db, "SELECT name FROM sqlite_master WHERE name='people'"), []);
  } finally { db.close(); }
});

test('README fictional health setup commands work through Daily import before a separate Medical report', async () => {
  const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
  const seed = [...readme.matchAll(/```text\r?\n([\s\S]*?)```/g)].map(match => match[1])
    .find(block => block.startsWith('MEASUREMENT_CREATE | Demo glucose'));
  assert.ok(seed, 'README contains a ready-to-try fictional setup block');
  const input = inputWithCommands(seed.trim().split(/\r?\n/));
  input.sourceText = input.sourceText.replace('Daily tablet', 'Demo medicine 10 mg tablet').replace('Head pain', 'Demo head pain');
  const db = replacementDatabase();
  try {
    const preview = inspectDailyNote(db, input);
    assert.equal(preview.ready, true, preview.errors.join('\n'));
    writeHistoricalDailyNote(db, input);
    const imported = writeMedicalForm(db, {
      filePath: 'Demo/report.md', sourceChecksum: 'documentation-test', pluginVersion: 'test',
      sourceText: '#### EH Medical Form\nreport: Fictional documentation example\nperformed:\nreported:\nsource:\nreport id:\n##### Measurements\nENTRIES:\nDemo blood sugar | 92 | fictional fixture only\nDemo imaging impression | Example written finding. | fictional fixture only\n##### Procedures\nENTRIES:\nDemo ultrasound | fictional fixture only\n#### END',
    });
    assert.equal(imported.measurementCount, 2);
    assert.equal(imported.procedureCount, 1);
  } finally { db.close(); }
});
