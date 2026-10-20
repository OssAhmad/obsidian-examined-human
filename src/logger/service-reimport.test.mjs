import '../../test-support/plugin-module-hooks.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TFile, TFolder } from '../../test-support/obsidian-stub.mjs';
import { replacementDatabase, replacementInput } from '../../test-support/daily-reimport.mjs';
import { SQL } from '../../test-support/database.mjs';
import { writeHistoricalDailyNote } from './daily-note.ts';
import { queryRows } from '../read-models/sql.ts';

const { LoggerService } = await import('./service.ts');

function harness() {
  const db = replacementDatabase();
  const input = replacementInput();
  writeHistoricalDailyNote(db, input);
  const original = db.export();
  db.close();
  const state = {
    bytes: original.slice(), text: input.sourceText.replace('original workout', 'replacement workout'),
    backups: new Map(), folders: new Set(), writes: 0, walSize: 0,
    failBackup: false, failVerification: false, corruptNextRead: false, onBackup: null,
  };
  const source = new TFile(input.filePath);
  const database = new TFile('EH.db');
  const app = { vault: {
    getAbstractFileByPath(path) {
      return path === database.path ? database : path === source.path ? source
        : state.folders.has(path) ? new TFolder(path) : null;
    },
    async read() { return state.text; },
    async readBinary() {
      if (state.corruptNextRead) { state.corruptNextRead = false; return new Uint8Array([1, 2]).buffer; }
      return state.bytes.slice().buffer;
    },
    async modifyBinary(_file, bytes) {
      state.bytes = new Uint8Array(bytes).slice();
      state.writes++;
      if (state.failVerification && state.writes === 1) state.corruptNextRead = true;
    },
    async createFolder(path) { state.folders.add(path); },
    adapter: {
      async stat(path) {
        if (path.endsWith('-wal')) return state.walSize ? { type: 'file', size: state.walSize } : null;
        return state.folders.has(path) ? { type: 'folder' } : null;
      },
      async exists(path) { return state.backups.has(path) || state.folders.has(path); },
      async writeBinary(path, bytes) {
        if (state.failBackup) throw new Error('simulated backup failure');
        state.backups.set(path, new Uint8Array(bytes).slice());
        if (state.onBackup) await state.onBackup();
      },
    },
  } };
  const service = new LoggerService(app, 'test');
  const request = { ...input, databasePath: 'EH.db', sourceText: state.text, replaceExisting: true };
  return { service, request, state, original };
}

test('guarded replacement requires a reviewed snapshot, backs up exact old bytes, and serializes duplicate attempts', async () => {
  const { service, request, state, original } = harness();
  await assert.rejects(service.importHistoricalDaily(request), /Preview and confirm/);
  assert.equal(state.writes, 0);
  const preview = await service.inspectDaily(request);
  assert.equal(preview.ready, true, preview.errors.join('\n'));
  assert.equal(preview.replacement.records.sessions, 2);
  assert.deepEqual(state.bytes, original);
  const confirmed = { ...request, expectedDatabaseChecksum: preview.databaseChecksum };
  const results = await Promise.allSettled([service.importHistoricalDaily(confirmed), service.importHistoricalDaily(confirmed)]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[0].value.replaced, true);
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /database changed after preview/);
  assert.equal(state.writes, 1);
  assert.equal(state.backups.size, 1);
  assert.deepEqual([...state.backups.values()][0], original);
  const db = new SQL.Database(state.bytes);
  try {
    assert.equal(queryRows(db, 'SELECT * FROM sessions').length, 2);
    assert.equal(queryRows(db, 'SELECT * FROM transactions').length, 1);
    assert.equal(queryRows(db, 'SELECT * FROM imported_notes').length, 1);
    assert.equal(queryRows(db, "SELECT notes FROM sessions WHERE start_time = '07:00'")[0].notes, 'replacement workout');
  } finally { db.close(); }
});

test('database edits, note edits, WAL, and backup failure all refuse replacement without writing', async () => {
  for (const failure of ['database', 'source', 'wal', 'backup', 'source-during-backup', 'database-during-backup', 'wal-during-backup']) {
    const { service, request, state, original } = harness();
    const preview = await service.inspectDaily(request);
    let expected = original;
    const editDatabase = () => {
      const db = new SQL.Database(state.bytes);
      db.run("UPDATE daily_metrics SET notes = 'external change'");
      state.bytes = db.export();
      expected = state.bytes.slice();
      db.close();
    };
    if (failure === 'database') editDatabase();
    if (failure === 'source') state.text += '\nchanged';
    if (failure === 'wal') state.walSize = 100;
    if (failure === 'backup') state.failBackup = true;
    if (failure === 'source-during-backup') state.onBackup = () => { state.text += '\nchanged'; };
    if (failure === 'database-during-backup') state.onBackup = editDatabase;
    if (failure === 'wal-during-backup') state.onBackup = () => { state.walSize = 100; };
    await assert.rejects(service.importHistoricalDaily({ ...request, expectedDatabaseChecksum: preview.databaseChecksum }));
    assert.equal(state.writes, 0, failure);
    assert.deepEqual(state.bytes, expected, failure);
  }
});

test('failed post-write verification restores the original database and retains its backup', async () => {
  const { service, request, state, original } = harness();
  const preview = await service.inspectDaily(request);
  state.failVerification = true;
  await assert.rejects(service.importHistoricalDaily({ ...request, expectedDatabaseChecksum: preview.databaseChecksum }), /original was restored/);
  assert.deepEqual(state.bytes, original);
  assert.equal(state.backups.size, 1);
  assert.deepEqual([...state.backups.values()][0], original);
});
