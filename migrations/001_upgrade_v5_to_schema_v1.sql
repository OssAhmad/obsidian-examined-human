-- One-time conversion from the retired schema v5 to official Data Schema v1.
-- This preserves existing meal rows exactly as stored. New imports will populate
-- daily_meals.food_id and daily_meals.amount_g from canonical foods.

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

ALTER TABLE daily_meals
    ADD COLUMN food_id INTEGER REFERENCES foods(id) ON DELETE SET NULL;

ALTER TABLE daily_meals
    ADD COLUMN amount_g REAL CHECK (amount_g IS NULL OR amount_g > 0);

ALTER TABLE daily_meals
    ADD COLUMN carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g >= 0);

ALTER TABLE daily_meals
    ADD COLUMN fat_g REAL CHECK (fat_g IS NULL OR fat_g >= 0);

ALTER TABLE daily_meals
    ADD COLUMN salt_g REAL CHECK (salt_g IS NULL OR salt_g >= 0);

ALTER TABLE daily_meals
    ADD COLUMN fiber_g REAL CHECK (fiber_g IS NULL OR fiber_g >= 0);

ALTER TABLE daily_meals
    ADD COLUMN cholesterol_mg REAL CHECK (cholesterol_mg IS NULL OR cholesterol_mg >= 0);

CREATE INDEX idx_daily_meals_food ON daily_meals(food_id, day);
CREATE INDEX idx_food_aliases_food ON food_aliases(food_id);

DELETE FROM schema_migrations;
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (1, 'official schema v1: food, finance, and valuation foundations', datetime('now'));

PRAGMA user_version = 1;
