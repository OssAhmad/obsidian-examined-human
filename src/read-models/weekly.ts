import type { Database } from 'sql.js';
import { validateSchema } from './core-schema.ts';
import { hasTableColumns, queryRows } from './sql.ts';
import { nullableText } from './values.ts';

export const WEEKLY_PLANNING_COLUMNS: Record<string, string[]> = {
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

export function hasWeeklyPlanningSchema(db: Database): boolean {
  return Object.entries(WEEKLY_PLANNING_COLUMNS).every(([table, required]) => hasTableColumns(db, table, required));
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


export function queryWeeklyPlan(db: Database, weekStartDate: string): WeeklyPlanQueryResult | null {
  validateSchema(db);
  if (!hasWeeklyPlanningSchema(db)) return null;
  const plans = queryRows(db, `
    SELECT id, week_start_date, source_file_name, main_outcome,
           important_deadline, constraint_or_risk
    FROM weekly_plans
    WHERE week_start_date = ?
  `, [weekStartDate]);
  if (plans.length === 0) return null;
  const plan = plans[0];
  const planId = Number(plan.id);
  const sessionRows = queryRows(db, `
    SELECT wps.id, wps.date, wps.start_time, wps.end_time,
           wps.duration_minutes, st.code AS session_type,
           e.name AS engagement_name, wps.notes
    FROM weekly_plan_sessions AS wps
    LEFT JOIN session_types AS st ON st.id = wps.session_type_id
    JOIN engagements AS e ON e.id = wps.engagement_id
    WHERE wps.weekly_plan_id = ?
    ORDER BY wps.date, wps.start_time, wps.id
  `, [planId]);
  const commitmentRows = queryRows(db, `
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
      sessionType: nullableText(row.session_type) ?? '',
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
    importedPlans: queryRows(db, `
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

  const matchingPlans = queryRows(db, `
    SELECT id, week_start_date, source_file_name, main_outcome,
           important_deadline, constraint_or_risk
    FROM weekly_plans
    WHERE week_start_date <= ?
    ORDER BY week_start_date DESC
    LIMIT 1
  `, [requestedDate]);
  const plans = matchingPlans.length > 0 ? matchingPlans : queryRows(db, `
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
  const navigation = queryRows(db, `
    SELECT
      (SELECT MAX(week_start_date) FROM weekly_plans WHERE week_start_date < ?) AS previous_week_start,
      (SELECT MIN(week_start_date) FROM weekly_plans WHERE week_start_date > ?) AS next_week_start
  `, [weekStartDate, weekStartDate])[0];
  const commitmentRows = queryRows(db, `
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
    weekEndDate: String(queryRows(db, `SELECT date(?, '+6 days') AS week_end_date`, [weekStartDate])[0]?.week_end_date ?? weekStartDate),
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

