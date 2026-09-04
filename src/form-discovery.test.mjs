import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedEhForms } from './form-discovery.ts';

test('cached discovery keeps a form visible after its source file is modified', () => {
  const file = {
    name: '2026-09-03.md',
    path: 'Journal/2026-09-03.md',
    stat: { mtime: 200, size: 2_000 },
  };
  const app = {
    vault: {
      getAbstractFileByPath: (path) => path === file.path ? file : null,
    },
  };
  const cache = {
    version: 1,
    entries: {
      [file.path]: {
        mtime: 100,
        size: 1_000,
        forms: [{
          kind: 'daily',
          date: '2026-09-03',
          startDate: null,
          endDate: null,
        }],
      },
    },
  };

  assert.deepEqual(cachedEhForms(app, cache), [{
    kind: 'daily',
    date: '2026-09-03',
    startDate: null,
    endDate: null,
    fileName: file.name,
    filePath: file.path,
  }]);
});

test('cached discovery still drops a deleted or renamed source path', () => {
  const app = { vault: { getAbstractFileByPath: () => null } };
  const cache = {
    version: 1,
    entries: {
      'Journal/deleted.md': {
        mtime: 100,
        size: 1_000,
        forms: [{ kind: 'daily', date: '2026-09-03', startDate: null, endDate: null }],
      },
    },
  };

  assert.deepEqual(cachedEhForms(app, cache), []);
});
