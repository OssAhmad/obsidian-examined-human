-- A vault represents one owner. Run inside the guarded medical upgrade.
ALTER TABLE reports DROP COLUMN person_id;
DROP TABLE IF EXISTS people;
INSERT INTO schema_migrations (version, name) VALUES (7, 'single-owner medical records');
