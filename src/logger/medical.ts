import type { Database } from 'sql.js';
import { requireEhForm, formSections, findEntriesMarker, entryLines } from '../forms/form-document.ts';
import { labeledValue } from '../forms/fields.ts';
import { isIsoDate } from '../domain/date.ts';
import { normalizeVaultDatabasePath } from '../database-path.ts';
import { assertMedicalSchema, queryHealthCatalog, HEALTH_CATALOGS, type HealthCatalogKind } from '../read-models/medical.ts';
import { queryRows, lastInsertId, assertSchemaV1 } from './database-utils.ts';

export type CollectionState = 'unrecorded' | 'none' | 'recorded';
export interface MedicalInput {
  filePath: string; sourceText: string; sourceChecksum: string; pluginVersion: string;
  replaceExisting?: boolean;
}
export interface CatalogInput {
  kind: HealthCatalogKind; id?: number; name: string; unit: string; valueType: string; aliases: string[];
}
export function writeHealthCatalog(db: Database, input: CatalogInput): number {
  assertSchemaV1(db); assertMedicalSchema(db);
  const catalog = queryHealthCatalog(db, input.kind);
  const name = input.name.trim(); const unit = input.unit.trim();
  if (!name || /[|\r\n]/.test(name)) throw new Error('A canonical name without pipes or line breaks is required.');
  if (input.id && !catalog.some(r => r.id === input.id)) throw new Error('The selected catalog record no longer exists.');
  const names = [name, ...input.aliases.map(a => a.trim())];
  if (names.some(n => !n || /[|\r\n]/.test(n))) throw new Error('Aliases cannot be blank or contain pipes or line breaks.');
  for (const row of catalog) {
    if (row.id !== input.id && names.some(n => [row.name, ...row.aliases].some(a => a.toLowerCase() === n.toLowerCase()))) {
      throw new Error(`The name or alias already belongs to ${row.name}.`);
    }
  }
  if (input.kind === 'measurement' && !['number', 'qualitative', 'text'].includes(input.valueType)) throw new Error('Select a valid measurement value type.');
  if ((input.kind === 'medication' || (input.kind === 'measurement' && input.valueType === 'number')) && !unit) throw new Error('A canonical unit is required.');
  if (input.kind === 'measurement' && input.valueType !== 'number' && unit) throw new Error('Qualitative and text measurements have no numeric unit.');
  const config = HEALTH_CATALOGS[input.kind];
  const columns = input.kind === 'measurement' ? ['name', 'unit', 'value_type'] : input.kind === 'medication' ? ['name', 'unit'] : ['name'];
  const values = input.kind === 'measurement' ? [name, unit || null, input.valueType] : input.kind === 'medication' ? [name, unit] : [name];
  if (input.id) db.run(`UPDATE ${config.table} SET ${columns.map(c => `${c}=?`).join(',')} WHERE id=?`, [...values, input.id]);
  else db.run(`INSERT INTO ${config.table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, values);
  const id = input.id ?? lastInsertId(db);
  if (config.aliasTable) {
    db.run(`DELETE FROM ${config.aliasTable} WHERE ${config.owner}=?`, [id]);
    const unique = [...new Set(input.aliases.map(a => a.trim().toLowerCase()))].filter(a => a !== name.toLowerCase());
    for (const alias of unique) db.run(`INSERT INTO ${config.aliasTable} (${config.owner},alias) VALUES (?,?)`, [id, alias]);
  }
  return id;
}
export function resolveHealth(db: Database, kind: HealthCatalogKind, raw: string) {
  const matches = queryHealthCatalog(db, kind).filter(r => [r.name, ...r.aliases].some(n => n.toLowerCase() === raw.trim().toLowerCase()));
  if (matches.length !== 1) throw new Error(`${matches.length ? 'Ambiguous' : 'Unknown'} ${kind}: ${raw}. Use Command Center → Health to stage its canonical name and unit/type in a Daily Form, then import that form.`);
  return matches[0];
}

/** Compact rows support literal pipes and newlines via \\| and \\n. */
export function healthFields(line: string, count: number): string[] {
  const fields = [''];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && ['|', '\\', 'n'].includes(line[i + 1])) {
      const escaped = line[++i]; fields[fields.length - 1] += escaped === 'n' ? '\n' : escaped;
    } else if (c === '|') fields.push('');
    else fields[fields.length - 1] += c;
  }
  const trimmed = fields.map(f => f.trim());
  if (trimmed.length !== count || trimmed.some(f => !f)) throw new Error(`Expected ${count} non-empty pipe-separated fields: ${line}`);
  return trimmed;
}
export function healthSection(content: string | undefined): { state: CollectionState; lines: string[] } {
  if (content === undefined) return { state: 'unrecorded', lines: [] };
  if (!findEntriesMarker(content)) throw new Error('Health sections require a standalone ENTRIES: marker, even when empty.');
  const lines = entryLines(content);
  if (lines.some(l => l.toLowerCase() === 'none')) {
    if (lines.length !== 1) throw new Error('A standalone none cannot be mixed with other entries.');
    return { state: 'none', lines: [] };
  }
  return { state: lines.length ? 'recorded' : 'unrecorded', lines };
}
function timestamp(raw: string, range = false): string | null {
  if (!raw.trim()) return null;
  const parts = raw.trim().split(' to ');
  if (parts.length > (range ? 2 : 1) || parts.some(p => {
    const m = /^(\d{4}-\d{2}-\d{2})(?: ([01]\d|2[0-3]):([0-5]\d))?$/.exec(p);
    return !m || !isIsoDate(m[1]);
  }) || (parts.length === 2 && parts[0] > parts[1])) throw new Error(`Invalid medical date or range: ${raw}`);
  return raw.trim();
}
export function numericObservation(raw: string): { number: number; comparator: string | null } {
  const match = /^(<=|>=|<|>|=)?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.exec(raw);
  if (!match || !Number.isFinite(Number(match[2]))) throw new Error(`Expected a numeric value in the catalog unit, optionally with <, <=, >, >=, or =: ${raw}`);
  return { number: Number(match[2]), comparator: match[1] ?? null };
}
export function inspectMedicalForm(db: Database, input: MedicalInput) {
  assertSchemaV1(db); assertMedicalSchema(db);
  if ((input.sourceText.match(/^####[ \t]+EH[ \t]+Medical[ \t]+Form[ \t]*$/gmi) ?? []).length !== 1) throw new Error('Keep exactly one Medical Form per source note.');
  const form = requireEhForm(input.sourceText, 'medical');
  const body = form.body;
  const headings = [...body.matchAll(/^#####(?!#)[ \t]+(.+?)[ \t]*$/gm)].map(m => m[1].trim().toLowerCase());
  if (headings.some(n => !['measurements', 'procedures'].includes(n)) || new Set(headings).size !== headings.length) throw new Error('Medical Forms accept one Measurements and one Procedures section; unknown or duplicate sections must be corrected.');
  const sections = formSections(body);
  const header = body.split(/^##### /m)[0];
  for (const field of ['report', 'report id', 'performed', 'reported', 'source']) {
    if ((header.match(new RegExp(`^${field}:`, 'gmi')) ?? []).length > 1) throw new Error(`Duplicate medical header field: ${field}`);
  }
  const title = labeledValue(header, 'report');
  if (!title) throw new Error('Medical Form requires a report: title.');
  const performed = timestamp(labeledValue(header, 'performed') ?? '', true);
  const reported = timestamp(labeledValue(header, 'reported') ?? '');
  if (performed && reported && reported.slice(0, 10) < performed.split(' to ')[0].slice(0, 10)) throw new Error('Report issue date cannot precede the first performed date.');
  const source = labeledValue(header, 'source');
  if (source) normalizeVaultDatabasePath(source);
  const rawId = labeledValue(header, 'report id');
  if (rawId && (!/^\d+$/.test(rawId) || !Number.isSafeInteger(Number(rawId)) || Number(rawId) < 1)) throw new Error('report id must be a positive imported report ID.');
  const previous = queryRows(db, `SELECT i.* FROM medical_report_imports i
    WHERE ${rawId ? 'i.report_id=?' : 'i.source_file_path=?'}`, [rawId ? Number(rawId) : input.filePath])[0];
  if (rawId && !previous) throw new Error('report id does not identify a report imported by this plugin.');
  const other = queryRows(db, `SELECT report_id FROM medical_report_imports WHERE source_file_path=?`, [input.filePath])[0];
  if (other && Number(other.report_id) !== Number(previous?.report_id)) throw new Error('This source note already belongs to a different report.');
  if (source) {
    const duplicates = queryRows(db, 'SELECT report_id FROM medical_report_imports WHERE source_document_path=? AND report_id<>?', [source, Number(previous?.report_id ?? -1)]);
    if (duplicates.length) throw new Error(`This source document is already imported as report ${String(duplicates[0].report_id)}. Use its source note or report id to reimport it.`);
  }
  const measurementSection = healthSection(sections.get('measurements')?.content);
  const procedureSection = healthSection(sections.get('procedures')?.content);
  const measurements = measurementSection.lines.map((line, ordinal) => {
    const [name, value, notes] = healthFields(line, 3);
    const marker = resolveHealth(db, 'measurement', name);
    const numeric = marker.valueType === 'number' ? numericObservation(value) : null;
    if (marker.valueType === 'number' && !marker.unit) throw new Error(`Define a canonical unit for ${marker.name} first.`);
    return { markerId: marker.id, name: marker.name, value, number: numeric?.number ?? null, comparator: numeric?.comparator ?? null,
      unit: marker.unit || null, valueType: marker.valueType, notes, ordinal };
  });
  const procedures = procedureSection.lines.map((line, ordinal) => {
    const [name, notes] = healthFields(line, 2); const procedure = resolveHealth(db, 'procedure', name);
    return { procedureId: procedure.id, name: procedure.name, notes, ordinal };
  });
  return { title, performed, reported, source, measurements, procedures,
    measurementState: measurementSection.state, procedureState: procedureSection.state,
    reportId: previous ? Number(previous.report_id) : null,
    previousMeasurements: previous ? Number(queryRows(db, 'SELECT COUNT(*) AS n FROM measurements WHERE report_id=?', [previous.report_id])[0].n) : 0,
    previousProcedures: previous ? Number(queryRows(db, 'SELECT COUNT(*) AS n FROM report_procedures WHERE report_id=?', [previous.report_id])[0].n) : 0,
  };
}
export type MedicalPreview = ReturnType<typeof inspectMedicalForm>;
export function writeMedicalForm(db: Database, input: MedicalInput) {
  db.run('SAVEPOINT medical_import');
  try {
    const p = inspectMedicalForm(db, input);
    if (p.reportId && !input.replaceExisting) throw new Error('This report is already imported. Preview and explicitly confirm replacement.');
    let id = p.reportId;
    if (id) {
      db.run('DELETE FROM measurements WHERE report_id=?', [id]);
      db.run('DELETE FROM report_procedures WHERE report_id=?', [id]);
      db.run('UPDATE reports SET title=?, report_timestamp=?, relative_path=? WHERE id=?', [p.title, p.reported ?? p.performed ?? '', p.source ?? input.filePath, id]);
    } else {
      db.run('INSERT INTO reports (report_timestamp,report_type,title,relative_path) VALUES (?,?,?,?)', [p.reported ?? p.performed ?? '', 'medical', p.title, p.source ?? input.filePath]);
      id = lastInsertId(db);
    }
    for (const m of p.measurements) db.run(`INSERT INTO measurements
      (report_id,marker_id,value,value_text,comparator,unit_at_time,value_type_at_time,notes,source_ordinal)
      VALUES (?,?,?,?,?,?,?,?,?)`, [id, m.markerId, m.number, m.value, m.comparator, m.unit, m.valueType, m.notes, m.ordinal]);
    for (const procedure of p.procedures) db.run('INSERT INTO report_procedures (report_id,procedure_id,source_ordinal,notes) VALUES (?,?,?,?)', [id, procedure.procedureId, procedure.ordinal, procedure.notes]);
    db.run(`INSERT INTO medical_report_imports
      (report_id,source_file_path,source_checksum,source_document_path,performed,reported,measurements_state,procedures_state,plugin_version)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(report_id) DO UPDATE SET source_file_path=excluded.source_file_path,
      source_checksum=excluded.source_checksum, source_document_path=excluded.source_document_path, performed=excluded.performed,
      reported=excluded.reported, measurements_state=excluded.measurements_state, procedures_state=excluded.procedures_state,
      plugin_version=excluded.plugin_version, updated_at=CURRENT_TIMESTAMP`,
    [id, input.filePath, input.sourceChecksum, p.source, p.performed, p.reported, p.measurementState, p.procedureState, input.pluginVersion]);
    db.run('RELEASE medical_import');
    return { reportId: id, replaced: p.reportId !== null, measurementCount: p.measurements.length, procedureCount: p.procedures.length };
  } catch (error) {
    db.run('ROLLBACK TO medical_import'); db.run('RELEASE medical_import'); throw error;
  }
}
