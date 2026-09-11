import type { Database, SqlValue } from 'sql.js';
import { queryRows, validateSchemaContract } from './sql.ts';
import { nullableNumber } from './values.ts';

function validateDashboardSchema(db: Database, dashboard: string, contract: Record<string, string[]>): void {
  validateSchemaContract(db, contract, {
    missingSource: (table) => `${dashboard} requires table or view "${table}".`,
    missingColumns: (table, missing) => `${dashboard} source "${table}" is missing: ${missing.join(', ')}.`,
  });
}

const NUTRITION_DASHBOARD_COLUMNS: Record<string, string[]> = {
  daily_metrics: ['date', 'calories', 'protein_g', 'dieted'],
  daily_meals: ['id', 'day', 'food', 'calories', 'protein_g', 'meal_event_id'],
  meal_events: ['id', 'day', 'meal_type', 'is_leisure'],
  meal_event_totals: [
    'meal_event_id', 'day', 'meal_type', 'item_count', 'total_calories_kcal',
    'total_protein_g', 'evaluated_is_leisure',
  ],
  daily_meal_assessments: [
    'day', 'daily_calorie_limit_kcal', 'minimum_protein_g', 'daily_calories_kcal',
    'protein_g', 'recorded_dieted', 'evaluated_dieted',
  ],
  daily_leisure_meal_summary: ['day', 'counted_meals', 'leisure_meals'],
};

export interface NutritionDailyRecord {
  date: string;
  calories: number | null;
  proteinG: number | null;
  dieted: number | null;
  dietedSource: 'evaluated' | 'recorded' | 'missing';
  calorieLimitKcal: number | null;
  minimumProteinG: number | null;
  countedMeals: number | null;
  leisureMeals: number | null;
}

export interface NutritionMealTypeRecord {
  mealType: string;
  mealCount: number;
  itemCount: number;
  calories: number;
  proteinG: number;
  leisureMeals: number;
}

export interface NutritionFoodRecord {
  food: string;
  timesLogged: number;
  calories: number;
  proteinG: number;
}

export interface NutritionLeisureDebtRecord {
  targetRate: number;
  assessedDays: number;
  countedMeals: number;
  leisureMeals: number;
  leisureRate: number | null;
  debtMeals: number;
  balanceDays: number;
}

export interface NutritionDashboardQueryResult {
  startDate: string | null;
  endDate: string;
  recordedDays: number;
  dietedEvaluatedDays: number;
  dietedDays: number;
  missingCaloriesDays: number;
  daily: NutritionDailyRecord[];
  mealTypes: NutritionMealTypeRecord[];
  topFoods: NutritionFoodRecord[];
  leisureDebt: NutritionLeisureDebtRecord;
}


