import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import {
  queryExerciseDashboard,
  queryCommandCatalog,
  queryFinancialDashboard,
  queryFoodLibrary,
  queryNutritionDashboard,
} from './examined-human-query.ts';

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const schema = await readFile(new URL('../migrations/000_create_schema_v1.sql', import.meta.url), 'utf8');
const SQL = await initSqlJs({ wasmBinary });

function fixture() {
  const db = new SQL.Database();
  db.run(schema);
  db.run(`
    INSERT INTO engagements (id, name, type_id, status_id)
    VALUES (
      1,
      'Health Project',
      (SELECT id FROM engagement_types WHERE code = 'fitness'),
      (SELECT id FROM engagement_statuses WHERE code = 'active')
    );
    INSERT INTO accounts (id, name, type, currency) VALUES
      (1, 'Cash', 'cash', ' usd '),
      (2, 'Travel', 'cash', 'EUR');
    INSERT INTO transactions (id, account_id, date, amount, category, description) VALUES
      (1, 1, '2026-07-02', 100, '1', 'Income'),
      (2, 1, '2026-07-03', -30, '1', 'Supplies'),
      (3, 2, '2026-07-04', -20, 'legacy', 'Legacy row');

    INSERT INTO daily_metrics (date, calories, protein_g, dieted) VALUES
      ('2026-07-01', 2000, 100, 0),
      ('2026-07-02', 1800, 95, 1);
    INSERT INTO meal_events (id, day, meal_type, is_leisure, classification_source, calorie_limit_kcal) VALUES
      (1, '2026-07-02', 'breakfast', 0, 'default', 700),
      (2, '2026-07-02', 'lunch', 1, 'manual', 700),
      (3, '2026-07-02', 'dinner', 0, 'default', 700),
      (4, '2026-07-02', 'snacks', 0, 'default', 700);
    INSERT INTO daily_meals (day, food, calories, protein_g, meal_event_id, item_ordinal) VALUES
      ('2026-07-02', 'Eggs', 600, 40, 1, 1),
      ('2026-07-02', 'Rice', 700, 20, 2, 1),
      ('2026-07-02', 'Chicken', 400, 35, 3, 1),
      ('2026-07-02', 'Tea', 0, 0, 4, 1);
    INSERT INTO daily_meal_assessments (
      day, daily_calorie_limit_kcal, minimum_protein_g, daily_calories_kcal,
      daily_metrics_calories_kcal, meal_items_calories_kcal, daily_calorie_source,
      protein_g, recorded_dieted, evaluated_dieted
    ) VALUES ('2026-07-02', 1850, 90, 1800, 1800, 1700, 'higher_of_both', 95, 1, 1);

    INSERT INTO sessions (id, engagement_id, date, start_time, end_time, duration_minutes, session_type_id) VALUES
      (1, 1, '2026-07-01', '08:00', '09:00', 60, (SELECT id FROM session_types WHERE code = 'exercise')),
      (2, 1, '2026-07-02', '08:00', '08:30', 30, (SELECT id FROM session_types WHERE code = 'study')),
      (3, 1, '2026-07-03', '08:00', '08:30', 30, (SELECT id FROM session_types WHERE code = 'study'));
    INSERT INTO exercises (id, name, category) VALUES
      (1, 'Squat', 'strength'),
      (2, 'Walk', 'cardio');
    INSERT INTO session_exercises (id, session_id, exercise_id, order_index) VALUES
      (1, 1, 1, 1),
      (2, 2, 2, 1);
    INSERT INTO exercise_sets (id, session_exercise_id, set_number, weight, reps, distance) VALUES
      (1, 1, 1, 50, 5, NULL),
      (2, 1, 2, 60, 4, NULL),
      (3, 2, 1, NULL, NULL, 2.5),
      (4, 2, 2, NULL, NULL, NULL);
    INSERT INTO muscles (id, name, body_region) VALUES (1, 'Quadriceps', 'legs');
    INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (1, 1, 'primary');
  `);
  return db;
}

