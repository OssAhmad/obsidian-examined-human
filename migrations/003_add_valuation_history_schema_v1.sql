-- Additive official Data Schema v1 valuation history.
-- Rates are observed through finalized historical Daily Notes and remain effective until superseded.

CREATE TABLE valuation_rate_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rate_date DATE NOT NULL UNIQUE,
    source_file_name TEXT NOT NULL,
    source_file_path TEXT NOT NULL,
    source_checksum TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE valuation_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rate_set_id INTEGER NOT NULL REFERENCES valuation_rate_sets(id) ON DELETE CASCADE,
    source_ordinal INTEGER NOT NULL,
    unit_key TEXT NOT NULL,
    unit_label TEXT NOT NULL,
    value REAL NOT NULL CHECK (value > 0),
    UNIQUE (rate_set_id, source_ordinal),
    UNIQUE (rate_set_id, unit_key)
);

CREATE INDEX idx_valuation_rate_sets_date ON valuation_rate_sets(rate_date);
CREATE INDEX idx_valuation_rates_unit ON valuation_rates(unit_key, rate_set_id);

UPDATE schema_migrations
SET name = 'official schema v1: food, finance, and valuation foundations'
WHERE version = 1;
