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
const schema = await readFile(new URL('../../migrations/000_create_schema_v1.sql', import.meta.url), 'utf8');
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
    INSERT INTO foods (
      name, calories_kcal_per_100g, protein_g_per_100g, carbs_g_per_100g,
      fat_g_per_100g, salt_g_per_100g, fiber_g_per_100g, cholesterol_mg_per_100g
    ) VALUES
      ('Eggs', 300, 25, 0, 20, 1, 0, 0),
      ('Rice', 600, 15, 100, 3, 1, 2, 0),
      ('Chicken', 550, 60, 0, 20, 1, 0, 90),
      ('Chocolate', 550, 0, 60, 30, 1, 4, 0);
  `);
  return db;
}

const thresholds = {
  mealCalorieLimitKcal: 700,
  dailyCalorieLimitKcal: 1850,
  minimumProteinG: 90,
};

function dailyNote(date = '2026-08-20') {
  return `#### EH Daily Form
date: ${date}

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
Eggs | 100

###### Lunch
is_leisure: 0
ENTRIES:
Rice | 100

###### Dinner
is_leisure: 0
ENTRIES:
Chicken | 100

###### Snacks
is_leisure: 0
ENTRIES:
Chocolate | 100

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

##### Valuation Rates
ENTRIES:
USD | 1
Apartment | 2300000

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
  assert.deepEqual(inspection.preview.valuationRates, [{ unit: 'USD', value: 1 }, { unit: 'Apartment', value: 2300000 }]);

  const result = writeHistoricalDailyNote(db, input);
  assert.equal(result.sessionCount, 2);
  assert.equal(result.exerciseSetCount, 1);
  assert.equal(result.valuationRateCount, 2);
  assert.equal(db.exec('SELECT COUNT(*) FROM imported_notes')[0].values[0][0], 1);
  assert.equal(db.exec('SELECT dieted FROM daily_metrics')[0].values[0][0], 0);
  assert.equal(db.exec('SELECT COUNT(*) FROM account_aliases')[0].values[0][0], 1);
  assert.equal(String(db.exec('SELECT category FROM transactions')[0].values[0][0]), '1');
  assert.equal(db.exec('SELECT COUNT(*) FROM engagement_measurements')[0].values[0][0], 1);
  assert.deepEqual(db.exec('SELECT unit_key, value FROM valuation_rates ORDER BY source_ordinal')[0].values, [['USD', 1], ['APARTMENT', 2300000]]);
  assert.throws(() => writeHistoricalDailyNote(db, input), /already represented/);
  db.close();
});

