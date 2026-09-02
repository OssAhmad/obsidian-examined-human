-- Additive official Data Schema v1 finance foundation.
-- The database remains Schema v1. This creates one replaceable active budget plan.

CREATE TABLE active_budget_plan (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    source_file_name TEXT NOT NULL,
    source_file_path TEXT NOT NULL,
    source_checksum TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (julianday(period_end) - julianday(period_start) >= 3)
);

CREATE TABLE budget_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    budget_plan_id INTEGER NOT NULL REFERENCES active_budget_plan(id) ON DELETE CASCADE,
    source_ordinal INTEGER NOT NULL,
    currency TEXT NOT NULL CHECK (trim(currency) <> ''),
    amount REAL NOT NULL CHECK (amount <> 0),
    engagement_id INTEGER NOT NULL REFERENCES engagements(id),
    engagement_raw TEXT NOT NULL,
    UNIQUE (budget_plan_id, source_ordinal)
);

CREATE TABLE expected_financial_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    budget_plan_id INTEGER NOT NULL REFERENCES active_budget_plan(id) ON DELETE CASCADE,
    source_ordinal INTEGER NOT NULL,
    due_date DATE NOT NULL,
    currency TEXT NOT NULL CHECK (trim(currency) <> ''),
    amount REAL NOT NULL CHECK (amount <> 0),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    engagement_id INTEGER NOT NULL REFERENCES engagements(id),
    engagement_raw TEXT NOT NULL,
    description TEXT,
    UNIQUE (budget_plan_id, source_ordinal)
);

CREATE INDEX idx_budget_targets_plan_currency ON budget_targets(budget_plan_id, currency);
CREATE INDEX idx_budget_targets_engagement ON budget_targets(engagement_id);
CREATE INDEX idx_expected_financial_movements_plan_due ON expected_financial_movements(budget_plan_id, due_date);
CREATE INDEX idx_expected_financial_movements_account ON expected_financial_movements(account_id, due_date);

UPDATE schema_migrations
SET name = 'official schema v1: food, finance, and valuation foundations'
WHERE version = 1;
