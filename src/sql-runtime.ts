import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmBinary from 'sql.js/dist/sql-wasm.wasm';

let sqlPromise: Promise<SqlJsStatic> | null = null;

export function getSqlJs(): Promise<SqlJsStatic> {
  const wasmArrayBuffer = wasmBinary.slice().buffer;
  sqlPromise ??= initSqlJs({ wasmBinary: wasmArrayBuffer });
  return sqlPromise;
}
