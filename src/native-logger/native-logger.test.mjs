import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { inspectDailyNote, writeHistoricalDailyNote } from './daily-note.ts';
import { queryMealComponentState, writeMealInspection } from './meal-import.ts';
import { inspectMeals } from './meals.ts';
import { inspectPlannedNote, syncPlanningNotes } from './planning.ts';
import {
  inspectWeeklyPlan,
  prepareWeeklyDailyNoteWrites,
  writeWeeklyPlan,
} from './weekly.ts';

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const schema = await readFile(new URL('../../migrations/000_create_schema_v5.sql', import.meta.url), 'utf8');
const SQL = await initSqlJs({ wasmBinary });

function database() {
  const db = new SQL.Database();
  db.run(schema);
  db.run('PRAGMA foreign_keys = ON');
  db.run(`
    INSERT INTO engagements (name, type_id, status_id)
    SELECT 'Project Alpha', et.id, es.id
    FROM engagement_types et, engagement_statuses es
    WHERE et.code = 'course' AND es.code = 'active';
    INSERT INTO engagement_aliases (engagement_id, alias)
    SELECT id, 'Alpha spending' FROM engagements WHERE name = 'Project Alpha';
    INSERT INTO accounts (name, type) VALUES ('Cash', 'cash');
    INSERT INTO exercises (name, category) VALUES ('Run', 'endurance');
  `);
  return db;
}

const thresholds = {
  mealCalorieLimitKcal: 700,
  dailyCalorieLimitKcal: 1850,
  minimumProteinG: 90,
};

function dailyNote() {
  return `#### EH Form

##### Daily Metrics
mood: 1
energy: 2
stress: -1
weight_kg: 80
sleep_hours: 7.5
calories: 2000
protein_g: 100
fasted: 0
dieted: 1

##### Sessions
ENTRIES:
07:00-08:00 | exercise | Project Alpha | morning run
09:00-10:30 | study | Project Alpha | reading

##### Meals
###### Breakfast
is_leisure: 0
ENTRIES:
Eggs | 300 | 25

###### Lunch
is_leisure: 0
ENTRIES:
Rice | 600 | 15

###### Dinner
is_leisure: 0
ENTRIES:
Chicken | 550 | 60

###### Snacks
is_leisure: 0
ENTRIES:
Chocolate | 550 | 0

##### Transactions
ENTRIES:
12.5 | Cash | Alpha spending | lunch

##### Exercise Details
ENTRIES:
Run | [30min, 5km] | easy

##### Milestones
ENTRIES:
Project Alpha | First run | distance_km | 5 | 07:00-08:00

##### Stoicism
score: 4
notes: calm

##### Admin Events
ENTRIES:
ACCOUNT_ALIAS | Cash | Wallet

#### END`;
}

test('native historical validation and import cover every Daily Note component', () => {
  const db = database();
  const input = {
    noteDate: '2026-08-20',
    todayDate: '2026-08-21',
    fileName: '2026-08-20.md',
    filePath: 'Oss Ahmad Journal/2026/daily/2026-08-20.md',
    sourceText: dailyNote(),
    sourceChecksum: 'checksum-daily',
    pluginVersion: '0.8.5',
    nutritionThresholds: thresholds,
  };
  const inspectionDb = new SQL.Database(db.export());
  const inspection = inspectDailyNote(inspectionDb, input);
  inspectionDb.close();
  assert.equal(inspection.ready, true);
  assert.equal(inspection.completeness.session_count, 2);
  assert.equal(inspection.mealInspection.leisureMeals, 2);
  assert.equal(inspection.preview.transactions[0].engagement, 'Project Alpha');
  assert.equal(inspection.preview.transactions[0].engagement_raw, 'Alpha spending');
  assert.equal(inspection.preview.transactions[0].engagement_id, 1);

  const result = writeHistoricalDailyNote(db, input);
  assert.equal(result.sessionCount, 2);
  assert.equal(result.exerciseSetCount, 1);
  assert.equal(db.exec('SELECT COUNT(*) FROM imported_notes')[0].values[0][0], 1);
  assert.equal(db.exec('SELECT dieted FROM daily_metrics')[0].values[0][0], 0);
  assert.equal(db.exec('SELECT COUNT(*) FROM account_aliases')[0].values[0][0], 1);
  assert.equal(String(db.exec('SELECT category FROM transactions')[0].values[0][0]), '1');
  assert.equal(db.exec('SELECT COUNT(*) FROM engagement_measurements')[0].values[0][0], 1);
  assert.throws(() => writeHistoricalDailyNote(db, input), /already represented/);
  db.close();
});

