import type { Database, SqlValue } from 'sql.js';
import type {
  CalendarDayState,
  CalendarEvent,
  DataIssue,
  ExerciseSetDetails,
  MilestoneMeasurementDetails,
  SessionExerciseDetails,
  SessionMilestoneDetails,
} from './events.ts';
import { parseDatabaseTime, titleForEngagement } from './events.ts';
import { normalizeValuationUnit } from './domain/valuation.ts';
import {
  eventSignal,
  inferDailyActivity,
  inferSleepHours,
  mergeTodayWithWeekly,
  type DailySessionSignal,
} from './daily-inference.ts';
import {
  hasTableColumns as hasColumns,
  queryRows as rows,
  validateSchemaContract,
} from './read-models/sql.ts';
import { validateSchema } from './read-models/core-schema.ts';
export { validateSchema } from './read-models/core-schema.ts';
export { inspectDatabase } from './read-models/database-inspection.ts';
export type { DatabaseInspection } from './read-models/database-inspection.ts';
export { queryCommandCatalog, queryFoodLibrary } from './read-models/command-catalog.ts';
export { queryExerciseDashboard } from './read-models/exercise.ts';
export { queryNutritionDashboard } from './read-models/nutrition.ts';
export { queryWeeklyAssessment, queryWeeklyPlan, queryWeeklyPlanIndex } from './read-models/weekly.ts';
import { hasWeeklyPlanningSchema } from './read-models/weekly.ts';
export type {
  CommandAccountRecord,
  CommandCatalog,
  CommandEngagementRecord,
  CommandExerciseRecord,
  FoodLibraryRecord,
} from './read-models/command-catalog.ts';
import type { SessionQueryResult } from './read-models/calendar.ts';
import type {
  DailyAssessmentQueryResult,
  DailyNoteIndexQueryResult,
} from './read-models/daily.ts';
import type {
  EngagementActivityRecord,
  EngagementDashboardQueryResult,
  EngagementDashboardSummaryRecord,
  EngagementMilestoneRecord,
  EngagementRecentSessionRecord,
  EngagementSessionTypeRecord,
  EngagementTransactionRecord,
  EngagementTransactionTotalRecord,
} from './read-models/engagement.ts';
import type {
  ActiveBudgetPlanRecord,
  FinancialAccountExplorerRecord,
  FinancialAccountRecord,
  FinancialBalanceHistoryRecord,
  FinancialBudgetTargetRecord,
  FinancialCurrencyRecord,
  FinancialDailyRecord,
  FinancialDashboardQueryResult,
  FinancialEngagementRecord,
  FinancialExpectedMovementRecord,
  FinancialExplorerEngagementRecord,
  FinancialMissingValuationRecord,
  FinancialTransactionRecord,
  FinancialValuationOptions,
  FinancialValuationSummary,
} from './read-models/finance.ts';
export type { SessionQueryResult } from './read-models/calendar.ts';
export type * from './read-models/daily.ts';
export type * from './read-models/engagement.ts';
export type * from './read-models/finance.ts';
export type * from './read-models/nutrition.ts';
export type * from './read-models/exercise.ts';
export type * from './read-models/weekly.ts';

const EXERCISE_DETAIL_COLUMNS: Record<string, string[]> = {
  exercises: ['id', 'name', 'category'],
  session_exercises: ['id', 'session_id', 'exercise_id', 'order_index'],
  exercise_sets: ['id', 'session_exercise_id', 'set_number', 'weight', 'reps', 'distance', 'duration_minutes', 'notes'],
};

const MILESTONE_DETAIL_COLUMNS: Record<string, string[]> = {
  engagement_milestones: ['id', 'session_id', 'name', 'date', 'notes'],
  engagement_measurements: ['id', 'milestone_id', 'metric_name', 'metric_value', 'measurement_date', 'notes'],
};

const PLANNING_COLUMNS: Record<string, string[]> = {
  note_sources: ['id', 'note_date', 'lifecycle_state', 'parse_status', 'last_error'],
  planned_sessions: [
    'id', 'source_note_id', 'source_ordinal', 'date', 'start_time', 'end_time', 'duration_minutes',
    'time_is_estimated', 'session_type_raw', 'resolved_session_type_id',
    'engagement_raw', 'resolved_engagement_id',
    'notes', 'warning_text',
  ],
};

const ENGAGEMENT_DASHBOARD_COLUMNS: Record<string, string[]> = {
  engagements: [
    'id', 'name', 'type_id', 'status_id', 'start_date', 'target_date', 'completion_date', 'notes',
  ],
  engagement_aliases: ['id', 'engagement_id', 'alias'],
  engagement_types: ['id', 'code'],
  engagement_statuses: ['id', 'code'],
  sessions: ['id', 'engagement_id', 'date', 'start_time', 'end_time', 'duration_minutes', 'session_type_id', 'notes'],
  session_types: ['id', 'code'],
  engagement_milestones: ['id', 'engagement_id', 'session_id', 'name', 'date', 'notes'],
  engagement_measurements: ['id', 'milestone_id', 'metric_name', 'metric_value', 'measurement_date', 'notes'],
  accounts: ['id', 'name', 'currency'],
  transactions: ['id', 'account_id', 'date', 'amount', 'category', 'description'],
};

const FINANCIAL_DASHBOARD_COLUMNS: Record<string, string[]> = {
  accounts: ['id', 'name', 'type', 'currency'],
  transactions: ['id', 'account_id', 'date', 'amount', 'category', 'description'],
  engagements: ['id', 'name'],
  budget_plans: ['id', 'period_start', 'period_end', 'source_file_name', 'source_file_path', 'source_checksum'],
  budget_targets: ['id', 'budget_plan_id', 'source_ordinal', 'currency', 'amount', 'engagement_id', 'engagement_raw'],
  expected_financial_movements: [
    'id', 'budget_plan_id', 'source_ordinal', 'due_date', 'currency', 'amount', 'account_id',
    'engagement_id', 'engagement_raw', 'description',
  ],
  valuation_rate_sets: ['id', 'rate_date', 'source_file_name', 'source_file_path', 'source_checksum'],
  valuation_rates: ['id', 'rate_set_id', 'source_ordinal', 'unit_key', 'unit_label', 'value'],
};

function hasExerciseDetailSchema(db: Database): boolean {
  return Object.entries(EXERCISE_DETAIL_COLUMNS).every(([table, required]) => hasColumns(db, table, required));
}

function hasMilestoneDetailSchema(db: Database): boolean {
  return Object.entries(MILESTONE_DETAIL_COLUMNS).every(([table, required]) => hasColumns(db, table, required));
}

function hasPlanningSchema(db: Database): boolean {
  return Object.entries(PLANNING_COLUMNS).every(([table, required]) => hasColumns(db, table, required));
}

function validateEngagementDashboardSchema(db: Database): void {
  validateSchemaContract(db, ENGAGEMENT_DASHBOARD_COLUMNS, {
    missingSource: (table) => `Engagement Dashboard requires table "${table}".`,
    missingColumns: (table, missing) => `Engagement Dashboard table "${table}" is missing: ${missing.join(', ')}.`,
  });
}

function validateDashboardSchema(db: Database, dashboard: string, contract: Record<string, string[]>): void {
  validateSchemaContract(db, contract, {
    missingSource: (table) => `${dashboard} requires table or view "${table}".`,
    missingColumns: (table, missing) => `${dashboard} source "${table}" is missing: ${missing.join(', ')}.`,
  });
}

function importedNoteDates(db: Database, startDate: string, endDate: string): Set<string> {
  if (!hasColumns(db, 'imported_notes', ['note_date'])) return new Set();
  return new Set(rows(db, `
    SELECT DISTINCT note_date
    FROM imported_notes
    WHERE note_date >= ? AND note_date <= ?
  `, [startDate, endDate]).map((row) => String(row.note_date)));
}