test('financial dashboard reconciles currencies and excludes unresolved rows only from engagement analysis', () => {
  const db = fixture();
  try {
    const result = queryFinancialDashboard(db, '2026-07-01', '2026-07-31');
    assert.equal(result.transactionCount, 3);
    assert.equal(result.linkedTransactionCount, 2);
    assert.equal(result.unresolvedTransactionCount, 1);
    assert.deepEqual(result.currencies, [
      { currency: 'EUR', transactionCount: 1, inflow: 0, outflow: 20, net: -20 },
      { currency: 'USD', transactionCount: 2, inflow: 100, outflow: 30, net: 70 },
    ]);
    assert.equal(result.engagements.length, 1);
    assert.equal(result.engagements[0].outflow, 30);
    assert.equal(result.recentTransactions[0].engagementName, null);
    assert.equal(result.accounts.find((account) => account.accountName === 'Cash')?.balance, 70);
    assert.equal(result.accounts.find((account) => account.accountName === 'Travel')?.balance, -20);
    assert.equal(result.activeBudget, null);
  } finally {
    db.close();
  }
});

test('finance dashboard derives ledger balances, excludes one unambiguous transfer pair, and matches expected movements conservatively', () => {
  const db = fixture();
  try {
    db.run(`
      INSERT INTO accounts (id, name, type, currency) VALUES (3, 'Savings', 'cash', 'USD');
      INSERT INTO transactions (id, account_id, date, amount, category, description) VALUES
        (4, 1, '2026-07-05', -50, '1', 'moved to Savings'),
        (5, 3, '2026-07-05', 50, '1', 'moved from Cash'),
        (6, 1, '2026-07-06', 500, '1', '[EH opening balance] initial amount'),
        (7, 1, '2026-07-07', -10, '1', '[EH reconciliation] forgotten cash purchase');
      INSERT INTO budget_plans (id, period_start, period_end, source_file_name, source_file_path, source_checksum)
        VALUES (1, '2026-07-01', '2026-07-31', 'July Budget.md', 'Plans/July Budget.md', 'checksum');
      INSERT INTO budget_targets (budget_plan_id, source_ordinal, currency, amount, engagement_id, engagement_raw)
        VALUES (1, 1, 'USD', -100, 1, 'Health Project');
      INSERT INTO expected_financial_movements (
        budget_plan_id, source_ordinal, due_date, currency, amount, account_id, engagement_id, engagement_raw, description
      ) VALUES (1, 1, '2026-07-03', 'USD', -30, 1, 1, 'Health Project', 'Supplies');
    `);
    const result = queryFinancialDashboard(db, '2026-07-01', '2026-07-31');
    assert.deepEqual(result.currencies.find((currency) => currency.currency === 'USD'), {
      currency: 'USD', transactionCount: 2, inflow: 100, outflow: 30, net: 70,
    });
    const cash = result.accounts.find((account) => account.accountName === 'Cash');
    assert.equal(cash?.balance, 510);
    assert.equal(cash?.openingBalance, 500);
    assert.equal(cash?.reconciliationAdjustment, -10);
    assert.equal(cash?.transferOut, 50);
    assert.equal(result.recentTransactions.find((transaction) => transaction.id === 4)?.kind, 'transfer');
    assert.equal(result.activeBudget?.targets[0].actualAmount, -30);
    assert.equal(result.activeBudget?.expectedMovements[0].isMatched, true);
    assert.equal(result.explorer.accountId, null);
    assert.equal(result.explorer.valuationInflow, 100);
    assert.equal(result.explorer.valuationOutflow, 30);
    assert.equal(result.explorer.missingFlowValuationTransactionCount, 1);
  } finally {
    db.close();
  }
});

