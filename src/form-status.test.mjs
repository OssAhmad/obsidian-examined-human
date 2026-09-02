import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ehFormFrontmatterStatus,
  fileHasCompletedImportableForms,
  shouldDiscoverEhFormFile,
} from './form-status.ts';

test('EH Form discovery recognizes true, unimported, and imported case-insensitively', () => {
  assert.equal(ehFormFrontmatterStatus({ 'EH form': true }), 'unimported');
  assert.equal(ehFormFrontmatterStatus({ 'eh FORM': ' TRUE ' }), 'unimported');
  assert.equal(ehFormFrontmatterStatus({ 'Eh Form': 'UnImported' }), 'unimported');
  assert.equal(ehFormFrontmatterStatus({ 'EH form': 'IMPORTED' }), 'imported');
  assert.equal(ehFormFrontmatterStatus({}), 'missing');
  assert.equal(ehFormFrontmatterStatus({ 'EH form': false }), 'excluded');
});

test('tagged discovery requires an unimported marker while folder discovery also accepts missing markers', () => {
  assert.equal(shouldDiscoverEhFormFile('unimported', 'tagged-vault', false), true);
  assert.equal(shouldDiscoverEhFormFile('missing', 'tagged-vault', true), false);
  assert.equal(shouldDiscoverEhFormFile('missing', 'journal-folder', true), true);
  assert.equal(shouldDiscoverEhFormFile('unimported', 'journal-folder', true), true);
  assert.equal(shouldDiscoverEhFormFile('imported', 'journal-folder', true), false);
  assert.equal(shouldDiscoverEhFormFile('excluded', 'journal-folder', true), false);
  assert.equal(shouldDiscoverEhFormFile('missing', 'journal-folder', false), false);
});

test('a shared file becomes imported only after every Daily and Weekly Form is complete; Budget Forms are ignored', () => {
  const forms = [
    { kind: 'daily', date: '2026-09-01', startDate: null },
    { kind: 'weekly', date: null, startDate: '2026-08-29' },
    { kind: 'budget', date: null, startDate: '2026-09-01' },
  ];
  assert.equal(fileHasCompletedImportableForms(forms, 'Bundle.md', [
    { date: '2026-09-01', filePath: 'Bundle.md' },
  ], []), false);
  assert.equal(fileHasCompletedImportableForms(forms, 'Bundle.md', [
    { date: '2026-09-01', filePath: 'Bundle.md' },
  ], [
    { weekStartDate: '2026-08-29', sourceFilePath: 'Bundle.md' },
  ]), true);
  assert.equal(fileHasCompletedImportableForms([
    { kind: 'budget', date: null, startDate: '2026-09-01' },
  ], 'Budget.md', [], []), false);
});
