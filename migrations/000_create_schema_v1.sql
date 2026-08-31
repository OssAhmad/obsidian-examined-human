-- Empty official Examined Human Data Schema v1.
-- This file contains structure and canonical taxonomy seeds only; it contains no user data.

PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE session_types (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    label TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    CHECK (code <> '' AND code = lower(trim(code)))
);

CREATE TABLE engagement_types (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    label TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    CHECK (code <> '' AND code = lower(trim(code)))
);

CREATE TABLE engagement_statuses (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    label TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    CHECK (code <> '' AND code = lower(trim(code)))
);

CREATE TABLE engagements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type_id INTEGER NOT NULL REFERENCES engagement_types(id),
    status_id INTEGER REFERENCES engagement_statuses(id),
    start_date DATE,
    target_date DATE,
    completion_date DATE,
    notes TEXT
);

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id INTEGER NOT NULL REFERENCES engagements(id),
    date DATE NOT NULL,
    start_time TEXT,
    end_time TEXT,
    duration_minutes INTEGER,
    session_type_id INTEGER NOT NULL REFERENCES session_types(id),
    notes TEXT
);

CREATE TABLE note_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_date TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    content_checksum TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL,
    parse_status TEXT NOT NULL,
    last_error TEXT,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_scanned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_import_attempt_at TEXT,
    finalized_at TEXT
);

CREATE TABLE planned_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_note_id INTEGER NOT NULL REFERENCES note_sources(id) ON DELETE CASCADE,
    source_ordinal INTEGER NOT NULL,
    date TEXT NOT NULL,
    interval_raw TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    time_is_estimated INTEGER NOT NULL DEFAULT 0,
    session_type_raw TEXT NOT NULL,
    resolved_session_type_id INTEGER REFERENCES session_types(id) ON DELETE SET NULL,
    engagement_raw TEXT NOT NULL,
    resolved_engagement_id INTEGER REFERENCES engagements(id) ON DELETE SET NULL,
    notes TEXT,
    warning_text TEXT,
    UNIQUE (source_note_id, source_ordinal)
);

CREATE TABLE daily_metrics (
    date DATE PRIMARY KEY,
    mood REAL,
    energy REAL,
    stress REAL,
    weight_kg REAL,
    sleep_hours REAL,
    calories INTEGER,
    protein_g INTEGER,
    fasted INTEGER DEFAULT 0,
    dieted INTEGER DEFAULT 0,
    studied INTEGER DEFAULT 0,
    worked INTEGER DEFAULT 0,
    exercised INTEGER DEFAULT 0,
    notes TEXT
);

CREATE TABLE imported_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_date DATE NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    checksum TEXT,
    UNIQUE (file_name)
);

CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT,
    address TEXT,
    currency TEXT DEFAULT NULL
);

CREATE TABLE account_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    alias TEXT NOT NULL UNIQUE
);

CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    date DATE NOT NULL,
    amount REAL NOT NULL,
    category TEXT,
    description TEXT
);

CREATE TABLE engagement_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id INTEGER NOT NULL REFERENCES engagements(id),
    alias TEXT NOT NULL UNIQUE
);

CREATE TABLE engagement_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id INTEGER NOT NULL REFERENCES engagements(id),
    name TEXT NOT NULL,
    date DATE,
    notes TEXT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT
);

CREATE TABLE engagement_measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    milestone_id INTEGER NOT NULL REFERENCES engagement_milestones(id),
    metric_name TEXT NOT NULL,
    metric_value TEXT NOT NULL,
    measurement_date DATE,
    notes TEXT
);

CREATE TABLE exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT
);

CREATE TABLE exercise_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id),
    alias TEXT NOT NULL UNIQUE
);

CREATE TABLE session_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    exercise_id INTEGER NOT NULL REFERENCES exercises(id),
    order_index INTEGER
);

CREATE TABLE exercise_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_exercise_id INTEGER NOT NULL REFERENCES session_exercises(id),
    set_number INTEGER,
    weight REAL,
    reps INTEGER,
    distance REAL,
    duration_minutes REAL,
    notes TEXT,
    pain_level REAL,
    duration_seconds REAL
);

CREATE TABLE muscles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    body_region TEXT,
    notes TEXT
);

