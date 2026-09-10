import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { assertMealImportSchema } from './meal-import.ts';
import { assertFinanceFoundationSchema, assertOptionalSessionTypeSchema } from './database-utils.ts';
import { assertValuationHistorySchema } from './database-utils.ts';
import { applyV5ToOfficialSchemaV1, previewSchemaV1Upgrade } from './schema-upgrade-core.ts';

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const upgradeSql = await readFile(new URL('../../migrations/001_upgrade_v5_to_schema_v1.sql', import.meta.url), 'utf8');
const financeSql = await readFile(new URL('../../migrations/002_add_finance_foundation_schema_v1.sql', import.meta.url), 'utf8');
const valuationSql = await readFile(new URL('../../migrations/003_add_valuation_history_schema_v1.sql', import.meta.url), 'utf8');
const mutableBudgetSql = await readFile(new URL('../../migrations/004_make_budget_plans_mutable_schema_v1.sql', import.meta.url), 'utf8');
const optionalSessionTypeSql = await readFile(new URL('../../migrations/005_make_session_type_optional_schema_v1.sql', import.meta.url), 'utf8');
const SQL = await initSqlJs({ wasmBinary });

function legacyV5Database() {
  const db = new SQL.Database();
  db.run(`
    PRAGMA foreign_keys = ON;
    PRAGMA user_version = 5;
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO schema_migrations (version, name) VALUES
      (1, 'legacy one'), (2, 'legacy two'), (3, 'legacy three'), (4, 'legacy four'), (5, 'legacy five');
    CREATE TABLE imported_notes (note_date TEXT NOT NULL);
    CREATE TABLE session_types (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, label TEXT NOT NULL, description TEXT, is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0);
    INSERT INTO session_types (id, code, label) VALUES (1, 'study', 'Study');
    CREATE TABLE engagements (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO engagements (id, name) VALUES (1, 'Legacy project');
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, engagement_id INTEGER NOT NULL REFERENCES engagements(id),
      date TEXT NOT NULL, start_time TEXT, end_time TEXT, duration_minutes INTEGER,
      session_type_id INTEGER NOT NULL REFERENCES session_types(id), notes TEXT
    );
    CREATE INDEX idx_sessions_date ON sessions(date);
    CREATE INDEX idx_sessions_engagement ON sessions(engagement_id);
    CREATE INDEX idx_sessions_type ON sessions(session_type_id);
    CREATE TRIGGER sessions_require_active_type_insert BEFORE INSERT ON sessions
      WHEN NOT EXISTS (SELECT 1 FROM session_types WHERE id = NEW.session_type_id AND is_active = 1)
      BEGIN SELECT RAISE(ABORT, 'unknown or inactive session type'); END;
    CREATE TRIGGER sessions_require_active_type_update BEFORE UPDATE OF session_type_id ON sessions
      WHEN NOT EXISTS (SELECT 1 FROM session_types WHERE id = NEW.session_type_id AND is_active = 1)
      BEGIN SELECT RAISE(ABORT, 'unknown or inactive session type'); END;
    CREATE TABLE session_exercises (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id), exercise_id INTEGER NOT NULL, order_index INTEGER NOT NULL);
    CREATE TABLE engagement_milestones (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id));
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, currency TEXT);
    CREATE TABLE meal_events (
      id INTEGER PRIMARY KEY, day TEXT NOT NULL, meal_type TEXT NOT NULL,
      is_leisure INTEGER NOT NULL, classification_source TEXT NOT NULL, calorie_limit_kcal REAL
    );
    CREATE TABLE daily_meals (
      id INTEGER PRIMARY KEY, day TEXT NOT NULL, food TEXT NOT NULL, calories REAL,
      protein_g REAL, meal_event_id INTEGER, item_ordinal INTEGER
    );
    CREATE TABLE daily_meal_assessments (
      day TEXT PRIMARY KEY, daily_calorie_limit_kcal REAL NOT NULL,
      minimum_protein_g REAL NOT NULL, daily_calories_kcal REAL,
      daily_metrics_calories_kcal REAL, meal_items_calories_kcal REAL NOT NULL,
      daily_calorie_source TEXT NOT NULL, protein_g REAL, recorded_dieted INTEGER,
      evaluated_dieted INTEGER
    );
    CREATE TABLE note_import_components (
      note_date TEXT NOT NULL, component TEXT NOT NULL, lifecycle_state TEXT NOT NULL,
      source_file_path TEXT NOT NULL, source_checksum TEXT NOT NULL,
      plugin_version TEXT NOT NULL, row_count INTEGER NOT NULL,
      imported_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (note_date, component)
    );
  `);
  return db;
}

