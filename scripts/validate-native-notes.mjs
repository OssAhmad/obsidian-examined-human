import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { inspectDailyNote } from '../src/native-logger/daily-note.ts';

const [databasePath, ...notePaths] = process.argv.slice(2);
if (!databasePath || notePaths.length === 0) {
  throw new Error('Usage: node scripts/validate-native-notes.mjs EQH.db DAILY_NOTE.md [...]');
}

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const SQL = await initSqlJs({ wasmBinary });
const databaseBytes = await readFile(databasePath);
const todayDate = new Date().toISOString().slice(0, 10);

const results = [];
for (const notePath of notePaths) {
  const fileName = basename(notePath);
  const noteDate = fileName.replace(/\.md$/i, '');
  const sourceText = await readFile(notePath, 'utf8');
  const db = new SQL.Database(databaseBytes);
  try {
    db.run('PRAGMA foreign_keys = ON');
    const inspection = inspectDailyNote(db, {
      noteDate,
      todayDate,
      fileName,
      filePath: notePath,
      sourceText,
      sourceChecksum: 'read-only-validation',
      pluginVersion: 'validation',
      nutritionThresholds: {
        mealCalorieLimitKcal: 0,
        dailyCalorieLimitKcal: 1850,
        minimumProteinG: 0,
      },
    });
    results.push({
      noteDate,
      ready: inspection.ready,
      errorCount: inspection.errors.length,
      warningCount: inspection.warnings.length,
      counts: inspection.completeness,
      errors: inspection.errors,
      warnings: inspection.warnings,
    });
  } finally {
    db.close();
  }
}

console.log(JSON.stringify(results, null, 2));