CREATE TABLE exercise_muscles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id),
    muscle_id INTEGER NOT NULL REFERENCES muscles(id),
    role TEXT
);

CREATE TABLE people (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    report_timestamp TEXT NOT NULL,
    report_type TEXT NOT NULL,
    provider TEXT,
    title TEXT,
    relative_path TEXT NOT NULL
);

CREATE TABLE markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    unit TEXT,
    textbook_normal_range TEXT
);

CREATE TABLE measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES reports(id),
    marker_id INTEGER NOT NULL REFERENCES markers(id),
    value REAL NOT NULL,
    notes TEXT,
    reference_range_at_time TEXT,
    flag TEXT
);

CREATE TABLE stoicism_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    score REAL,
    notes TEXT
);

CREATE TABLE weekly_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start_date DATE NOT NULL UNIQUE,
    source_file_name TEXT NOT NULL,
    source_file_path TEXT NOT NULL UNIQUE,
    source_checksum TEXT NOT NULL,
    main_outcome TEXT,
    important_deadline TEXT,
    constraint_or_risk TEXT,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE weekly_plan_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    weekly_plan_id INTEGER NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    session_type_id INTEGER REFERENCES session_types(id),
    engagement_id INTEGER REFERENCES engagements(id),
    original_cell_text TEXT NOT NULL,
    notes TEXT,
    source_row INTEGER NOT NULL,
    source_column_start INTEGER NOT NULL,
    source_column_end INTEGER NOT NULL,
    UNIQUE (weekly_plan_id, date, start_time, end_time)
);

CREATE TABLE weekly_commitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    weekly_plan_id INTEGER NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
    source_ordinal INTEGER NOT NULL,
    target_minutes INTEGER NOT NULL CHECK (target_minutes > 0),
    engagement_id INTEGER NOT NULL REFERENCES engagements(id),
    engagement_raw TEXT NOT NULL,
    commitment_text TEXT NOT NULL,
    UNIQUE (weekly_plan_id, source_ordinal)
);

CREATE TABLE meal_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day DATE NOT NULL,
    meal_type TEXT NOT NULL COLLATE NOCASE,
    is_leisure INTEGER NOT NULL DEFAULT 0 CHECK (is_leisure IN (0, 1)),
    classification_source TEXT NOT NULL DEFAULT 'default'
        CHECK (classification_source IN ('default', 'manual', 'meal_limit', 'manual_and_meal_limit')),
    calorie_limit_kcal REAL CHECK (calorie_limit_kcal IS NULL OR calorie_limit_kcal > 0),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snacks')),
    UNIQUE (day, meal_type)
);

CREATE TABLE daily_meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day DATE NOT NULL,
    food TEXT NOT NULL CHECK (trim(food) <> ''),
    calories INTEGER,
    protein_g REAL,
    meal_event_id INTEGER REFERENCES meal_events(id) ON DELETE CASCADE,
    item_ordinal INTEGER CHECK (item_ordinal IS NULL OR item_ordinal > 0),
    food_id INTEGER REFERENCES foods(id) ON DELETE SET NULL,
    amount_g REAL CHECK (amount_g IS NULL OR amount_g > 0),
    carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g >= 0),
    fat_g REAL CHECK (fat_g IS NULL OR fat_g >= 0),
    salt_g REAL CHECK (salt_g IS NULL OR salt_g >= 0),
    fiber_g REAL CHECK (fiber_g IS NULL OR fiber_g >= 0),
    cholesterol_mg REAL CHECK (cholesterol_mg IS NULL OR cholesterol_mg >= 0)
);

CREATE TABLE foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (trim(name) <> ''),
    category TEXT,
    calories_kcal_per_100g REAL NOT NULL CHECK (calories_kcal_per_100g >= 0),
    protein_g_per_100g REAL NOT NULL CHECK (protein_g_per_100g >= 0),
    carbs_g_per_100g REAL NOT NULL CHECK (carbs_g_per_100g >= 0),
    fat_g_per_100g REAL NOT NULL CHECK (fat_g_per_100g >= 0),
    salt_g_per_100g REAL NOT NULL CHECK (salt_g_per_100g >= 0),
    fiber_g_per_100g REAL CHECK (fiber_g_per_100g IS NULL OR fiber_g_per_100g >= 0),
    cholesterol_mg_per_100g REAL CHECK (cholesterol_mg_per_100g IS NULL OR cholesterol_mg_per_100g >= 0),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE food_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_id INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
    alias TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (trim(alias) <> '')
);

