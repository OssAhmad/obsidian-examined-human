import type { Database } from 'sql.js';
import { queryRows, validateSchemaContract } from './sql.ts';
import { nullableNumber, nullableText } from './values.ts';

export interface FoodLibraryRecord {
  id: number;
  name: string;
  category: string | null;
  caloriesKcalPer100g: number;
  proteinGPer100g: number;
  carbsGPer100g: number;
  fatGPer100g: number;
  saltGPer100g: number;
  fiberGPer100g: number | null;
  cholesterolMgPer100g: number | null;
  notes: string | null;
  aliases: string[];
  timesLogged: number;
  lastLoggedDate: string | null;
}

export interface CommandCatalog {
  foods: Array<{ id: number; name: string }>;
  engagements: CommandEngagementRecord[];
  exercises: CommandExerciseRecord[];
  accounts: CommandAccountRecord[];
  engagementTypes: string[];
  engagementStatuses: string[];
}

export interface CommandEngagementRecord {
  id: number;
  name: string;
  type: string;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  completionDate: string | null;
  notes: string | null;
  aliases: string[];
}

export interface CommandExerciseRecord {
  id: number;
  name: string;
  category: string | null;
  aliases: string[];
}

export interface CommandAccountRecord {
  id: number;
  name: string;
  type: string | null;
  currency: string | null;
  address: string | null;
  aliases: string[];
}

const COMMAND_CENTER_SCHEMA = {
  foods: [
    'id', 'name', 'category', 'calories_kcal_per_100g', 'protein_g_per_100g',
    'carbs_g_per_100g', 'fat_g_per_100g', 'salt_g_per_100g', 'fiber_g_per_100g',
    'cholesterol_mg_per_100g', 'notes',
  ],
  food_aliases: ['id', 'food_id', 'alias'],
  daily_meals: ['id', 'day', 'food_id'],
  engagements: ['id', 'name', 'type_id', 'status_id'],
  engagement_types: ['id', 'code'],
  engagement_statuses: ['id', 'code'],
  exercises: ['id', 'name', 'category'],
  accounts: ['id', 'name', 'type', 'currency', 'address'],
  engagement_aliases: ['id', 'engagement_id', 'alias'],
  exercise_aliases: ['id', 'exercise_id', 'alias'],
  account_aliases: ['id', 'account_id', 'alias'],
};

function requireCommandCenterSchema(db: Database): void {
  validateSchemaContract(db, COMMAND_CENTER_SCHEMA, {
    missingSource: (table) => `Command Center requires table or view "${table}".`,
    missingColumns: (table, missing) => `Command Center source "${table}" is missing: ${missing.join(', ')}.`,
  });
}

export function queryFoodLibrary(db: Database): FoodLibraryRecord[] {
  requireCommandCenterSchema(db);
  const aliasesByFood = new Map<number, string[]>();
  for (const row of queryRows(db, 'SELECT food_id, alias FROM food_aliases ORDER BY alias COLLATE NOCASE, id')) {
    const foodId = Number(row.food_id);
    const aliases = aliasesByFood.get(foodId) ?? [];
    aliases.push(String(row.alias));
    aliasesByFood.set(foodId, aliases);
  }
  return queryRows(db, `
    SELECT f.id, f.name, f.category,
           f.calories_kcal_per_100g, f.protein_g_per_100g, f.carbs_g_per_100g,
           f.fat_g_per_100g, f.salt_g_per_100g, f.fiber_g_per_100g,
           f.cholesterol_mg_per_100g, f.notes,
           COUNT(dm.id) AS times_logged, MAX(dm.day) AS last_logged_date
    FROM foods AS f
    LEFT JOIN daily_meals AS dm ON dm.food_id = f.id
    GROUP BY f.id
    ORDER BY f.name COLLATE NOCASE, f.id
  `).map((row): FoodLibraryRecord => ({
    id: Number(row.id),
    name: String(row.name),
    category: nullableText(row.category),
    caloriesKcalPer100g: Number(row.calories_kcal_per_100g),
    proteinGPer100g: Number(row.protein_g_per_100g),
    carbsGPer100g: Number(row.carbs_g_per_100g),
    fatGPer100g: Number(row.fat_g_per_100g),
    saltGPer100g: Number(row.salt_g_per_100g),
    fiberGPer100g: nullableNumber(row.fiber_g_per_100g),
    cholesterolMgPer100g: nullableNumber(row.cholesterol_mg_per_100g),
    notes: nullableText(row.notes),
    aliases: aliasesByFood.get(Number(row.id)) ?? [],
    timesLogged: Number(row.times_logged),
    lastLoggedDate: nullableText(row.last_logged_date),
  }));
}

export function queryCommandCatalog(db: Database): CommandCatalog {
  requireCommandCenterSchema(db);
  const aliases = (table: string, foreignKey: string): Map<number, string[]> => {
    const result = new Map<number, string[]>();
    for (const row of queryRows(db, `SELECT ${foreignKey} AS entity_id, alias FROM "${table}" ORDER BY alias COLLATE NOCASE, id`)) {
      const id = Number(row.entity_id);
      const values = result.get(id) ?? [];
      values.push(String(row.alias));
      result.set(id, values);
    }
    return result;
  };
  const engagementAliases = aliases('engagement_aliases', 'engagement_id');
  const exerciseAliases = aliases('exercise_aliases', 'exercise_id');
  const accountAliases = aliases('account_aliases', 'account_id');
  const taxonomy = (table: string): string[] => queryRows(db, `
    SELECT code FROM "${table}" WHERE is_active = 1 ORDER BY code COLLATE NOCASE, id
  `).map((row) => String(row.code));
  return {
    foods: queryRows(db, 'SELECT id, name FROM foods ORDER BY name COLLATE NOCASE, id')
      .map((row) => ({ id: Number(row.id), name: String(row.name) })),
    engagements: queryRows(db, `
      SELECT e.id, e.name, et.code AS type, es.code AS status,
             e.start_date, e.target_date, e.completion_date, e.notes
      FROM engagements AS e
      JOIN engagement_types AS et ON et.id = e.type_id
      JOIN engagement_statuses AS es ON es.id = e.status_id
      ORDER BY e.name COLLATE NOCASE, e.id
    `).map((row): CommandEngagementRecord => ({
      id: Number(row.id), name: String(row.name), type: String(row.type), status: String(row.status),
      startDate: nullableText(row.start_date), targetDate: nullableText(row.target_date),
      completionDate: nullableText(row.completion_date), notes: nullableText(row.notes),
      aliases: engagementAliases.get(Number(row.id)) ?? [],
    })),
    exercises: queryRows(db, 'SELECT id, name, category FROM exercises ORDER BY name COLLATE NOCASE, id')
      .map((row): CommandExerciseRecord => ({
        id: Number(row.id), name: String(row.name), category: nullableText(row.category),
        aliases: exerciseAliases.get(Number(row.id)) ?? [],
      })),
    accounts: queryRows(db, 'SELECT id, name, type, currency, address FROM accounts ORDER BY name COLLATE NOCASE, id')
      .map((row): CommandAccountRecord => ({
        id: Number(row.id), name: String(row.name), type: nullableText(row.type),
        currency: nullableText(row.currency), address: nullableText(row.address),
        aliases: accountAliases.get(Number(row.id)) ?? [],
      })),
    engagementTypes: taxonomy('engagement_types'),
    engagementStatuses: taxonomy('engagement_statuses'),
  };
}
