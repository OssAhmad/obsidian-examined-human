import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));

export const schemaV1Sql = await readFile(
  new URL('../migrations/000_create_schema_v1.sql', import.meta.url),
  'utf8',
);

export const SQL = await initSqlJs({ wasmBinary });

export function createSchemaV1Database({ foreignKeys = true } = {}) {
  const db = new SQL.Database();
  db.run(schemaV1Sql);
  if (foreignKeys) db.run('PRAGMA foreign_keys = ON');
  return db;
}