function queryPlanningState(
  db: Database,
  startDate: string,
  endDate: string,
  todayDate: string,
  importedDates: Set<string>,
): { dayStates: Record<string, CalendarDayState>; unfinalizedDates: Set<string> } {
  const dayStates: Record<string, CalendarDayState> = {};
  const unfinalizedDates = new Set<string>();
  if (!hasPlanningSchema(db)) return { dayStates, unfinalizedDates };

  const sourceRows = rows(db, `
    SELECT note_date, lifecycle_state, parse_status, last_error
    FROM note_sources
    WHERE note_date >= ? AND note_date <= ?
      AND note_date = ?
      AND lifecycle_state NOT IN ('finalized', 'deleted')
  `, [startDate, endDate, todayDate]);
  for (const row of sourceRows) {
    const date = String(row.note_date);
    if (importedDates.has(date)) continue;
    unfinalizedDates.add(date);
    dayStates[date] = {
      source: 'planned',
      lifecycleState: String(row.lifecycle_state),
      overdue: date < todayDate,
      message: nullableText(row.last_error),
    };
  }
  return { dayStates, unfinalizedDates };
}

function queryPlannedEvents(
  db: Database,
  startDate: string,
  endDate: string,
  importedDates: Set<string>,
  todayDate: string,
  issues: DataIssue[],
): CalendarEvent[] {
  if (!hasPlanningSchema(db)) return [];
  const plannedRows = rows(db, `
    SELECT ps.id,
           ps.date,
           ps.start_time,
           ps.end_time,
           ps.duration_minutes,
           ps.time_is_estimated,
           ps.session_type_raw,
           ps.engagement_raw,
           ps.notes,
           ps.warning_text,
           st.code AS resolved_session_type,
           e.name AS resolved_engagement_name,
           et.code AS resolved_engagement_type
    FROM planned_sessions AS ps
    JOIN note_sources AS ns ON ns.id = ps.source_note_id
    LEFT JOIN engagements AS e ON e.id = ps.resolved_engagement_id
    LEFT JOIN engagement_types AS et ON et.id = e.type_id
    LEFT JOIN session_types AS st ON st.id = ps.resolved_session_type_id
    WHERE ps.date >= ? AND ps.date <= ?
      AND ps.date = ?
      AND ns.lifecycle_state NOT IN ('finalized', 'deleted')
    ORDER BY ps.date, ps.start_time, ps.source_ordinal, ps.id
  `, [startDate, endDate, todayDate]);

  const events: CalendarEvent[] = [];
  for (const row of plannedRows) {
    const date = String(row.date);
    if (importedDates.has(date)) continue;
    const id = `planned:${String(row.id)}`;
    const start = parseDatabaseTime(String(row.start_time ?? ''));
    const end = parseDatabaseTime(String(row.end_time ?? ''));
    if (start == null || end == null || end <= start) {
      issues.push({ sessionId: id, message: `Planned session ${id} has an invalid display time.` });
      continue;
    }

    const rawEngagement = String(row.engagement_raw ?? '').trim();
    const engagementName = (nullableText(row.resolved_engagement_name) ?? rawEngagement) || 'Untitled session';
    const warningText = nullableText(row.warning_text);
    events.push({
      id,
      date,
      sessionType: nullableText(row.resolved_session_type) ?? String(row.session_type_raw ?? '').trim(),
      engagementName,
      engagementType: nullableText(row.resolved_engagement_type) ?? '',
      title: titleForEngagement(engagementName),
      kind: 'timed',
      startMinutes: start,
      endMinutes: end,
      durationMinutes: nullableNumber(row.duration_minutes) ?? end - start,
      notes: nullableText(row.notes),
      sourceKind: 'planned',
      planningSource: 'daily-note',
      timeEstimated: Number(row.time_is_estimated) === 1,
      planningWarnings: warningText ? warningText.split('\n').filter(Boolean) : [],
    });
  }
  return events;
}

function queryWeeklyPlannedEvents(
  db: Database,
  startDate: string,
  endDate: string,
  todayDate: string,
  primaryTodayEvents: CalendarEvent[],
  issues: DataIssue[],
): { events: CalendarEvent[]; dayStates: Record<string, CalendarDayState> } {
  const events: CalendarEvent[] = [];
  const dayStates: Record<string, CalendarDayState> = {};
  if (!hasWeeklyPlanningSchema(db)) return { events, dayStates };

  const weeklyRows = rows(db, `
    SELECT wps.id,
           wps.date,
           wps.start_time,
           wps.end_time,
           wps.duration_minutes,
           wps.notes,
           wp.source_file_name,
           st.code AS session_type,
           e.name AS engagement_name,
           et.code AS engagement_type
    FROM weekly_plan_sessions AS wps
    JOIN weekly_plans AS wp ON wp.id = wps.weekly_plan_id
    LEFT JOIN session_types AS st ON st.id = wps.session_type_id
    LEFT JOIN engagements AS e ON e.id = wps.engagement_id
    LEFT JOIN engagement_types AS et ON et.id = e.type_id
    WHERE wps.date >= ? AND wps.date <= ?
      AND wps.date >= ?
    ORDER BY wps.date, wps.start_time, wps.id
  `, [startDate, endDate, todayDate]);

  for (const row of weeklyRows) {
    const date = String(row.date);
    const id = `weekly:${String(row.id)}`;
    const start = parseDatabaseTime(String(row.start_time ?? ''));
    const end = parseDatabaseTime(String(row.end_time ?? ''));
    if (start == null || end == null || end <= start) {
      issues.push({ sessionId: id, message: `Weekly planned session ${id} has an invalid display time.` });
      continue;
    }

    const engagementName = nullableText(row.engagement_name) ?? 'Untitled session';
    const sourceFileName = nullableText(row.source_file_name) ?? 'Weekly Form';
    events.push({
      id,
      date,
      sessionType: nullableText(row.session_type) ?? '',
      engagementName,
      engagementType: nullableText(row.engagement_type) ?? '',
      title: titleForEngagement(engagementName),
      kind: 'timed',
      startMinutes: start,
      endMinutes: end,
      durationMinutes: nullableNumber(row.duration_minutes) ?? end - start,
      notes: nullableText(row.notes),
      sourceKind: 'planned',
      planningSource: 'weekly-plan',
      timeEstimated: false,
      planningWarnings: [],
    });
    dayStates[date] ??= {
      source: 'planned',
      lifecycleState: 'weekly-plan',
      overdue: false,
      message: `Imported Weekly Form ${sourceFileName} supplies this date directly; no Daily Note is required.`,
    };
  }

  const todayWeekly = events.filter((event) => event.date === todayDate);
  const futureWeekly = events.filter((event) => event.date > todayDate);
  const mergedToday = mergeTodayWithWeekly(primaryTodayEvents, todayWeekly)
    .filter((event) => event.planningSource === 'weekly-plan');
  return { events: [...mergedToday, ...futureWeekly], dayStates };
}

