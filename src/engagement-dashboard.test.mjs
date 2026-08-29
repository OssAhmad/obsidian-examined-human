import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { queryEngagementDashboard } from './examined-human-query.ts';

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const SQL = await initSqlJs({ wasmBinary });

function fixture() {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE engagement_types (id INTEGER PRIMARY KEY, code TEXT NOT NULL);
    CREATE TABLE engagement_statuses (id INTEGER PRIMARY KEY, code TEXT NOT NULL);
    CREATE TABLE session_types (id INTEGER PRIMARY KEY, code TEXT NOT NULL);
    CREATE TABLE engagements (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type_id INTEGER NOT NULL,
      status_id INTEGER,
      start_date TEXT,
      target_date TEXT,
      completion_date TEXT,
      notes TEXT
    );
    CREATE TABLE engagement_aliases (
      id INTEGER PRIMARY KEY,
      engagement_id INTEGER NOT NULL,
      alias TEXT NOT NULL
    );
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY,
      engagement_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      duration_minutes INTEGER,
      session_type_id INTEGER NOT NULL,
      notes TEXT
    );
    CREATE TABLE engagement_milestones (
      id INTEGER PRIMARY KEY,
      engagement_id INTEGER NOT NULL,
      session_id INTEGER,
      name TEXT NOT NULL,
      date TEXT,
      notes TEXT
    );
    CREATE TABLE engagement_measurements (
      id INTEGER PRIMARY KEY,
      milestone_id INTEGER NOT NULL,
      metric_name TEXT NOT NULL,
      metric_value TEXT NOT NULL,
      measurement_date TEXT,
      notes TEXT
    );
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, currency TEXT);
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT,
      description TEXT
    );

    INSERT INTO engagement_types VALUES (1, 'course'), (2, 'fitness');
    INSERT INTO engagement_statuses VALUES (1, 'active'), (2, 'completed');
    INSERT INTO session_types VALUES (1, 'study'), (2, 'exercise');
    INSERT INTO engagements VALUES
      (1, 'Course Alpha', 1, 1, '2026-06-01', '2026-09-01', NULL, 'Primary notes'),
      (2, 'Fitness Beta', 2, 2, '2026-06-01', NULL, '2026-07-10', NULL);
    INSERT INTO engagement_aliases VALUES
      (1, 1, 'Alpha Course'),
      (2, 1, 'Study Alpha'),
      (3, 2, 'Gym');
    INSERT INTO sessions VALUES
      (1, 1, '2026-06-15', '09:00', '10:00', 60, 1, 'Outside range'),
      (2, 1, '2026-07-01', '09:00', '10:30', 90, 1, 'Lesson'),
      (3, 1, '2026-07-02', '07:00', '07:30', 30, 2, NULL),
      (4, 2, '2026-07-02', '08:00', '08:45', 45, 2, NULL);
    INSERT INTO engagement_milestones VALUES
      (1, 1, 2, 'First module', '2026-07-01', 'Finished'),
      (2, 1, NULL, 'Legacy milestone', '2026-06-20', NULL);
    INSERT INTO engagement_measurements VALUES
      (1, 1, 'score', '95', '2026-07-01', NULL);
    INSERT INTO accounts VALUES (1, 'Card', 'USD'), (2, 'Cash', 'EUR');
    INSERT INTO transactions VALUES
      (1, 1, '2026-07-03', -20, '1', 'Book'),
      (2, 1, '2026-07-04', 100, '1', 'Refund'),
      (3, 2, '2026-07-04', -10, '1', NULL),
      (4, 1, '2026-07-04', -5, 'legacy category', 'Legacy'),
      (5, 1, '2026-06-15', -50, '1', 'Old purchase');
  `);
  return db;
}

test('engagement dashboard keeps period metrics and lifetime milestones distinct', () => {
  const db = fixture();
  try {
    const result = queryEngagementDashboard(db, 1, '2026-07-01', '2026-07-31');
    assert.equal(result.selectedEngagement?.name, 'Course Alpha');
    assert.deepEqual(result.selectedEngagement?.aliases, ['Alpha Course', 'Study Alpha']);
    assert.deepEqual(
      result.engagements.map((engagement) => [engagement.id, engagement.sessionCount, engagement.totalMinutes]),
      [[1, 2, 120], [2, 1, 45]],
    );
    assert.equal(result.selectedEngagement?.milestoneCount, 2);
    assert.deepEqual(result.dailyActivity, [
      { date: '2026-07-01', sessionCount: 1, totalMinutes: 90 },
      { date: '2026-07-02', sessionCount: 1, totalMinutes: 30 },
    ]);
    assert.deepEqual(result.sessionTypes, [
      { sessionType: 'study', sessionCount: 1, totalMinutes: 90 },
      { sessionType: 'exercise', sessionCount: 1, totalMinutes: 30 },
    ]);
    assert.equal(result.milestones.length, 2);
    assert.equal(result.milestones[0].ownerSessionId, 2);
    assert.deepEqual(result.milestones[0].measurements, [{
      id: 1,
      metricName: 'score',
      metricValue: '95',
      measurementDate: '2026-07-01',
      notes: null,
    }]);
    assert.equal(result.milestones[1].ownerSessionId, null);
    assert.deepEqual(result.transactionTotals, [
      { currency: 'EUR', transactionCount: 1, inflow: 0, outflow: 10, net: -10 },
      { currency: 'USD', transactionCount: 2, inflow: 100, outflow: 20, net: 80 },
    ]);
    assert.deepEqual(result.transactions, [
      { id: 3, date: '2026-07-04', amount: -10, currency: 'EUR', accountName: 'Cash', description: null },
      { id: 2, date: '2026-07-04', amount: 100, currency: 'USD', accountName: 'Card', description: 'Refund' },
      { id: 1, date: '2026-07-03', amount: -20, currency: 'USD', accountName: 'Card', description: 'Book' },
    ]);
    assert.equal(result.unassignedTransactionCount, 1);
    assert.deepEqual(result.recentSessions.map((session) => session.id), [3, 2]);
  } finally {
    db.close();
  }
});

test('engagement dashboard falls back to the highest-priority engagement', () => {
  const db = fixture();
  try {
    const result = queryEngagementDashboard(db, 999, null, '2026-07-31');
    assert.equal(result.selectedEngagement?.id, 1);
    assert.equal(result.selectedEngagement?.totalMinutes, 180);
  } finally {
    db.close();
  }
});
