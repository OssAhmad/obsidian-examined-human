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

test('weekly notes form one newest-first list with temporal state tints', async () => {
  const files = [
    weeklyFile('2026-W31.md'),
    weeklyFile('2026-W32.md'),
    weeklyFile('2026-W33.md'),
    weeklyFile('2026-W34.md'),
  ];
  const starts = new Map([
    ['2026-W31.md', '2026-08-01'],
    ['2026-W32.md', '2026-08-08'],
    ['2026-W33.md', '2026-08-15'],
    ['2026-W34.md', '2026-08-22'],
  ]);
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (file) => `---\nweek start: "${starts.get(file.name)}"\n---`,
    },
  };
  const result = await buildWeeklyNoteList(app, {
    importedPlans: [{
      id: 1,
      weekStartDate: '2026-08-08',
      sourceFileName: '2026-W32.md',
      sourceFilePath: 'Oss Ahmad Journal/2026-W32.md',
    }],
  }, '2026-08-18');

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