test('focused Admin Events safely maintain aliases, engagements, exercises, and accounts', () => {
  const db = database();
  const sourceText = dailyNote()
    .replace('12.5 | Cash | Alpha spending | lunch', '12.5 | Pocket cash | Project Alpha | lunch')
    .replace('ACCOUNT_ALIAS | Cash | Wallet', [
    'ENGAGEMENT_CREATE | Project Beta | course | active |',
    'ENGAGEMENT_ALIAS_ADD | Project Alpha | Alpha alt',
    'ENGAGEMENT_ALIAS_MOVE | Alpha spending | Project Beta',
    'ENGAGEMENT_ALIAS_REMOVE | Project Beta | Alpha spending',
    'ENGAGEMENT_SET_STATUS | Project Alpha | paused',
    'ENGAGEMENT_REOPEN | Project Alpha',
    'ENGAGEMENT_SET_DATES | Project Alpha | 2026-08-01 | 2026-09-01',
    'ENGAGEMENT_SET_NOTES | Project Alpha | Focused notes',
    'EXERCISE_ALIAS_ADD | Run | Jog',
    'EXERCISE_ALIAS_REMOVE | Run | Jog',
    'EXERCISE_CREATE | Kettlebell swing | strength',
    'EXERCISE_UPDATE | Kettlebell swing | Kettlebell Swing | power | [KB swing]',
    'ACCOUNT_CREATE | Euro card | cash | EUR | Visa',
    'ACCOUNT_SET_CURRENCY | Cash | USD',
    'ACCOUNT_RENAME | Cash | Pocket cash',
    'ACCOUNT_ALIAS_ADD | Pocket cash | Wallet',
    'ACCOUNT_ALIAS_REMOVE | Pocket cash | Wallet',
    'FOOD_CREATE | Greek yogurt | dairy | 100 | 10 | 4 | 2 | 0.1 |  | 15 | creamy | [yogurt, greek]',
    'FOOD_UPDATE | Greek yogurt | dairy | 110 | 11 | 5 | 2 | 0.1 | 1 | 16 | updated',
    'FOOD_ALIAS_REMOVE | Greek yogurt | [greek]',
    'FOOD_RENAME | Greek yogurt | Yogurt Greek',
    'FOOD_CREATE | Temporary food | misc | 1 | 1 | 1 | 1 | 1 |  |  |  |',
    'FOOD_DELETE | Temporary food',
    ].join('\n'));
  const input = {
    noteDate: '2026-08-20',
    todayDate: '2026-08-21',
    fileName: '2026-08-20.md',
    filePath: 'Oss Ahmad Journal/2026/daily/2026-08-20.md',
    sourceText,
    sourceChecksum: 'focused-admin-events',
    pluginVersion: '0.9.2',
    nutritionThresholds: thresholds,
  };
  const inspectionDb = new SQL.Database(db.export());
  const inspection = inspectDailyNote(inspectionDb, input);
  assert.equal(inspection.ready, true, inspection.errors.join('\n'));
  inspectionDb.close();
  writeHistoricalDailyNote(db, input);
  const engagement = db.exec(`
    SELECT e.start_date, e.target_date, e.notes, s.code
    FROM engagements e JOIN engagement_statuses s ON s.id = e.status_id
    WHERE e.name = 'Project Alpha'
  `)[0].values[0];
  assert.deepEqual(engagement, ['2026-08-01', '2026-09-01', 'Focused notes', 'active']);
  assert.equal(db.exec("SELECT COUNT(*) FROM engagement_aliases WHERE alias = 'Alpha spending'")[0].values[0][0], 0);
  assert.equal(db.exec("SELECT COUNT(*) FROM engagement_aliases WHERE alias = 'Alpha alt'")[0].values[0][0], 1);
  assert.equal(db.exec("SELECT COUNT(*) FROM exercise_aliases WHERE alias = 'Jog'")[0].values[0][0], 0);
  assert.deepEqual(
    db.exec("SELECT name, category FROM exercises WHERE name = 'Kettlebell Swing'")[0].values[0],
    ['Kettlebell Swing', 'power'],
  );
  assert.equal(db.exec("SELECT COUNT(*) FROM exercise_aliases WHERE alias = 'KB swing'")[0].values[0][0], 1);
  assert.deepEqual(
    db.exec("SELECT name, type, currency, address FROM accounts WHERE name = 'Euro card'")[0].values[0],
    ['Euro card', 'cash', 'EUR', 'Visa'],
  );
  assert.deepEqual(
    db.exec("SELECT name, currency FROM accounts WHERE id = 1")[0].values[0],
    ['Pocket cash', 'USD'],
  );
  assert.equal(db.exec("SELECT COUNT(*) FROM account_aliases WHERE alias = 'Wallet'")[0].values[0][0], 0);
  assert.deepEqual(
    db.exec("SELECT name, calories_kcal_per_100g, fiber_g_per_100g, cholesterol_mg_per_100g FROM foods WHERE name = 'Yogurt Greek'")[0].values[0],
    ['Yogurt Greek', 110, 1, 16],
  );
  assert.equal(db.exec("SELECT COUNT(*) FROM food_aliases WHERE alias = 'yogurt'")[0].values[0][0], 1);
  assert.equal(db.exec("SELECT COUNT(*) FROM food_aliases WHERE alias = 'greek'")[0].values[0][0], 0);
  assert.equal(db.exec("SELECT COUNT(*) FROM foods WHERE name = 'Temporary food'")[0].values[0][0], 0);
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
    inspection: inspectMeals(db, sourceText, thresholds),
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
    inspection: inspectMeals(db, dailyNote(), thresholds),
  });
  const changed = dailyNote().replace('Eggs | 100', 'Eggs | 110');
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
  assert.equal(db.exec("SELECT calories FROM daily_meals WHERE food='Eggs'")[0].values[0][0], 330);
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
    inspection: inspectMeals(db, dailyNote(), thresholds),
  });
  const changed = dailyNote().replace('Eggs | 100', 'Eggs | 101');
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
  const sourceText = `#### EH Daily Form
date: 2026-08-21
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

test('current and future planning ignores examples and instructional ENTRIES mentions', () => {
  const sourceText = `#### EH Daily Form
date: 2026-08-21
##### Sessions
FORMAT:
\`interval | session type | engagement | notes\`

EXAMPLES (do not copy these below \`ENTRIES:\` unless they are real):
\`09:00-10:30 | study | Jannach German for Reading | studied Kapitel 4\`
\`14:00-15:30 | work | Mensonaut Paper | wrote related zettels\`

ENTRIES:
10:00-11:00 | study | Project Alpha | real session
##### Meals
#### END`;

  const parsed = inspectPlannedNote(sourceText, '2026-08-21');
  assert.equal(parsed.parseStatus, 'ok');
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.sessions.length, 1);
  assert.equal(parsed.sessions[0].engagementRaw, 'Project Alpha');
  assert.equal(parsed.sessions[0].notes, 'real session');
});

function weeklyNote() {
  const empty = ' |'.repeat(4);
  return `#### EH Weekly Form
start date: 2026-08-22
end date: 2026-08-28
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
| Friday |${empty}
#### END`;
}

function emptyDaily(date) {
  const sourceText = `#### EH Daily Form
date: ${date}
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
  assert.equal(inspectWeeklyPlan(db, input).weekStart, '2026-08-22');

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
