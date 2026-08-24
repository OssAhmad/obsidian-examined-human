import type { Database } from 'sql.js';
import {
  assertSchemaV5,
  queryRows,
  requireIsoDate,
  resolveEntity,
  resolveTaxonomy,
} from './database-utils.ts';

export interface NativePlanningNote {
  noteDate: string;
  fileName: string;
  filePath: string;
  sourceText: string;
  sourceChecksum: string;
}

export interface PlannedSession {
  ordinal: number;
  intervalRaw: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  timeIsEstimated: boolean;
  sessionTypeRaw: string;
  engagementRaw: string;
  notes: string;
  warnings: string[];
}

export interface PlannedNoteInspection {
  sessions: PlannedSession[];
  issues: string[];
  parseStatus: 'ok' | 'warning' | 'error';
}

export interface PlanningProjectionResult {
  noteDate: string;
  fileName: string;
  sessionCount: number;
  warningCount: number;
  parseStatus: 'ok' | 'warning' | 'error';
}

export interface PlanningSyncResult {
  cutoffDate: string;
  noteCount: number;
  sessionCount: number;
  warningCount: number;
  deletedSourceCount: number;
  notes: PlanningProjectionResult[];
}

const ESTIMATED_START_MINUTE = 7 * 60;
const ESTIMATED_DURATION_MINUTES = 60;
const ESTIMATED_SLOTS_PER_DAY = 17;

function formSections(text: string): { sections: Map<string, string>; issues: string[] } {
  const issues: string[] = [];
  const positions = ['#### EH Form', '#### EQH Form']
    .map((heading) => text.indexOf(heading))
    .filter((position) => position >= 0);
  if (positions.length === 0) return { sections: new Map(), issues: ['No EH Form heading was found.'] };
  const start = Math.min(...positions);
  let end = text.indexOf('#### END', start);
  if (end < 0) {
    end = text.length;
    issues.push('No END marker was found; the form was parsed to the end of the note.');
  }
  const form = text.slice(start, end);
  const matches = [...form.matchAll(/^##### (.+?)\r?$/gm)];
  const sections = new Map<string, string>();
  matches.forEach((match, index) => {
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = index + 1 < matches.length ? (matches[index + 1].index ?? form.length) : form.length;
    sections.set(match[1].trim(), form.slice(bodyStart, bodyEnd).trim());
  });
  return { sections, issues };
}

function entriesBlock(section: string): string {
  const marker = section.indexOf('ENTRIES:');
  return marker < 0 ? '' : section.slice(marker + 'ENTRIES:'.length).trim();
}

function splitFields(line: string, expected: number): string[] {
  for (const delimiter of ['|', ';']) {
    const parts = line.split(delimiter).map((part) => part.trim());
    if (parts.length === expected) return parts;
  }
  return line.split(line.includes('|') ? '|' : ';').map((part) => part.trim());
}

function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function parsePlannedInterval(value: string): [number, number] | null {
  const match = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(value);
  if (!match) return null;
  const values = match.slice(1).map(Number);
  const [startHour, startMinute, endHour, endMinute] = values;
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null;
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return end > start ? [start, end] : null;
}

export function inspectPlannedNote(text: string): PlannedNoteInspection {
  const extracted = formSections(text);
  if (extracted.issues.some((issue) => issue.startsWith('No EH Form'))) {
    return { sessions: [], issues: extracted.issues, parseStatus: 'error' };
  }
  const sessionLines = entriesBlock(extracted.sections.get('Sessions') ?? '').split(/\r?\n/);
  const sessions: PlannedSession[] = [];
  let estimatedIndex = 0;
  sessionLines.forEach((rawLine, sourceIndex) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('<!--') || line.startsWith('-->') || line.startsWith('>') || line.startsWith('#')) return;
    const parts = splitFields(line, 4);
    if (parts.length !== 4) {
      extracted.issues.push(`Sessions entry #${sourceIndex + 1} has ${parts.length} fields; expected 4.`);
      return;
    }
    const [intervalRaw, sessionTypeRaw, engagementRaw, notes] = parts;
    const warnings: string[] = [];
    const parsed = parsePlannedInterval(intervalRaw);
    let start: number;
    let end: number;
    let timeIsEstimated: boolean;
    if (parsed) {
      [start, end] = parsed;
      timeIsEstimated = false;
    } else {
      start = ESTIMATED_START_MINUTE + (estimatedIndex % ESTIMATED_SLOTS_PER_DAY) * ESTIMATED_DURATION_MINUTES;
      end = start + ESTIMATED_DURATION_MINUTES;
      estimatedIndex += 1;
      warnings.push(intervalRaw
        ? `Time "${intervalRaw}" is not valid and is shown in an estimated slot.`
        : 'Time is not specified and is shown in an estimated slot.');
      if (estimatedIndex > ESTIMATED_SLOTS_PER_DAY) warnings.push('Estimated hourly slots were reused because the day is full.');
      timeIsEstimated = true;
    }
    if (!sessionTypeRaw) warnings.push('Session type is missing.');
    if (!engagementRaw) warnings.push('Engagement is missing.');
    sessions.push({
      ordinal: sourceIndex + 1,
      intervalRaw,
      startTime: formatTime(start),
      endTime: formatTime(end),
      durationMinutes: end - start,
      timeIsEstimated,
      sessionTypeRaw,
      engagementRaw,
      notes,
      warnings,
    });
  });
  const hasWarnings = extracted.issues.length > 0 || sessions.some((session) => session.warnings.length > 0);
  return { sessions, issues: extracted.issues, parseStatus: hasWarnings ? 'warning' : 'ok' };
}

