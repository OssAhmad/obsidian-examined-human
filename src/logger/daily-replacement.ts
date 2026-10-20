import type { Database } from 'sql.js';
import { queryRows } from '../read-models/sql.ts';

export interface DailyReplacementPreview {
  date: string;
  /** Includes every dated row, regardless of which application created it. */
  records: Record<string, number>;
}

const sessions = 'SELECT id FROM sessions WHERE date = ?1';
const milestones = `SELECT id FROM engagement_milestones WHERE date = ?1 OR session_id IN (${sessions})`;

// Child rows precede their owners. The same predicates drive the preview and
// deletion so the warning describes exactly the records being replaced.
const REPLACEMENT_RECORDS = {
  exercise_sets: `session_exercise_id IN (SELECT id FROM session_exercises WHERE session_id IN (${sessions}))`,
  session_exercises: `session_id IN (${sessions})`,
  engagement_measurements: `measurement_date = ?1 OR milestone_id IN (${milestones})`,
  engagement_milestones: `id IN (${milestones})`,
  sessions: 'date = ?1',
  transactions: 'date = ?1',
  stoicism_entries: 'date = ?1',
  daily_meals: 'day = ?1 OR meal_event_id IN (SELECT id FROM meal_events WHERE day = ?1)',
  meal_events: 'day = ?1',
  daily_meal_assessments: 'day = ?1',
  daily_metrics: 'date = ?1',
  valuation_rates: 'rate_set_id IN (SELECT id FROM valuation_rate_sets WHERE rate_date = ?1)',
  valuation_rate_sets: 'rate_date = ?1',
  note_import_components: 'note_date = ?1',
  planned_sessions: 'date = ?1 OR source_note_id IN (SELECT id FROM note_sources WHERE note_date = ?1)',
  note_sources: 'note_date = ?1',
  imported_notes: 'note_date = ?1',
} as const;

export function previewDailyReplacement(db: Database, date: string): DailyReplacementPreview {
  return {
    date,
    records: Object.fromEntries(Object.entries(REPLACEMENT_RECORDS).map(([table, predicate]) => [
      table,
      Number(queryRows(db, `SELECT COUNT(*) AS count FROM ${table} WHERE ${predicate}`, [date])[0].count),
    ])),
  };
}

export function deleteDailyRecords(db: Database, date: string): void {
  // A day cannot own records from another day merely because a milestone or
  // meal event connects them. Refuse ambiguous legacy links before deleting.
  if (queryRows(db, `SELECT 1 FROM engagement_measurements WHERE milestone_id IN (${milestones})
      AND (measurement_date IS NULL OR measurement_date <> ?1) LIMIT 1`, [date]).length) {
    throw new Error('Replacement blocked: a milestone owned by this day has measurements from another or unknown date. Resolve those links before replacing the day.');
  }
  if (queryRows(db, `SELECT 1 FROM engagement_milestones AS milestone
      JOIN sessions AS session ON session.id = milestone.session_id
      WHERE milestone.date = ?1 AND session.date <> ?1 LIMIT 1`, [date]).length) {
    throw new Error('Replacement blocked: a milestone dated this day belongs to a session on another date. Resolve that link first.');
  }
  if (queryRows(db, `SELECT 1 FROM daily_meals AS item
      JOIN meal_events AS event ON event.id = item.meal_event_id
      WHERE (item.day = ?1 OR event.day = ?1) AND item.day <> event.day LIMIT 1`, [date]).length) {
    throw new Error('Replacement blocked: meal items and their meal event disagree about the date. Resolve those links first.');
  }
  if (queryRows(db, `SELECT 1 FROM planned_sessions
      WHERE source_note_id IN (SELECT id FROM note_sources WHERE note_date = ?1)
      AND date <> ?1 LIMIT 1`, [date]).length) {
    throw new Error('Replacement blocked: this day owns a planning projection for another date. Resolve that link first.');
  }
  for (const [table, predicate] of Object.entries(REPLACEMENT_RECORDS)) {
    db.run(`DELETE FROM ${table} WHERE ${predicate}`, [date]);
  }
}
