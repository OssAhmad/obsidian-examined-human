import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyNoteList } from './weekly-note-index.ts';

function weeklyFile(name) {
  return {
    name,
    basename: name.replace(/\.md$/i, ''),
    path: `Oss Ahmad Journal/${name}`,
  };
}

test('discovered Weekly Forms form one newest-first list with temporal state tints', async () => {
  const files = [
    weeklyFile('2026-W31.md'),
    weeklyFile('2026-W32.md'),
    weeklyFile('2026-W33.md'),
    weeklyFile('2026-W34.md'),
  ];
  const app = {
    vault: { getMarkdownFiles: () => files },
  };
  const result = await buildWeeklyNoteList(app, {
    importedPlans: [{
      id: 1,
      weekStartDate: '2026-08-08',
      sourceFileName: '2026-W32.md',
      sourceFilePath: 'Oss Ahmad Journal/2026-W32.md',
    }],
  }, '2026-08-18', [
    { kind: 'weekly', path: files[0].path, fileName: files[0].name, formText: '', startDate: '2026-08-01', endDate: '2026-08-07' },
    { kind: 'weekly', path: files[1].path, fileName: files[1].name, formText: '', startDate: '2026-08-08', endDate: '2026-08-14' },
    { kind: 'weekly', path: files[2].path, fileName: files[2].name, formText: '', startDate: '2026-08-15', endDate: '2026-08-21' },
    { kind: 'weekly', path: files[3].path, fileName: files[3].name, formText: '', startDate: '2026-08-22', endDate: '2026-08-28' },
  ]);

  assert.deepEqual(result.map((item) => [
    item.weekLabel,
    item.status,
    item.temporalState,
  ]), [
    ['2026-W34', 'pending', 'future'],
    ['2026-W33', 'pending', 'current'],
    ['2026-W32', 'imported', 'imported'],
    ['2026-W31', 'pending', 'overdue'],
  ]);
});
