import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVaultDatabasePath } from './database-path.ts';

test('normalizes paths relative to the vault root', () => {
  assert.equal(normalizeVaultDatabasePath(' data\\calendar\\EH.db '), 'data/calendar/EH.db');
  assert.equal(normalizeVaultDatabasePath('./EH.db'), 'EH.db');
});

test('rejects desktop, POSIX, UNC, URI, and parent paths', () => {
  for (const value of [
    'C:\\Users\\person\\EH.db',
    '/storage/emulated/0/EH.db',
    '\\\\server\\share\\EH.db',
    'content://provider/EH.db',
    '../EH.db',
    'data/../../EH.db',
  ]) {
    assert.throws(() => normalizeVaultDatabasePath(value), /vault|Absolute/);
  }
});
