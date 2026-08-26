import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJournalFolder, pathIsInJournalFolder } from './journal-folder.ts';

test('normalizes a vault-relative journal folder', () => {
  assert.equal(normalizeJournalFolder(' Journal\\Daily/ '), 'Journal/Daily');
  assert.equal(normalizeJournalFolder(''), '');
});

test('rejects absolute and parent journal folders', () => {
  for (const value of ['C:/Journal', '/Journal', '../Journal', 'file:Journal']) {
    assert.throws(() => normalizeJournalFolder(value));
  }
});

test('matches only files inside the configured journal folder', () => {
  assert.equal(pathIsInJournalFolder('Journal/2026/2026-08-26.md', 'Journal'), true);
  assert.equal(pathIsInJournalFolder('Journal Archive/2026-08-26.md', 'Journal'), false);
  assert.equal(pathIsInJournalFolder('2026-08-26.md', ''), true);
});
