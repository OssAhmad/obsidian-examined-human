import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMeals } from './meals.ts';

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
Kabab | 456 | 31
Rice | 270 | 6

###### Lunch
is_leisure: 0
ENTRIES:

###### Dinner
is_leisure:
ENTRIES:

###### Snacks
ENTRIES:
Three pizzas | 3000 | 90
`;

test('evaluates meal totals, includes snacks in the daily total, and applies the two-meal floor', () => {
  const result = inspectMeals(note({ meals: completeMeals }), {
    mealCalorieLimitKcal: 700,
    dailyCalorieLimitKcal: 1850,
    minimumProteinG: 0,
  });
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

test('zero nutrition thresholds trust the recorded dieted value and disable automatic limits', () => {
  const result = inspectMeals(note({ calories: '', protein: '', dieted: '1', meals: completeMeals }), {
    mealCalorieLimitKcal: 0,
    dailyCalorieLimitKcal: 0,
    minimumProteinG: 0,
  });
  assert.equal(result.ready, true);
  assert.equal(result.directLeisureMeals, 0);
  assert.equal(result.dailyLimitExceeded, false);
  assert.equal(result.nutrition.evaluatedDieted, 1);
});

test('minimum protein participates in objective dieted evaluation', () => {
  const result = inspectMeals(note({ calories: '1800', protein: '89', dieted: '1', meals: completeMeals }), {
    mealCalorieLimitKcal: 0,
    dailyCalorieLimitKcal: 2200,
    minimumProteinG: 90,
  });
  assert.equal(result.ready, true);
  assert.equal(result.nutrition.evaluatedDieted, 0);
});

test('manual leisure survives a disabled or unexceeded meal threshold', () => {
  const meals = completeMeals.replace('###### Lunch\nis_leisure: 0', '###### Lunch\nis_leisure: 1');
  const result = inspectMeals(note({ calories: '1700', meals }), {
    mealCalorieLimitKcal: 900,
    dailyCalorieLimitKcal: 0,
    minimumProteinG: 0,
  });
  assert.equal(result.ready, true);
  assert.equal(result.meals.find((meal) => meal.type === 'lunch')?.classificationSource, 'manual');
  assert.equal(result.directLeisureMeals, 1);
  assert.equal(result.leisureMeals, 1);
});

test('structured snack calories cannot be hidden by an understated Daily Metrics total', () => {
  const result = inspectMeals(note({ calories: '1000', meals: completeMeals }), {
    mealCalorieLimitKcal: 0,
    dailyCalorieLimitKcal: 1850,
    minimumProteinG: 0,
  });
  assert.equal(result.ready, true);
  assert.equal(result.nutrition.dailyCaloriesKcal, 3726);
  assert.equal(result.nutrition.dailyCalorieSource, 'higher_of_both');
  assert.equal(result.leisureMeals, 2);
  assert.match(result.warnings.join('\n'), /snacks and meals remain reflected/i);
});

test('missing meal headings become empty non-leisure opportunities with warnings', () => {
  const result = inspectMeals(note({ meals: `
###### Breakfast
is_leisure:
ENTRIES:
Oats | 300 | 20
` }), {
    mealCalorieLimitKcal: 500,
    dailyCalorieLimitKcal: 0,
    minimumProteinG: 0,
  });
  assert.equal(result.ready, true);
  assert.equal(result.meals.length, 4);
  assert.equal(result.directLeisureMeals, 0);
  assert.match(result.warnings.join('\n'), /lunch is missing/i);
});

test('rejects legacy or malformed food data instead of guessing', () => {
  const legacy = `
##### Daily Metrics
- FOODS:
- oats | 300 | 20
calories: 300
protein_g: 20
dieted: 1
`;
  const result = inspectMeals(legacy, {
    mealCalorieLimitKcal: 0,
    dailyCalorieLimitKcal: 1850,
    minimumProteinG: 0,
  });
  assert.equal(result.ready, false);
  assert.match(result.errors.join('\n'), /does not contain a ##### Meals section/);

  const malformed = inspectMeals(note({ meals: `
###### Breakfast
is_leisure: maybe
ENTRIES:
Oats | nope | 20
` }), {
    mealCalorieLimitKcal: 0,
    dailyCalorieLimitKcal: 1850,
    minimumProteinG: 0,
  });
  assert.equal(malformed.ready, false);
  assert.match(malformed.errors.join('\n'), /blank, 0, or 1/);
  assert.match(malformed.errors.join('\n'), /invalid calories/);
});