test('finance account explorer carries exact daily balances and supports native and valued account views', () => {
  const db = fixture();
  try {
    const result = queryFinancialDashboard(db, '2026-07-01', '2026-07-05', {
      label: 'EHM', referenceUnit: 'USD', selectedAccountId: 1,
    });
    assert.equal(result.explorer.accountName, 'Cash');
    assert.equal(result.explorer.nativeCurrency, 'USD');
    assert.equal(result.explorer.nativeBalance, 70);
    assert.equal(result.explorer.nativeInflow, 100);
    assert.equal(result.explorer.nativeOutflow, 30);
    assert.equal(result.explorer.valuationBalance, 70);
    assert.deepEqual(result.explorer.balanceHistory.map((point) => [point.date, point.nativeBalance, point.valuationBalance]), [
      ['2026-07-01', 0, 0],
      ['2026-07-02', 100, 100],
      ['2026-07-03', 70, 70],
      ['2026-07-04', 70, 70],
      ['2026-07-05', 70, 70],
    ]);
    assert.equal(result.explorer.engagements[0].engagementName, 'Health Project');
    assert.equal(result.explorer.engagements[0].nativeInflow, 100);
    assert.equal(result.explorer.engagements[0].nativeOutflow, 30);
    assert.equal(result.recentTransactions.every((transaction) => transaction.accountId === 1), true);
  } finally {
    db.close();
  }
});

test('finance valuation history carries rates forward without applying them backward', () => {
  const db = fixture();
  try {
    db.run(`
      INSERT INTO accounts (id, name, type, currency) VALUES (3, 'Apartment', 'property', 'Apartment');
      INSERT INTO transactions (id, account_id, date, amount, category, description)
        VALUES (4, 3, '2026-01-01', 1, '1', '[EH opening balance] apartment');
      INSERT INTO valuation_rate_sets (id, rate_date, source_file_name, source_file_path, source_checksum)
        VALUES (1, '2026-01-06', '2026-01-06.md', 'Journal/2026-01-06.md', 'rate-set');
      INSERT INTO valuation_rates (rate_set_id, source_ordinal, unit_key, unit_label, value)
        VALUES (1, 1, 'APARTMENT', 'Apartment', 2300000);
    `);
    const result = queryFinancialDashboard(db, '2026-01-04', '2026-01-07', {
      label: 'EHM', referenceUnit: 'USD', selectedAccountId: 3,
    });
    assert.deepEqual(result.explorer.balanceHistory.map((point) => [point.date, point.valuationBalance, point.missingAccountCount]), [
      ['2026-01-04', null, 1],
      ['2026-01-05', null, 1],
      ['2026-01-06', 2300000, 0],
      ['2026-01-07', 2300000, 0],
    ]);
    assert.equal(result.explorer.valuationBalance, 2300000);
  } finally {
    db.close();
  }
});

test('financial valuation carries each unit forward independently through the selected as-of date', () => {
  const db = fixture();
  try {
    db.run(`
      INSERT INTO accounts (id, name, type, currency) VALUES (3, 'Apartment', 'property', 'Apartment');
      INSERT INTO transactions (id, account_id, date, amount, category, description)
        VALUES (4, 3, '2026-01-06', 1, '1', '[EH opening balance] recorded property unit');
      INSERT INTO valuation_rate_sets (id, rate_date, source_file_name, source_file_path, source_checksum)
        VALUES (1, '2026-01-06', '2026-01-06.md', 'Journal/2026-01-06.md', 'jan-rate-set'),
               (2, '2026-08-01', '2026-08-01.md', 'Journal/2026-08-01.md', 'aug-rate-set');
      INSERT INTO valuation_rates (rate_set_id, source_ordinal, unit_key, unit_label, value) VALUES
        (1, 1, 'APARTMENT', 'Apartment', 2300000),
        (1, 2, 'EUR', 'EUR', 1.20),
        (2, 1, 'EUR', 'EUR', 1.10);
    `);
    const july = queryFinancialDashboard(db, null, '2026-07-31', { label: 'EHM', referenceUnit: 'USD' });
    const apartmentInJuly = july.accounts.find((account) => account.accountName === 'Apartment');
    assert.equal(apartmentInJuly?.valuationAmount, 2300000);
    assert.equal(apartmentInJuly?.valuationRateDate, '2026-01-06');
    assert.equal(july.accounts.find((account) => account.accountName === 'Cash')?.valuationKind, 'reference');

    const august = queryFinancialDashboard(db, null, '2026-08-02', { label: 'EHM', referenceUnit: 'USD' });
    const apartmentInAugust = august.accounts.find((account) => account.accountName === 'Apartment');
    const travelInAugust = august.accounts.find((account) => account.accountName === 'Travel');
    assert.equal(apartmentInAugust?.valuationAmount, 2300000, 'an omitted apartment rate must carry forward indefinitely');
    assert.equal(apartmentInAugust?.valuationRateDate, '2026-01-06');
    assert.equal(travelInAugust?.valuationRate, 1.10, 'a newer EUR rate updates EUR only');
    assert.equal(travelInAugust?.valuationRateDate, '2026-08-01');
  } finally {
    db.close();
  }
});

