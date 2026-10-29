import type { Database } from 'sql.js';
import { hasTableColumns, queryRows } from './sql.ts';
import type { DailyHealth } from '../logger/daily-health.ts';

export const HEALTH_SCHEMA = {
  markers: ['value_type'], measurements: ['value_text', 'unit_at_time', 'comparator', 'value_type_at_time', 'source_ordinal'],
  medical_report_imports: ['report_id', 'source_file_path', 'source_checksum', 'measurements_state', 'procedures_state'],
  medical_procedures: ['id', 'name'], marker_aliases: ['marker_id', 'alias'],
  medical_procedure_aliases: ['procedure_id', 'alias'], report_procedures: ['report_id', 'procedure_id'],
  medications: ['id', 'name', 'unit'], medication_aliases: ['medication_id', 'alias'],
  symptoms: ['id', 'name'], symptom_aliases: ['symptom_id', 'alias'],
  daily_health: ['date', 'medication_state', 'symptoms_state'],
  medication_intakes: ['date', 'amount', 'unit_at_time'], symptom_entries: ['date', 'time'],
};
export function hasMedicalSchema(db: Database): boolean {
  return hasMedicalFoundation(db) && !hasTableColumns(db, 'reports', ['person_id']);
}
export function hasMedicalFoundation(db: Database): boolean {
  return Object.entries(HEALTH_SCHEMA).every(([table, columns]) => hasTableColumns(db, table, columns));
}
export function assertMedicalSchema(db: Database): void {
  if (!hasMedicalSchema(db)) throw new Error('Go to Settings → Examined Human → General → Tools and maintenance → Medical database migration before importing health entries.');
}

