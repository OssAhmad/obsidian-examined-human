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

const REQUIRED_COLUMNS: Record<string, string[]> = {
  sessions: ['id', 'engagement_id', 'date', 'start_time', 'end_time', 'duration_minutes', 'session_type_id', 'notes'],
  session_types: ['id', 'code'],
  engagements: ['id', 'name', 'type_id'],
  engagement_types: ['id', 'code'],
};

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

const WEEKLY_PLANNING_COLUMNS: Record<string, string[]> = {
  weekly_plans: [
    'id', 'week_start_date', 'source_file_name', 'main_outcome',
    'important_deadline', 'constraint_or_risk',
  ],
  weekly_plan_sessions: [
    'id', 'weekly_plan_id', 'date', 'start_time', 'end_time',
    'duration_minutes', 'session_type_id', 'engagement_id', 'notes',
  ],
  weekly_commitments: [
    'id', 'weekly_plan_id', 'source_ordinal', 'target_minutes',
    'engagement_id', 'commitment_text',
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
};

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

const EXERCISE_DASHBOARD_COLUMNS: Record<string, string[]> = {
  sessions: ['id', 'engagement_id', 'date', 'duration_minutes', 'session_type_id', 'notes'],
  session_types: ['id', 'code'],
  engagements: ['id', 'name'],
  exercises: ['id', 'name', 'category'],
  session_exercises: ['id', 'session_id', 'exercise_id'],
  exercise_sets: [
    'id', 'session_exercise_id', 'weight', 'reps', 'distance', 'duration_minutes',
    'duration_seconds', 'pain_level',
  ],
  muscles: ['id', 'name', 'body_region'],
  exercise_muscles: ['exercise_id', 'muscle_id', 'role'],
};

export interface DatabaseInspection {
  integrity: string;
  sessionCount: number;
  distinctDays: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface SessionQueryResult {
  events: CalendarEvent[];
  issues: DataIssue[];
  dayStates: Record<string, CalendarDayState>;
}

export interface WeeklyPlanSessionRecord {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  sessionType: string;
  engagementName: string;
  notes: string | null;
}

export interface WeeklyCommitmentRecord {
  id: number;
  ordinal: number;
  targetMinutes: number;
  engagementName: string;
  commitmentText: string;
}

export interface WeeklyPlanQueryResult {
  weekStartDate: string;
  sourceFileName: string;
  mainOutcome: string | null;
  importantDeadline: string | null;
  constraintOrRisk: string | null;
  sessions: WeeklyPlanSessionRecord[];
  commitments: WeeklyCommitmentRecord[];
}

export interface WeeklyCommitmentAssessmentRecord extends WeeklyCommitmentRecord {
  actualMinutes: number;
}

export interface WeeklyAssessmentQueryResult {
  weekStartDate: string;
  weekEndDate: string;
  sourceFileName: string;
  mainOutcome: string | null;
  importantDeadline: string | null;
  constraintOrRisk: string | null;
  previousWeekStart: string | null;
  nextWeekStart: string | null;
  commitments: WeeklyCommitmentAssessmentRecord[];
}

export interface WeeklyPlanIndexRecord {
  id: number;
  weekStartDate: string;
  sourceFileName: string;
  sourceFilePath: string;
}

export interface WeeklyPlanIndexQueryResult {
  importedPlans: WeeklyPlanIndexRecord[];
}

export interface ImportedDailyNoteRecord {
  date: string;
  fileName: string;
  filePath: string;
  importedAt: string | null;
}

export interface DailyNoteSourceRecord {
  date: string;
  lifecycleState: string;
  parseStatus: string;
  lastError: string | null;
}

export interface MealImportComponentRecord {
  lifecycleState: 'ephemeral' | 'finalized';
  sourceFilePath: string;
  sourceChecksum: string;
  pluginVersion: string;
  rowCount: number;
  importedAt: string;
  updatedAt: string;
}

export interface DailyNoteIndexQueryResult {
  importedNotes: ImportedDailyNoteRecord[];
  noteSources: DailyNoteSourceRecord[];
}

export interface DailyMetricsRecord {
  mood: number | null;
  energy: number | null;
  stress: number | null;
  weightKg: number | null;
  sleepHours: number | null;
  calories: number | null;
  proteinG: number | null;
  fasted: number | null;
  dieted: number | null;
}

export interface DailyMealRecord {
  id: number;
  food: string;
  calories: number | null;
  proteinG: number | null;
}

export interface DailyTransactionRecord {
  id: number;
  accountName: string;
  amount: number;
  engagement: string;
  description: string;
}

export interface DailyAssessmentQueryResult {
  sessionResult: SessionQueryResult;
  metrics: DailyMetricsRecord | null;
  meals: DailyMealRecord[];
  transactions: DailyTransactionRecord[];
  imported: boolean;
  importedAt: string | null;
  sourceState: DailyNoteSourceRecord | null;
  mealImport: MealImportComponentRecord | null;
}

export interface EngagementDashboardSummaryRecord {
  id: number;
  name: string;
  aliases: string[];
  type: string;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  completionDate: string | null;
  notes: string | null;
  sessionCount: number;
  totalMinutes: number;
  firstSessionDate: string | null;
  lastSessionDate: string | null;
  milestoneCount: number;
}

export interface EngagementActivityRecord {
  date: string;
  sessionCount: number;
  totalMinutes: number;
}

export interface EngagementSessionTypeRecord {
  sessionType: string;
  sessionCount: number;
  totalMinutes: number;
}

export interface EngagementMilestoneMeasurementRecord {
  id: number;
  metricName: string;
  metricValue: string;
  measurementDate: string | null;
  notes: string | null;
}

export interface EngagementMilestoneRecord {
  id: number;
  name: string;
  date: string | null;
  notes: string | null;
  ownerSessionId: number | null;
  ownerSessionDate: string | null;
  ownerStartTime: string | null;
  ownerEndTime: string | null;
  measurements: EngagementMilestoneMeasurementRecord[];
}

export interface EngagementTransactionTotalRecord {
  currency: string;
  transactionCount: number;
  inflow: number;
  outflow: number;
  net: number;
}

export interface EngagementRecentSessionRecord {
  id: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number;
  sessionType: string;
  notes: string | null;
}

export interface EngagementTransactionRecord {
  id: number;
  date: string;
  amount: number;
  currency: string;
  accountName: string;
  description: string | null;
}

export interface EngagementDashboardQueryResult {
  startDate: string | null;
  endDate: string;
  engagements: EngagementDashboardSummaryRecord[];
  selectedEngagement: EngagementDashboardSummaryRecord | null;
  dailyActivity: EngagementActivityRecord[];
  sessionTypes: EngagementSessionTypeRecord[];
  milestones: EngagementMilestoneRecord[];
  transactionTotals: EngagementTransactionTotalRecord[];
  transactions: EngagementTransactionRecord[];
  recentSessions: EngagementRecentSessionRecord[];
  unassignedTransactionCount: number;
}

export interface FinancialCurrencyRecord {
  currency: string;
  transactionCount: number;
  inflow: number;
  outflow: number;
  net: number;
}

export interface FinancialDailyRecord extends FinancialCurrencyRecord {
  date: string;
}

export interface FinancialEngagementRecord extends FinancialCurrencyRecord {
  engagementId: number;
  engagementName: string;
}

export interface FinancialAccountRecord extends FinancialCurrencyRecord {
  accountId: number;
  accountName: string;
  accountType: string | null;
}

export interface FinancialTransactionRecord {
  id: number;
  date: string;
  amount: number;
  currency: string;
  accountName: string;
  engagementName: string | null;
  description: string | null;
}

export interface FinancialDashboardQueryResult {
  startDate: string | null;
  endDate: string;
  transactionCount: number;
  linkedTransactionCount: number;
  unresolvedTransactionCount: number;
  currencies: FinancialCurrencyRecord[];
  dailyFlow: FinancialDailyRecord[];
  engagements: FinancialEngagementRecord[];
  accounts: FinancialAccountRecord[];
  recentTransactions: FinancialTransactionRecord[];
}

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

export interface ExerciseDailyRecord {
  date: string;
  workoutCount: number;
  totalMinutes: number;
  setCount: number;
}

export interface ExercisePerformanceRecord {
  exerciseId: number;
  exerciseName: string;
  category: string | null;
  workoutCount: number;
  setCount: number;
  maxWeight: number | null;
  maxReps: number | null;
  loadVolume: number;
  totalDistance: number;
  measuredDurationMinutes: number;
  lastDate: string;
}

export interface ExerciseMuscleRecord {
  muscleName: string;
  bodyRegion: string | null;
  role: string | null;
  exposureSets: number;
  workoutCount: number;
}

export interface ExerciseWorkoutRecord {
  id: number;
  date: string;
  engagementName: string;
  durationMinutes: number;
  exerciseCount: number;
  setCount: number;
  loadVolume: number;
  totalDistance: number;
  measuredDurationMinutes: number;
  notes: string | null;
}

export interface ExerciseDashboardQueryResult {
  startDate: string | null;
  endDate: string;
  workoutCount: number;
  trainingDays: number;
  totalMinutes: number;
  detailedWorkoutCount: number;
  totalSets: number;
  setsWithoutMeasurements: number;
  painRecordedSets: number;
  daily: ExerciseDailyRecord[];
  exercises: ExercisePerformanceRecord[];
  muscles: ExerciseMuscleRecord[];
  recentWorkouts: ExerciseWorkoutRecord[];
}

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

function scalar(db: Database, sql: string): SqlValue | undefined {
  const result = rows(db, sql);
  if (result.length === 0) return undefined;
  return Object.values(result[0])[0];
}

function hasColumns(db: Database, table: string, required: string[]): boolean {
  const existing = new Set(rows(db, `PRAGMA table_info("${table}")`).map((row) => String(row.name)));
  return required.every((column) => existing.has(column));
}

function hasExerciseDetailSchema(db: Database): boolean {
  return Object.entries(EXERCISE_DETAIL_COLUMNS).every(([table, required]) => hasColumns(db, table, required));
}

function hasMilestoneDetailSchema(db: Database): boolean {
  return Object.entries(MILESTONE_DETAIL_COLUMNS).every(([table, required]) => hasColumns(db, table, required));
}

function hasPlanningSchema(db: Database): boolean {
  return Object.entries(PLANNING_COLUMNS).every(([table, required]) => hasColumns(db, table, required));
}

function hasWeeklyPlanningSchema(db: Database): boolean {
  return Object.entries(WEEKLY_PLANNING_COLUMNS).every(([table, required]) => hasColumns(db, table, required));
}

function validateEngagementDashboardSchema(db: Database): void {
  for (const [table, required] of Object.entries(ENGAGEMENT_DASHBOARD_COLUMNS)) {
    const existing = new Set(rows(db, `PRAGMA table_info("${table}")`).map((row) => String(row.name)));
    if (existing.size === 0) throw new Error(`Engagement Dashboard requires table "${table}".`);
    const missing = required.filter((column) => !existing.has(column));
    if (missing.length > 0) {
      throw new Error(`Engagement Dashboard table "${table}" is missing: ${missing.join(', ')}.`);
    }
  }
}

function validateDashboardSchema(db: Database, dashboard: string, contract: Record<string, string[]>): void {
  for (const [table, required] of Object.entries(contract)) {
    const existing = new Set(rows(db, `PRAGMA table_info("${table}")`).map((row) => String(row.name)));
    if (existing.size === 0) throw new Error(`${dashboard} requires table or view "${table}".`);
    const missing = required.filter((column) => !existing.has(column));
    if (missing.length > 0) throw new Error(`${dashboard} source "${table}" is missing: ${missing.join(', ')}.`);
  }
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
      AND lifecycle_state NOT IN ('finalized', 'deleted')
  `, [startDate, endDate]);
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
      AND ns.lifecycle_state NOT IN ('finalized', 'deleted')
    ORDER BY ps.date, ps.start_time, ps.source_ordinal, ps.id
  `, [startDate, endDate]);

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
      timeEstimated: Number(row.time_is_estimated) === 1,
      planningWarnings: warningText ? warningText.split('\n').filter(Boolean) : [],
    });
  }
  return events;
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
  const exerciseEvents = events.filter((event) => event.sessionType.trim().toLowerCase() === 'exercise');
  if (exerciseEvents.length === 0 || !hasExerciseDetailSchema(db)) return;

  const eventsById = new Map(exerciseEvents.map((event) => {
    event.exerciseDetails = [];
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
    JOIN session_types AS st ON st.id = s.session_type_id
    JOIN session_exercises AS se ON se.session_id = s.id
    JOIN exercises AS e ON e.id = se.exercise_id
    LEFT JOIN exercise_sets AS es ON es.session_exercise_id = se.id
    WHERE s.date >= ? AND s.date <= ?
      AND st.code = 'exercise' COLLATE NOCASE
    ORDER BY s.date,
             s.start_time,
             COALESCE(se.order_index, 2147483647),
             se.id,
             COALESCE(es.set_number, 2147483647),
             es.id
  `, [startDate, endDate]);

  for (const row of exerciseRows) {
    const event = eventsById.get(String(row.session_id));
    if (!event?.exerciseDetails) continue;

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

export function validateSchema(db: Database): void {
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const existing = new Set(rows(db, `PRAGMA table_info("${table}")`).map((row) => String(row.name)));
    if (existing.size === 0) throw new Error(`Required table "${table}" was not found.`);
    const missing = required.filter((column) => !existing.has(column));
    if (missing.length > 0) throw new Error(`Table "${table}" is missing: ${missing.join(', ')}.`);
  }
}

export function inspectDatabase(db: Database): DatabaseInspection {
  const integrity = String(scalar(db, 'PRAGMA quick_check') ?? 'unknown');
  if (integrity !== 'ok') throw new Error(`SQLite quick check failed: ${integrity}`);
  validateSchema(db);
  const profile = rows(db, `
    SELECT COUNT(*) AS session_count,
           COUNT(DISTINCT date) AS distinct_days,
           MIN(date) AS first_date,
           MAX(date) AS last_date
    FROM sessions
  `)[0];
  return {
    integrity,
    sessionCount: Number(profile.session_count ?? 0),
    distinctDays: Number(profile.distinct_days ?? 0),
    firstDate: profile.first_date == null ? null : String(profile.first_date),
    lastDate: profile.last_date == null ? null : String(profile.last_date),
  };
}

export function queryWeeklyPlan(db: Database, weekStartDate: string): WeeklyPlanQueryResult | null {
  validateSchema(db);
  if (!hasWeeklyPlanningSchema(db)) return null;
  const plans = rows(db, `
    SELECT id, week_start_date, source_file_name, main_outcome,
           important_deadline, constraint_or_risk
    FROM weekly_plans
    WHERE week_start_date = ?
  `, [weekStartDate]);
  if (plans.length === 0) return null;
  const plan = plans[0];
  const planId = Number(plan.id);
  const sessionRows = rows(db, `
    SELECT wps.id, wps.date, wps.start_time, wps.end_time,
           wps.duration_minutes, st.code AS session_type,
           e.name AS engagement_name, wps.notes
    FROM weekly_plan_sessions AS wps
    JOIN session_types AS st ON st.id = wps.session_type_id
    JOIN engagements AS e ON e.id = wps.engagement_id
    WHERE wps.weekly_plan_id = ?
    ORDER BY wps.date, wps.start_time, wps.id
  `, [planId]);
  const commitmentRows = rows(db, `
    SELECT wc.id, wc.source_ordinal, wc.target_minutes,
           e.name AS engagement_name, wc.commitment_text
    FROM weekly_commitments AS wc
    JOIN engagements AS e ON e.id = wc.engagement_id
    WHERE wc.weekly_plan_id = ?
    ORDER BY wc.source_ordinal, wc.id
  `, [planId]);
  return {
    weekStartDate: String(plan.week_start_date),
    sourceFileName: String(plan.source_file_name),
    mainOutcome: nullableText(plan.main_outcome),
    importantDeadline: nullableText(plan.important_deadline),
    constraintOrRisk: nullableText(plan.constraint_or_risk),
    sessions: sessionRows.map((row) => ({
      id: Number(row.id),
      date: String(row.date),
      startTime: String(row.start_time),
      endTime: String(row.end_time),
      durationMinutes: Number(row.duration_minutes),
      sessionType: String(row.session_type),
      engagementName: String(row.engagement_name),
      notes: nullableText(row.notes),
    })),
    commitments: commitmentRows.map((row) => ({
      id: Number(row.id),
      ordinal: Number(row.source_ordinal),
      targetMinutes: Number(row.target_minutes),
      engagementName: String(row.engagement_name),
      commitmentText: String(row.commitment_text),
    })),
  };
}

export function queryWeeklyPlanIndex(db: Database): WeeklyPlanIndexQueryResult {
  validateSchema(db);
  if (!hasWeeklyPlanningSchema(db)) return { importedPlans: [] };
  return {
    importedPlans: rows(db, `
      SELECT id, week_start_date, source_file_name, source_file_path
      FROM weekly_plans
      ORDER BY week_start_date DESC, id DESC
    `).map((row) => ({
      id: Number(row.id),
      weekStartDate: String(row.week_start_date),
      sourceFileName: String(row.source_file_name),
      sourceFilePath: String(row.source_file_path),
    })),
  };
}

export function queryWeeklyAssessment(db: Database, requestedDate: string): WeeklyAssessmentQueryResult | null {
  validateSchema(db);
  if (!hasWeeklyPlanningSchema(db)) return null;

  const matchingPlans = rows(db, `
    SELECT id, week_start_date, source_file_name, main_outcome,
           important_deadline, constraint_or_risk
    FROM weekly_plans
    WHERE week_start_date <= ?
    ORDER BY week_start_date DESC
    LIMIT 1
  `, [requestedDate]);
  const plans = matchingPlans.length > 0 ? matchingPlans : rows(db, `
    SELECT id, week_start_date, source_file_name, main_outcome,
           important_deadline, constraint_or_risk
    FROM weekly_plans
    ORDER BY week_start_date ASC
    LIMIT 1
  `);
  if (plans.length === 0) return null;

  const plan = plans[0];
  const planId = Number(plan.id);
  const weekStartDate = String(plan.week_start_date);
  const navigation = rows(db, `
    SELECT
      (SELECT MAX(week_start_date) FROM weekly_plans WHERE week_start_date < ?) AS previous_week_start,
      (SELECT MIN(week_start_date) FROM weekly_plans WHERE week_start_date > ?) AS next_week_start
  `, [weekStartDate, weekStartDate])[0];
  const commitmentRows = rows(db, `
    SELECT wc.id,
           wc.source_ordinal,
           wc.target_minutes,
           e.name AS engagement_name,
           wc.commitment_text,
           COALESCE(SUM(s.duration_minutes), 0) AS actual_minutes
    FROM weekly_commitments AS wc
    JOIN engagements AS e ON e.id = wc.engagement_id
    LEFT JOIN sessions AS s
      ON s.engagement_id = wc.engagement_id
     AND s.date >= ?
     AND s.date <= date(?, '+6 days')
    WHERE wc.weekly_plan_id = ?
    GROUP BY wc.id, wc.source_ordinal, wc.target_minutes, e.name, wc.commitment_text
    ORDER BY wc.source_ordinal, wc.id
  `, [weekStartDate, weekStartDate, planId]);

  return {
    weekStartDate,
    weekEndDate: String(rows(db, `SELECT date(?, '+6 days') AS week_end_date`, [weekStartDate])[0]?.week_end_date ?? weekStartDate),
    sourceFileName: String(plan.source_file_name),
    mainOutcome: nullableText(plan.main_outcome),
    importantDeadline: nullableText(plan.important_deadline),
    constraintOrRisk: nullableText(plan.constraint_or_risk),
    previousWeekStart: nullableText(navigation.previous_week_start),
    nextWeekStart: nullableText(navigation.next_week_start),
    commitments: commitmentRows.map((row) => ({
      id: Number(row.id),
      ordinal: Number(row.source_ordinal),
      targetMinutes: Number(row.target_minutes),
      actualMinutes: Number(row.actual_minutes),
      engagementName: String(row.engagement_name),
      commitmentText: String(row.commitment_text),
    })),
  };
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
): DailyAssessmentQueryResult {
  validateSchema(db);
  const sessionResult = querySessions(db, date, date, todayDate);
  const metricRows = hasColumns(db, 'daily_metrics', [
    'date', 'mood', 'energy', 'stress', 'weight_kg', 'sleep_hours',
    'calories', 'protein_g', 'fasted', 'dieted',
  ]) ? rows(db, `
    SELECT mood, energy, stress, weight_kg, sleep_hours,
           calories, protein_g, fasted, dieted
    FROM daily_metrics
    WHERE date = ?
  `, [date]) : [];
  const metricRow = metricRows[0];
  const metrics = metricRow ? {
    mood: nullableNumber(metricRow.mood),
    energy: nullableNumber(metricRow.energy),
    stress: nullableNumber(metricRow.stress),
    weightKg: nullableNumber(metricRow.weight_kg),
    sleepHours: nullableNumber(metricRow.sleep_hours),
    calories: nullableNumber(metricRow.calories),
    proteinG: nullableNumber(metricRow.protein_g),
    fasted: nullableNumber(metricRow.fasted),
    dieted: nullableNumber(metricRow.dieted),
  } : null;
  const meals = hasColumns(db, 'daily_meals', ['id', 'day', 'food', 'calories', 'protein_g'])
    ? rows(db, `
        SELECT id, food, calories, protein_g
        FROM daily_meals
        WHERE day = ?
        ORDER BY id
      `, [date]).map((row) => ({
        id: Number(row.id),
        food: String(row.food),
        calories: nullableNumber(row.calories),
        proteinG: nullableNumber(row.protein_g),
      }))
    : [];
  const transactions = hasColumns(db, 'transactions', ['id', 'account_id', 'date', 'amount', 'category', 'description'])
    && hasColumns(db, 'accounts', ['id', 'name'])
    ? rows(db, `
        SELECT t.id, a.name AS account_name, t.amount,
               COALESCE(e.name, CAST(t.category AS TEXT)) AS engagement_display,
               t.description
        FROM transactions AS t
        JOIN accounts AS a ON a.id = t.account_id
        LEFT JOIN engagements AS e ON CAST(e.id AS TEXT) = TRIM(CAST(t.category AS TEXT))
        WHERE t.date = ?
        ORDER BY t.id
      `, [date]).map((row) => ({
        id: Number(row.id),
        accountName: String(row.account_name),
        amount: Number(row.amount),
        engagement: String(row.engagement_display ?? ''),
        description: String(row.description ?? ''),
      }))
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
    sessionType: String(row.session_type),
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
    JOIN session_types AS st ON st.id = s.session_type_id
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
    sessionType: String(row.session_type),
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
): FinancialDashboardQueryResult {
  validateDashboardSchema(db, 'Financial Dashboard', FINANCIAL_DASHBOARD_COLUMNS);
  const rangeParams: SqlValue[] = [startDate, startDate, endDate];
  const currencyExpression = `COALESCE(NULLIF(TRIM(account.currency), ''), 'Unspecified')`;
  const linkJoin = `LEFT JOIN engagements AS engagement
      ON CAST(engagement.id AS TEXT) = TRIM(CAST(transaction_row.category AS TEXT))`;

  const summary = rows(db, `
    SELECT COUNT(*) AS transaction_count,
           SUM(CASE WHEN engagement.id IS NOT NULL THEN 1 ELSE 0 END) AS linked_count,
           SUM(CASE WHEN engagement.id IS NULL THEN 1 ELSE 0 END) AS unresolved_count
    FROM transactions AS transaction_row
    ${linkJoin}
    WHERE (? IS NULL OR transaction_row.date >= ?)
      AND transaction_row.date <= ?
  `, rangeParams)[0];

  const currencies = rows(db, `
    SELECT ${currencyExpression} AS currency,
           COUNT(*) AS transaction_count,
           COALESCE(SUM(CASE WHEN transaction_row.amount > 0 THEN transaction_row.amount ELSE 0 END), 0) AS inflow,
           COALESCE(SUM(CASE WHEN transaction_row.amount < 0 THEN -transaction_row.amount ELSE 0 END), 0) AS outflow,
           COALESCE(SUM(transaction_row.amount), 0) AS net
    FROM transactions AS transaction_row
    JOIN accounts AS account ON account.id = transaction_row.account_id
    WHERE (? IS NULL OR transaction_row.date >= ?)
      AND transaction_row.date <= ?
    GROUP BY ${currencyExpression}
    ORDER BY currency COLLATE NOCASE
  `, rangeParams).map((row): FinancialCurrencyRecord => ({
    currency: String(row.currency),
    transactionCount: Number(row.transaction_count ?? 0),
    inflow: Number(row.inflow ?? 0),
    outflow: Number(row.outflow ?? 0),
    net: Number(row.net ?? 0),
  }));

  const dailyFlow = rows(db, `
    SELECT transaction_row.date,
           ${currencyExpression} AS currency,
           COUNT(*) AS transaction_count,
           COALESCE(SUM(CASE WHEN transaction_row.amount > 0 THEN transaction_row.amount ELSE 0 END), 0) AS inflow,
           COALESCE(SUM(CASE WHEN transaction_row.amount < 0 THEN -transaction_row.amount ELSE 0 END), 0) AS outflow,
           COALESCE(SUM(transaction_row.amount), 0) AS net
    FROM transactions AS transaction_row
    JOIN accounts AS account ON account.id = transaction_row.account_id
    WHERE (? IS NULL OR transaction_row.date >= ?)
      AND transaction_row.date <= ?
    GROUP BY transaction_row.date, ${currencyExpression}
    ORDER BY transaction_row.date, currency COLLATE NOCASE
  `, rangeParams).map((row): FinancialDailyRecord => ({
    date: String(row.date),
    currency: String(row.currency),
    transactionCount: Number(row.transaction_count ?? 0),
    inflow: Number(row.inflow ?? 0),
    outflow: Number(row.outflow ?? 0),
    net: Number(row.net ?? 0),
  }));

  const engagements = rows(db, `
    SELECT engagement.id AS engagement_id,
           engagement.name AS engagement_name,
           ${currencyExpression} AS currency,
           COUNT(*) AS transaction_count,
           COALESCE(SUM(CASE WHEN transaction_row.amount > 0 THEN transaction_row.amount ELSE 0 END), 0) AS inflow,
           COALESCE(SUM(CASE WHEN transaction_row.amount < 0 THEN -transaction_row.amount ELSE 0 END), 0) AS outflow,
           COALESCE(SUM(transaction_row.amount), 0) AS net
    FROM transactions AS transaction_row
    JOIN accounts AS account ON account.id = transaction_row.account_id
    JOIN engagements AS engagement
      ON CAST(engagement.id AS TEXT) = TRIM(CAST(transaction_row.category AS TEXT))
    WHERE (? IS NULL OR transaction_row.date >= ?)
      AND transaction_row.date <= ?
    GROUP BY engagement.id, engagement.name, ${currencyExpression}
    ORDER BY outflow DESC, engagement.name COLLATE NOCASE
  `, rangeParams).map((row): FinancialEngagementRecord => ({
    engagementId: Number(row.engagement_id),
    engagementName: String(row.engagement_name),
    currency: String(row.currency),
    transactionCount: Number(row.transaction_count ?? 0),
    inflow: Number(row.inflow ?? 0),
    outflow: Number(row.outflow ?? 0),
    net: Number(row.net ?? 0),
  }));

  const accounts = rows(db, `
    SELECT account.id AS account_id,
           account.name AS account_name,
           account.type AS account_type,
           ${currencyExpression} AS currency,
           COUNT(*) AS transaction_count,
           COALESCE(SUM(CASE WHEN transaction_row.amount > 0 THEN transaction_row.amount ELSE 0 END), 0) AS inflow,
           COALESCE(SUM(CASE WHEN transaction_row.amount < 0 THEN -transaction_row.amount ELSE 0 END), 0) AS outflow,
           COALESCE(SUM(transaction_row.amount), 0) AS net
    FROM accounts AS account
    JOIN transactions AS transaction_row ON transaction_row.account_id = account.id
    WHERE (? IS NULL OR transaction_row.date >= ?)
      AND transaction_row.date <= ?
    GROUP BY account.id, account.name, account.type, ${currencyExpression}
    ORDER BY currency COLLATE NOCASE, ABS(net) DESC, account.name COLLATE NOCASE
  `, rangeParams).map((row): FinancialAccountRecord => ({
    accountId: Number(row.account_id),
    accountName: String(row.account_name),
    accountType: nullableText(row.account_type),
    currency: String(row.currency),
    transactionCount: Number(row.transaction_count ?? 0),
    inflow: Number(row.inflow ?? 0),
    outflow: Number(row.outflow ?? 0),
    net: Number(row.net ?? 0),
  }));

  const recentTransactions = rows(db, `
    SELECT transaction_row.id,
           transaction_row.date,
           transaction_row.amount,
           transaction_row.description,
           account.name AS account_name,
           ${currencyExpression} AS currency,
           engagement.name AS engagement_name
    FROM transactions AS transaction_row
    JOIN accounts AS account ON account.id = transaction_row.account_id
    ${linkJoin}
    WHERE (? IS NULL OR transaction_row.date >= ?)
      AND transaction_row.date <= ?
    ORDER BY transaction_row.date DESC, transaction_row.id DESC
    LIMIT 24
  `, rangeParams).map((row): FinancialTransactionRecord => ({
    id: Number(row.id),
    date: String(row.date),
    amount: Number(row.amount),
    currency: String(row.currency),
    accountName: String(row.account_name),
    engagementName: nullableText(row.engagement_name),
    description: nullableText(row.description),
  }));

  return {
    startDate,
    endDate,
    transactionCount: Number(summary?.transaction_count ?? 0),
    linkedTransactionCount: Number(summary?.linked_count ?? 0),
    unresolvedTransactionCount: Number(summary?.unresolved_count ?? 0),
    currencies,
    dailyFlow,
    engagements,
    accounts,
    recentTransactions,
  };
}

export function queryNutritionDashboard(
  db: Database,
  startDate: string | null,
  endDate: string,
): NutritionDashboardQueryResult {
  validateDashboardSchema(db, 'Nutrition Dashboard', NUTRITION_DASHBOARD_COLUMNS);
  const rangeParams: SqlValue[] = [startDate, startDate, endDate];
  const daily = rows(db, `
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

  const mealTypes = rows(db, `
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

  const topFoods = rows(db, `
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

export function queryExerciseDashboard(
  db: Database,
  startDate: string | null,
  endDate: string,
): ExerciseDashboardQueryResult {
  validateDashboardSchema(db, 'Exercise Dashboard', EXERCISE_DASHBOARD_COLUMNS);
  const rangeParams: SqlValue[] = [startDate, startDate, endDate];
  const workoutPredicate = `(session_type.code = 'exercise'
    OR EXISTS (SELECT 1 FROM session_exercises AS detail WHERE detail.session_id = session_row.id))`;

  const daily = rows(db, `
    SELECT session_row.date,
           COUNT(*) AS workout_count,
           COALESCE(SUM(CASE WHEN session_row.duration_minutes >= 0 THEN session_row.duration_minutes ELSE 0 END), 0) AS total_minutes,
           COALESCE(SUM((SELECT COUNT(*)
             FROM session_exercises AS link
             JOIN exercise_sets AS set_row ON set_row.session_exercise_id = link.id
             WHERE link.session_id = session_row.id)), 0) AS set_count
    FROM sessions AS session_row
    JOIN session_types AS session_type ON session_type.id = session_row.session_type_id
    WHERE ${workoutPredicate}
      AND (? IS NULL OR session_row.date >= ?)
      AND session_row.date <= ?
    GROUP BY session_row.date
    ORDER BY session_row.date
  `, rangeParams).map((row): ExerciseDailyRecord => ({
    date: String(row.date),
    workoutCount: Number(row.workout_count ?? 0),
    totalMinutes: Number(row.total_minutes ?? 0),
    setCount: Number(row.set_count ?? 0),
  }));

  const exercises = rows(db, `
    SELECT exercise.id AS exercise_id,
           exercise.name AS exercise_name,
           exercise.category,
           COUNT(DISTINCT session_row.id) AS workout_count,
           COUNT(set_row.id) AS set_count,
           MAX(set_row.weight) AS max_weight,
           MAX(set_row.reps) AS max_reps,
           COALESCE(SUM(CASE
             WHEN set_row.weight IS NOT NULL AND set_row.reps IS NOT NULL THEN set_row.weight * set_row.reps
             ELSE 0 END), 0) AS load_volume,
           COALESCE(SUM(set_row.distance), 0) AS total_distance,
           COALESCE(SUM(COALESCE(set_row.duration_minutes, set_row.duration_seconds / 60.0, 0)), 0) AS measured_duration_minutes,
           MAX(session_row.date) AS last_date
    FROM session_exercises AS link
    JOIN sessions AS session_row ON session_row.id = link.session_id
    JOIN session_types AS session_type ON session_type.id = session_row.session_type_id
    JOIN exercises AS exercise ON exercise.id = link.exercise_id
    LEFT JOIN exercise_sets AS set_row ON set_row.session_exercise_id = link.id
    WHERE ${workoutPredicate}
      AND (? IS NULL OR session_row.date >= ?)
      AND session_row.date <= ?
    GROUP BY exercise.id, exercise.name, exercise.category
    ORDER BY workout_count DESC, set_count DESC, exercise.name COLLATE NOCASE
  `, rangeParams).map((row): ExercisePerformanceRecord => ({
    exerciseId: Number(row.exercise_id),
    exerciseName: String(row.exercise_name),
    category: nullableText(row.category),
    workoutCount: Number(row.workout_count ?? 0),
    setCount: Number(row.set_count ?? 0),
    maxWeight: nullableNumber(row.max_weight),
    maxReps: nullableNumber(row.max_reps),
    loadVolume: Number(row.load_volume ?? 0),
    totalDistance: Number(row.total_distance ?? 0),
    measuredDurationMinutes: Number(row.measured_duration_minutes ?? 0),
    lastDate: String(row.last_date),
  }));

  const muscles = rows(db, `
    SELECT muscle.name AS muscle_name,
           muscle.body_region,
           mapping.role,
           COUNT(set_row.id) AS exposure_sets,
           COUNT(DISTINCT session_row.id) AS workout_count
    FROM exercise_muscles AS mapping
    JOIN muscles AS muscle ON muscle.id = mapping.muscle_id
    JOIN session_exercises AS link ON link.exercise_id = mapping.exercise_id
    JOIN sessions AS session_row ON session_row.id = link.session_id
    JOIN session_types AS session_type ON session_type.id = session_row.session_type_id
    LEFT JOIN exercise_sets AS set_row ON set_row.session_exercise_id = link.id
    WHERE ${workoutPredicate}
      AND (? IS NULL OR session_row.date >= ?)
      AND session_row.date <= ?
    GROUP BY muscle.id, muscle.name, muscle.body_region, mapping.role
    ORDER BY exposure_sets DESC, muscle.name COLLATE NOCASE
  `, rangeParams).map((row): ExerciseMuscleRecord => ({
    muscleName: String(row.muscle_name),
    bodyRegion: nullableText(row.body_region),
    role: nullableText(row.role),
    exposureSets: Number(row.exposure_sets ?? 0),
    workoutCount: Number(row.workout_count ?? 0),
  }));

  const recentWorkouts = rows(db, `
    SELECT session_row.id,
           session_row.date,
           session_row.duration_minutes,
           session_row.notes,
           engagement.name AS engagement_name,
           COUNT(DISTINCT link.exercise_id) AS exercise_count,
           COUNT(set_row.id) AS set_count,
           COALESCE(SUM(CASE
             WHEN set_row.weight IS NOT NULL AND set_row.reps IS NOT NULL THEN set_row.weight * set_row.reps
             ELSE 0 END), 0) AS load_volume,
           COALESCE(SUM(set_row.distance), 0) AS total_distance,
           COALESCE(SUM(COALESCE(set_row.duration_minutes, set_row.duration_seconds / 60.0, 0)), 0) AS measured_duration_minutes
    FROM sessions AS session_row
    JOIN session_types AS session_type ON session_type.id = session_row.session_type_id
    JOIN engagements AS engagement ON engagement.id = session_row.engagement_id
    LEFT JOIN session_exercises AS link ON link.session_id = session_row.id
    LEFT JOIN exercise_sets AS set_row ON set_row.session_exercise_id = link.id
    WHERE ${workoutPredicate}
      AND (? IS NULL OR session_row.date >= ?)
      AND session_row.date <= ?
    GROUP BY session_row.id, session_row.date, session_row.duration_minutes, session_row.notes, engagement.name
    ORDER BY session_row.date DESC, session_row.id DESC
    LIMIT 20
  `, rangeParams).map((row): ExerciseWorkoutRecord => ({
    id: Number(row.id),
    date: String(row.date),
    engagementName: String(row.engagement_name),
    durationMinutes: Math.max(0, Number(row.duration_minutes ?? 0)),
    exerciseCount: Number(row.exercise_count ?? 0),
    setCount: Number(row.set_count ?? 0),
    loadVolume: Number(row.load_volume ?? 0),
    totalDistance: Number(row.total_distance ?? 0),
    measuredDurationMinutes: Number(row.measured_duration_minutes ?? 0),
    notes: nullableText(row.notes),
  }));

  const quality = rows(db, `
    SELECT COUNT(set_row.id) AS total_sets,
           SUM(CASE WHEN set_row.weight IS NULL
                     AND set_row.reps IS NULL
                     AND set_row.distance IS NULL
                     AND set_row.duration_minutes IS NULL
                     AND set_row.duration_seconds IS NULL THEN 1 ELSE 0 END) AS missing_measurement_sets,
           SUM(CASE WHEN set_row.pain_level IS NOT NULL THEN 1 ELSE 0 END) AS pain_recorded_sets
    FROM exercise_sets AS set_row
    JOIN session_exercises AS link ON link.id = set_row.session_exercise_id
    JOIN sessions AS session_row ON session_row.id = link.session_id
    WHERE (? IS NULL OR session_row.date >= ?)
      AND session_row.date <= ?
  `, rangeParams)[0];
  const workoutCount = daily.reduce((sum, day) => sum + day.workoutCount, 0);

  return {
    startDate,
    endDate,
    workoutCount,
    trainingDays: daily.length,
    totalMinutes: daily.reduce((sum, day) => sum + day.totalMinutes, 0),
    detailedWorkoutCount: recentWorkouts.length >= workoutCount
      ? recentWorkouts.filter((workout) => workout.exerciseCount > 0).length
      : Number(rows(db, `
          SELECT COUNT(DISTINCT session_row.id) AS detailed_count
          FROM sessions AS session_row
          JOIN session_exercises AS link ON link.session_id = session_row.id
          WHERE (? IS NULL OR session_row.date >= ?)
            AND session_row.date <= ?
        `, rangeParams)[0]?.detailed_count ?? 0),
    totalSets: Number(quality?.total_sets ?? 0),
    setsWithoutMeasurements: Number(quality?.missing_measurement_sets ?? 0),
    painRecordedSets: Number(quality?.pain_recorded_sets ?? 0),
    daily,
    exercises,
    muscles,
    recentWorkouts,
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
    JOIN session_types AS st ON st.id = s.session_type_id
    JOIN engagement_types AS et ON et.id = e.type_id
    WHERE s.date >= ? AND s.date <= ?
  `, [startDate, endDate]);

  const events: CalendarEvent[] = [];
  const issues: DataIssue[] = [];
  for (const row of sourceRows) {
    const date = String(row.date);
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
      event.dataWarning = `Session ${id} uses the invalid type "chor". Correct it in EQH.db.`;
      issues.push({ sessionId: id, message: event.dataWarning });
    }
    events.push(event);
  }

  attachExerciseDetails(db, startDate, endDate, events);
  attachMilestoneDetails(db, startDate, endDate, events);
  if (includePlanning) {
    events.push(...queryPlannedEvents(db, startDate, endDate, importedDates, issues));
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
