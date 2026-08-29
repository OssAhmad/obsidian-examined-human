import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { writeHistoricalDailyNote } from '../src/native-logger/daily-note.ts';
import { queryMealComponentState } from '../src/native-logger/meal-import.ts';

const [databasePath, notePath, mealLimitRaw = '0', dailyLimitRaw = '1850', proteinRaw = '0'] =
  process.argv.slice(2);
if (!databasePath || !notePath) {
  throw new Error(
    'Usage: node scripts/validate-historical-import.mjs EH.db YYYY-MM-DD.md [meal-limit] [daily-limit] [minimum-protein]',
  );
}

const fileName = basename(notePath);
const noteDate = fileName.replace(/\.md$/i, '');
const todayDate = new Date().toISOString().slice(0, 10);
if (noteDate >= todayDate) throw new Error('The validation note must be historical.');

const [databaseBytes, sourceText] = await Promise.all([
  readFile(databasePath),
  readFile(notePath, 'utf8'),
]);
const sourceChecksum = createHash('sha256').update(sourceText).digest('hex');
const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const SQL = await initSqlJs({ wasmBinary });
const db = new SQL.Database(databaseBytes);

try {
  db.run('PRAGMA foreign_keys = ON');
  db.run('BEGIN IMMEDIATE');
  const result = writeHistoricalDailyNote(db, {
    noteDate,
    todayDate,
    fileName,
    filePath: notePath,
    sourceText,
    sourceChecksum,
    pluginVersion: 'in-memory-validation',
    nutritionThresholds: {
      mealCalorieLimitKcal: Number(mealLimitRaw),
      dailyCalorieLimitKcal: Number(dailyLimitRaw),
      minimumProteinG: Number(proteinRaw),
    },
  });
  db.run('COMMIT');
  const quickCheck = db.exec('PRAGMA quick_check')[0]?.values[0]?.[0] ?? 'missing';
  const foreignKeyViolations = db.exec('PRAGMA foreign_key_check')[0]?.values.length ?? 0;
  const mealComponent = queryMealComponentState(db, noteDate);
  console.log(JSON.stringify({
    mode: 'in-memory-only',
    noteDate,
    result,
    mealLifecycle: mealComponent?.lifecycleState ?? null,
    mealRowCount: mealComponent?.rowCount ?? null,
    quickCheck,
    foreignKeyViolations,
  }, null, 2));
} catch (error) {
  try {
    db.run('ROLLBACK');
  } catch {
    // Preserve the validation error.
  }
  throw error;
} finally {
  db.close();
}
