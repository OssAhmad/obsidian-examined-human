-- Run inside LoggerService's guarded transaction. Legacy numeric results keep
-- their IDs and values; the additional representation permits text and limits.
ALTER TABLE markers ADD COLUMN value_type TEXT NOT NULL DEFAULT 'number'
    CHECK (value_type IN ('number', 'qualitative', 'text'));

CREATE TABLE measurements_medical_upgrade (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES reports(id),
    marker_id INTEGER NOT NULL REFERENCES markers(id),
    value REAL,
    notes TEXT,
    reference_range_at_time TEXT,
    flag TEXT,
    value_text TEXT NOT NULL DEFAULT '',
    comparator TEXT CHECK (comparator IN ('<', '<=', '>', '>=', '=')),
    unit_at_time TEXT,
    value_type_at_time TEXT NOT NULL DEFAULT 'number' CHECK (value_type_at_time IN ('number', 'qualitative', 'text')),
    source_ordinal INTEGER
);
INSERT INTO measurements_medical_upgrade
    (id, report_id, marker_id, value, notes, reference_range_at_time, flag,
     value_text, unit_at_time, value_type_at_time)
SELECT m.id, m.report_id, m.marker_id, m.value, m.notes, m.reference_range_at_time, m.flag,
       CAST(m.value AS TEXT), k.unit, 'number'
FROM measurements m LEFT JOIN markers k ON k.id = m.marker_id;
DROP TABLE measurements;
ALTER TABLE measurements_medical_upgrade RENAME TO measurements;

CREATE TABLE marker_aliases (
    id INTEGER PRIMARY KEY,
    marker_id INTEGER NOT NULL REFERENCES markers(id),
    alias TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (trim(alias) <> '')
);
CREATE TABLE medical_procedures (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (trim(name) <> '')
);
CREATE TABLE medical_procedure_aliases (
    id INTEGER PRIMARY KEY,
    procedure_id INTEGER NOT NULL REFERENCES medical_procedures(id),
    alias TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (trim(alias) <> '')
);
CREATE TABLE report_procedures (
    id INTEGER PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES reports(id),
    procedure_id INTEGER NOT NULL REFERENCES medical_procedures(id),
    source_ordinal INTEGER NOT NULL,
    notes TEXT NOT NULL
);
CREATE TABLE medical_report_imports (
    report_id INTEGER PRIMARY KEY REFERENCES reports(id),
    source_file_path TEXT NOT NULL UNIQUE,
    source_checksum TEXT NOT NULL,
    source_document_path TEXT,
    performed TEXT,
    reported TEXT,
    measurements_state TEXT NOT NULL CHECK (measurements_state IN ('unrecorded', 'none', 'recorded')),
    procedures_state TEXT NOT NULL CHECK (procedures_state IN ('unrecorded', 'none', 'recorded')),
    plugin_version TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_measurements_report ON measurements(report_id);
CREATE INDEX idx_measurements_marker ON measurements(marker_id, report_id);
CREATE INDEX idx_report_procedures_report ON report_procedures(report_id);
CREATE INDEX idx_reports_timestamp ON reports(report_timestamp);
CREATE TABLE medications (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (trim(name) <> ''),
    unit TEXT NOT NULL CHECK (trim(unit) <> '')
);
CREATE TABLE medication_aliases (
    id INTEGER PRIMARY KEY,
    medication_id INTEGER NOT NULL REFERENCES medications(id),
    alias TEXT NOT NULL COLLATE NOCASE UNIQUE
);
CREATE TABLE symptoms (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (trim(name) <> '')
);
CREATE TABLE symptom_aliases (
    id INTEGER PRIMARY KEY,
    symptom_id INTEGER NOT NULL REFERENCES symptoms(id),
    alias TEXT NOT NULL COLLATE NOCASE UNIQUE
);
CREATE TABLE daily_health (
    date TEXT PRIMARY KEY REFERENCES daily_metrics(date),
    medication_state TEXT NOT NULL CHECK (medication_state IN ('unrecorded', 'none', 'recorded')),
    symptoms_state TEXT NOT NULL CHECK (symptoms_state IN ('unrecorded', 'none', 'recorded'))
);
CREATE TABLE medication_intakes (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL REFERENCES daily_health(date),
    time TEXT NOT NULL,
    medication_id INTEGER NOT NULL REFERENCES medications(id),
    amount REAL NOT NULL CHECK (amount > 0),
    unit_at_time TEXT NOT NULL,
    notes TEXT NOT NULL,
    source_ordinal INTEGER NOT NULL
);
CREATE TABLE symptom_entries (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL REFERENCES daily_health(date),
    time TEXT NOT NULL,
    symptom_id INTEGER NOT NULL REFERENCES symptoms(id),
    notes TEXT NOT NULL,
    source_ordinal INTEGER NOT NULL
);
CREATE INDEX idx_medication_intakes_date ON medication_intakes(date);
CREATE INDEX idx_symptom_entries_date ON symptom_entries(date);
INSERT INTO schema_migrations (version, name) VALUES (6, 'medical forms with typed observations and report-scoped replacement');