function sourceId(db: Database, noteDate: string): number {
  const row = queryRows(db, 'SELECT id FROM note_sources WHERE note_date = ?', [noteDate])[0];
  if (!row) throw new Error(`Could not find note source for ${noteDate}.`);
  return Number(row.id);
}

function resolvePlanningFacts(db: Database, parsed: PlannedNoteInspection): Array<{
  session: PlannedSession;
  typeId: number | null;
  engagementId: number | null;
  warnings: string[];
}> {
  return parsed.sessions.map((session) => {
    const type = session.sessionTypeRaw ? resolveTaxonomy(db, 'session_types', session.sessionTypeRaw) : null;
    const engagement = session.engagementRaw ? resolveEntity(db, session.engagementRaw, 'engagements') : null;
    const warnings = [...session.warnings];
    if (session.sessionTypeRaw && !type) warnings.push(`Unknown session type "${session.sessionTypeRaw}".`);
    if (session.engagementRaw && !engagement) warnings.push(`Engagement "${session.engagementRaw}" is unresolved.`);
    return { session, typeId: type?.id ?? null, engagementId: engagement?.id ?? null, warnings };
  });
}

function projectNote(db: Database, note: NativePlanningNote): PlanningProjectionResult {
  requireIsoDate(note.noteDate, 'Daily Note date');
  const parsed = inspectPlannedNote(note.sourceText);
  const resolved = resolvePlanningFacts(db, parsed);
  const combinedIssues = parsed.issues.join('\n\n') || null;
  let parseStatus: 'ok' | 'warning' | 'error' = parsed.parseStatus;
  if (resolved.some((item) => item.warnings.length > 0) && parseStatus === 'ok') parseStatus = 'warning';
  db.run(`INSERT INTO note_sources (
      note_date, file_name, file_path, content_checksum,
      lifecycle_state, parse_status, last_error, last_scanned_at
    ) VALUES (?, ?, ?, ?, 'planned', ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(note_date) DO UPDATE SET
      file_name = excluded.file_name,
      file_path = excluded.file_path,
      content_checksum = excluded.content_checksum,
      lifecycle_state = 'planned',
      parse_status = excluded.parse_status,
      last_error = excluded.last_error,
      last_scanned_at = CURRENT_TIMESTAMP,
      finalized_at = NULL`, [
    note.noteDate, note.fileName, note.filePath, note.sourceChecksum, parseStatus, combinedIssues,
  ]);
  const id = sourceId(db, note.noteDate);
  db.run('DELETE FROM planned_sessions WHERE source_note_id = ?', [id]);
  for (const item of resolved) {
    const session = item.session;
    db.run(`INSERT INTO planned_sessions (
        source_note_id, source_ordinal, date, interval_raw,
        start_time, end_time, duration_minutes, time_is_estimated,
        session_type_raw, resolved_session_type_id,
        engagement_raw, resolved_engagement_id, notes, warning_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      id, session.ordinal, note.noteDate, session.intervalRaw || null,
      session.startTime, session.endTime, session.durationMinutes, session.timeIsEstimated ? 1 : 0,
      session.sessionTypeRaw, item.typeId, session.engagementRaw, item.engagementId,
      session.notes || null, item.warnings.join('\n') || null,
    ]);
  }
  return {
    noteDate: note.noteDate,
    fileName: note.fileName,
    sessionCount: parsed.sessions.length,
    warningCount: parsed.issues.length + resolved.reduce((total, item) => total + item.warnings.length, 0),
    parseStatus,
  };
}

export function syncPlanningNotes(
  db: Database,
  notes: NativePlanningNote[],
  cutoffDate: string,
): PlanningSyncResult {
  assertSchemaV5(db);
  requireIsoDate(cutoffDate, 'Planning cutoff');
  const eligible = notes.filter((note) => note.noteDate >= cutoffDate);
  const duplicateDates = eligible.filter((note, index) => eligible.findIndex((other) => other.noteDate === note.noteDate) !== index);
  if (duplicateDates.length > 0) throw new Error(`Multiple Daily Notes were supplied for ${duplicateDates[0].noteDate}.`);
  const results = eligible.map((note) => projectNote(db, note));
  const seenPaths = new Set(eligible.map((note) => note.filePath));
  const candidates = queryRows(db, `SELECT id, file_path FROM note_sources
    WHERE note_date >= ? AND lifecycle_state <> 'finalized'`, [cutoffDate]);
  let deletedSourceCount = 0;
  for (const candidate of candidates) {
    if (seenPaths.has(String(candidate.file_path))) continue;
    db.run('DELETE FROM planned_sessions WHERE source_note_id = ?', [candidate.id]);
    db.run(`UPDATE note_sources SET lifecycle_state = 'deleted', parse_status = 'ok',
      last_error = NULL, last_scanned_at = CURRENT_TIMESTAMP WHERE id = ?`, [candidate.id]);
    deletedSourceCount += 1;
  }
  return {
    cutoffDate,
    noteCount: results.length,
    sessionCount: results.reduce((total, result) => total + result.sessionCount, 0),
    warningCount: results.reduce((total, result) => total + result.warningCount, 0),
    deletedSourceCount,
    notes: results,
  };
}
