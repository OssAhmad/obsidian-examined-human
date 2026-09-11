import type { Database } from 'sql.js';
import { validateSchema } from './core-schema.ts';
import { queryRows, queryScalar } from './sql.ts';

export interface DatabaseInspection {
  integrity: string;
  sessionCount: number;
  distinctDays: number;
  firstDate: string | null;
  lastDate: string | null;
}

export function inspectDatabase(db: Database): DatabaseInspection {
  const integrity = String(queryScalar(db, 'PRAGMA quick_check') ?? 'unknown');
  if (integrity !== 'ok') throw new Error(`SQLite quick check failed: ${integrity}`);
  validateSchema(db);
  const profile = queryRows(db, `
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
