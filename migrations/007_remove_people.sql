-- Run in the guarded schema transaction with foreign keys disabled before BEGIN.
-- Rebuild instead of DROP COLUMN: legacy reports use a table-level owner FK.
CREATE TABLE reports_single_owner (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_timestamp TEXT NOT NULL,
    report_type TEXT NOT NULL,
    provider TEXT,
    title TEXT,
    relative_path TEXT NOT NULL
);
INSERT INTO reports_single_owner (id, report_timestamp, report_type, provider, title, relative_path)
SELECT id, report_timestamp, report_type, provider, title, relative_path FROM reports;
DROP TABLE reports;
ALTER TABLE reports_single_owner RENAME TO reports;
CREATE INDEX idx_reports_timestamp ON reports(report_timestamp);
DROP TABLE IF EXISTS people;
INSERT INTO schema_migrations (version, name) VALUES (7, 'single-owner medical records');
