import assert from 'node:assert/strict';
import test from 'node:test';
import { adminCommandDefinition, supportedAdminCommands, validateAdminCommandArguments } from './command-registry.ts';

test('registry keeps command arity and supported-command reporting together', () => {
  assert.deepEqual(adminCommandDefinition('ACCOUNT_CREATE').argumentCounts, [3, 4]);
  assert.equal(validateAdminCommandArguments('ACCOUNT_CREATE', 4), null);
  assert.match(validateAdminCommandArguments('ACCOUNT_CREATE', 2), /expects 3 or 4 arguments/);
  assert.match(validateAdminCommandArguments('UNKNOWN', 0), /Supported commands:/);
  assert.equal(supportedAdminCommands().includes('FOOD_ALIAS_MOVE'), true);
});