CREATE TABLE daily_meal_assessments (
    day DATE PRIMARY KEY,
    daily_calorie_limit_kcal REAL NOT NULL CHECK (daily_calorie_limit_kcal >= 0),
    minimum_protein_g REAL NOT NULL DEFAULT 0 CHECK (minimum_protein_g >= 0),
    daily_calories_kcal REAL CHECK (daily_calories_kcal IS NULL OR daily_calories_kcal >= 0),
    daily_metrics_calories_kcal REAL CHECK (daily_metrics_calories_kcal IS NULL OR daily_metrics_calories_kcal >= 0),
    meal_items_calories_kcal REAL NOT NULL DEFAULT 0 CHECK (meal_items_calories_kcal >= 0),
    daily_calorie_source TEXT NOT NULL DEFAULT 'missing'
        CHECK (daily_calorie_source IN ('daily_metrics', 'meal_items', 'higher_of_both', 'missing')),
    protein_g REAL CHECK (protein_g IS NULL OR protein_g >= 0),
    recorded_dieted INTEGER CHECK (recorded_dieted IS NULL OR recorded_dieted IN (0, 1)),
    evaluated_dieted INTEGER CHECK (evaluated_dieted IS NULL OR evaluated_dieted IN (0, 1)),
    evaluated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE note_import_components (
    note_date DATE NOT NULL,
    component TEXT NOT NULL CHECK (trim(component) <> ''),
    lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('ephemeral', 'finalized')),
    source_file_path TEXT NOT NULL CHECK (trim(source_file_path) <> ''),
    source_checksum TEXT NOT NULL CHECK (trim(source_checksum) <> ''),
    plugin_version TEXT NOT NULL CHECK (trim(plugin_version) <> ''),
    row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (note_date, component)
);

CREATE UNIQUE INDEX uq_accounts_name_nocase ON accounts(name COLLATE NOCASE);
CREATE UNIQUE INDEX uq_account_aliases_alias_nocase ON account_aliases(alias COLLATE NOCASE);
CREATE UNIQUE INDEX uq_engagements_name_nocase ON engagements(name COLLATE NOCASE);
CREATE UNIQUE INDEX uq_engagement_aliases_alias_nocase ON engagement_aliases(alias COLLATE NOCASE);
CREATE UNIQUE INDEX uq_exercise_aliases_alias_nocase ON exercise_aliases(alias COLLATE NOCASE);
CREATE UNIQUE INDEX uq_muscles_name_nocase ON muscles(name COLLATE NOCASE);
CREATE INDEX idx_sessions_date ON sessions(date);
CREATE INDEX idx_sessions_engagement ON sessions(engagement_id);
CREATE INDEX idx_sessions_type ON sessions(session_type_id);
CREATE INDEX idx_engagements_type ON engagements(type_id);
CREATE INDEX idx_engagements_status ON engagements(status_id);
CREATE INDEX idx_note_sources_date ON note_sources(note_date);
CREATE INDEX idx_note_sources_state ON note_sources(lifecycle_state);
CREATE INDEX idx_planned_sessions_date ON planned_sessions(date);
CREATE INDEX idx_planned_sessions_source ON planned_sessions(source_note_id);
CREATE INDEX idx_planned_sessions_type ON planned_sessions(resolved_session_type_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_engagement_milestones_session ON engagement_milestones(session_id);
CREATE INDEX idx_exercise_sets_session ON exercise_sets(session_exercise_id);
CREATE INDEX idx_weekly_plan_sessions_plan ON weekly_plan_sessions(weekly_plan_id);
CREATE INDEX idx_weekly_plan_sessions_date ON weekly_plan_sessions(date);
CREATE INDEX idx_weekly_plan_sessions_type ON weekly_plan_sessions(session_type_id);
CREATE INDEX idx_weekly_plan_sessions_engagement ON weekly_plan_sessions(engagement_id);
CREATE INDEX idx_weekly_commitments_plan ON weekly_commitments(weekly_plan_id);
CREATE INDEX idx_weekly_commitments_engagement ON weekly_commitments(engagement_id);
CREATE INDEX idx_meal_events_day ON meal_events(day);
CREATE INDEX idx_meal_events_type ON meal_events(meal_type);
CREATE INDEX idx_daily_meals_day ON daily_meals(day);
CREATE INDEX idx_daily_meals_meal_event ON daily_meals(meal_event_id, item_ordinal);
CREATE INDEX idx_daily_meals_food ON daily_meals(food_id, day);
CREATE INDEX idx_food_aliases_food ON food_aliases(food_id);
CREATE INDEX idx_note_import_components_state ON note_import_components(lifecycle_state, note_date);

CREATE TRIGGER sessions_require_active_type_insert
BEFORE INSERT ON sessions
WHEN NOT EXISTS (SELECT 1 FROM session_types WHERE id = NEW.session_type_id AND is_active = 1)
BEGIN SELECT RAISE(ABORT, 'unknown or inactive session type'); END;

CREATE TRIGGER sessions_require_active_type_update
BEFORE UPDATE OF session_type_id ON sessions
WHEN NOT EXISTS (SELECT 1 FROM session_types WHERE id = NEW.session_type_id AND is_active = 1)
BEGIN SELECT RAISE(ABORT, 'unknown or inactive session type'); END;

CREATE TRIGGER engagements_require_active_type_insert
BEFORE INSERT ON engagements
WHEN NOT EXISTS (SELECT 1 FROM engagement_types WHERE id = NEW.type_id AND is_active = 1)
BEGIN SELECT RAISE(ABORT, 'unknown or inactive engagement type'); END;

CREATE TRIGGER engagements_require_active_type_update
BEFORE UPDATE OF type_id ON engagements
WHEN NOT EXISTS (SELECT 1 FROM engagement_types WHERE id = NEW.type_id AND is_active = 1)
BEGIN SELECT RAISE(ABORT, 'unknown or inactive engagement type'); END;

CREATE TRIGGER engagements_require_active_status_insert
BEFORE INSERT ON engagements
WHEN NEW.status_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM engagement_statuses WHERE id = NEW.status_id AND is_active = 1)
BEGIN SELECT RAISE(ABORT, 'unknown or inactive engagement status'); END;

