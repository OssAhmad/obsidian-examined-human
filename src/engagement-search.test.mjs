import test from 'node:test';
import assert from 'node:assert/strict';
import { engagementMatchesSearch } from './engagement-search.ts';

test('engagement search matches canonical names and aliases case-insensitively', () => {
  assert.equal(engagementMatchesSearch('German Study', ['Deutsch', 'Language practice'], 'german'), true);
  assert.equal(engagementMatchesSearch('German Study', ['Deutsch', 'Language practice'], 'DEUTSCH'), true);
  assert.equal(engagementMatchesSearch('German Study', ['Deutsch', 'Language practice'], 'practice'), true);
  assert.equal(engagementMatchesSearch('German Study', ['Deutsch'], 'running'), false);
  assert.equal(engagementMatchesSearch('German Study', ['Deutsch'], '   '), true);
});
