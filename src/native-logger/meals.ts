export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks'] as const;
export const COUNTED_MEAL_TYPES = ['breakfast', 'lunch', 'dinner'] as const;

export type MealType = typeof MEAL_TYPES[number];
export type MealClassificationSource = 'default' | 'manual' | 'meal_limit' | 'manual_and_meal_limit';

export interface NutritionThresholds {
  mealCalorieLimitKcal: number;
  dailyCalorieLimitKcal: number;
  minimumProteinG: number;
}

export interface ParsedMealItem {
  ordinal: number;
  food: string;
  caloriesKcal: number;
  proteinG: number;
}

export interface EvaluatedMeal {
  type: MealType;
  presentInNote: boolean;
  recordedIsLeisure: 0 | 1;
  evaluatedIsLeisure: 0 | 1;
  classificationSource: MealClassificationSource;
  calorieLimitKcal: number | null;
  totalCaloriesKcal: number;
  totalProteinG: number;
  items: ParsedMealItem[];
}

export interface NutritionMetricSnapshot {
  dailyMetricsCaloriesKcal: number | null;
  mealItemsCaloriesKcal: number;
  dailyCaloriesKcal: number | null;
  dailyCalorieSource: 'daily_metrics' | 'meal_items' | 'higher_of_both' | 'missing';
  proteinG: number | null;
  recordedDieted: 0 | 1 | null;
  evaluatedDieted: 0 | 1 | null;
}

export interface MealInspection {
  ready: boolean;
  errors: string[];
  warnings: string[];
  thresholds: NutritionThresholds;
  meals: EvaluatedMeal[];
  nutrition: NutritionMetricSnapshot;
  countedMeals: 3;
  directLeisureMeals: number;
  dailyLimitExceeded: boolean;
  leisureMeals: number;
  foodRowCount: number;
}

interface ParsedMealSection {
  type: MealType;
  presentInNote: boolean;
  recordedIsLeisure: 0 | 1;
  items: ParsedMealItem[];
}

function sectionBody(content: string, name: string): string | null {
  const heading = new RegExp(`^#####(?!#)\\s+${name}\\s*$`, 'im');
  const match = heading.exec(content);
  if (!match) return null;
  const start = match.index + match[0].length;
  const remainder = content.slice(start);
  const next = /^#####(?!#)\s+/m.exec(remainder);
  return next ? remainder.slice(0, next.index) : remainder;
}