CREATE TRIGGER engagements_require_active_status_update
BEFORE UPDATE OF status_id ON engagements
WHEN NEW.status_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM engagement_statuses WHERE id = NEW.status_id AND is_active = 1)
BEGIN SELECT RAISE(ABORT, 'unknown or inactive engagement status'); END;

CREATE TRIGGER daily_meals_meal_event_day_insert
BEFORE INSERT ON daily_meals
WHEN NEW.meal_event_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM meal_events WHERE id = NEW.meal_event_id AND day = NEW.day)
BEGIN SELECT RAISE(ABORT, 'daily_meals.day must match its meal event day'); END;

CREATE TRIGGER daily_meals_meal_event_day_update
BEFORE UPDATE OF meal_event_id, day ON daily_meals
WHEN NEW.meal_event_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM meal_events WHERE id = NEW.meal_event_id AND day = NEW.day)
BEGIN SELECT RAISE(ABORT, 'daily_meals.day must match its meal event day'); END;

CREATE TRIGGER trg_exercises_name_nocase_insert
BEFORE INSERT ON exercises
WHEN EXISTS (SELECT 1 FROM exercises WHERE name = NEW.name COLLATE NOCASE)
BEGIN SELECT RAISE(ABORT, 'exercise name already exists (case-insensitive)'); END;

CREATE TRIGGER trg_exercises_name_nocase_update
BEFORE UPDATE OF name ON exercises
WHEN EXISTS (SELECT 1 FROM exercises WHERE id <> OLD.id AND name = NEW.name COLLATE NOCASE)
BEGIN SELECT RAISE(ABORT, 'exercise name already exists (case-insensitive)'); END;

