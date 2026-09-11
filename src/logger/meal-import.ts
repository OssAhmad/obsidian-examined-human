import type { Database, SqlValue } from 'sql.js';
import type { MealInspection } from './meals.ts';

export type MealImportLifecycle = 'ephemeral' | 'finalized';

export interface MealComponentState {
  date: string;
  lifecycleState: MealImportLifecycle;
  sourceFilePath: string;
  sourceChecksum: string;
  pluginVersion: string;
  rowCount: number;
  importedAt: string;
  updatedAt: string;
}

export interface MealImportInput {
  noteDate: string;
  todayDate: string;
  sourceFilePath: string;
  sourceChecksum: string;
  pluginVersion: string;
  inspection: MealInspection;
}

export interface MealImportResult {
  lifecycleState: MealImportLifecycle;
  replaced: boolean;
  mealEventCount: number;
  foodRowCount: number;
  leisureMeals: number;
}

const REQUIRED_COLUMNS: Record<string, string[]> = {
  daily_meals: [
    'id', 'day', 'food', 'food_id', 'amount_g', 'calories', 'protein_g', 'carbs_g', 'fat_g',
    'salt_g', 'fiber_g', 'cholesterol_mg', 'meal_event_id', 'item_ordinal',
  ],
  daily_meal_assessments: [
    'day', 'daily_calorie_limit_kcal', 'minimum_protein_g', 'daily_calories_kcal',
    'daily_metrics_calories_kcal', 'meal_items_calories_kcal', 'daily_calorie_source',
    'protein_g', 'recorded_dieted', 'evaluated_dieted',
  ],
  imported_notes: ['note_date'],
  meal_events: [
    'id', 'day', 'meal_type', 'is_leisure', 'classification_source', 'calorie_limit_kcal',
  ],
  note_import_components: [
    'note_date', 'component', 'lifecycle_state', 'source_file_path', 'source_checksum',
    'plugin_version', 'row_count', 'imported_at', 'updated_at',
  ],
  foods: [
    'id', 'name', 'calories_kcal_per_100g', 'protein_g_per_100g', 'carbs_g_per_100g',
    'fat_g_per_100g', 'salt_g_per_100g', 'fiber_g_per_100g', 'cholesterol_mg_per_100g',
  ],
  food_aliases: ['id', 'food_id', 'alias'],
};

function rows(db: Database, sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const result: Record<string, SqlValue>[] = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally {
    statement.free();
  }
}

function hasColumns(db: Database, table: string, required: string[]): boolean {
  const available = new Set(rows(db, `PRAGMA table_info("${table}")`).map((row) => String(row.name)));
  return required.every((column) => available.has(column));
}

function requireIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD.`);
}

export function assertMealImportSchema(db: Database): void {
  const version = Number(rows(db, 'PRAGMA user_version')[0]?.user_version ?? 0);
  if (version !== 1) {
    throw new Error(`Native Meals import requires official Data Schema v1; this database reports v${version}.`);
  }
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    if (!hasColumns(db, table, required)) {
      throw new Error(`Official Data Schema v1 is incomplete: ${table} is missing required columns.`);
    }
  }
}

export function queryMealComponentState(db: Database, date: string): MealComponentState | null {
  assertMealImportSchema(db);
  const row = rows(db, `
    SELECT note_date, lifecycle_state, source_file_path, source_checksum,
           plugin_version, row_count, imported_at, updated_at
    FROM note_import_components
    WHERE note_date = ? AND component = 'meals'
    LIMIT 1
  `, [date])[0];
  if (!row) return null;
  return {
    date: String(row.note_date),
    lifecycleState: String(row.lifecycle_state) as MealImportLifecycle,
    sourceFilePath: String(row.source_file_path),
    sourceChecksum: String(row.source_checksum),
    pluginVersion: String(row.plugin_version),
    rowCount: Number(row.row_count),
    importedAt: String(row.imported_at),
    updatedAt: String(row.updated_at),
  };
}

function sameNullableNumber(actual: SqlValue, expected: number | null): boolean {
  if (actual == null || expected == null) return actual == null && expected == null;
  const numeric = Number(actual);
  return Number.isFinite(numeric) && Math.abs(numeric - expected) < 1e-9;
}

export function mealComponentMatchesInspection(
  db: Database,
  date: string,
  inspection: MealInspection,
): boolean {
  assertMealImportSchema(db);
  if (!inspection.ready) return false;
  const events = rows(db, `
    SELECT id, meal_type, is_leisure, classification_source, calorie_limit_kcal
    FROM meal_events
    WHERE day = ?
    ORDER BY CASE meal_type
      WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END
  `, [date]);
  if (events.length !== inspection.meals.length) return false;
  for (let index = 0; index < inspection.meals.length; index += 1) {
    const event = events[index];
    const meal = inspection.meals[index];
    if (String(event.meal_type) !== meal.type
      || Number(event.is_leisure) !== meal.recordedIsLeisure
      || String(event.classification_source) !== meal.classificationSource
      || !sameNullableNumber(event.calorie_limit_kcal, meal.calorieLimitKcal)) return false;
    const items = rows(db, `
      SELECT item_ordinal, food, food_id, amount_g, calories, protein_g,
             carbs_g, fat_g, salt_g, fiber_g, cholesterol_mg
      FROM daily_meals
      WHERE meal_event_id = ?
      ORDER BY item_ordinal, id
    `, [event.id]);
    if (items.length !== meal.items.length) return false;
    for (let itemIndex = 0; itemIndex < meal.items.length; itemIndex += 1) {
      const actual = items[itemIndex];
      const expected = meal.items[itemIndex];
      if (Number(actual.item_ordinal) !== expected.ordinal
        || String(actual.food) !== expected.food
        || Number(actual.food_id) !== expected.foodId
        || !sameNullableNumber(actual.amount_g, expected.amountG)
        || !sameNullableNumber(actual.calories, expected.caloriesKcal)
        || !sameNullableNumber(actual.protein_g, expected.proteinG)
        || !sameNullableNumber(actual.carbs_g, expected.carbsG)
        || !sameNullableNumber(actual.fat_g, expected.fatG)
        || !sameNullableNumber(actual.salt_g, expected.saltG)
        || !sameNullableNumber(actual.fiber_g, expected.fiberG)
        || !sameNullableNumber(actual.cholesterol_mg, expected.cholesterolMg)) return false;
    }
  }

  const assessment = rows(db, `
    SELECT daily_calorie_limit_kcal, minimum_protein_g, daily_calories_kcal,
           daily_metrics_calories_kcal, meal_items_calories_kcal,
           daily_calorie_source, protein_g, recorded_dieted, evaluated_dieted
    FROM daily_meal_assessments
    WHERE day = ?
    LIMIT 1
  `, [date])[0];
  if (!assessment) return false;
  const nutrition = inspection.nutrition;
  return sameNullableNumber(assessment.daily_calorie_limit_kcal, inspection.thresholds.dailyCalorieLimitKcal)
    && sameNullableNumber(assessment.minimum_protein_g, inspection.thresholds.minimumProteinG)
    && sameNullableNumber(assessment.daily_calories_kcal, nutrition.dailyCaloriesKcal)
    && sameNullableNumber(assessment.daily_metrics_calories_kcal, nutrition.dailyMetricsCaloriesKcal)
    && sameNullableNumber(assessment.meal_items_calories_kcal, nutrition.mealItemsCaloriesKcal)
    && String(assessment.daily_calorie_source) === nutrition.dailyCalorieSource
    && sameNullableNumber(assessment.protein_g, nutrition.proteinG)
    && sameNullableNumber(assessment.recorded_dieted, nutrition.recordedDieted)
    && sameNullableNumber(assessment.evaluated_dieted, nutrition.evaluatedDieted);
}

export function writeMealInspection(db: Database, input: MealImportInput): MealImportResult {
  assertMealImportSchema(db);
  requireIsoDate(input.noteDate, 'Note date');
  requireIsoDate(input.todayDate, 'Today date');
  if (!input.inspection.ready) throw new Error('Meals import cannot run while validation errors remain.');
  if (!input.sourceFilePath.trim()) throw new Error('The source Daily Note path is required.');
  if (!input.sourceChecksum.trim()) throw new Error('The source Daily Note checksum is required.');
  if (!input.pluginVersion.trim()) throw new Error('The plugin version is required for import provenance.');

  const isHistorical = input.noteDate < input.todayDate;
  const fullImportExists = rows(
    db,
    'SELECT 1 AS found FROM imported_notes WHERE note_date = ? LIMIT 1',
    [input.noteDate],
  ).length > 0;
  if (fullImportExists) {
    throw new Error(`${input.noteDate} is already finalized by the full Daily Note importer.`);
  }
  const existing = queryMealComponentState(db, input.noteDate);
  if (isHistorical && existing?.lifecycleState === 'finalized') {
    throw new Error(`Meals for historical date ${input.noteDate} were already imported and cannot be replaced.`);
  }
  if (!isHistorical && existing?.lifecycleState === 'finalized') {
    throw new Error(`Meals for ${input.noteDate} are finalized and cannot be changed by an ephemeral import.`);
  }

  db.run('DELETE FROM meal_events WHERE day = ?', [input.noteDate]);
  db.run('DELETE FROM daily_meal_assessments WHERE day = ?', [input.noteDate]);

  for (const meal of input.inspection.meals) {
    db.run(`
      INSERT INTO meal_events (
        day, meal_type, is_leisure, classification_source, calorie_limit_kcal
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      input.noteDate,
      meal.type,
      meal.recordedIsLeisure,
      meal.classificationSource,
      meal.calorieLimitKcal,
    ]);
    const mealEventId = Number(rows(db, 'SELECT last_insert_rowid() AS id')[0]?.id);
    for (const item of meal.items) {
      db.run(`
        INSERT INTO daily_meals (
          day, food, food_id, amount_g, calories, protein_g, carbs_g, fat_g,
          salt_g, fiber_g, cholesterol_mg, meal_event_id, item_ordinal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        input.noteDate,
        item.food,
        item.foodId,
        item.amountG,
        item.caloriesKcal,
        item.proteinG,
        item.carbsG,
        item.fatG,
        item.saltG,
        item.fiberG,
        item.cholesterolMg,
        mealEventId,
        item.ordinal,
      ]);
    }
  }

  const nutrition = input.inspection.nutrition;
  db.run(`
    INSERT INTO daily_meal_assessments (
      day, daily_calorie_limit_kcal, minimum_protein_g, daily_calories_kcal,
      daily_metrics_calories_kcal, meal_items_calories_kcal, daily_calorie_source,
      protein_g, recorded_dieted, evaluated_dieted, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    input.noteDate,
    input.inspection.thresholds.dailyCalorieLimitKcal,
    input.inspection.thresholds.minimumProteinG,
    nutrition.dailyCaloriesKcal,
    nutrition.dailyMetricsCaloriesKcal,
    nutrition.mealItemsCaloriesKcal,
    nutrition.dailyCalorieSource,
    nutrition.proteinG,
    nutrition.recordedDieted,
    nutrition.evaluatedDieted,
  ]);

  const lifecycleState: MealImportLifecycle = isHistorical ? 'finalized' : 'ephemeral';
  db.run(`
    INSERT INTO note_import_components (
      note_date, component, lifecycle_state, source_file_path, source_checksum,
      plugin_version, row_count, imported_at, updated_at
    ) VALUES (?, 'meals', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(note_date, component) DO UPDATE SET
      lifecycle_state = excluded.lifecycle_state,
      source_file_path = excluded.source_file_path,
      source_checksum = excluded.source_checksum,
      plugin_version = excluded.plugin_version,
      row_count = excluded.row_count,
      updated_at = datetime('now')
  `, [
    input.noteDate,
    lifecycleState,
    input.sourceFilePath,
    input.sourceChecksum,
    input.pluginVersion,
    input.inspection.foodRowCount,
  ]);

  return {
    lifecycleState,
    replaced: existing != null,
    mealEventCount: input.inspection.meals.length,
    foodRowCount: input.inspection.foodRowCount,
    leisureMeals: input.inspection.leisureMeals,
  };
}
