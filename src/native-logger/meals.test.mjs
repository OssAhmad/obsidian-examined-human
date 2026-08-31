import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { inspectMeals } from './meals.ts';

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const SQL = await initSqlJs({ wasmBinary });
const db = new SQL.Database();
db.run(`
  CREATE TABLE foods (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT,
    calories_kcal_per_100g REAL NOT NULL, protein_g_per_100g REAL NOT NULL,
    carbs_g_per_100g REAL NOT NULL, fat_g_per_100g REAL NOT NULL,
    salt_g_per_100g REAL NOT NULL, fiber_g_per_100g REAL,
    cholesterol_mg_per_100g REAL, notes TEXT
  );
  CREATE TABLE food_aliases (id INTEGER PRIMARY KEY, food_id INTEGER NOT NULL, alias TEXT NOT NULL);
  INSERT INTO foods VALUES
    (1, 'Kabab', NULL, 456, 31, 0, 0, 0, NULL, NULL, NULL),
    (2, 'Rice', NULL, 270, 6, 0, 0, 0, NULL, NULL, NULL),
    (3, 'Three pizzas', NULL, 3000, 90, 0, 0, 0, NULL, NULL, NULL),
    (4, 'Oats', NULL, 300, 20, 0, 0, 0, NULL, NULL, NULL);
`);

function note({ calories = '4000', protein = '127', dieted = '1', meals = '' } = {}) {
  return `
#### EH Form

##### Daily Metrics
calories: ${calories}
protein_g: ${protein}
dieted: ${dieted}

##### Meals
${meals}

##### Transactions
ENTRIES:
`;
}

const completeMeals = `
###### Breakfast
is_leisure:
ENTRIES:
Kabab | 100
Rice | 100

###### Lunch
is_leisure: 0
ENTRIES:

###### Dinner
is_leisure:
ENTRIES:

###### Snacks
ENTRIES:
Three pizzas | 100
`;

const thresholds = { mealCalorieLimitKcal: 700, dailyCalorieLimitKcal: 1850, minimumProteinG: 0 };

test('evaluates canonical-food totals, includes snacks, and applies the two-meal floor', () => {
  const result = inspectMeals(db, note({ meals: completeMeals }), thresholds);
  assert.equal(result.ready, true);
  assert.equal(result.meals.find((meal) => meal.type === 'breakfast')?.totalCaloriesKcal, 726);
  assert.equal(result.meals.find((meal) => meal.type === 'breakfast')?.evaluatedIsLeisure, 1);
  assert.equal(result.meals.find((meal) => meal.type === 'snacks')?.evaluatedIsLeisure, 0);
  assert.equal(result.directLeisureMeals, 1);
  assert.equal(result.dailyLimitExceeded, true);
  assert.equal(result.leisureMeals, 2);
  assert.equal(result.nutrition.evaluatedDieted, 0);
  assert.equal(result.nutrition.mealItemsCaloriesKcal, 3726);
  assert.equal(result.nutrition.dailyCaloriesKcal, 4000);
});

test('accepts an optional g suffix and canonical food aliases', () => {
  db.run("INSERT INTO food_aliases (food_id, alias) VALUES (1, 'Kabab koobideh')");
  const result = inspectMeals(db, note({ meals: completeMeals.replace('Kabab | 100', 'Kabab koobideh | 100 g') }), thresholds);
  assert.equal(result.ready, true);
  assert.equal(result.meals[0].items[0].food, 'Kabab');
  assert.equal(result.meals[0].items[0].amountG, 100);
});

test('zero nutrition thresholds trust the recorded dieted value and disable automatic limits', () => {
  const result = inspectMeals(db, note({ calories: '', protein: '', dieted: '1', meals: completeMeals }), {
    mealCalorieLimitKcal: 0, dailyCalorieLimitKcal: 0, minimumProteinG: 0,
  });
  assert.equal(result.ready, true);
  assert.equal(result.directLeisureMeals, 0);
  assert.equal(result.dailyLimitExceeded, false);
  assert.equal(result.nutrition.evaluatedDieted, 1);
});

test('rejects legacy three-field, unknown-food, and malformed amount rows', () => {
  const legacy = inspectMeals(db, note({ meals: completeMeals.replace('Kabab | 100', 'Kabab | 456 | 31') }), thresholds);
  assert.equal(legacy.ready, false);
  assert.match(legacy.errors.join('\n'), /food \| amount_g/);
  const unknown = inspectMeals(db, note({ meals: completeMeals.replace('Kabab | 100', 'Mystery food | 100') }), thresholds);
  assert.equal(unknown.ready, false);
  assert.match(unknown.errors.join('\n'), /not in the Food Library/);
  const malformed = inspectMeals(db, note({ meals: completeMeals.replace('Kabab | 100', 'Kabab | nope') }), thresholds);
  assert.equal(malformed.ready, false);
  assert.match(malformed.errors.join('\n'), /invalid gram amount/);
});
