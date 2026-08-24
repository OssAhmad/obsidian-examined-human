import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import {
  queryExerciseDashboard,
  queryFinancialDashboard,
  queryNutritionDashboard,
} from './eqh-query.ts';

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const schema = await readFile(new URL('../migrations/000_create_schema_v5.sql', import.meta.url), 'utf8');
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
      (1, 'Cash', 'cash', 'USD'),
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
