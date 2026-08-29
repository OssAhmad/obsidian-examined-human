-- Examined Human schema v5: meal events, food-item grouping, leisure-meal assessment,
-- and component-level import provenance.
-- Existing daily_meals rows are intentionally preserved with meal_event_id NULL.

PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

CREATE TABLE meal_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day DATE NOT NULL,
    meal_type TEXT NOT NULL COLLATE NOCASE,
    is_leisure INTEGER NOT NULL DEFAULT 0,
    classification_source TEXT NOT NULL DEFAULT 'default',
    calorie_limit_kcal REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snacks')),
    CHECK (is_leisure IN (0, 1)),
    CHECK (
        classification_source IN (
            'default',
            'manual',
            'meal_limit',
            'manual_and_meal_limit'
        )
    ),
    CHECK (calorie_limit_kcal IS NULL OR calorie_limit_kcal > 0),
    UNIQUE (day, meal_type)
);

CREATE TABLE daily_meal_assessments (
    day DATE PRIMARY KEY,
    daily_calorie_limit_kcal REAL NOT NULL,
    minimum_protein_g REAL NOT NULL DEFAULT 0,
    daily_calories_kcal REAL,
    daily_metrics_calories_kcal REAL,
    meal_items_calories_kcal REAL NOT NULL DEFAULT 0,
    daily_calorie_source TEXT NOT NULL DEFAULT 'missing',
    protein_g REAL,
    recorded_dieted INTEGER,
    evaluated_dieted INTEGER,
    evaluated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (daily_calorie_limit_kcal >= 0),
    CHECK (minimum_protein_g >= 0),
    CHECK (daily_calories_kcal IS NULL OR daily_calories_kcal >= 0),
    CHECK (daily_metrics_calories_kcal IS NULL OR daily_metrics_calories_kcal >= 0),
    CHECK (meal_items_calories_kcal >= 0),
    CHECK (daily_calorie_source IN ('daily_metrics', 'meal_items', 'higher_of_both', 'missing')),
    CHECK (protein_g IS NULL OR protein_g >= 0),
    CHECK (recorded_dieted IS NULL OR recorded_dieted IN (0, 1)),
    CHECK (evaluated_dieted IS NULL OR evaluated_dieted IN (0, 1))
);

CREATE TABLE note_import_components (
    note_date DATE NOT NULL,
    component TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL,
    source_file_path TEXT NOT NULL,
    source_checksum TEXT NOT NULL,
    plugin_version TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (note_date, component),
    CHECK (trim(component) <> ''),
    CHECK (lifecycle_state IN ('ephemeral', 'finalized')),
    CHECK (trim(source_file_path) <> ''),
    CHECK (trim(source_checksum) <> ''),
    CHECK (trim(plugin_version) <> ''),
    CHECK (row_count >= 0)
);

ALTER TABLE daily_meals
    ADD COLUMN meal_event_id INTEGER REFERENCES meal_events(id) ON DELETE CASCADE;

ALTER TABLE daily_meals
    ADD COLUMN item_ordinal INTEGER CHECK (item_ordinal IS NULL OR item_ordinal > 0);

CREATE INDEX idx_meal_events_day ON meal_events(day);
CREATE INDEX idx_meal_events_type ON meal_events(meal_type);
CREATE INDEX idx_daily_meals_meal_event ON daily_meals(meal_event_id, item_ordinal);
CREATE INDEX idx_note_import_components_state
    ON note_import_components(lifecycle_state, note_date);

CREATE TRIGGER daily_meals_meal_event_day_insert
BEFORE INSERT ON daily_meals
WHEN NEW.meal_event_id IS NOT NULL
 AND NOT EXISTS (
     SELECT 1 FROM meal_events
     WHERE id = NEW.meal_event_id AND day = NEW.day
 )
BEGIN
    SELECT RAISE(ABORT, 'daily_meals.day must match its meal event day');
END;

CREATE TRIGGER daily_meals_meal_event_day_update
BEFORE UPDATE OF meal_event_id, day ON daily_meals
WHEN NEW.meal_event_id IS NOT NULL
 AND NOT EXISTS (
     SELECT 1 FROM meal_events
     WHERE id = NEW.meal_event_id AND day = NEW.day
 )
BEGIN
    SELECT RAISE(ABORT, 'daily_meals.day must match its meal event day');
END;

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
    SUM(CASE WHEN dm.id IS NOT NULL AND dm.calories IS NULL THEN 1 ELSE 0 END)
        AS items_missing_calories,
    CASE
        WHEN me.meal_type = 'snacks' THEN 0
        WHEN me.is_leisure = 1 THEN 1
        WHEN me.calorie_limit_kcal IS NOT NULL
         AND COALESCE(SUM(dm.calories), 0) > me.calorie_limit_kcal THEN 1
        ELSE 0
    END AS evaluated_is_leisure
FROM meal_events AS me
LEFT JOIN daily_meals AS dm ON dm.meal_event_id = me.id
GROUP BY
    me.id, me.day, me.meal_type, me.is_leisure,
    me.classification_source, me.calorie_limit_kcal;

CREATE VIEW daily_leisure_meal_summary AS
WITH evaluated_days AS (
    SELECT
        dma.day,
        dma.daily_calorie_limit_kcal,
        dma.daily_calories_kcal,
        COALESCE(SUM(
            CASE
                WHEN met.meal_type IN ('breakfast', 'lunch', 'dinner')
                THEN met.evaluated_is_leisure
                ELSE 0
            END
        ), 0) AS direct_leisure_meals
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

INSERT INTO schema_migrations (version, name, applied_at)
VALUES (
    5,
    'add meal events, leisure assessment, and component provenance',
    datetime('now')
);

PRAGMA user_version = 5;
COMMIT;
