import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { assertMealImportSchema } from './meal-import.ts';

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const createSchemaSql = await readFile(
  new URL('../../migrations/000_create_schema_v5.sql', import.meta.url),
  'utf8',
);
const SQL = await initSqlJs({ wasmBinary });

test('native database creation SQL builds a complete empty schema v5', () => {
  const db = new SQL.Database();
  try {
    db.run(createSchemaSql);
    db.run('PRAGMA foreign_keys = ON');
    assertMealImportSchema(db);
    assert.equal(db.exec('PRAGMA quick_check')[0].values[0][0], 'ok');
    assert.equal(db.exec('PRAGMA foreign_key_check').length, 0);
    assert.equal(db.exec('PRAGMA user_version')[0].values[0][0], 5);
    assert.equal(db.exec('SELECT COUNT(*) FROM schema_migrations')[0].values[0][0], 5);
    assert.equal(db.exec('SELECT COUNT(*) FROM session_types')[0].values[0][0], 13);
    assert.equal(db.exec('SELECT COUNT(*) FROM sessions')[0].values[0][0], 0);
    const milestoneColumns = db.exec("PRAGMA table_info('engagement_milestones')")[0];
    const sessionIdRow = milestoneColumns.values.find((row) => row[1] === 'session_id');
    assert.equal(sessionIdRow[3], 1);
    const milestoneForeignKeys = db.exec("PRAGMA foreign_key_list('engagement_milestones')")[0];
    const sessionForeignKey = milestoneForeignKeys.values.find((row) => row[3] === 'session_id');
    assert.equal(sessionForeignKey[6], 'RESTRICT');
  } finally {
    db.close();
  }
});