test('full historical import adopts an identical earlier Meals component despite a changed whole-note checksum', () => {
  const db = database();
  const sourceText = dailyNote();
  writeMealInspection(db, {
    noteDate: '2026-08-20',
    todayDate: '2026-08-21',
    sourceFilePath: 'Oss Ahmad Journal/2026/daily/2026-08-20.md',
    sourceChecksum: 'meals-only-checksum',
    pluginVersion: '0.9.0',
    inspection: inspectMeals(sourceText, thresholds),
  });
  const result = writeHistoricalDailyNote(db, {
    noteDate: '2026-08-20',
    todayDate: '2026-08-21',
    fileName: '2026-08-20.md',
    filePath: 'Oss Ahmad Journal/2026/daily/2026-08-20.md',
    sourceText,
    sourceChecksum: 'full-note-checksum-after-other-sections-changed',
    pluginVersion: '0.9.0',
    nutritionThresholds: thresholds,
  });
  assert.equal(result.sessionCount, 2);
  assert.equal(db.exec('SELECT COUNT(*) FROM meal_events')[0].values[0][0], 4);
  assert.equal(db.exec('SELECT COUNT(*) FROM daily_meals')[0].values[0][0], 4);
  const component = queryMealComponentState(db, '2026-08-20');
  assert.equal(component?.lifecycleState, 'finalized');
  assert.equal(component?.sourceChecksum, 'full-note-checksum-after-other-sections-changed');
  db.close();
});

test('full historical import replaces and finalizes a changed ephemeral Meals component', () => {
  const db = database();
  writeMealInspection(db, {
    noteDate: '2026-08-20',
    todayDate: '2026-08-20',
    sourceFilePath: 'Oss Ahmad Journal/2026/daily/2026-08-20.md',
    sourceChecksum: 'ephemeral-meals-checksum',
    pluginVersion: '0.9.0',
    inspection: inspectMeals(dailyNote(), thresholds),
  });
  const changed = dailyNote().replace('Eggs | 300 | 25', 'Eggs | 325 | 25');
  const result = writeHistoricalDailyNote(db, {
    noteDate: '2026-08-20',
    todayDate: '2026-08-21',
    fileName: '2026-08-20.md',
    filePath: 'Oss Ahmad Journal/2026/daily/2026-08-20.md',
    sourceText: changed,
    sourceChecksum: 'full-note-checksum-with-final-meals',
    pluginVersion: '0.9.0',
    nutritionThresholds: thresholds,
  });
  assert.equal(result.sessionCount, 2);
  assert.equal(db.exec("SELECT calories FROM daily_meals WHERE food='Eggs'")[0].values[0][0], 325);
  const component = queryMealComponentState(db, '2026-08-20');
  assert.equal(component?.lifecycleState, 'finalized');
  assert.equal(component?.sourceChecksum, 'full-note-checksum-with-final-meals');
  db.close();
});

test('full historical import still rejects a changed finalized Meals component', () => {
  const db = database();
  writeMealInspection(db, {
    noteDate: '2026-08-20',
    todayDate: '2026-08-21',
    sourceFilePath: 'Oss Ahmad Journal/2026/daily/2026-08-20.md',
    sourceChecksum: 'meals-only-checksum',
    pluginVersion: '0.9.0',
    inspection: inspectMeals(dailyNote(), thresholds),
  });
  const changed = dailyNote().replace('Eggs | 300 | 25', 'Eggs | 301 | 25');
  assert.throws(() => writeHistoricalDailyNote(db, {
    noteDate: '2026-08-20',
    todayDate: '2026-08-21',
    fileName: '2026-08-20.md',
    filePath: 'Oss Ahmad Journal/2026/daily/2026-08-20.md',
    sourceText: changed,
    sourceChecksum: 'changed-meals-checksum',
    pluginVersion: '0.9.0',
    nutritionThresholds: thresholds,
  }), /differ from the finalized meal component/);
  assert.equal(db.exec('SELECT COUNT(*) FROM imported_notes')[0].values[0][0], 0);
  db.close();
});