CREATE VIEW meal_event_totals AS
SELECT
    me.id AS meal_event_id,
    me.day,
    me.meal_type,
    me.is_leisure AS recorded_is_leisure,
    me.classification_source,
    me.calorie_limit_kcal,
    COUNT(dm.id) AS item_count,
    COALESCE(SUM(dm.calories), 0) AS total_calories_kcal,
    COALESCE(SUM(dm.protein_g), 0.0) AS total_protein_g,
    SUM(CASE WHEN dm.id IS NOT NULL AND dm.calories IS NULL THEN 1 ELSE 0 END) AS items_missing_calories,
    CASE
        WHEN me.meal_type = 'snacks' THEN 0
        WHEN me.is_leisure = 1 THEN 1
        WHEN me.calorie_limit_kcal IS NOT NULL
         AND COALESCE(SUM(dm.calories), 0) > me.calorie_limit_kcal THEN 1
        ELSE 0
    END AS evaluated_is_leisure
FROM meal_events AS me
LEFT JOIN daily_meals AS dm ON dm.meal_event_id = me.id
GROUP BY me.id, me.day, me.meal_type, me.is_leisure, me.classification_source, me.calorie_limit_kcal;

CREATE VIEW daily_leisure_meal_summary AS
WITH evaluated_days AS (
    SELECT
        dma.day,
        dma.daily_calorie_limit_kcal,
        dma.daily_calories_kcal,
        COALESCE(SUM(CASE
            WHEN met.meal_type IN ('breakfast', 'lunch', 'dinner') THEN met.evaluated_is_leisure
            ELSE 0
        END), 0) AS direct_leisure_meals
    FROM daily_meal_assessments AS dma
    LEFT JOIN meal_event_totals AS met ON met.day = dma.day
    GROUP BY dma.day, dma.daily_calorie_limit_kcal, dma.daily_calories_kcal
)
SELECT
    day,
    3 AS counted_meals,
    direct_leisure_meals,
    daily_calories_kcal,
    daily_calorie_limit_kcal,
    CASE
        WHEN daily_calories_kcal IS NOT NULL
         AND daily_calories_kcal > daily_calorie_limit_kcal
         AND daily_calorie_limit_kcal > 0 THEN 1
        ELSE 0
    END AS daily_limit_exceeded,
    CASE
        WHEN daily_calories_kcal IS NOT NULL
         AND daily_calories_kcal > daily_calorie_limit_kcal
         AND daily_calorie_limit_kcal > 0
         AND direct_leisure_meals < 2 THEN 2
        ELSE direct_leisure_meals
    END AS leisure_meals
FROM evaluated_days;

INSERT INTO session_types (code, label, description, sort_order) VALUES
('authorship', 'Authorship', 'Creating an authored work', 10),
('chore', 'Chore', 'Routine personal or household work', 20),
('exercise', 'Exercise', 'Physical training', 30),
('leisure', 'Leisure', 'Recreation and unstructured leisure', 40),
('maintenance', 'Maintenance', 'Maintaining systems, spaces, or obligations', 50),
('meditation', 'Meditation', 'Meditation or contemplative practice', 60),
('reading', 'Reading', 'Reading not classified as study or research', 70),
('research', 'Research', 'Exploratory search and evidence gathering', 80),
('social', 'Social', 'Social and relationship time', 90),
('study', 'Study', 'Structured learning toward mastery', 100),
('thinking', 'Thinking', 'Deliberate reflection or problem framing', 110),
('work', 'Work', 'Professional execution', 120),
('writing', 'Writing', 'Writing not classified as authorship', 130);

INSERT INTO engagement_types (code, label, sort_order) VALUES
('article', 'Article', 10), ('authorship', 'Authorship', 20), ('book', 'Book', 30),
('career', 'Career', 40), ('certification', 'Certification', 50), ('course', 'Course', 60),
('exam', 'Exam', 70), ('fitness', 'Fitness', 80), ('leisure', 'Leisure', 90),
('maintenance', 'Maintenance', 100), ('practice', 'Practice', 110),
('relationship', 'Relationship', 120), ('speech', 'Speech', 130), ('startup', 'Startup', 140);

INSERT INTO engagement_statuses (code, label, sort_order) VALUES
('planned', 'Planned', 10), ('pending', 'Pending', 20), ('active', 'Active', 30),
('paused', 'Paused', 40), ('completed', 'Completed', 50), ('abandoned', 'Abandoned', 60);

INSERT INTO schema_migrations (version, name) VALUES
(1, 'official schema v1: canonical food dictionary');

PRAGMA user_version = 1;
COMMIT;
PRAGMA foreign_keys = ON;
