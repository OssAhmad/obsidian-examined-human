import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backupDirectoryForDatabase,
  ensureStorageFolder,
  pluginBackupRetentionPlan,
} from './backup-storage.ts';

test('an unindexed hidden backup folder is accepted when it exists in storage', async () => {
  const created = [];
  await ensureStorageFolder({
    indexedType: () => null,
    persistedType: async (path) => path === 'data/.eqh-backups' ? 'folder' : null,
    createFolder: async (path) => { created.push(path); },
  }, 'data/.eqh-backups');
  assert.deepEqual(created, ['data']);
});

test('a folder-created race is accepted after persisted-state verification', async () => {
  let created = false;
  await ensureStorageFolder({
    indexedType: () => null,
    persistedType: async () => created ? 'folder' : null,
    createFolder: async () => {
      created = true;
      throw new Error('Folder already exists.');
    },
  }, '.eqh-backups');
  assert.equal(created, true);
});

test('a persisted file still blocks backup folder creation', async () => {
  await assert.rejects(() => ensureStorageFolder({
    indexedType: () => null,
    persistedType: async () => 'file',
    createFolder: async () => undefined,
  }, '.eqh-backups'), /file blocks backup folder creation/);
});

test('backup retention keeps the requested newest plugin-created database backups', () => {
  const directory = 'data/.eqh-backups';
  const files = [
    `${directory}/EQH.before-daily-import-20260822111140323.db`,
    `${directory}/EQH.before-meals-20260822111240323.db`,
    `${directory}/EQH.before-planning-sync-20260822111340323.db`,
    `${directory}/EQH.before-weekly-import-20260822111440323.db`,
    `${directory}/EQH.before-daily-import-20260822111540323.db`,
    `${directory}/EQH.before-daily-import-20260822111640323.db`,
  ];
  assert.equal(backupDirectoryForDatabase('data/EQH.db'), directory);
  assert.deepEqual(pluginBackupRetentionPlan('data/EQH.db', files, 5), [files[0]]);
  assert.deepEqual(pluginBackupRetentionPlan('data/EQH.db', files, 2), files.slice(0, 4));
  assert.deepEqual(pluginBackupRetentionPlan('data/EQH.db', files, 0), []);
});

test('backup retention ignores unrelated files and protects the backup created by the current write', () => {
  const directory = 'data/.eqh-backups';
  const protectedPath = `${directory}/EQH.before-daily-import-20200101000000000.db`;
  const files = [
    protectedPath,
    `${directory}/EQH.before-daily-import-20260822111540323.db`,
    `${directory}/EQH.before-daily-import-20260822111640323.db`,
    `${directory}/Other.before-daily-import-20260822111740323.db`,
    `${directory}/EQH.manual-copy.db`,
    `${directory}/nested/EQH.before-daily-import-20260822111840323.db`,
  ];
  assert.deepEqual(pluginBackupRetentionPlan('data/EQH.db', files, 2, protectedPath), [files[1]]);
});