test('transaction engagements must resolve to an engagement name or alias', () => {
  const db = database();
  const input = {
    noteDate: '2026-08-20',
    todayDate: '2026-08-21',
    fileName: '2026-08-20.md',
    filePath: 'Oss Ahmad Journal/2026/daily/2026-08-20.md',
    sourceText: dailyNote().replace('Alpha spending | lunch', 'unmapped category | lunch'),
    sourceChecksum: 'checksum-unmapped-transaction',
    pluginVersion: '0.8.5',
    nutritionThresholds: thresholds,
  };
  const inspection = inspectDailyNote(db, input);
  assert.equal(inspection.ready, false);
  assert.match(inspection.errors.join('\n'), /Unknown engagement in transaction #1: 'unmapped category'/);
  assert.throws(() => writeHistoricalDailyNote(db, input), /Unknown engagement in transaction #1/);
  assert.equal(db.exec('SELECT COUNT(*) FROM transactions')[0].values[0][0], 0);
  db.close();
});

test('every milestone requires exactly one same-engagement owner session', () => {
  const db = database();
  const input = {
    noteDate: '2026-08-20',
    todayDate: '2026-08-21',
    fileName: '2026-08-20.md',
    filePath: 'Oss Ahmad Journal/2026/daily/2026-08-20.md',
    sourceText: dailyNote().replace(
      'Project Alpha | First run | distance_km | 5 | 07:00-08:00',
      'Project Alpha | First run | distance_km | 5',
    ),
    sourceChecksum: 'checksum-ownerless-milestone',
    pluginVersion: '0.8.5',
    nutritionThresholds: thresholds,
  };
  const inspection = inspectDailyNote(db, input);
  assert.equal(inspection.ready, false);
  assert.match(inspection.errors.join('\n'), /owner session interval/);
  assert.throws(() => writeHistoricalDailyNote(db, input), /owner session interval/);
  assert.equal(db.exec('SELECT COUNT(*) FROM engagement_milestones')[0].values[0][0], 0);
  db.close();
});

test('current and future planning is tolerant, replaceable, and marks missing notes deleted', () => {
  const db = database();
  const sourceText = `#### EH Form
##### Sessions
ENTRIES:
bad time | study | Project Alpha | draft
| unknown | Missing project |
#### END`;
  const parsed = inspectPlannedNote(sourceText);
  assert.equal(parsed.sessions.length, 2);
  assert.equal(parsed.sessions[0].timeIsEstimated, true);

  const first = syncPlanningNotes(db, [{
    noteDate: '2026-08-21',
    fileName: '2026-08-21.md',
    filePath: 'Oss Ahmad Journal/2026/daily/2026-08-21.md',
    sourceText,
    sourceChecksum: 'one',
  }], '2026-08-21');
  assert.equal(first.sessionCount, 2);
  assert.ok(first.warningCount >= 3);
  assert.equal(db.exec('SELECT COUNT(*) FROM planned_sessions')[0].values[0][0], 2);

  const second = syncPlanningNotes(db, [], '2026-08-21');
  assert.equal(second.deletedSourceCount, 1);
  assert.equal(db.exec('SELECT lifecycle_state FROM note_sources')[0].values[0][0], 'deleted');
  assert.equal(db.exec('SELECT COUNT(*) FROM planned_sessions')[0].values[0][0], 0);
  db.close();
});

function weeklyNote() {
  const empty = ' |'.repeat(4);
  return `---
week start: 2026-08-22
---
- Main outcome: Ship native logger
- Important deadline: Friday
- Constraint or risk: Mobile testing

#### Commitments
10 | Project Alpha | Finish migration

| Day | 07-08 | 08-09 | 09-10 | 10-11 |
| --- | --- | --- | --- | --- |
| Saturday | study ; Project Alpha | study ; Project Alpha | | |
| Sunday |${empty}
| Monday |${empty}
| Tuesday |${empty}
| Wednesday |${empty}
| Thursday |${empty}
| Friday |${empty}`;
}

function emptyDaily(date) {
  const sourceText = `#### EH Form
##### Sessions
ENTRIES:
<!-- interval | type | engagement | notes -->
##### Meals
#### END`;
  return {
    noteDate: date,
    fileName: `${date}.md`,
    filePath: `Oss Ahmad Journal/2026/daily/${date}.md`,
    sourceText,
    sourceChecksum: `checksum-${date}`,
  };
}

test('weekly plans import, collapse adjacent cells, and prepare guarded Daily Note writes', () => {
  const db = database();
  const input = {
    weekStartDate: '2026-08-22',
    fileName: '2026-W34.md',
    filePath: 'Oss Ahmad Journal/2026/weekly/2026-W34.md',
    sourceText: weeklyNote(),
    sourceChecksum: 'weekly-checksum',
  };
  const preview = inspectWeeklyPlan(db, input);
  assert.equal(preview.commitmentCount, 1);
  assert.equal(preview.sessionCount, 1);
  assert.equal(preview.plannedMinutes, 120);
  writeWeeklyPlan(db, input);
  assert.throws(() => inspectWeeklyPlan(db, input), /already been imported/);

  const notes = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 7, 22 + index)).toISOString().slice(0, 10);
    return emptyDaily(date);
  });
  const writePreview = prepareWeeklyDailyNoteWrites(db, '2026-08-22', '2026-08-22', notes);
  assert.equal(writePreview.writableNoteCount, 1);
  assert.equal(writePreview.writtenSessionCount, 1);
  assert.match(writePreview.notes[0].updatedText, /07:00-09:00 \| study \| Project Alpha \|/);
  db.close();
});
