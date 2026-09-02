-- Replace the retired single-active Budget Form storage with dated mutable
-- non-overlapping plans. This is still official Data Schema v1.

CREATE TABLE budget_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    source_file_name TEXT NOT NULL,
    source_file_path TEXT NOT NULL,
    source_checksum TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (julianday(period_end) - julianday(period_start) >= 3),
    UNIQUE (period_start, period_end)
);

CREATE TABLE budget_targets_next (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    budget_plan_id INTEGER NOT NULL REFERENCES budget_plans(id) ON DELETE CASCADE,
    source_ordinal INTEGER NOT NULL,
    currency TEXT NOT NULL CHECK (trim(currency) <> ''),
    amount REAL NOT NULL CHECK (amount <> 0),
    engagement_id INTEGER NOT NULL REFERENCES engagements(id),
    engagement_raw TEXT NOT NULL,
    UNIQUE (budget_plan_id, source_ordinal)
);

CREATE TABLE expected_financial_movements_next (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    budget_plan_id INTEGER NOT NULL REFERENCES budget_plans(id) ON DELETE CASCADE,
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

INSERT INTO budget_plans (
    id, period_start, period_end, source_file_name, source_file_path, source_checksum, imported_at
)
SELECT id, period_start, period_end, source_file_name, source_file_path, source_checksum, imported_at
FROM active_budget_plan;

INSERT INTO budget_targets_next (
    id, budget_plan_id, source_ordinal, currency, amount, engagement_id, engagement_raw
)
SELECT id, budget_plan_id, source_ordinal, currency, amount, engagement_id, engagement_raw
FROM budget_targets;

INSERT INTO expected_financial_movements_next (
    id, budget_plan_id, source_ordinal, due_date, currency, amount, account_id,
    engagement_id, engagement_raw, description
)
SELECT id, budget_plan_id, source_ordinal, due_date, currency, amount, account_id,
       engagement_id, engagement_raw, description
FROM expected_financial_movements;

DROP TABLE expected_financial_movements;
DROP TABLE budget_targets;
DROP TABLE active_budget_plan;

ALTER TABLE budget_targets_next RENAME TO budget_targets;
ALTER TABLE expected_financial_movements_next RENAME TO expected_financial_movements;

CREATE INDEX idx_budget_plans_period ON budget_plans(period_start, period_end);
CREATE INDEX idx_budget_targets_plan_currency ON budget_targets(budget_plan_id, currency);
CREATE INDEX idx_budget_targets_engagement ON budget_targets(engagement_id);
CREATE INDEX idx_expected_financial_movements_plan_due ON expected_financial_movements(budget_plan_id, due_date);
CREATE INDEX idx_expected_financial_movements_account ON expected_financial_movements(account_id, due_date);

UPDATE schema_migrations
SET name = 'official schema v1: food, finance, valuation, and mutable budget foundations'
WHERE version = 1;
