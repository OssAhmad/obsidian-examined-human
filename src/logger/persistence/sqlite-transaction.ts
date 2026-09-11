import type { Database } from 'sql.js';
import { queryRows } from '../../read-models/sql.ts';

export function verifyDatabaseIntegrity(db: Database): void {
  const quickCheck = String(queryRows(db, 'PRAGMA quick_check')[0]?.quick_check ?? 'missing result');
  if (quickCheck !== 'ok') throw new Error(`SQLite quick_check failed: ${quickCheck}`);
  const violations = queryRows(db, 'PRAGMA foreign_key_check');
  if (violations.length > 0) {
    throw new Error(`SQLite foreign_key_check reported ${violations.length} violation(s).`);
  }
}

export function runDatabaseTransaction<T>(
  db: Database,
  operation: (db: Database) => T,
  enforceForeignKeys = true,
): T {
  db.run(`PRAGMA foreign_keys = ${enforceForeignKeys ? 'ON' : 'OFF'}`);
  db.run('BEGIN IMMEDIATE');
  try {
    const value = operation(db);
    verifyDatabaseIntegrity(db);
    db.run('COMMIT');
    if (!enforceForeignKeys) db.run('PRAGMA foreign_keys = ON');
    verifyDatabaseIntegrity(db);
    return value;
  } catch (error) {
    try {
      db.run('ROLLBACK');
    } catch {
      // Preserve the mutation error that caused the rollback.
    }
    throw error;
  }
}
