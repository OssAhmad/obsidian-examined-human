import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { queryMealComponentState, writeMealInspection } from './meal-import.ts';
import { inspectMeals } from './meals.ts';

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const SQL = await initSqlJs({ wasmBinary });

const thresholds = {
  mealCalorieLimitKcal: 700,
  dailyCalorieLimitKcal: 1850,
  minimumProteinG: 90,
};

function database() {
  const db = new SQL.Database();
  db.run(`
    PRAGMA foreign_keys = ON;
    PRAGMA user_version = 1;
    CREATE TABLE imported_notes (note_date TEXT NOT NULL);
    CREATE TABLE meal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      meal_type TEXT NOT NULL,
      is_leisure INTEGER NOT NULL,
      classification_source TEXT NOT NULL,
      calorie_limit_kcal REAL,
      UNIQUE(day, meal_type)
    );
    CREATE TABLE daily_meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      food TEXT NOT NULL,
      calories REAL,
      protein_g REAL,
      meal_event_id INTEGER REFERENCES meal_events(id) ON DELETE CASCADE,
      item_ordinal INTEGER,
      food_id INTEGER,
      amount_g REAL,
      carbs_g REAL,
      fat_g REAL,
      salt_g REAL,
      fiber_g REAL,
      cholesterol_mg REAL
    );
    CREATE TABLE daily_meal_assessments (
      day TEXT PRIMARY KEY,
      daily_calorie_limit_kcal REAL NOT NULL,
      minimum_protein_g REAL NOT NULL,
      daily_calories_kcal REAL,
      daily_metrics_calories_kcal REAL,
      meal_items_calories_kcal REAL NOT NULL,
      daily_calorie_source TEXT NOT NULL,
      protein_g REAL,
      recorded_dieted INTEGER,
      evaluated_dieted INTEGER,
      evaluated_at TEXT NOT NULL
    );
    CREATE TABLE note_import_components (
      note_date TEXT NOT NULL,
      component TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL,
      source_file_path TEXT NOT NULL,
      source_checksum TEXT NOT NULL,
      plugin_version TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(note_date, component)
    );
    CREATE TABLE foods (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT,
      calories_kcal_per_100g REAL NOT NULL, protein_g_per_100g REAL NOT NULL,
      carbs_g_per_100g REAL NOT NULL, fat_g_per_100g REAL NOT NULL,
      salt_g_per_100g REAL NOT NULL, fiber_g_per_100g REAL,
      cholesterol_mg_per_100g REAL, notes TEXT
    );
    CREATE TABLE food_aliases (id INTEGER PRIMARY KEY, food_id INTEGER NOT NULL, alias TEXT NOT NULL);
    INSERT INTO foods VALUES
      (1, 'Eggs', NULL, 300, 28, 0, 0, 0, NULL, NULL, NULL),
      (2, 'Rice', NULL, 600, 20, 0, 0, 0, NULL, NULL, NULL),
      (3, 'Chicken', NULL, 500, 47, 0, 0, 0, NULL, NULL, NULL),
      (4, 'Chocolate', NULL, 500, 0, 0, 0, 0, NULL, NULL, NULL),
      (5, 'Yogurt', NULL, 200, 28, 0, 0, 0, NULL, NULL, NULL),
      (6, 'Oats', NULL, 250, 12, 0, 0, 0, NULL, NULL, NULL);
  `);
  return db;
}

function note(calories = 1900, breakfast = 'Eggs | 100') {
  return `
##### Daily Metrics
calories: ${calories}
protein_g: 95
dieted: 1

##### Meals
###### Breakfast
is_leisure:
ENTRIES:
${breakfast}

###### Lunch
is_leisure: 0
ENTRIES:
Rice | 100

###### Dinner
is_leisure: 0
ENTRIES:
Chicken | 100

###### Snacks
is_leisure: 1
ENTRIES:
Chocolate | 100

##### Sessions
`;
}

function input(db, date, today, content, checksum = 'abc123') {
  return {
    noteDate: date,
    todayDate: today,
    sourceFilePath: `Oss Ahmad Journal/${date}.md`,
    sourceChecksum: checksum,
    pluginVersion: '0.8.0',
    inspection: inspectMeals(db, content, thresholds),
  };
}

