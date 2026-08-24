import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVaultDatabasePath } from './database-path.ts';

test('normalizes paths relative to the vault root', () => {
  assert.equal(normalizeVaultDatabasePath(' data\\calendar\\EQH.db '), 'data/calendar/EQH.db');
  assert.equal(normalizeVaultDatabasePath('./EQH.db'), 'EQH.db');
});

test('rejects desktop, POSIX, UNC, URI, and parent paths', () => {
  for (const value of [
    'C:\\Users\\person\\EQH.db',
    '/storage/emulated/0/EQH.db',
    '\\\\server\\share\\EQH.db',
    'content://provider/EQH.db',
    '../EQH.db',
    'data/../../EQH.db',
  ]) {
    assert.throws(() => normalizeVaultDatabasePath(value), /vault|Absolute/);
  }
});
