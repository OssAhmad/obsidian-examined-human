import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldCreateDatabaseBackup } from './mutation-policy.ts';

test('durable database mutations require backups', () => {
  assert.equal(shouldCreateDatabaseBackup('durable'), true);
});

test('ephemeral-only database mutations do not create backups', () => {
  assert.equal(shouldCreateDatabaseBackup('ephemeral'), false);
});