function nullableNumber(value: SqlValue | undefined): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableText(value: SqlValue | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function attachExerciseDetails(
  db: Database,
  startDate: string,
  endDate: string,
  events: CalendarEvent[],
): void {
  const actualEvents = events.filter((event) => event.sourceKind !== 'planned');
  if (actualEvents.length === 0 || !hasExerciseDetailSchema(db)) return;

  const eventsById = new Map(actualEvents.map((event) => {
    if (event.sessionType.trim().toLowerCase() === 'exercise') event.exerciseDetails = [];
    return [event.id, event] as const;
  }));
  const exercisesByAssociationId = new Map<string, SessionExerciseDetails>();
  const exerciseRows = rows(db, `
    SELECT se.id AS session_exercise_id,
           se.session_id,
           e.name AS exercise_name,
           e.category AS exercise_category,
           es.id AS set_id,
           es.set_number,
           es.weight,
           es.reps,
           es.distance,
           es.duration_minutes,
           es.notes AS set_notes
    FROM sessions AS s
    JOIN session_exercises AS se ON se.session_id = s.id
    JOIN exercises AS e ON e.id = se.exercise_id
    LEFT JOIN exercise_sets AS es ON es.session_exercise_id = se.id
    WHERE s.date >= ? AND s.date <= ?
    ORDER BY s.date,
             s.start_time,
             COALESCE(se.order_index, 2147483647),
             se.id,
             COALESCE(es.set_number, 2147483647),
             es.id
  `, [startDate, endDate]);

  for (const row of exerciseRows) {
    const event = eventsById.get(String(row.session_id));
    if (!event) continue;
    event.exerciseDetails ??= [];

    const associationId = String(row.session_exercise_id);
    let exercise = exercisesByAssociationId.get(associationId);
    if (!exercise) {
      exercise = {
        name: String(row.exercise_name ?? '').trim(),
        category: nullableText(row.exercise_category),
        sets: [],
      };
      exercisesByAssociationId.set(associationId, exercise);
      event.exerciseDetails.push(exercise);
    }

    if (row.set_id == null) continue;
    const set: ExerciseSetDetails = {
      setNumber: nullableNumber(row.set_number),
      weight: nullableNumber(row.weight),
      reps: nullableNumber(row.reps),
      distance: nullableNumber(row.distance),
      durationMinutes: nullableNumber(row.duration_minutes),
      notes: nullableText(row.set_notes),
    };
    exercise.sets.push(set);
  }
}

function attachMilestoneDetails(
  db: Database,
  startDate: string,
  endDate: string,
  events: CalendarEvent[],
): void {
  const actualEvents = events.filter((event) => event.sourceKind !== 'planned');
  if (actualEvents.length === 0 || !hasMilestoneDetailSchema(db)) return;

  const eventsById = new Map(actualEvents.map((event) => {
    event.milestoneDetails = [];
    return [event.id, event] as const;
  }));
  const milestonesById = new Map<string, SessionMilestoneDetails>();
  const milestoneRows = rows(db, `
    SELECT m.id AS milestone_id,
           m.session_id,
           m.name AS milestone_name,
           m.date AS milestone_date,
           m.notes AS milestone_notes,
           em.id AS measurement_id,
           em.metric_name,
           em.metric_value,
           em.measurement_date,
           em.notes AS measurement_notes
    FROM sessions AS s
    JOIN engagement_milestones AS m ON m.session_id = s.id
    LEFT JOIN engagement_measurements AS em ON em.milestone_id = m.id
    WHERE s.date >= ? AND s.date <= ?
    ORDER BY s.date,
             s.start_time,
             m.id,
             em.measurement_date,
             em.id
  `, [startDate, endDate]);

  for (const row of milestoneRows) {
    const event = eventsById.get(String(row.session_id));
    if (!event?.milestoneDetails) continue;

    const milestoneId = String(row.milestone_id);
    let milestone = milestonesById.get(milestoneId);
    if (!milestone) {
      milestone = {
        name: String(row.milestone_name ?? '').trim(),
        date: nullableText(row.milestone_date),
        notes: nullableText(row.milestone_notes),
        measurements: [],
      };
      milestonesById.set(milestoneId, milestone);
      event.milestoneDetails.push(milestone);
    }

    if (row.measurement_id == null) continue;
    const measurement: MilestoneMeasurementDetails = {
      metricName: String(row.metric_name ?? '').trim(),
      metricValue: String(row.metric_value ?? '').trim(),
      measurementDate: nullableText(row.measurement_date),
      notes: nullableText(row.measurement_notes),
    };
    milestone.measurements.push(measurement);
  }
}

export function queryDailyNoteIndex(db: Database): DailyNoteIndexQueryResult {
  validateSchema(db);
  const importedNotes = hasColumns(db, 'imported_notes', ['note_date', 'file_name', 'file_path', 'imported_at'])
    ? rows(db, `
        SELECT note_date, file_name, file_path, imported_at
        FROM imported_notes
        ORDER BY note_date DESC
      `).map((row) => ({
        date: String(row.note_date),
        fileName: String(row.file_name),
        filePath: String(row.file_path),
        importedAt: nullableText(row.imported_at),
      }))
    : [];
  const noteSources = hasColumns(db, 'note_sources', ['note_date', 'lifecycle_state', 'parse_status', 'last_error'])
    ? rows(db, `
        SELECT note_date, lifecycle_state, parse_status, last_error
        FROM note_sources
        ORDER BY note_date DESC
      `).map((row) => ({
        date: String(row.note_date),
        lifecycleState: String(row.lifecycle_state),
        parseStatus: String(row.parse_status),
        lastError: nullableText(row.last_error),
      }))
    : [];
  return { importedNotes, noteSources };
}

export function queryDailyAssessment(
  db: Database,
  date: string,
  todayDate: string,
  valuationOptions: FinancialValuationOptions = { label: 'EHM', referenceUnit: 'USD' },
): DailyAssessmentQueryResult {
  validateSchema(db);
  const sessionResult = querySessions(db, date, date, todayDate);
  const hasCoreMetrics = hasColumns(db, 'daily_metrics', [
    'date', 'mood', 'energy', 'stress', 'weight_kg', 'sleep_hours',
    'calories', 'protein_g', 'fasted', 'dieted',
  ]);
  const metricField = (field: string): string => hasColumns(db, 'daily_metrics', [field])
    ? field
    : `NULL AS ${field}`;
  const metricRows = hasCoreMetrics ? rows(db, `
    SELECT mood, energy, stress, weight_kg, sleep_hours,
           calories, protein_g, fasted, dieted,
           ${metricField('studied')}, ${metricField('worked')},
           ${metricField('exercised')}, ${metricField('notes')}
    FROM daily_metrics
    WHERE date = ?
  `, [date]) : [];
  const metricRow = metricRows[0];
  let metrics = metricRow ? {
    mood: nullableNumber(metricRow.mood),
    energy: nullableNumber(metricRow.energy),
    stress: nullableNumber(metricRow.stress),
    weightKg: nullableNumber(metricRow.weight_kg),
    sleepHours: nullableNumber(metricRow.sleep_hours),
    calories: nullableNumber(metricRow.calories),
    proteinG: nullableNumber(metricRow.protein_g),
    fasted: nullableNumber(metricRow.fasted),
    dieted: nullableNumber(metricRow.dieted),
    studied: nullableNumber(metricRow.studied),
    worked: nullableNumber(metricRow.worked),
    exercised: nullableNumber(metricRow.exercised),
    notes: nullableText(metricRow.notes),
  } : null;
  const detailedMeals = hasColumns(db, 'daily_meals', [
    'id', 'day', 'food', 'amount_g', 'calories', 'protein_g', 'carbs_g', 'fat_g',
    'salt_g', 'fiber_g', 'cholesterol_mg', 'meal_event_id',
  ]) && hasColumns(db, 'meal_events', ['id', 'meal_type']);
  const meals = detailedMeals
    ? rows(db, `
        SELECT daily_meal.id, meal_event.meal_type, daily_meal.food, daily_meal.amount_g,
               daily_meal.calories, daily_meal.protein_g, daily_meal.carbs_g,
               daily_meal.fat_g, daily_meal.salt_g, daily_meal.fiber_g,
               daily_meal.cholesterol_mg
        FROM daily_meals AS daily_meal
        LEFT JOIN meal_events AS meal_event ON meal_event.id = daily_meal.meal_event_id
        WHERE daily_meal.day = ?
        ORDER BY daily_meal.id
      `, [date]).map((row) => ({
        id: Number(row.id),
        mealType: nullableText(row.meal_type),
        food: String(row.food),
        amountG: nullableNumber(row.amount_g),
        calories: nullableNumber(row.calories),
        proteinG: nullableNumber(row.protein_g),
        carbsG: nullableNumber(row.carbs_g),
        fatG: nullableNumber(row.fat_g),
        saltG: nullableNumber(row.salt_g),
        fiberG: nullableNumber(row.fiber_g),
        cholesterolMg: nullableNumber(row.cholesterol_mg),
      }))
    : hasColumns(db, 'daily_meals', ['id', 'day', 'food', 'calories', 'protein_g'])
      ? rows(db, `SELECT id, food, calories, protein_g FROM daily_meals WHERE day = ? ORDER BY id`, [date])
        .map((row) => ({
          id: Number(row.id), mealType: null, food: String(row.food), amountG: null,
          calories: nullableNumber(row.calories), proteinG: nullableNumber(row.protein_g),
          carbsG: null, fatG: null, saltG: null, fiberG: null, cholesterolMg: null,
        }))
      : [];
  const mealAssessment = hasColumns(db, 'daily_meal_assessments', ['day', 'daily_calories_kcal', 'protein_g'])
    ? rows(db, 'SELECT daily_calories_kcal, protein_g FROM daily_meal_assessments WHERE day = ? LIMIT 1', [date])[0]
    : null;
  const activity = inferDailyActivity(sessionResult.events.map(eventSignal));
  const previousSleepSignals: DailySessionSignal[] = rows(db, `
    SELECT session.date, session.start_time, session.end_time,
           session_type.code AS session_type, engagement_type.code AS engagement_type,
           engagement.name AS engagement_name
    FROM sessions AS session
    JOIN engagements AS engagement ON engagement.id = session.engagement_id
    JOIN engagement_types AS engagement_type ON engagement_type.id = engagement.type_id
    LEFT JOIN session_types AS session_type ON session_type.id = session.session_type_id
    WHERE session.date = date(?, '-1 day')
  `, [date]).flatMap((row) => {
    const start = parseDatabaseTime(String(row.start_time ?? ''));
    const end = parseDatabaseTime(String(row.end_time ?? ''));
    return start == null || end == null || end <= start ? [] : [{
      date: String(row.date), startMinutes: start, endMinutes: end,
      sessionType: String(row.session_type ?? ''), engagementType: String(row.engagement_type ?? ''),
      engagementName: String(row.engagement_name ?? ''),
    }];
  });
  const inferredSleepHours = inferSleepHours(date, [
    ...previousSleepSignals,
    ...sessionResult.events.map(eventSignal),
  ]);
  metrics = {
    mood: metrics?.mood ?? null,
    energy: metrics?.energy ?? null,
    stress: metrics?.stress ?? null,
    weightKg: metrics?.weightKg ?? null,
    sleepHours: inferredSleepHours,
    calories: mealAssessment ? nullableNumber(mealAssessment.daily_calories_kcal) : metrics?.calories ?? null,
    proteinG: mealAssessment ? nullableNumber(mealAssessment.protein_g) : metrics?.proteinG ?? null,
    fasted: metrics?.fasted ?? null,
    dieted: metrics?.dieted ?? null,
    studied: activity.studied,
    worked: activity.worked,
    exercised: activity.exercised,
    notes: metrics?.notes ?? null,
  };
  const referenceUnit = normalizeValuationUnit(valuationOptions.referenceUnit) || 'USD';
  const valuationRateFor = (unit: string): number | null => {
    const unitKey = normalizeValuationUnit(unit);
    if (unitKey === referenceUnit) return 1;
    if (!hasColumns(db, 'valuation_rate_sets', ['id', 'rate_date'])
      || !hasColumns(db, 'valuation_rates', ['id', 'rate_set_id', 'unit_key', 'value'])) return null;
    const row = rows(db, `
      SELECT rate.value
      FROM valuation_rates AS rate
      JOIN valuation_rate_sets AS rate_set ON rate_set.id = rate.rate_set_id
      WHERE rate.unit_key = ? AND rate_set.rate_date <= ?
      ORDER BY rate_set.rate_date DESC, rate.id DESC
      LIMIT 1
    `, [unitKey, date])[0];
    return row == null ? null : Number(row.value);
  };
  const hasAccountCurrency = hasColumns(db, 'accounts', ['currency']);
  const transactions = hasColumns(db, 'transactions', ['id', 'account_id', 'date', 'amount', 'category', 'description'])
    && hasColumns(db, 'accounts', ['id', 'name'])
    ? rows(db, `
        SELECT t.id, a.name AS account_name, ${hasAccountCurrency ? 'a.currency' : "'Unspecified' AS currency"}, t.amount,
               COALESCE(e.name, CAST(t.category AS TEXT)) AS engagement_display,
               t.description
        FROM transactions AS t
        JOIN accounts AS a ON a.id = t.account_id
        LEFT JOIN engagements AS e ON CAST(e.id AS TEXT) = TRIM(CAST(t.category AS TEXT))
        WHERE t.date = ?
        ORDER BY t.id
      `, [date]).map((row) => {
        const amount = Number(row.amount);
        const currency = normalizeValuationUnit(String(row.currency ?? '')) || 'Unspecified';
        const rate = valuationRateFor(currency);
        return {
          id: Number(row.id), accountName: String(row.account_name), amount,
          engagement: String(row.engagement_display ?? ''), description: String(row.description ?? ''),
          currency, valuationAmount: rate == null && amount !== 0 ? null : amount * (rate ?? 0),
        };
      })
    : [];
  const importedRows = hasColumns(db, 'imported_notes', ['note_date', 'imported_at'])
    ? rows(db, `SELECT imported_at FROM imported_notes WHERE note_date = ? LIMIT 1`, [date])
    : [];
  const sourceRows = hasColumns(db, 'note_sources', ['note_date', 'lifecycle_state', 'parse_status', 'last_error'])
    ? rows(db, `
        SELECT note_date, lifecycle_state, parse_status, last_error
        FROM note_sources
        WHERE note_date = ?
        LIMIT 1
      `, [date])
    : [];
  const sourceRow = sourceRows[0];
  const mealImportRows = hasColumns(db, 'note_import_components', [
    'note_date', 'component', 'lifecycle_state', 'source_file_path', 'source_checksum',
    'plugin_version', 'row_count', 'imported_at', 'updated_at',
  ]) ? rows(db, `
    SELECT lifecycle_state, source_file_path, source_checksum, plugin_version,
           row_count, imported_at, updated_at
    FROM note_import_components
    WHERE note_date = ? AND component = 'meals'
    LIMIT 1
  `, [date]) : [];
  const mealImportRow = mealImportRows[0];
  return {
    sessionResult,
    metrics,
    meals,
    transactions,
    imported: importedRows.length > 0,
    importedAt: importedRows.length > 0 ? nullableText(importedRows[0].imported_at) : null,
    sourceState: sourceRow ? {
      date: String(sourceRow.note_date),
      lifecycleState: String(sourceRow.lifecycle_state),
      parseStatus: String(sourceRow.parse_status),
      lastError: nullableText(sourceRow.last_error),
    } : null,
    mealImport: mealImportRow ? {
      lifecycleState: String(mealImportRow.lifecycle_state) as 'ephemeral' | 'finalized',
      sourceFilePath: String(mealImportRow.source_file_path),
      sourceChecksum: String(mealImportRow.source_checksum),
      pluginVersion: String(mealImportRow.plugin_version),
      rowCount: Number(mealImportRow.row_count),
      importedAt: String(mealImportRow.imported_at),
      updatedAt: String(mealImportRow.updated_at),
    } : null,
  };
}

export function queryEngagementDashboard(
  db: Database,
  requestedEngagementId: number | null,
  startDate: string | null,
  endDate: string,
): EngagementDashboardQueryResult {
  validateSchema(db);
  validateEngagementDashboardSchema(db);

  const summaryRows = rows(db, `
    SELECT e.id,
           e.name,
           et.code AS engagement_type,
           COALESCE(es.code, 'unspecified') AS engagement_status,
           e.start_date,
           e.target_date,
           e.completion_date,
           e.notes,
           COUNT(s.id) AS session_count,
           COALESCE(SUM(CASE
             WHEN s.duration_minutes IS NOT NULL AND s.duration_minutes >= 0 THEN s.duration_minutes
             ELSE 0
           END), 0) AS total_minutes,
           MIN(s.date) AS first_session_date,
           MAX(s.date) AS last_session_date,
           (SELECT COUNT(*)
              FROM engagement_milestones AS milestone
             WHERE milestone.engagement_id = e.id) AS milestone_count
    FROM engagements AS e
    JOIN engagement_types AS et ON et.id = e.type_id
    LEFT JOIN engagement_statuses AS es ON es.id = e.status_id
    LEFT JOIN sessions AS s
      ON s.engagement_id = e.id
     AND (? IS NULL OR s.date >= ?)
     AND s.date <= ?
    GROUP BY e.id, e.name, et.code, es.code, e.start_date, e.target_date,
             e.completion_date, e.notes
    ORDER BY CASE COALESCE(es.code, 'unspecified')
               WHEN 'active' THEN 0
               WHEN 'pending' THEN 1
               WHEN 'planned' THEN 2
               WHEN 'paused' THEN 3
               WHEN 'unspecified' THEN 4
               WHEN 'completed' THEN 5
               WHEN 'abandoned' THEN 6
               ELSE 7
             END,
             total_minutes DESC,
             last_session_date DESC,
             e.name COLLATE NOCASE,
             e.id
  `, [startDate, startDate, endDate]);

  const aliasesByEngagement = new Map<number, string[]>();
  for (const row of rows(db, `
    SELECT engagement_id, alias
    FROM engagement_aliases
    ORDER BY alias COLLATE NOCASE, id
  `)) {
    const engagementId = Number(row.engagement_id);
    const aliases = aliasesByEngagement.get(engagementId) ?? [];
    aliases.push(String(row.alias));
    aliasesByEngagement.set(engagementId, aliases);
  }

  const engagements = summaryRows.map((row): EngagementDashboardSummaryRecord => ({
    id: Number(row.id),
    name: String(row.name),
    aliases: aliasesByEngagement.get(Number(row.id)) ?? [],
    type: String(row.engagement_type),
    status: String(row.engagement_status),
    startDate: nullableText(row.start_date),
    targetDate: nullableText(row.target_date),
    completionDate: nullableText(row.completion_date),
    notes: nullableText(row.notes),
    sessionCount: Number(row.session_count ?? 0),
    totalMinutes: Number(row.total_minutes ?? 0),
    firstSessionDate: nullableText(row.first_session_date),
    lastSessionDate: nullableText(row.last_session_date),
    milestoneCount: Number(row.milestone_count ?? 0),
  }));
  const selectedEngagement = engagements.find((engagement) => engagement.id === requestedEngagementId)
    ?? engagements[0]
    ?? null;

  const unresolvedRow = rows(db, `
    SELECT COUNT(*) AS unresolved_count
    FROM transactions AS transaction_row
    LEFT JOIN engagements AS engagement
      ON CAST(engagement.id AS TEXT) = TRIM(CAST(transaction_row.category AS TEXT))
    WHERE engagement.id IS NULL
      AND (? IS NULL OR transaction_row.date >= ?)
      AND transaction_row.date <= ?
  `, [startDate, startDate, endDate])[0];
  const unassignedTransactionCount = Number(unresolvedRow?.unresolved_count ?? 0);

  if (!selectedEngagement) {
    return {
      startDate,
      endDate,
      engagements,
      selectedEngagement: null,
      dailyActivity: [],
      sessionTypes: [],
      milestones: [],
      transactionTotals: [],
      transactions: [],
      recentSessions: [],
      unassignedTransactionCount,
    };
  }

  const engagementId = selectedEngagement.id;
  const dailyActivity = rows(db, `
    SELECT s.date,
           COUNT(*) AS session_count,
           COALESCE(SUM(CASE
             WHEN s.duration_minutes IS NOT NULL AND s.duration_minutes >= 0 THEN s.duration_minutes
             ELSE 0
           END), 0) AS total_minutes
    FROM sessions AS s
    WHERE s.engagement_id = ?
      AND (? IS NULL OR s.date >= ?)
      AND s.date <= ?
    GROUP BY s.date
    ORDER BY s.date
  `, [engagementId, startDate, startDate, endDate]).map((row): EngagementActivityRecord => ({
    date: String(row.date),
    sessionCount: Number(row.session_count ?? 0),
    totalMinutes: Number(row.total_minutes ?? 0),
  }));

  const sessionTypes = rows(db, `
    SELECT st.code AS session_type,
           COUNT(*) AS session_count,
           COALESCE(SUM(CASE
             WHEN s.duration_minutes IS NOT NULL AND s.duration_minutes >= 0 THEN s.duration_minutes
             ELSE 0
           END), 0) AS total_minutes
    FROM sessions AS s
    JOIN session_types AS st ON st.id = s.session_type_id
    WHERE s.engagement_id = ?
      AND (? IS NULL OR s.date >= ?)
      AND s.date <= ?
    GROUP BY st.id, st.code
    ORDER BY total_minutes DESC, st.code COLLATE NOCASE
  `, [engagementId, startDate, startDate, endDate]).map((row): EngagementSessionTypeRecord => ({
    sessionType: nullableText(row.session_type) ?? '',
    sessionCount: Number(row.session_count ?? 0),
    totalMinutes: Number(row.total_minutes ?? 0),
  }));

  const milestoneRows = rows(db, `
    SELECT milestone.id,
           milestone.name,
           milestone.date,
           milestone.notes,
           milestone.session_id,
           owner.date AS owner_session_date,
           owner.start_time AS owner_start_time,
           owner.end_time AS owner_end_time,
           measurement.id AS measurement_id,
           measurement.metric_name,
           measurement.metric_value,
           measurement.measurement_date,
           measurement.notes AS measurement_notes
    FROM engagement_milestones AS milestone
    LEFT JOIN sessions AS owner ON owner.id = milestone.session_id
    LEFT JOIN engagement_measurements AS measurement ON measurement.milestone_id = milestone.id
    WHERE milestone.engagement_id = ?
    ORDER BY COALESCE(milestone.date, owner.date) DESC, milestone.id DESC, measurement.id
  `, [engagementId]);
  const milestoneMap = new Map<number, EngagementMilestoneRecord>();
  for (const row of milestoneRows) {
    const milestoneId = Number(row.id);
    let milestone = milestoneMap.get(milestoneId);
    if (!milestone) {
      milestone = {
        id: milestoneId,
        name: String(row.name),
        date: nullableText(row.date),
        notes: nullableText(row.notes),
        ownerSessionId: nullableNumber(row.session_id),
        ownerSessionDate: nullableText(row.owner_session_date),
        ownerStartTime: nullableText(row.owner_start_time),
        ownerEndTime: nullableText(row.owner_end_time),
        measurements: [],
      };
      milestoneMap.set(milestoneId, milestone);
    }
    if (row.measurement_id != null) {
      milestone.measurements.push({
        id: Number(row.measurement_id),
        metricName: String(row.metric_name),
        metricValue: String(row.metric_value),
        measurementDate: nullableText(row.measurement_date),
        notes: nullableText(row.measurement_notes),
      });
    }
  }

  const transactionTotals = rows(db, `
    SELECT COALESCE(NULLIF(TRIM(account.currency), ''), 'Unspecified') AS currency,
           COUNT(*) AS transaction_count,
           COALESCE(SUM(CASE WHEN transaction_row.amount > 0 THEN transaction_row.amount ELSE 0 END), 0) AS inflow,
           COALESCE(SUM(CASE WHEN transaction_row.amount < 0 THEN -transaction_row.amount ELSE 0 END), 0) AS outflow,
           COALESCE(SUM(transaction_row.amount), 0) AS net
    FROM transactions AS transaction_row
    JOIN accounts AS account ON account.id = transaction_row.account_id
    WHERE TRIM(CAST(transaction_row.category AS TEXT)) = CAST(? AS TEXT)
      AND (? IS NULL OR transaction_row.date >= ?)
      AND transaction_row.date <= ?
    GROUP BY COALESCE(NULLIF(TRIM(account.currency), ''), 'Unspecified')
    ORDER BY currency COLLATE NOCASE
  `, [engagementId, startDate, startDate, endDate]).map((row): EngagementTransactionTotalRecord => ({
    currency: String(row.currency),
    transactionCount: Number(row.transaction_count ?? 0),
    inflow: Number(row.inflow ?? 0),
    outflow: Number(row.outflow ?? 0),
    net: Number(row.net ?? 0),
  }));

  const transactions = rows(db, `
    SELECT transaction_row.id,
           transaction_row.account_id,
           transaction_row.date,
           transaction_row.amount,
           COALESCE(NULLIF(TRIM(account.currency), ''), 'Unspecified') AS currency,
           account.name AS account_name,
           transaction_row.description
    FROM transactions AS transaction_row
    JOIN accounts AS account ON account.id = transaction_row.account_id
    WHERE TRIM(CAST(transaction_row.category AS TEXT)) = CAST(? AS TEXT)
      AND (? IS NULL OR transaction_row.date >= ?)
      AND transaction_row.date <= ?
    ORDER BY transaction_row.date DESC, transaction_row.id DESC
  `, [engagementId, startDate, startDate, endDate]).map((row): EngagementTransactionRecord => ({
    id: Number(row.id),
    date: String(row.date),
    amount: Number(row.amount),
    currency: String(row.currency),
    accountName: String(row.account_name),
    description: nullableText(row.description),
  }));

  const recentSessions = rows(db, `
    SELECT s.id,
           s.date,
           s.start_time,
           s.end_time,
           s.duration_minutes,
           st.code AS session_type,
           s.notes
    FROM sessions AS s
    LEFT JOIN session_types AS st ON st.id = s.session_type_id
    WHERE s.engagement_id = ?
      AND (? IS NULL OR s.date >= ?)
      AND s.date <= ?
    ORDER BY s.date DESC, s.start_time DESC, s.id DESC
    LIMIT 12
  `, [engagementId, startDate, startDate, endDate]).map((row): EngagementRecentSessionRecord => ({
    id: Number(row.id),
    date: String(row.date),
    startTime: nullableText(row.start_time),
    endTime: nullableText(row.end_time),
    durationMinutes: Math.max(0, Number(row.duration_minutes ?? 0)),
    sessionType: nullableText(row.session_type) ?? '',
    notes: nullableText(row.notes),
  }));

  return {
    startDate,
    endDate,
    engagements,
    selectedEngagement,
    dailyActivity,
    sessionTypes,
    milestones: [...milestoneMap.values()],
    transactionTotals,
    transactions,
    recentSessions,
    unassignedTransactionCount,
  };
}

export function queryFinancialDashboard(
  db: Database,
  startDate: string | null,
  endDate: string,
  valuationOptions: FinancialValuationOptions = { label: 'EHM', referenceUnit: 'USD' },
): FinancialDashboardQueryResult {
  validateDashboardSchema(db, 'Financial Dashboard', FINANCIAL_DASHBOARD_COLUMNS);
  const currencyExpression = `COALESCE(NULLIF(TRIM(account.currency), ''), 'Unspecified')`;
  const linkJoin = `LEFT JOIN engagements AS engagement
      ON CAST(engagement.id AS TEXT) = TRIM(CAST(transaction_row.category AS TEXT))`;
  interface LedgerRow extends FinancialTransactionRecord {
    engagementId: number | null;
  }
  const ledger = rows(db, `
    SELECT transaction_row.id, transaction_row.account_id, transaction_row.date,
           transaction_row.amount, transaction_row.description,
           account.name AS account_name, account.type AS account_type,
           ${currencyExpression} AS currency,
           engagement.id AS engagement_id, engagement.name AS engagement_name
    FROM transactions AS transaction_row
    JOIN accounts AS account ON account.id = transaction_row.account_id
    ${linkJoin}
    ORDER BY transaction_row.date, transaction_row.id
  `).map((row): LedgerRow => {
    const description = nullableText(row.description);
    const marker = description?.trim().toLowerCase() ?? '';
    const kind: FinancialTransactionRecord['kind'] = marker.startsWith('[eh opening balance]')
      ? 'opening_balance'
      : marker.startsWith('[eh reconciliation]') ? 'reconciliation' : 'normal';
    return {
      id: Number(row.id),
      accountId: Number(row.account_id),
      date: String(row.date),
      amount: Number(row.amount),
      currency: normalizeValuationUnit(String(row.currency)),
      accountName: String(row.account_name),
      engagementName: nullableText(row.engagement_name),
      engagementId: nullableNumber(row.engagement_id),
      description,
      kind,
      isTransfer: false,
    };
  });

  const transferGroups = new Map<string, LedgerRow[]>();
  for (const row of ledger) {
    if (row.kind !== 'normal' || row.amount === 0) continue;
    const key = `${row.date}\u0000${row.currency}\u0000${Math.abs(row.amount)}`;
    const group = transferGroups.get(key) ?? [];
    group.push(row);
    transferGroups.set(key, group);
  }
  for (const group of transferGroups.values()) {
    const negatives = group.filter((row) => row.amount < 0);
    const positives = group.filter((row) => row.amount > 0);
    if (negatives.length === 1 && positives.length === 1 && negatives[0].accountId !== positives[0].accountId) {
      negatives[0].isTransfer = true;
      positives[0].isTransfer = true;
      negatives[0].kind = 'transfer';
      positives[0].kind = 'transfer';
    }
  }

  const asOfLedger = ledger.filter((row) => row.date <= endDate);
  const inRange = (row: LedgerRow): boolean => (startDate == null || row.date >= startDate) && row.date <= endDate;
  const rangeLedger = asOfLedger.filter(inRange);
  const ordinary = (row: LedgerRow): boolean => row.kind === 'normal' && !row.isTransfer;
  const flowRows = rangeLedger.filter(ordinary);
  const aggregateFlow = <T extends { currency: string; amount: number }>(records: T[]): FinancialCurrencyRecord => ({
    currency: records[0]?.currency ?? 'Unspecified',
    transactionCount: records.length,
    inflow: records.reduce((sum, row) => sum + (row.amount > 0 ? row.amount : 0), 0),
    outflow: records.reduce((sum, row) => sum + (row.amount < 0 ? -row.amount : 0), 0),
    net: records.reduce((sum, row) => sum + row.amount, 0),
  });
  const groupBy = <T>(records: T[], keyFor: (record: T) => string): Map<string, T[]> => {
    const grouped = new Map<string, T[]>();
    for (const record of records) {
      const key = keyFor(record);
      const group = grouped.get(key) ?? [];
      group.push(record);
      grouped.set(key, group);
    }
    return grouped;
  };

  const currencies = [...groupBy(flowRows, (row) => row.currency).values()]
    .map(aggregateFlow).sort((left, right) => left.currency.localeCompare(right.currency));
  const dailyFlow = [...groupBy(flowRows, (row) => `${row.date}\u0000${row.currency}`).values()]
    .map((records): FinancialDailyRecord => ({ date: records[0].date, ...aggregateFlow(records) }))
    .sort((left, right) => left.date.localeCompare(right.date) || left.currency.localeCompare(right.currency));
  const engagements = [...groupBy(flowRows.filter((row) => row.engagementId != null), (row) => `${row.engagementId}\u0000${row.currency}`).values()]
    .map((records): FinancialEngagementRecord => ({
      engagementId: records[0].engagementId!,
      engagementName: records[0].engagementName!,
      ...aggregateFlow(records),
    }))
    .sort((left, right) => right.outflow - left.outflow || left.engagementName.localeCompare(right.engagementName));

  const rateRows = rows(db, `
    SELECT rate_set.rate_date, rate.id, rate.unit_key, rate.value
    FROM valuation_rates AS rate
    JOIN valuation_rate_sets AS rate_set ON rate_set.id = rate.rate_set_id
    WHERE rate_set.rate_date <= ?
    ORDER BY rate_set.rate_date DESC, rate.id DESC
  `, [endDate]);
  const latestRates = new Map<string, { value: number; date: string }>();
  for (const row of rateRows) {
    const unitKey = String(row.unit_key);
    if (!latestRates.has(unitKey)) latestRates.set(unitKey, { value: Number(row.value), date: String(row.rate_date) });
  }
  const referenceUnit = normalizeValuationUnit(valuationOptions.referenceUnit) || 'USD';
  const valuationLabel = valuationOptions.label.trim() || 'EHM';
  const rateHistory = new Map<string, Array<{ date: string; value: number }>>();
  for (const row of [...rateRows].reverse()) {
    const unitKey = normalizeValuationUnit(String(row.unit_key));
    const history = rateHistory.get(unitKey) ?? [];
    history.push({ date: String(row.rate_date), value: Number(row.value) });
    rateHistory.set(unitKey, history);
  }
  const valuationRateFor = (unit: string, date: string): number | null => {
    const unitKey = normalizeValuationUnit(unit);
    if (unitKey === referenceUnit) return 1;
    const history = rateHistory.get(unitKey) ?? [];
    let low = 0;
    let high = history.length - 1;
    let match: number | null = null;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (history[middle].date <= date) {
        match = history[middle].value;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return match;
  };
  const accountRows = rows(db, `
    SELECT id, name, type, ${currencyExpression} AS currency
    FROM accounts AS account
    ORDER BY currency COLLATE NOCASE, name COLLATE NOCASE
  `);
  const accounts = accountRows.map((row): FinancialAccountRecord => {
    const accountId = Number(row.id);
    const accountLedger = asOfLedger.filter((entry) => entry.accountId === accountId);
    const accountPeriodFlow = accountLedger.filter(inRange).filter(ordinary);
    const record = aggregateFlow(accountPeriodFlow);
    const currency = normalizeValuationUnit(String(row.currency));
    const unitKey = normalizeValuationUnit(currency);
    const observedRate = latestRates.get(unitKey);
    const valuationKind: FinancialAccountRecord['valuationKind'] = unitKey === referenceUnit
      ? 'reference'
      : observedRate ? 'observed' : 'missing';
    const valuationRate = valuationKind === 'reference' ? 1 : observedRate?.value ?? null;
    return {
      accountId,
      accountName: String(row.name),
      accountType: nullableText(row.type),
      ...record,
      currency,
      balance: accountLedger.reduce((sum, entry) => sum + entry.amount, 0),
      openingBalance: accountLedger.filter((entry) => entry.kind === 'opening_balance').reduce((sum, entry) => sum + entry.amount, 0),
      reconciliationAdjustment: accountLedger.filter((entry) => entry.kind === 'reconciliation').reduce((sum, entry) => sum + entry.amount, 0),
      transferIn: accountLedger.filter(inRange).filter((entry) => entry.isTransfer && entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0),
      transferOut: accountLedger.filter(inRange).filter((entry) => entry.isTransfer && entry.amount < 0).reduce((sum, entry) => sum + -entry.amount, 0),
      lastActivityDate: accountLedger.length ? accountLedger[accountLedger.length - 1].date : null,
      valuationRate,
      valuationRateDate: valuationKind === 'reference' ? null : observedRate?.date ?? null,
      valuationAmount: valuationRate == null ? null : accountLedger.reduce((sum, entry) => sum + entry.amount, 0) * valuationRate,
      valuationKind,
    };
  });

  const activePlanRow = rows(db, `
    SELECT id, period_start, period_end, source_file_name, source_file_path, source_checksum
    FROM budget_plans
    WHERE period_start <= ? AND period_end >= ?
    ORDER BY period_start DESC
    LIMIT 1
  `, [endDate, endDate])[0];
  let activeBudget: ActiveBudgetPlanRecord | null = null;
  if (activePlanRow) {
    const periodStart = String(activePlanRow.period_start);
    const periodEnd = String(activePlanRow.period_end);
    const budgetLedger = asOfLedger.filter((row) => row.date >= periodStart && row.date <= periodEnd && ordinary(row));
    const targetRows = rows(db, `
      SELECT target.id, target.currency, target.amount, target.engagement_id,
             target.engagement_raw, engagement.name AS engagement_name
      FROM budget_targets AS target
      LEFT JOIN engagements AS engagement ON engagement.id = target.engagement_id
      WHERE target.budget_plan_id = ?
      ORDER BY target.source_ordinal
    `, [Number(activePlanRow.id)]);
    const targets = targetRows.map((row): FinancialBudgetTargetRecord => {
      const engagementId = nullableNumber(row.engagement_id);
      const amount = Number(row.amount);
      const actualAmount = budgetLedger.filter((entry) => (
        entry.currency === normalizeValuationUnit(String(row.currency))
        && entry.engagementId === engagementId
        && Math.sign(entry.amount) === Math.sign(amount)
      )).reduce((sum, entry) => sum + entry.amount, 0);
      return {
        id: Number(row.id),
        currency: normalizeValuationUnit(String(row.currency)),
        amount,
        engagementId,
        engagementName: nullableText(row.engagement_name) ?? String(row.engagement_raw),
        actualAmount,
        variance: actualAmount - amount,
      };
    });
    const expectedRows = rows(db, `
      SELECT movement.id, movement.due_date, movement.currency, movement.amount,
             movement.account_id, movement.engagement_id, movement.engagement_raw, movement.description,
             account.name AS account_name, engagement.name AS engagement_name
      FROM expected_financial_movements AS movement
      LEFT JOIN accounts AS account ON account.id = movement.account_id
      LEFT JOIN engagements AS engagement ON engagement.id = movement.engagement_id
      WHERE movement.budget_plan_id = ?
      ORDER BY movement.due_date, movement.source_ordinal
    `, [Number(activePlanRow.id)]);
    const matchingActuals = new Map<string, LedgerRow[]>();
    for (const row of budgetLedger) {
      const key = `${row.date}\u0000${row.currency}\u0000${row.amount}\u0000${row.accountId}\u0000${row.engagementId ?? ''}`;
      const matches = matchingActuals.get(key) ?? [];
      matches.push(row);
      matchingActuals.set(key, matches);
    }
    const expectedMovements = expectedRows.map((row): FinancialExpectedMovementRecord => {
      const accountId = nullableNumber(row.account_id);
      const engagementId = nullableNumber(row.engagement_id);
      const key = `${String(row.due_date)}\u0000${normalizeValuationUnit(String(row.currency))}\u0000${Number(row.amount)}\u0000${accountId ?? ''}\u0000${engagementId ?? ''}`;
      const matches = matchingActuals.get(key) ?? [];
      const isMatched = matches.length > 0;
      if (isMatched) matches.shift();
      return {
        id: Number(row.id), dueDate: String(row.due_date), currency: normalizeValuationUnit(String(row.currency)), amount: Number(row.amount),
        accountId, accountName: nullableText(row.account_name) ?? 'Unknown account',
        engagementId, engagementName: nullableText(row.engagement_name) ?? String(row.engagement_raw),
        description: nullableText(row.description), isMatched,
      };
    });
    activeBudget = {
      periodStart, periodEnd,
      sourceFileName: String(activePlanRow.source_file_name), sourceFilePath: String(activePlanRow.source_file_path),
      sourceChecksum: String(activePlanRow.source_checksum), targets, expectedMovements,
    };
  }

  const missingAccounts = accounts.filter((account) => account.balance !== 0 && account.valuationAmount == null)
    .map((account): FinancialMissingValuationRecord => ({
      accountId: account.accountId, accountName: account.accountName, unit: account.currency, balance: account.balance,
    }));
  const valuedAccounts = accounts.filter((account) => account.valuationAmount != null);
  const valuation: FinancialValuationSummary = {
    label: valuationLabel,
    referenceUnit,
    asOfDate: endDate,
    assetTotal: valuedAccounts.reduce((sum, account) => sum + Math.max(0, account.valuationAmount ?? 0), 0),
    liabilityTotal: valuedAccounts.reduce((sum, account) => sum + Math.min(0, account.valuationAmount ?? 0), 0),
    netWorth: valuedAccounts.reduce((sum, account) => sum + (account.valuationAmount ?? 0), 0),
    valuedAccountCount: valuedAccounts.length,
    missingAccounts,
  };

  const selectedAccount = valuationOptions.selectedAccountId == null
    ? null
    : accounts.find((account) => account.accountId === valuationOptions.selectedAccountId) ?? null;
  const explorerLedger = selectedAccount
    ? asOfLedger.filter((row) => row.accountId === selectedAccount.accountId)
    : asOfLedger;
  const explorerRangeLedger = explorerLedger.filter(inRange);
  const explorerFlowRows = explorerRangeLedger.filter(ordinary);
  const valuedFlow = (records: LedgerRow[]): {
    inflow: number;
    outflow: number;
    net: number;
    valuedCount: number;
    missingCount: number;
  } => {
    let inflow = 0;
    let outflow = 0;
    let valuedCount = 0;
    let missingCount = 0;
    for (const record of records) {
      const rate = valuationRateFor(record.currency, record.date);
      if (rate == null && record.amount !== 0) {
        missingCount += 1;
        continue;
      }
      const amount = record.amount * (rate ?? 0);
      valuedCount += 1;
      if (amount > 0) inflow += amount;
      else if (amount < 0) outflow += -amount;
    }
    return { inflow, outflow, net: inflow - outflow, valuedCount, missingCount };
  };
  const valuationFlow = valuedFlow(explorerFlowRows);
  const nativeFlow = selectedAccount ? aggregateFlow(explorerFlowRows) : null;

  const explorerEngagements = [...groupBy(
    explorerFlowRows.filter((row) => row.engagementId != null),
    (row) => String(row.engagementId),
  ).values()].map((records): FinancialExplorerEngagementRecord => {
    const native = selectedAccount ? aggregateFlow(records) : null;
    const valued = valuedFlow(records);
    return {
      engagementId: records[0].engagementId!,
      engagementName: records[0].engagementName!,
      transactionCount: records.length,
      nativeCurrency: selectedAccount?.currency ?? null,
      nativeInflow: native?.inflow ?? null,
      nativeOutflow: native?.outflow ?? null,
      nativeNet: native?.net ?? null,
      valuationTransactionCount: valued.valuedCount,
      valuationInflow: valued.inflow,
      valuationOutflow: valued.outflow,
      valuationNet: valued.net,
      missingValuationTransactionCount: valued.missingCount,
    };
  }).sort((left, right) => {
    const leftActivity = selectedAccount
      ? (left.nativeInflow ?? 0) + (left.nativeOutflow ?? 0)
      : left.valuationInflow + left.valuationOutflow;
    const rightActivity = selectedAccount
      ? (right.nativeInflow ?? 0) + (right.nativeOutflow ?? 0)
      : right.valuationInflow + right.valuationOutflow;
    return rightActivity - leftActivity || left.engagementName.localeCompare(right.engagementName);
  });

  const chartLedger = selectedAccount
    ? asOfLedger.filter((row) => row.accountId === selectedAccount.accountId)
    : asOfLedger;
  const chartStart = startDate ?? chartLedger[0]?.date ?? endDate;
  const balanceHistory: FinancialBalanceHistoryRecord[] = [];
  if (chartLedger.length > 0) {
    const balances = new Map<number, number>();
    const rowsByDate = new Map<string, LedgerRow[]>();
    for (const row of chartLedger) {
      if (row.date < chartStart) {
        balances.set(row.accountId, (balances.get(row.accountId) ?? 0) + row.amount);
      } else {
        const dated = rowsByDate.get(row.date) ?? [];
        dated.push(row);
        rowsByDate.set(row.date, dated);
      }
    }
    const cursor = new Date(`${chartStart}T00:00:00Z`);
    const finalDate = new Date(`${endDate}T00:00:00Z`);
    while (cursor <= finalDate) {
      const date = cursor.toISOString().slice(0, 10);
      for (const row of rowsByDate.get(date) ?? []) {
        balances.set(row.accountId, (balances.get(row.accountId) ?? 0) + row.amount);
      }
      if (selectedAccount) {
        const nativeBalance = balances.get(selectedAccount.accountId) ?? 0;
        const rate = valuationRateFor(selectedAccount.currency, date);
        const missing = nativeBalance !== 0 && rate == null;
        balanceHistory.push({
          date,
          nativeBalance,
          valuationBalance: missing ? null : nativeBalance * (rate ?? 0),
          missingAccountCount: missing ? 1 : 0,
        });
      } else {
        let valuationBalance = 0;
        let missingAccountCount = 0;
        for (const account of accounts) {
          const nativeBalance = balances.get(account.accountId) ?? 0;
          if (nativeBalance === 0) continue;
          const rate = valuationRateFor(account.currency, date);
          if (rate == null) missingAccountCount += 1;
          else valuationBalance += nativeBalance * rate;
        }
        balanceHistory.push({ date, nativeBalance: null, valuationBalance, missingAccountCount });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const explorer: FinancialAccountExplorerRecord = {
    accountId: selectedAccount?.accountId ?? null,
    accountName: selectedAccount?.accountName ?? 'All accounts',
    nativeCurrency: selectedAccount?.currency ?? null,
    nativeBalance: selectedAccount?.balance ?? null,
    nativeInflow: nativeFlow?.inflow ?? null,
    nativeOutflow: nativeFlow?.outflow ?? null,
    nativeNet: nativeFlow?.net ?? null,
    valuationBalance: selectedAccount ? selectedAccount.valuationAmount : valuation.netWorth,
    valuationInflow: valuationFlow.inflow,
    valuationOutflow: valuationFlow.outflow,
    valuationNet: valuationFlow.net,
    missingCurrentValuationAccountCount: selectedAccount
      ? (selectedAccount.balance !== 0 && selectedAccount.valuationAmount == null ? 1 : 0)
      : valuation.missingAccounts.length,
    missingFlowValuationTransactionCount: valuationFlow.missingCount,
    balanceHistory,
    engagements: explorerEngagements,
  };

  return {
    startDate,
    endDate,
    transactionCount: rangeLedger.length,
    linkedTransactionCount: rangeLedger.filter((row) => row.engagementId != null).length,
    unresolvedTransactionCount: rangeLedger.filter((row) => row.engagementId == null).length,
    currencies,
    dailyFlow,
    engagements,
    accounts,
    recentTransactions: [...explorerRangeLedger].sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id).slice(0, 24),
    activeBudget,
    valuation,
    explorer,
  };
}

export function querySessions(
  db: Database,
  startDate: string,
  endDate: string,
  todayDate = startDate,
  includePlanning = true,
): SessionQueryResult {
  validateSchema(db);
  const importedDates = includePlanning ? importedNoteDates(db, startDate, endDate) : new Set<string>();
  const { dayStates, unfinalizedDates } = includePlanning
    ? queryPlanningState(db, startDate, endDate, todayDate, importedDates)
    : { dayStates: {}, unfinalizedDates: new Set<string>() };
  const sourceRows = rows(db, `
    SELECT s.id,
           s.date,
           s.start_time,
           s.end_time,
           s.duration_minutes,
           st.code AS session_type,
           s.notes,
           e.name AS engagement_name,
           et.code AS engagement_type
    FROM sessions AS s
    JOIN engagements AS e ON e.id = s.engagement_id
    LEFT JOIN session_types AS st ON st.id = s.session_type_id
    JOIN engagement_types AS et ON et.id = e.type_id
    WHERE s.date >= ? AND s.date <= ?
  `, [startDate, endDate]);

  const events: CalendarEvent[] = [];
  const issues: DataIssue[] = [];
  for (const row of sourceRows) {
    const date = String(row.date);
    if (date > todayDate) continue;
    if (unfinalizedDates.has(date)) continue;
    const id = String(row.id);
    const start = parseDatabaseTime(String(row.start_time ?? ''));
    const end = parseDatabaseTime(String(row.end_time ?? ''));
    if (start == null || end == null || end <= start) {
      issues.push({ sessionId: id, message: `Session ${id} has an invalid time range.` });
      continue;
    }

    const sessionType = String(row.session_type ?? '').trim();
    const engagementName = String(row.engagement_name ?? '').trim();
    const durationValue = Number(row.duration_minutes);
    const durationMinutes = Number.isFinite(durationValue) && durationValue >= 0
      ? Math.round(durationValue)
      : end - start;
    const event: CalendarEvent = {
      id,
      date,
      sessionType,
      engagementName,
      engagementType: String(row.engagement_type ?? ''),
      title: titleForEngagement(engagementName),
      kind: 'timed',
      startMinutes: start,
      endMinutes: end,
      durationMinutes,
      notes: row.notes == null ? null : String(row.notes),
      sourceKind: 'actual',
    };

    if (sessionType.toLowerCase() === 'chor') {
      event.dataWarning = `Session ${id} uses the invalid type "chor". Correct it in EH.db.`;
      issues.push({ sessionId: id, message: event.dataWarning });
    }
    events.push(event);
  }

  attachExerciseDetails(db, startDate, endDate, events);
  attachMilestoneDetails(db, startDate, endDate, events);
  if (includePlanning) {
    events.push(...queryPlannedEvents(db, startDate, endDate, importedDates, todayDate, issues));
    const primaryTodayEvents = events.filter((event) => event.date === todayDate);
    const weeklyPlanning = queryWeeklyPlannedEvents(
      db,
      startDate,
      endDate,
      todayDate,
      primaryTodayEvents,
      issues,
    );
    events.push(...weeklyPlanning.events);
    for (const [date, state] of Object.entries(weeklyPlanning.dayStates)) dayStates[date] ??= state;
  }
  for (const [date, state] of Object.entries(dayStates)) {
    if (state.overdue) {
      issues.push({
        message: `${date} is awaiting finalization. Open its journal note for EH Logger feedback.`,
      });
    } else if (state.message) {
      issues.push({
        message: `${date} has planning-form issues. Open its journal note or run EH Logger in dry-run mode.`,
      });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || a.id.localeCompare(b.id));
  return { events, issues, dayStates };
}