export interface MedicalDashboardItem {
  key: string; kind: 'report' | 'daily'; reportId: number | null;
  date: string; title: string; sourcePath: string;
}
export function queryMedicalDashboardPage(db: Database, page: number) {
  if (!hasMedicalSchema(db)) return { needsMigration: true, total: 0, items: [] as MedicalDashboardItem[] };
  const sources = `SELECT 'report:' || r.id AS key, 'report' AS kind, r.id AS report_id,
      COALESCE(i.reported, i.performed, NULLIF(r.report_timestamp, ''), '') AS date,
      COALESCE(r.title, 'Medical report') AS title, i.source_file_path AS path
    FROM medical_report_imports i JOIN reports r ON r.id=i.report_id
    UNION ALL
    SELECT 'daily:' || h.date, 'daily', NULL, h.date, 'Daily medical log',
      (SELECT n.file_path FROM imported_notes n WHERE n.note_date=h.date ORDER BY n.id DESC LIMIT 1)
    FROM daily_health h WHERE (h.medication_state<>'unrecorded' OR h.symptoms_state<>'unrecorded')
      AND EXISTS (SELECT 1 FROM imported_notes n WHERE n.note_date=h.date)`;
  const total = Number(queryRows(db, `SELECT COUNT(*) AS n FROM (${sources})`)[0].n);
  const offset = Math.max(0, Math.floor(page)) * 50;
  const items = queryRows(db, `SELECT * FROM (${sources}) ORDER BY date DESC, kind, key LIMIT 50 OFFSET ?`, [offset]).map(r => ({
    key: String(r.key), kind: String(r.kind) as MedicalDashboardItem['kind'], reportId: r.report_id == null ? null : Number(r.report_id),
    date: String(r.date), title: String(r.title), sourcePath: String(r.path),
  }));
  return { needsMigration: false, total, items };
}
export type HealthCatalogKind = 'measurement' | 'procedure' | 'medication' | 'symptom';
export interface HealthCatalogEntry {
  id: number; name: string; unit: string; valueType: string; aliases: string[];
}
export const HEALTH_CATALOGS = {
  measurement: { table: 'markers', aliasTable: 'marker_aliases', owner: 'marker_id' },
  procedure: { table: 'medical_procedures', aliasTable: 'medical_procedure_aliases', owner: 'procedure_id' },
  medication: { table: 'medications', aliasTable: 'medication_aliases', owner: 'medication_id' },
  symptom: { table: 'symptoms', aliasTable: 'symptom_aliases', owner: 'symptom_id' },
} as const;
export function queryHealthCatalog(db: Database, kind: HealthCatalogKind): HealthCatalogEntry[] {
  assertMedicalSchema(db);
  const config = HEALTH_CATALOGS[kind];
  return queryRows(db, `SELECT * FROM ${config.table} ORDER BY name COLLATE NOCASE`).map(row => ({
    id: Number(row.id), name: String(row.name), unit: String(row.unit ?? ''), valueType: String(row.value_type ?? ''),
    aliases: config.aliasTable ? queryRows(db, `SELECT alias FROM ${config.aliasTable} WHERE ${config.owner} = ? ORDER BY alias`, [row.id]).map(a => String(a.alias)) : [],
  }));
}
export function medicalImportPaths(db: Database, filePath: string): string[] {
  if (!hasMedicalSchema(db)) return [];
  return queryRows(db, 'SELECT source_file_path FROM medical_report_imports WHERE source_file_path=?', [filePath]).map(r => String(r.source_file_path));
}
export interface RecordsPage {
  forms: Record<string, string | number | null>[];
  days: Array<{ date: string; medicationState: string; symptomsState: string; medication: string[]; symptoms: string[] }>;
}
export function queryDailyHealth(db: Database, date: string): DailyHealth | undefined {
  if (!hasMedicalSchema(db)) return undefined;
  const day = queryRows(db, 'SELECT * FROM daily_health WHERE date=?', [date])[0];
  if (!day) return undefined;
  return {
    medicationState: String(day.medication_state) as DailyHealth['medicationState'],
    symptomsState: String(day.symptoms_state) as DailyHealth['symptomsState'],
    intakes: queryRows(db, `SELECT i.*, m.name FROM medication_intakes i JOIN medications m ON m.id=i.medication_id WHERE date=? ORDER BY source_ordinal`, [date])
      .map(r => ({ time: String(r.time), medicationId: Number(r.medication_id), name: String(r.name), amount: Number(r.amount), unit: String(r.unit_at_time), notes: String(r.notes) })),
    occurrences: queryRows(db, `SELECT e.*, s.name FROM symptom_entries e JOIN symptoms s ON s.id=e.symptom_id WHERE date=? ORDER BY source_ordinal`, [date])
      .map(r => ({ time: String(r.time), symptomId: Number(r.symptom_id), name: String(r.name), notes: String(r.notes) })),
  };
}
export function queryRecordsPage(db: Database, page: number): RecordsPage {
  const offset = Math.max(0, Math.floor(page)) * 50;
  // Optional health tables must not prevent an older database's ordinary forms
  // from being inspected. Both lists are bounded, with deterministic paging.
  const medical = hasMedicalSchema(db);
  const sources: string[] = [];
  if (hasTableColumns(db, 'imported_notes', ['id', 'note_date', 'file_name', 'file_path', 'imported_at'])) sources.push("SELECT 'Daily' AS kind, CAST(id AS TEXT) AS id, note_date AS date, file_name AS title, file_path AS path, imported_at AS updated FROM imported_notes");
  if (hasTableColumns(db, 'weekly_plans', ['id', 'week_start_date', 'source_file_path', 'imported_at'])) sources.push("SELECT 'Weekly' AS kind, CAST(id AS TEXT) AS id, week_start_date AS date, week_start_date AS title, source_file_path AS path, imported_at AS updated FROM weekly_plans");
  if (hasTableColumns(db, 'budget_plans', ['id', 'period_start', 'period_end', 'source_file_path', 'imported_at'])) sources.push("SELECT 'Budget' AS kind, CAST(id AS TEXT) AS id, period_start AS date, period_start || ' to ' || period_end AS title, source_file_path AS path, imported_at AS updated FROM budget_plans");
  if (medical) sources.push("SELECT 'Medical' AS kind, CAST(r.id AS TEXT) AS id, COALESCE(i.reported, i.performed, '') AS date, r.title, i.source_file_path AS path, i.updated_at AS updated FROM medical_report_imports i JOIN reports r ON r.id=i.report_id");
  const forms = sources.length ? queryRows(db, `SELECT * FROM (${sources.join(' UNION ALL ')}) ORDER BY date DESC, kind, id LIMIT 50 OFFSET ?`, [offset]) as RecordsPage['forms'] : [];
  const days: RecordsPage['days'] = !medical ? [] : queryRows(db, `SELECT * FROM daily_health
    WHERE medication_state <> 'unrecorded' OR symptoms_state <> 'unrecorded'
    ORDER BY date DESC LIMIT 50 OFFSET ?`, [offset]).map(day => ({
    date: String(day.date), medicationState: String(day.medication_state), symptomsState: String(day.symptoms_state),
    medication: queryRows(db, `SELECT i.*, m.name FROM medication_intakes i JOIN medications m ON m.id=i.medication_id
      WHERE date=? ORDER BY source_ordinal`, [day.date]).map(r => `${String(r.time)} | ${String(r.name)} | ${String(r.amount)} ${String(r.unit_at_time)} | ${String(r.notes)}`),
    symptoms: queryRows(db, `SELECT e.*, s.name FROM symptom_entries e JOIN symptoms s ON s.id=e.symptom_id
      WHERE date=? ORDER BY source_ordinal`, [day.date]).map(r => `${String(r.time)} | ${String(r.name)} | ${String(r.notes)}`),
  }));
  return { forms, days };
}
export function queryMedicalReport(db: Database, id: number) {
  assertMedicalSchema(db);
  const report = queryRows(db, `SELECT r.*, i.* FROM reports r JOIN medical_report_imports i ON i.report_id=r.id WHERE r.id=?`, [id])[0];
  if (!report) throw new Error('Imported Medical Form was not found.');
  return {
    report,
    measurements: queryRows(db, `SELECT m.*, k.name FROM measurements m JOIN markers k ON k.id=m.marker_id
      WHERE report_id=? ORDER BY source_ordinal, m.id`, [id]),
    procedures: queryRows(db, `SELECT p.*, k.name FROM report_procedures p JOIN medical_procedures k ON k.id=p.procedure_id
      WHERE report_id=? ORDER BY source_ordinal, p.id`, [id]),
  };
}