test('one-time v5 upgrade preserves legacy meal rows and resets official schema metadata', () => {
  const db = legacyV5Database();
  try {
    db.run("INSERT INTO daily_meals (day, food, calories, protein_g) VALUES ('2026-08-01', 'Legacy eggs', 300, 20)");
    db.run("INSERT INTO sessions (id, engagement_id, date, session_type_id) VALUES (7, 1, '2026-08-01', 1)");
    db.run('INSERT INTO session_exercises (id, session_id, exercise_id, order_index) VALUES (1, 7, 11, 1)');
    db.run('INSERT INTO engagement_milestones (id, session_id) VALUES (1, 7)');
    const preview = previewSchemaV1Upgrade(db);
    assert.deepEqual(preview, {
      currentSchemaVersion: 5, targetSchemaVersion: 1, migrationEntryCount: 5,
      needsFoodDictionary: true, needsFinanceFoundation: true, needsValuationHistory: true, needsMutableBudgets: true,
      needsOptionalSessionTypes: true,
    });
    db.run('PRAGMA foreign_keys = OFF');
    db.run('BEGIN IMMEDIATE');
    applyV5ToOfficialSchemaV1(db, upgradeSql, financeSql, valuationSql, mutableBudgetSql, optionalSessionTypeSql);
    assert.equal(db.exec('PRAGMA foreign_key_check').length, 0);
    db.run('COMMIT');
    db.run('PRAGMA foreign_keys = ON');
    assertMealImportSchema(db);
    assertFinanceFoundationSchema(db);
    assertValuationHistorySchema(db);
    assertOptionalSessionTypeSchema(db);
    assert.equal(db.exec('PRAGMA user_version')[0].values[0][0], 1);
    assert.deepEqual(db.exec('SELECT version, name FROM schema_migrations')[0].values, [[1, 'official schema v1: food, finance, valuation, mutable budgets, and optional session types']]);
    assert.deepEqual(db.exec('SELECT food, food_id, amount_g FROM daily_meals')[0].values, [['Legacy eggs', null, null]]);
    assert.deepEqual(db.exec('SELECT id, session_type_id FROM sessions')[0].values, [[7, 1]]);
    assert.deepEqual(db.exec('SELECT session_id FROM session_exercises')[0].values, [[7]]);
    assert.deepEqual(db.exec('SELECT session_id FROM engagement_milestones')[0].values, [[7]]);
    db.run("INSERT INTO sessions (engagement_id, date, session_type_id) VALUES (1, '2026-08-02', NULL)");
  } finally {
    db.close();
  }
});

test('current Schema v1 can upgrade only the optional session-type foundation', () => {
  const db = legacyV5Database();
  try {
    db.run(upgradeSql);
    db.run(financeSql);
    db.run(valuationSql);
    db.run(mutableBudgetSql);
    assert.deepEqual(previewSchemaV1Upgrade(db), {
      currentSchemaVersion: 1, targetSchemaVersion: 1, migrationEntryCount: 1,
      needsFoodDictionary: false, needsFinanceFoundation: false, needsValuationHistory: false,
      needsMutableBudgets: false, needsOptionalSessionTypes: true,
    });
    db.run('PRAGMA foreign_keys = OFF');
    db.run('BEGIN IMMEDIATE');
    applyV5ToOfficialSchemaV1(db, upgradeSql, financeSql, valuationSql, mutableBudgetSql, optionalSessionTypeSql);
    assert.equal(db.exec('PRAGMA foreign_key_check').length, 0);
    db.run('COMMIT');
    db.run('PRAGMA foreign_keys = ON');
    assertOptionalSessionTypeSchema(db);
  } finally {
    db.close();
  }
});
