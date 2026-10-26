import assert from 'node:assert/strict';
import test from 'node:test';
import { createSchemaV1Database } from '../../test-support/database.mjs';
import { queryDashboardOverview } from './dashboard-overview.ts';

test('sidebar totals count recorded sessions and participating engagements through today, excluding plans', () => {
  const db = createSchemaV1Database();
  try {
    db.run(`INSERT INTO engagements (id, name, type_id)
      SELECT 1, 'Reading', id FROM engagement_types WHERE code = 'book';
      INSERT INTO engagements (id, name, type_id)
      SELECT 2, 'Study', id FROM engagement_types WHERE code = 'course';
      INSERT INTO engagements (id, name, type_id)
      SELECT 3, 'Unused', id FROM engagement_types WHERE code = 'course';
      INSERT INTO sessions (engagement_id, date, duration_minutes) VALUES
        (1, '2026-10-25', 60), (2, '2026-10-26', 90),
        (2, '2026-10-26', NULL), (2, '2026-10-26', -10), (3, '2026-10-27', 999);
      INSERT INTO note_sources (id, note_date, file_name, file_path, content_checksum, lifecycle_state, parse_status)
      VALUES (1, '2026-10-26', 'today.md', 'today.md', 'test', 'planned', 'ok');
      INSERT INTO planned_sessions (source_note_id, source_ordinal, date, start_time, end_time, duration_minutes, session_type_raw, engagement_raw)
      VALUES (1, 1, '2026-10-26', '10:00', '11:00', 60, '', 'Reading');
      PRAGMA query_only = ON;`);
    assert.deepEqual(queryDashboardOverview(db, '2026-10-26'), {
      totalMinutes: 150, sessionCount: 4, engagementCount: 2, recordedDays: 2,
    });
    assert.deepEqual(queryDashboardOverview(db, '2026-01-01'), {
      totalMinutes: 0, sessionCount: 0, engagementCount: 0, recordedDays: 0,
    });
  } finally { db.close(); }
});
