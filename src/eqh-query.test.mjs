import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import {
  inspectDatabase,
  queryDailyAssessment,
  queryDailyNoteIndex,
  querySessions,
  queryWeeklyAssessment,
  queryWeeklyPlan,
  queryWeeklyPlanIndex,
} from './eqh-query.ts';

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const SQL = await initSqlJs({ wasmBinary });

function fixture(withExerciseDetails = false, withMilestoneDetails = false) {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE engagement_types (id INTEGER PRIMARY KEY, code TEXT NOT NULL);
    CREATE TABLE session_types (id INTEGER PRIMARY KEY, code TEXT NOT NULL);
    CREATE TABLE engagements (id INTEGER PRIMARY KEY, name TEXT, type_id INTEGER);
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY,
      engagement_id INTEGER,
      date TEXT,
      start_time TEXT,
      end_time TEXT,
      duration_minutes INTEGER,
      session_type_id INTEGER NOT NULL,
      notes TEXT
    );
    INSERT INTO engagement_types VALUES (1, 'academic');
    INSERT INTO session_types VALUES (1, 'study');
    INSERT INTO session_types VALUES (2, 'chor');
    INSERT INTO session_types VALUES (3, 'exercise');
    INSERT INTO session_types VALUES (4, 'research');
    INSERT INTO engagements VALUES (1, 'MIT Differential Equations', 1);
    INSERT INTO sessions VALUES (10, 1, '2026-07-20', '9:35', '10:59', 84, 1, 'Chapter 1');
    INSERT INTO sessions VALUES (11, 1, '2026-07-20', '10:30', '11:00', 30, 2, NULL);
    INSERT INTO sessions VALUES (12, 1, '2026-07-20', '11:00', '12:00', 60, 3, NULL);
  `);
  if (withExerciseDetails) {
    db.run(`
      CREATE TABLE exercises (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT);
      CREATE TABLE session_exercises (
        id INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL,
        exercise_id INTEGER NOT NULL,
        order_index INTEGER
      );
      CREATE TABLE exercise_sets (
        id INTEGER PRIMARY KEY,
        session_exercise_id INTEGER NOT NULL,
        set_number INTEGER,
        weight REAL,
        reps INTEGER,
        distance REAL,
        duration_minutes REAL,
        notes TEXT
      );
      INSERT INTO exercises VALUES (100, 'Bench Press', 'push');
      INSERT INTO exercises VALUES (101, 'Running', 'cardio');
      INSERT INTO session_exercises VALUES (201, 12, 101, 1);
      INSERT INTO session_exercises VALUES (200, 12, 100, 0);
      INSERT INTO exercise_sets VALUES (301, 200, 2, 80, 5, NULL, NULL, 'Controlled');
      INSERT INTO exercise_sets VALUES (300, 200, 1, 80, 6, NULL, NULL, NULL);
      INSERT INTO exercise_sets VALUES (302, 201, 1, NULL, NULL, 5, NULL, NULL);
      INSERT INTO exercise_sets VALUES (303, 201, 2, NULL, NULL, NULL, 30, NULL);
    `);
  }
  if (withMilestoneDetails) {
    db.run(`
      CREATE TABLE engagement_milestones (
        id INTEGER PRIMARY KEY,
        engagement_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        date TEXT,
        notes TEXT,
        session_id INTEGER
      );
      CREATE TABLE engagement_measurements (
        id INTEGER PRIMARY KEY,
        milestone_id INTEGER NOT NULL,
        metric_name TEXT NOT NULL,
        metric_value TEXT NOT NULL,
        measurement_date TEXT,
        notes TEXT
      );
      INSERT INTO engagement_milestones VALUES (400, 1, 'Problem Set 3', '2026-07-20', 'Completed cleanly', 10);
      INSERT INTO engagement_milestones VALUES (401, 1, 'Exam 1', '2026-07-20', NULL, 10);
      INSERT INTO engagement_measurements VALUES (500, 400, 'problems', '12', '2026-07-20', NULL);
      INSERT INTO engagement_measurements VALUES (501, 401, 'score', '92', '2026-07-20', 'Closed book');
    `);
  }
  return db;
}

function addPlanningSchema(db) {
  db.run(`
    CREATE TABLE imported_notes (
      id INTEGER PRIMARY KEY,
      note_date TEXT NOT NULL,
      file_name TEXT NOT NULL UNIQUE,
      file_path TEXT NOT NULL
    );
    CREATE TABLE note_sources (
      id INTEGER PRIMARY KEY,
      note_date TEXT NOT NULL UNIQUE,
      lifecycle_state TEXT NOT NULL,
      parse_status TEXT NOT NULL,
      last_error TEXT
    );
    CREATE TABLE planned_sessions (
      id INTEGER PRIMARY KEY,
      source_note_id INTEGER NOT NULL,
      source_ordinal INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      time_is_estimated INTEGER NOT NULL,
      session_type_raw TEXT NOT NULL,
      resolved_session_type_id INTEGER,
      engagement_raw TEXT NOT NULL,
      resolved_engagement_id INTEGER,
      notes TEXT,
      warning_text TEXT
    );
  `);
}

test('database inspection verifies the schema and profile', () => {
  const db = fixture();
  try {
    assert.deepEqual(inspectDatabase(db), {
      integrity: 'ok', sessionCount: 3, distinctDays: 1,
      firstDate: '2026-07-20', lastDate: '2026-07-20',
    });
  } finally {
    db.close();
  }
});

test('session query maps geometry, display data, and chor warnings', () => {
  const db = fixture();
  try {
    const result = querySessions(db, '2026-07-20', '2026-07-20');
    assert.equal(result.events.length, 3);
    assert.equal(result.events[0].title, 'MIT Differential Equations');
    assert.equal(result.events[0].startMinutes, 575);
    assert.equal(result.events[0].durationMinutes, 84);
    assert.match(result.events[1].dataWarning, /invalid type "chor"/);
    assert.equal(result.events[2].exerciseDetails, undefined);
    assert.equal(result.issues.length, 1);
  } finally {
    db.close();
  }
});

test('exercise sessions include ordered exercises and their recorded sets', () => {
  const db = fixture(true);
  try {
    const result = querySessions(db, '2026-07-20', '2026-07-20');
    assert.deepEqual(result.events[2].exerciseDetails, [
      {
        name: 'Bench Press',
        category: 'push',
        sets: [
          { setNumber: 1, weight: 80, reps: 6, distance: null, durationMinutes: null, notes: null },
          { setNumber: 2, weight: 80, reps: 5, distance: null, durationMinutes: null, notes: 'Controlled' },
        ],
      },
      {
        name: 'Running',
        category: 'cardio',
        sets: [
          { setNumber: 1, weight: null, reps: null, distance: 5, durationMinutes: null, notes: null },
          { setNumber: 2, weight: null, reps: null, distance: null, durationMinutes: 30, notes: null },
        ],
      },
    ]);
  } finally {
    db.close();
  }
});

test('sessions include linked milestones and their measurements', () => {
  const db = fixture(false, true);
  try {
    const result = querySessions(db, '2026-07-20', '2026-07-20');
    assert.deepEqual(result.events[0].milestoneDetails, [
      {
        name: 'Problem Set 3',
        date: '2026-07-20',
        notes: 'Completed cleanly',
        measurements: [{
          metricName: 'problems', metricValue: '12', measurementDate: '2026-07-20', notes: null,
        }],
      },
      {
        name: 'Exam 1',
        date: '2026-07-20',
        notes: null,
        measurements: [{
          metricName: 'score', metricValue: '92', measurementDate: '2026-07-20', notes: 'Closed book',
        }],
      },
    ]);
    assert.deepEqual(result.events[1].milestoneDetails, []);
  } finally {
    db.close();
  }
});

test('planned sessions fill unimported dates and identify overdue notes', () => {
  const db = fixture();
  try {
    addPlanningSchema(db);
    db.run(`
      INSERT INTO sessions VALUES (13, 1, '2026-07-19', '08:00', '09:00', 60, 1, 'stale actual');
      INSERT INTO note_sources VALUES (20, '2026-07-19', 'awaiting_finalization', 'error', 'Fix the note');
      INSERT INTO note_sources VALUES (21, '2026-07-22', 'planned', 'warning', NULL);
      INSERT INTO planned_sessions VALUES (
        30, 20, 1, '2026-07-19', '08:00', '09:00', 60, 0,
        'study', 1, 'Draft Course', NULL, NULL, 'Engagement "Draft Course" is unresolved.'
      );
      INSERT INTO planned_sessions VALUES (
        31, 21, 1, '2026-07-22', '07:00', '08:00', 60, 1,
        'studdy', NULL, 'Future Course', NULL, 'tentative',
        'Time is not specified and is shown in an estimated slot.\nUnknown session type "studdy".'
      );
    `);

    const result = querySessions(db, '2026-07-19', '2026-07-22', '2026-07-21');
    const overdueEvents = result.events.filter((event) => event.date === '2026-07-19');
    assert.equal(overdueEvents.length, 1);
    assert.equal(overdueEvents[0].id, 'planned:30');
    assert.deepEqual(result.dayStates['2026-07-19'], {
      source: 'planned', lifecycleState: 'awaiting_finalization', overdue: true, message: 'Fix the note',
    });

    const future = result.events.find((event) => event.id === 'planned:31');
    assert.equal(future.title, 'Future Course');
    assert.equal(future.startMinutes, 420);
    assert.equal(future.timeEstimated, true);
    assert.equal(future.sourceKind, 'planned');
    assert.equal(result.dayStates['2026-07-22'].overdue, false);
    assert.ok(result.issues.some((issue) => issue.message.includes('awaiting finalization')));
  } finally {
    db.close();
  }
});

test('an imported note makes canonical sessions win over its planned projection', () => {
  const db = fixture();
  try {
    addPlanningSchema(db);
    db.run(`
      INSERT INTO sessions VALUES (13, 1, '2026-07-22', '14:00', '15:00', 60, 1, 'actual');
      INSERT INTO imported_notes VALUES (1, '2026-07-22', 'Jul 22, 2026.md', 'Journal/Jul 22, 2026.md');
      INSERT INTO note_sources VALUES (20, '2026-07-22', 'planned', 'ok', NULL);
      INSERT INTO planned_sessions VALUES (
        30, 20, 1, '2026-07-22', '07:00', '08:00', 60, 1,
        'study', 1, 'Draft Course', NULL, NULL, NULL
      );
    `);

    const result = querySessions(db, '2026-07-22', '2026-07-22', '2026-07-21');
    assert.deepEqual(result.events.map((event) => event.id), ['13']);
    assert.deepEqual(result.dayStates, {});
  } finally {
    db.close();
  }
});

test('daily assessment maps canonical metrics, meals, transactions, and note status', () => {
  const db = fixture();
  try {
    db.run(`
      CREATE TABLE imported_notes (
        id INTEGER PRIMARY KEY,
        note_date TEXT,
        file_name TEXT,
        file_path TEXT,
        imported_at TEXT
      );
      CREATE TABLE note_sources (
        id INTEGER PRIMARY KEY,
        note_date TEXT,
        lifecycle_state TEXT,
        parse_status TEXT,
        last_error TEXT
      );
      CREATE TABLE daily_metrics (
        date TEXT PRIMARY KEY,
        mood REAL,
        energy REAL,
        stress REAL,
        weight_kg REAL,
        sleep_hours REAL,
        calories INTEGER,
        protein_g INTEGER,
        fasted INTEGER,
        dieted INTEGER
      );
      CREATE TABLE daily_meals (
        id INTEGER PRIMARY KEY,
        day TEXT,
        food TEXT,
        calories INTEGER,
        protein_g REAL
      );
      CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY,
        account_id INTEGER,
        date TEXT,
        amount REAL,
        category TEXT,
        description TEXT
      );
      INSERT INTO imported_notes VALUES (
        1, '2026-07-20', 'Jul 20, 2026.md', 'Journal/Jul 20, 2026.md', '2026-07-21 09:00:00'
      );
      INSERT INTO note_sources VALUES (1, '2026-07-21', 'planned', 'warning', 'Unknown alias');
      INSERT INTO daily_metrics VALUES ('2026-07-20', 1, 2, -1, 91.2, 7.5, 1800, 140, 1, 1);
      INSERT INTO daily_meals VALUES (1, '2026-07-20', 'Oats', 420, 28.5);
      INSERT INTO accounts VALUES (1, 'Main Bank');
      INSERT INTO transactions VALUES (1, 1, '2026-07-20', -25.5, 'grocery', 'Milk');
      INSERT INTO transactions VALUES (2, 1, '2026-07-20', -12, '1', 'Course material');
    `);

    const index = queryDailyNoteIndex(db);
    assert.equal(index.importedNotes[0].date, '2026-07-20');
    assert.equal(index.noteSources[0].lastError, 'Unknown alias');
    const result = queryDailyAssessment(db, '2026-07-20', '2026-07-21');
    assert.equal(result.imported, true);
    assert.equal(result.sessionResult.events.length, 3);
    assert.equal(result.metrics.weightKg, 91.2);
    assert.equal(result.meals[0].proteinG, 28.5);
    assert.deepEqual(result.transactions[0], {
      id: 1,
      accountName: 'Main Bank',
      amount: -25.5,
      engagement: 'grocery',
      description: 'Milk',
    });
    assert.equal(result.transactions[1].engagement, 'MIT Differential Equations');
  } finally {
    db.close();
  }
});

test('weekly plan and assessment queries resolve IDs and aggregate every actual session type', () => {
  const db = fixture();
  try {
    db.run(`
      CREATE TABLE weekly_plans (
        id INTEGER PRIMARY KEY,
        week_start_date TEXT,
        source_file_name TEXT,
        source_file_path TEXT,
        main_outcome TEXT,
        important_deadline TEXT,
        constraint_or_risk TEXT
      );
      CREATE TABLE weekly_plan_sessions (
        id INTEGER PRIMARY KEY,
        weekly_plan_id INTEGER,
        date TEXT,
        start_time TEXT,
        end_time TEXT,
        duration_minutes INTEGER,
        session_type_id INTEGER,
        engagement_id INTEGER,
        notes TEXT
      );
      CREATE TABLE weekly_commitments (
        id INTEGER PRIMARY KEY,
        weekly_plan_id INTEGER,
        source_ordinal INTEGER,
        target_minutes INTEGER,
        engagement_id INTEGER,
        commitment_text TEXT
      );
      INSERT INTO weekly_plans VALUES (
        1, '2026-08-15', '2026-W33.md', 'Journal/2026-W33.md', 'Finish the unit', 'Friday', 'Work'
      );
      INSERT INTO weekly_plans VALUES (
        2, '2026-08-22', '2026-W34.md', 'Journal/2026-W34.md', 'Start the next unit', NULL, NULL
      );
      INSERT INTO weekly_plan_sessions VALUES (
        2, 1, '2026-08-15', '07:00', '09:00', 120, 1, 1, NULL
      );
      INSERT INTO weekly_commitments VALUES (
        3, 1, 1, 540, 1, 'Two lectures and problem set 4'
      );
      INSERT INTO sessions VALUES (20, 1, '2026-08-15', '07:00', '08:00', 60, 1, 'Study');
      INSERT INTO sessions VALUES (21, 1, '2026-08-16', '08:00', '08:45', 45, 4, 'Research');
      INSERT INTO sessions VALUES (22, 1, '2026-08-22', '08:00', '09:30', 90, 1, 'Next week');
    `);
    const result = queryWeeklyPlan(db, '2026-08-15');
    assert.equal(result.sessions[0].sessionType, 'study');
    assert.equal(result.sessions[0].engagementName, 'MIT Differential Equations');
    assert.equal(result.commitments[0].targetMinutes, 540);
    assert.deepEqual(queryWeeklyPlan(db, '2026-08-22').commitments, []);

    const assessment = queryWeeklyAssessment(db, '2026-08-18');
    assert.equal(assessment.weekStartDate, '2026-08-15');
    assert.equal(assessment.weekEndDate, '2026-08-21');
    assert.equal(assessment.previousWeekStart, null);
    assert.equal(assessment.nextWeekStart, '2026-08-22');
    assert.equal(assessment.commitments[0].actualMinutes, 105);
    assert.equal(queryWeeklyAssessment(db, '2026-01-01').weekStartDate, '2026-08-15');
    assert.equal(queryWeeklyAssessment(db, '2026-08-30').weekStartDate, '2026-08-22');
    assert.deepEqual(queryWeeklyAssessment(db, '2026-08-22').commitments, []);
    assert.deepEqual(queryWeeklyPlanIndex(db).importedPlans, [
      {
        id: 2,
        weekStartDate: '2026-08-22',
        sourceFileName: '2026-W34.md',
        sourceFilePath: 'Journal/2026-W34.md',
      },
      {
        id: 1,
        weekStartDate: '2026-08-15',
        sourceFileName: '2026-W33.md',
        sourceFilePath: 'Journal/2026-W33.md',
      },
    ]);
  } finally {
    db.close();
  }
});
