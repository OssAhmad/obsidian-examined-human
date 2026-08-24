import assert from 'node:assert/strict';
import test from 'node:test';
import { hasUncheckpointedWal } from './database-source.ts';

test('a WAL containing frames is treated as uncheckpointed external state', () => {
  assert.equal(hasUncheckpointedWal(33), true);
  assert.equal(hasUncheckpointedWal(4096), true);
});

test('a missing, empty, or header-only WAL does not block database reads', () => {
  assert.equal(hasUncheckpointedWal(null), false);
  assert.equal(hasUncheckpointedWal(0), false);
  assert.equal(hasUncheckpointedWal(32), false);
});