test('nutrition dashboard preserves legacy adherence while limiting leisure debt to assessed meal days', () => {
  const db = fixture();
  try {
    const result = queryNutritionDashboard(db, '2026-07-01', '2026-07-31');
    assert.equal(result.recordedDays, 2);
    assert.equal(result.dietedEvaluatedDays, 2);
    assert.equal(result.dietedDays, 1);
    assert.equal(result.daily[0].dietedSource, 'recorded');
    assert.equal(result.daily[1].dietedSource, 'evaluated');
    assert.deepEqual(result.leisureDebt, {
      targetRate: 0.1,
      assessedDays: 1,
      countedMeals: 3,
      leisureMeals: 1,
      leisureRate: 1 / 3,
      debtMeals: 0.7,
      balanceDays: 3,
    });
    assert.equal(result.mealTypes.find((meal) => meal.mealType === 'snacks')?.leisureMeals, 0);
    assert.equal(result.topFoods[0].food, 'Rice');
  } finally {
    db.close();
  }
});

test('Food Library exposes canonical values, aliases, usage, and command choices without mutating data', () => {
  const db = fixture();
  try {
    db.run(`
      INSERT INTO foods (
        id, name, category, calories_kcal_per_100g, protein_g_per_100g,
        carbs_g_per_100g, fat_g_per_100g, salt_g_per_100g, fiber_g_per_100g,
        cholesterol_mg_per_100g, notes
      ) VALUES (1, 'Egg', 'protein', 143, 13, 1.1, 9.5, 0.12, NULL, 372, 'Boiled values');
      INSERT INTO food_aliases (food_id, alias) VALUES (1, 'Eggs'), (1, 'boiled egg');
      UPDATE daily_meals SET food_id = 1 WHERE food = 'Eggs';
    `);
    const foods = queryFoodLibrary(db);
    assert.equal(foods.length, 1);
    assert.equal(foods[0].name, 'Egg');
    assert.deepEqual(foods[0].aliases, ['boiled egg', 'Eggs']);
    assert.equal(foods[0].timesLogged, 1);
    assert.equal(foods[0].cholesterolMgPer100g, 372);
    const catalog = queryCommandCatalog(db);
    assert.equal(catalog.foods[0].name, 'Egg');
    assert.equal(catalog.engagements[0].name, 'Health Project');
    assert.equal(catalog.exercises[0].name, 'Squat');
    assert.equal(catalog.accounts[0].name, 'Cash');
  } finally {
    db.close();
  }
});

test('exercise dashboard counts typed workouts and sessions with structured exercise details', () => {
  const db = fixture();
  try {
    const result = queryExerciseDashboard(db, '2026-07-01', '2026-07-31');
    assert.equal(result.workoutCount, 2);
    assert.equal(result.trainingDays, 2);
    assert.equal(result.totalMinutes, 90);
    assert.equal(result.detailedWorkoutCount, 2);
    assert.equal(result.totalSets, 4);
    assert.equal(result.setsWithoutMeasurements, 1);
    assert.equal(result.exercises.length, 2);
    assert.equal(result.exercises.find((exercise) => exercise.exerciseName === 'Squat')?.loadVolume, 490);
    assert.equal(result.muscles[0].exposureSets, 2);
    assert.deepEqual(result.recentWorkouts.map((workout) => workout.id), [2, 1]);
  } finally {
    db.close();
  }
});