test('historical Meals import is finalized, auditable, and immutable', () => {
  const db = database();
  try {
    const result = writeMealInspection(db, input(db, '2026-08-19', '2026-08-21', note()));
    assert.deepEqual(result, {
      lifecycleState: 'finalized',
      replaced: false,
      mealEventCount: 4,
      foodRowCount: 4,
      leisureMeals: 2,
    });
    assert.equal(db.exec('SELECT COUNT(*) FROM meal_events')[0].values[0][0], 4);
    assert.equal(db.exec('SELECT COUNT(*) FROM daily_meals')[0].values[0][0], 4);
    assert.equal(db.exec("SELECT is_leisure FROM meal_events WHERE meal_type='snacks'")[0].values[0][0], 0);
    assert.equal(db.exec('SELECT evaluated_dieted FROM daily_meal_assessments')[0].values[0][0], 0);
    assert.equal(queryMealComponentState(db, '2026-08-19')?.lifecycleState, 'finalized');
    assert.throws(
      () => writeMealInspection(db, input(db, '2026-08-19', '2026-08-21', note(1700), 'changed')),
      /already imported/,
    );
  } finally {
    db.close();
  }
});

test('current and future Meals imports replace only linked native rows', () => {
  const db = database();
  try {
    db.run("INSERT INTO daily_meals (day, food) VALUES ('2026-08-21', 'legacy row')");
    const first = writeMealInspection(db, input(db, '2026-08-21', '2026-08-21', note()));
    assert.equal(first.lifecycleState, 'ephemeral');
    const second = writeMealInspection(
      db,
      input(db, '2026-08-21', '2026-08-21', note(1700, 'Yogurt | 100'), 'replacement'),
    );
    assert.equal(second.replaced, true);
    const third = writeMealInspection(
      db,
      input(db, '2026-08-21', '2026-08-21', note(1800, 'Oats | 100'), 'replacement-again'),
    );
    assert.equal(third.replaced, true);
    assert.equal(third.lifecycleState, 'ephemeral');
    assert.equal(db.exec("SELECT COUNT(*) FROM daily_meals WHERE meal_event_id IS NULL")[0].values[0][0], 1);
    assert.equal(db.exec("SELECT COUNT(*) FROM daily_meals WHERE meal_event_id IS NOT NULL")[0].values[0][0], 4);
    assert.equal(queryMealComponentState(db, '2026-08-21')?.sourceChecksum, 'replacement-again');
  } finally {
    db.close();
  }
});

test('an ephemeral Meals component can be replaced and finalized after its date becomes historical', () => {
  const db = database();
  try {
    const first = writeMealInspection(db, input(db, '2026-08-21', '2026-08-21', note()));
    assert.equal(first.lifecycleState, 'ephemeral');

    const finalized = writeMealInspection(
      db,
      input(db, '2026-08-21', '2026-08-22', note(1700, 'Yogurt | 100'), 'finalized-replacement'),
    );
    assert.equal(finalized.lifecycleState, 'finalized');
    assert.equal(finalized.replaced, true);
    assert.equal(queryMealComponentState(db, '2026-08-21')?.sourceChecksum, 'finalized-replacement');
    assert.equal(
      db.exec("SELECT food FROM daily_meals WHERE item_ordinal=1 ORDER BY id LIMIT 1")[0].values[0][0],
      'Yogurt',
    );
    assert.throws(
      () => writeMealInspection(db, input(db, '2026-08-21', '2026-08-22', note(), 'too-late')),
      /already imported/,
    );
  } finally {
    db.close();
  }
});

test('a full canonical Daily Note import blocks component import', () => {
  const db = database();
  try {
    db.run("INSERT INTO imported_notes VALUES ('2026-08-20')");
    assert.throws(
      () => writeMealInspection(db, input(db, '2026-08-20', '2026-08-21', note())),
      /already finalized by the full Daily Note importer/,
    );
  } finally {
    db.close();
  }
});
