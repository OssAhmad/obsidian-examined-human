import type { Database } from 'sql.js';
import { validateSchema } from './core-schema.ts';
import { queryRows } from './sql.ts';

export interface DashboardOverview {
  totalMinutes: number;
  sessionCount: number;
  engagementCount: number;
  recordedDays: number;
}

/** Recorded sessions through today; intentions never inflate the summary. */
export function queryDashboardOverview(db: Database, todayDate: string): DashboardOverview {
  validateSchema(db);
  const row = queryRows(db, `
    SELECT COALESCE(SUM(CASE WHEN duration_minutes >= 0 THEN duration_minutes ELSE 0 END), 0) AS total_minutes,
           COUNT(*) AS session_count,
           COUNT(DISTINCT engagement_id) AS engagement_count,
           COUNT(DISTINCT date) AS recorded_days
    FROM sessions
    WHERE date <= ?
  `, [todayDate])[0];
  return {
    totalMinutes: Number(row.total_minutes),
    sessionCount: Number(row.session_count),
    engagementCount: Number(row.engagement_count),
    recordedDays: Number(row.recorded_days),
  };
}