function parseOptionalNumber(
  raw: string | null,
  label: string,
  errors: string[],
): number | null {
  if (raw == null || raw.trim() === '') return null;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${label} must be a non-negative number.`);
    return null;
  }
  return value;
}

function metricValue(body: string | null, key: string): string | null {
  if (body == null) return null;
  const match = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'im').exec(body);
  return match?.[1] ?? null;
}

function parseOptionalFlag(raw: string | null, label: string, errors: string[]): 0 | 1 | null {
  if (raw == null || raw.trim() === '') return null;
  const normalized = raw.trim();
  if (normalized === '0') return 0;
  if (normalized === '1') return 1;
  errors.push(`${label} must be blank, 0, or 1.`);
  return null;
}

function parseMealItems(segment: string, type: MealType, errors: string[]): ParsedMealItem[] {
  const lines = segment.split(/\r?\n/);
  const entriesIndex = lines.findIndex((line) => /^ENTRIES:[ \t]*$/i.test(line.trim()));
  if (entriesIndex < 0) {
    errors.push(`${type} is missing its ENTRIES: marker.`);
    return [];
  }

  const items: ParsedMealItem[] = [];
  for (const originalLine of lines.slice(entriesIndex + 1)) {
    const line = originalLine.trim().replace(/^[-*]\s+/, '');
    if (!line) continue;
    const fields = line.split('|').map((field) => field.trim());
    if (fields.length !== 3) {
      errors.push(`${type} row "${line}" must use food | calories_kcal | protein_g.`);
      continue;
    }
    const [food, caloriesRaw, proteinRaw] = fields;
    if (!food) {
      errors.push(`${type} contains a food row with an empty food name.`);
      continue;
    }
    const calories = Number(caloriesRaw);
    const protein = Number(proteinRaw);
    if (!Number.isFinite(calories) || calories < 0) {
      errors.push(`${type} food "${food}" has invalid calories: ${caloriesRaw || '(blank)'}.`);
      continue;
    }
    if (!Number.isFinite(protein) || protein < 0) {
      errors.push(`${type} food "${food}" has invalid protein: ${proteinRaw || '(blank)'}.`);
      continue;
    }
    items.push({
      ordinal: items.length + 1,
      food,
      caloriesKcal: calories,
      proteinG: protein,
    });
  }
  return items;
}

function parseMealSections(body: string, errors: string[], warnings: string[]): ParsedMealSection[] {
  const heading = /^######\s+(Breakfast|Lunch|Dinner|Snacks)\s*$/gim;
  const matches = [...body.matchAll(heading)];
  const parsed = new Map<MealType, ParsedMealSection>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const type = match[1].toLowerCase() as MealType;
    if (parsed.has(type)) {
      errors.push(`Meals contains more than one ${type} heading.`);
      continue;
    }
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? body.length : body.length;
    const segment = body.slice(start, end);
    const rawFlag = /^is_leisure:[ \t]*(.*?)[ \t]*$/im.exec(segment)?.[1] ?? null;
    const parsedFlag = parseOptionalFlag(rawFlag, `${type} is_leisure`, errors);
    if (type === 'snacks' && parsedFlag === 1) {
      warnings.push('Snacks never count as an individual leisure meal; its is_leisure value was ignored.');
    }
    parsed.set(type, {
      type,
      presentInNote: true,
      recordedIsLeisure: type === 'snacks' ? 0 : parsedFlag ?? 0,
      items: parseMealItems(segment, type, errors),
    });
  }

  return MEAL_TYPES.map((type) => {
    const existing = parsed.get(type);
    if (existing) return existing;
    warnings.push(`${type} is missing and will be evaluated as an empty, non-leisure meal.`);
    return { type, presentInNote: false, recordedIsLeisure: 0, items: [] };
  });
}

function evaluateMeal(section: ParsedMealSection, thresholds: NutritionThresholds): EvaluatedMeal {
  const totalCaloriesKcal = section.items.reduce((total, item) => total + item.caloriesKcal, 0);
  const totalProteinG = section.items.reduce((total, item) => total + item.proteinG, 0);
  const limitApplied = section.type !== 'snacks'
    && thresholds.mealCalorieLimitKcal > 0
    && totalCaloriesKcal > thresholds.mealCalorieLimitKcal;
  const manual = section.type !== 'snacks' && section.recordedIsLeisure === 1;
  const evaluatedIsLeisure: 0 | 1 = manual || limitApplied ? 1 : 0;
  let classificationSource: MealClassificationSource = 'default';
  if (manual && limitApplied) classificationSource = 'manual_and_meal_limit';
  else if (manual) classificationSource = 'manual';
  else if (limitApplied) classificationSource = 'meal_limit';

  return {
    type: section.type,
    presentInNote: section.presentInNote,
    recordedIsLeisure: section.recordedIsLeisure,
    evaluatedIsLeisure,
    classificationSource,
    calorieLimitKcal: section.type !== 'snacks' && thresholds.mealCalorieLimitKcal > 0
      ? thresholds.mealCalorieLimitKcal
      : null,
    totalCaloriesKcal,
    totalProteinG,
    items: section.items,
  };
}

function evaluateDieted(
  dailyCaloriesKcal: number | null,
  proteinG: number | null,
  recordedDieted: 0 | 1 | null,
  thresholds: NutritionThresholds,
  errors: string[],
): 0 | 1 | null {
  const calorieRuleEnabled = thresholds.dailyCalorieLimitKcal > 0;
  const proteinRuleEnabled = thresholds.minimumProteinG > 0;
  if (!calorieRuleEnabled && !proteinRuleEnabled) return recordedDieted;
  if (calorieRuleEnabled && dailyCaloriesKcal == null) {
    errors.push('Daily Metrics calories is required while the daily calorie limit is enabled.');
  }
  if (proteinRuleEnabled && proteinG == null) {
    errors.push('Daily Metrics protein_g is required while the minimum protein setting is enabled.');
  }
  if ((calorieRuleEnabled && dailyCaloriesKcal == null) || (proteinRuleEnabled && proteinG == null)) return null;
  const caloriesPass = !calorieRuleEnabled || (dailyCaloriesKcal ?? 0) <= thresholds.dailyCalorieLimitKcal;
  const proteinPass = !proteinRuleEnabled || (proteinG ?? 0) >= thresholds.minimumProteinG;
  return caloriesPass && proteinPass ? 1 : 0;
}

export function inspectMeals(content: string, thresholds: NutritionThresholds): MealInspection {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const [label, value] of Object.entries(thresholds)) {
    if (!Number.isFinite(value) || value < 0) errors.push(`${label} must be a non-negative number.`);
  }

  const mealsBody = sectionBody(content, 'Meals');
  const dailyMetricsBody = sectionBody(content, 'Daily Metrics');
  if (mealsBody == null) errors.push('The Daily Note does not contain a ##### Meals section.');
  if (dailyMetricsBody == null) errors.push('The Daily Note does not contain a ##### Daily Metrics section.');

  const parsedSections = mealsBody == null
    ? MEAL_TYPES.map((type) => ({ type, presentInNote: false, recordedIsLeisure: 0 as const, items: [] }))
    : parseMealSections(mealsBody, errors, warnings);
  const dailyMetricsCaloriesKcal = parseOptionalNumber(
    metricValue(dailyMetricsBody, 'calories'),
    'Daily Metrics calories',
    errors,
  );
  const proteinG = parseOptionalNumber(
    metricValue(dailyMetricsBody, 'protein_g'),
    'Daily Metrics protein_g',
    errors,
  );
  const recordedDieted = parseOptionalFlag(
    metricValue(dailyMetricsBody, 'dieted'),
    'Daily Metrics dieted',
    errors,
  );
  const meals = parsedSections.map((section) => evaluateMeal(section, thresholds));
  const foodRowCount = meals.reduce((total, meal) => total + meal.items.length, 0);
  const mealItemsCaloriesKcal = meals.reduce((total, meal) => total + meal.totalCaloriesKcal, 0);
  let dailyCaloriesKcal: number | null = dailyMetricsCaloriesKcal;
  let dailyCalorieSource: NutritionMetricSnapshot['dailyCalorieSource'] = dailyMetricsCaloriesKcal == null
    ? 'missing'
    : 'daily_metrics';
  if (dailyMetricsCaloriesKcal == null && foodRowCount > 0) {
    dailyCaloriesKcal = mealItemsCaloriesKcal;
    dailyCalorieSource = 'meal_items';
  } else if (dailyMetricsCaloriesKcal != null && mealItemsCaloriesKcal > dailyMetricsCaloriesKcal) {
    dailyCaloriesKcal = mealItemsCaloriesKcal;
    dailyCalorieSource = 'higher_of_both';
    warnings.push(
      `Structured foods total ${mealItemsCaloriesKcal} kcal, above Daily Metrics calories ${dailyMetricsCaloriesKcal}; the food total was used so snacks and meals remain reflected.`,
    );
  }
  const evaluatedDieted = evaluateDieted(
    dailyCaloriesKcal,
    proteinG,
    recordedDieted,
    thresholds,
    errors,
  );
  const directLeisureMeals = meals
    .filter((meal) => meal.type !== 'snacks')
    .reduce((total, meal) => total + meal.evaluatedIsLeisure, 0);
  const dailyLimitExceeded = thresholds.dailyCalorieLimitKcal > 0
    && dailyCaloriesKcal != null
    && dailyCaloriesKcal > thresholds.dailyCalorieLimitKcal;
  const leisureMeals = dailyLimitExceeded ? Math.max(directLeisureMeals, 2) : directLeisureMeals;

  return {
    ready: errors.length === 0,
    errors,
    warnings,
    thresholds: { ...thresholds },
    meals,
    nutrition: {
      dailyMetricsCaloriesKcal,
      mealItemsCaloriesKcal,
      dailyCaloriesKcal,
      dailyCalorieSource,
      proteinG,
      recordedDieted,
      evaluatedDieted,
    },
    countedMeals: 3,
    directLeisureMeals,
    dailyLimitExceeded,
    leisureMeals,
    foodRowCount,
  };
}
