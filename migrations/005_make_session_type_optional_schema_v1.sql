-- EH-0016: preserve existing session types while allowing ordinary sessions to omit one.
-- The guarded writer executes this table rebuild with foreign-key enforcement disabled,
-- then runs explicit foreign_key_check verification before and after commit.

DROP TRIGGER IF EXISTS sessions_require_active_type_insert;
DROP TRIGGER IF EXISTS sessions_require_active_type_update;
DROP INDEX IF EXISTS idx_sessions_date;
DROP INDEX IF EXISTS idx_sessions_engagement;
DROP INDEX IF EXISTS idx_sessions_type;

CREATE TABLE sessions_optional_type (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id INTEGER NOT NULL REFERENCES engagements(id),
    date DATE NOT NULL,
    start_time TEXT,
    end_time TEXT,
    duration_minutes INTEGER,
    session_type_id INTEGER REFERENCES session_types(id),
    notes TEXT
);

INSERT INTO sessions_optional_type (
    id, engagement_id, date, start_time, end_time, duration_minutes, session_type_id, notes
)
SELECT id, engagement_id, date, start_time, end_time, duration_minutes, session_type_id, notes
FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_optional_type RENAME TO sessions;

CREATE INDEX idx_sessions_date ON sessions(date);
CREATE INDEX idx_sessions_engagement ON sessions(engagement_id);
CREATE INDEX idx_sessions_type ON sessions(session_type_id);

CREATE TRIGGER sessions_require_active_type_insert
BEFORE INSERT ON sessions
WHEN NEW.session_type_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM session_types WHERE id = NEW.session_type_id AND is_active = 1)
BEGIN SELECT RAISE(ABORT, 'unknown or inactive session type'); END;

CREATE TRIGGER sessions_require_active_type_update
BEFORE UPDATE OF session_type_id ON sessions
WHEN NEW.session_type_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM session_types WHERE id = NEW.session_type_id AND is_active = 1)
BEGIN SELECT RAISE(ABORT, 'unknown or inactive session type'); END;

UPDATE schema_migrations
SET name = 'official schema v1: food, finance, valuation, mutable budgets, and optional session types'
WHERE version = 1;