export function queryNutritionDashboard(
  db: Database,
  startDate: string | null,
  endDate: string,
): NutritionDashboardQueryResult {
  validateDashboardSchema(db, 'Nutrition Dashboard', NUTRITION_DASHBOARD_COLUMNS);
  const rangeParams: SqlValue[] = [startDate, startDate, endDate];
  const daily = queryRows(db, `
    WITH days AS (
      SELECT date AS day FROM daily_metrics
      UNION
      SELECT day FROM daily_meal_assessments
    )
    SELECT days.day,
           COALESCE(assessment.daily_calories_kcal, metrics.calories) AS calories,
           COALESCE(assessment.protein_g, metrics.protein_g) AS protein_g,
           COALESCE(assessment.evaluated_dieted, metrics.dieted) AS dieted,
           CASE
             WHEN assessment.evaluated_dieted IS NOT NULL THEN 'evaluated'
             WHEN metrics.dieted IS NOT NULL THEN 'recorded'
             ELSE 'missing'
           END AS dieted_source,
           assessment.daily_calorie_limit_kcal,
           assessment.minimum_protein_g,
           leisure.counted_meals,
           leisure.leisure_meals
    FROM days
    LEFT JOIN daily_metrics AS metrics ON metrics.date = days.day
    LEFT JOIN daily_meal_assessments AS assessment ON assessment.day = days.day
    LEFT JOIN daily_leisure_meal_summary AS leisure ON leisure.day = days.day
    WHERE (? IS NULL OR days.day >= ?)
      AND days.day <= ?
    ORDER BY days.day
  `, rangeParams).map((row): NutritionDailyRecord => ({
    date: String(row.day),
    calories: nullableNumber(row.calories),
    proteinG: nullableNumber(row.protein_g),
    dieted: nullableNumber(row.dieted),
    dietedSource: String(row.dieted_source) as NutritionDailyRecord['dietedSource'],
    calorieLimitKcal: nullableNumber(row.daily_calorie_limit_kcal),
    minimumProteinG: nullableNumber(row.minimum_protein_g),
    countedMeals: nullableNumber(row.counted_meals),
    leisureMeals: nullableNumber(row.leisure_meals),
  }));

  const mealTypes = queryRows(db, `
    SELECT totals.meal_type,
           COUNT(*) AS meal_count,
           COALESCE(SUM(totals.item_count), 0) AS item_count,
           COALESCE(SUM(totals.total_calories_kcal), 0) AS calories,
           COALESCE(SUM(totals.total_protein_g), 0) AS protein_g,
           COALESCE(SUM(totals.evaluated_is_leisure), 0) AS leisure_meals
    FROM meal_event_totals AS totals
    WHERE (? IS NULL OR totals.day >= ?)
      AND totals.day <= ?
    GROUP BY totals.meal_type
    ORDER BY CASE totals.meal_type
      WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END
  `, rangeParams).map((row): NutritionMealTypeRecord => ({
    mealType: String(row.meal_type),
    mealCount: Number(row.meal_count ?? 0),
    itemCount: Number(row.item_count ?? 0),
    calories: Number(row.calories ?? 0),
    proteinG: Number(row.protein_g ?? 0),
    leisureMeals: Number(row.leisure_meals ?? 0),
  }));

  const topFoods = queryRows(db, `
    SELECT meal.food,
           COUNT(*) AS times_logged,
           COALESCE(SUM(meal.calories), 0) AS calories,
           COALESCE(SUM(meal.protein_g), 0) AS protein_g
    FROM daily_meals AS meal
    WHERE (? IS NULL OR meal.day >= ?)
      AND meal.day <= ?
    GROUP BY LOWER(TRIM(meal.food))
    ORDER BY calories DESC, times_logged DESC, meal.food COLLATE NOCASE
    LIMIT 20
  `, rangeParams).map((row): NutritionFoodRecord => ({
    food: String(row.food),
    timesLogged: Number(row.times_logged ?? 0),
    calories: Number(row.calories ?? 0),
    proteinG: Number(row.protein_g ?? 0),
  }));

  const countedMeals = daily.reduce((sum, day) => sum + (day.countedMeals ?? 0), 0);
  const leisureMeals = daily.reduce((sum, day) => sum + (day.leisureMeals ?? 0), 0);
  const assessedDays = daily.filter((day) => day.countedMeals != null).length;
  const targetRate = 0.10;
  const debtMeals = Math.max(0, leisureMeals - (countedMeals * targetRate));
  const balanceDays = countedMeals > 0
    ? Math.max(0, Math.ceil(((leisureMeals / targetRate) - countedMeals) / 3))
    : 0;

  return {
    startDate,
    endDate,
    recordedDays: daily.length,
    dietedEvaluatedDays: daily.filter((day) => day.dieted != null).length,
    dietedDays: daily.filter((day) => day.dieted === 1).length,
    missingCaloriesDays: daily.filter((day) => day.calories == null).length,
    daily,
    mealTypes,
    topFoods,
    leisureDebt: {
      targetRate,
      assessedDays,
      countedMeals,
      leisureMeals,
      leisureRate: countedMeals > 0 ? leisureMeals / countedMeals : null,
      debtMeals,
      balanceDays,
    },
  };
}
