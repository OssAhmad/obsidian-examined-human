import type { Database } from 'sql.js';
import {
  addIsoDays,
  assertSchemaV5,
  lastInsertId,
  queryRows,
  requireIsoDate,
  resolveEntity,
  resolveTaxonomy,
} from './database-utils.ts';

export interface NativeWeeklyNoteInput {
  weekStartDate: string;
  fileName: string;
  filePath: string;
  sourceText: string;
  sourceChecksum: string;
}

export interface WeeklyCommitment {
  ordinal: number;
  targetMinutes: number;
  engagementId: number;
  engagementRaw: string;
  commitmentText: string;
}

export interface WeeklySession {
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  sessionTypeId: number;
  engagementId: number;
  originalCellText: string;
  notes: string | null;
  sourceRow: number;
  sourceColumnStart: number;
  sourceColumnEnd: number;
}

export interface ParsedWeeklyPlan {
  weekStart: string;
  mainOutcome: string | null;
  importantDeadline: string | null;
  constraintOrRisk: string | null;
  commitments: WeeklyCommitment[];
  sessions: WeeklySession[];
}

export interface WeeklyImportResult {
  weekStart: string;
  commitmentCount: number;
  sessionCount: number;
  plannedMinutes: number;
}

export interface DailyNoteWriteInput {
  noteDate: string;
  fileName: string;
  filePath: string;
  sourceText: string;
  sourceChecksum: string;
}

export interface PreparedDailyNoteWrite {
  noteDate: string;
  fileName: string;
  filePath: string;
  status: 'ready' | 'skipped-existing-sessions' | 'no-planned-sessions';
  sessionCount: number;
  rows: string[];
  sourceChecksum: string;
  updatedText: string | null;
}

export interface WeeklyNoteWritePreview {
  selector: string;
  weekStart: string;
  relevantDayCount: number;
  writableNoteCount: number;
  skippedNoteCount: number;
  writtenSessionCount: number;
  notes: PreparedDailyNoteWrite[];
}

const DAY_OFFSETS: Record<string, number> = {
  saturday: 0,
  sunday: 1,
  monday: 2,
  tuesday: 3,
  wednesday: 4,
  thursday: 5,
  friday: 6,
};

function parseWeekStart(text: string): string {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!frontmatter) throw new Error('Weekly note has no YAML frontmatter.');
  const match = /^week start:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/im.exec(frontmatter[1]);
  if (!match) throw new Error('Weekly note YAML must contain a rendered week start: YYYY-MM-DD.');
  requireIsoDate(match[1], 'Weekly plan start');
  return match[1];
}

function labeledValue(text: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^-\\s*${escaped}:\\s*(.*?)\\s*$`, 'im').exec(text);
  return match?.[1].trim() || null;
}

function parseCommitments(db: Database, text: string): WeeklyCommitment[] {
  const heading = /^#{4,5}\s+(?:Fixed\s+)?Commitments\s*$/im.exec(text);
  if (!heading) throw new Error('Weekly note has no Commitments section.');
  const tail = text.slice((heading.index ?? 0) + heading[0].length);
  const end = /^(?:#{1,6}\s+|Total:\s*|\|\s*Day\s*\|)/im.exec(tail);
  const block = end ? tail.slice(0, end.index) : tail;
  const commitments: WeeklyCommitment[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === '-') continue;
    const entry = line.startsWith('-') ? line.slice(1).trim() : line;
    const parts = entry.split('|').map((part) => part.trim());
    if (parts.length !== 3) throw new Error(`Invalid weekly commitment '${line}'; use hours | engagement | commitment.`);
    const hours = Number(parts[0]);
    if (!Number.isFinite(hours)) throw new Error(`Invalid commitment hours: '${parts[0]}'.`);
    const targetMinutes = Math.floor(hours * 60 + 0.5);
    if (targetMinutes <= 0) throw new Error('Weekly commitment hours must be greater than zero.');
    const engagement = resolveEntity(db, parts[1], 'engagements');
    if (!engagement) throw new Error(`Unknown engagement in weekly commitment: '${parts[1]}'.`);
    if (!parts[2]) throw new Error('Weekly commitment description cannot be empty.');
    commitments.push({
      ordinal: commitments.length + 1,
      targetMinutes,
      engagementId: engagement.id,
      engagementRaw: parts[1],
      commitmentText: parts[2],
    });
  }
  return commitments;
}

function markdownCells(line: string): string[] {
  let stripped = line.trim();
  if (stripped.startsWith('|')) stripped = stripped.slice(1);
  if (stripped.endsWith('|')) stripped = stripped.slice(0, -1);
  return stripped.split('|').map((cell) => cell.trim());
}

function parseHeaderInterval(value: string): { startTime: string; endTime: string; duration: number } {
  const normalized = value.replace(/â€“|–|—/g, '-').trim();
  const match = /^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/.exec(normalized);
  if (!match) throw new Error(`Invalid weekly grid interval header: '${value}'.`);
  const startTotal = Number(match[1]) * 60 + Number(match[2] ?? 0);
  const endTotal = Number(match[3]) * 60 + Number(match[4] ?? 0);
  if (startTotal < 0 || startTotal >= 1440 || endTotal < 0 || endTotal > 1440) {
    throw new Error(`Invalid weekly grid interval header: '${value}'.`);
  }
  const duration = (endTotal - startTotal + 1440) % 1440;
  if (duration === 0) throw new Error(`Weekly grid interval has zero duration: '${value}'.`);
  const time = (minutes: number): string => `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return { startTime: time(startTotal), endTime: time(endTotal), duration };
}

function parseSessionCell(value: string): { type: string; engagement: string; notes: string | null } {
  const parts = value.split(';').map((part) => part.trim());
  if ((parts.length !== 2 && parts.length !== 3) || !parts[0] || !parts[1]) {
    throw new Error(`Invalid weekly grid cell '${value}'; use type ; engagement ; optional notes.`);
  }
  return { type: parts[0], engagement: parts[1], notes: parts.length === 3 ? parts[2] || null : null };
}

function canCollapse(previous: WeeklySession, current: WeeklySession): boolean {
  return previous.date === current.date
    && previous.endTime === current.startTime
    && previous.sessionTypeId === current.sessionTypeId
    && previous.engagementId === current.engagementId
    && previous.notes === current.notes
    && previous.originalCellText.trim().toLowerCase() === current.originalCellText.trim().toLowerCase();
}

function parseGrid(db: Database, text: string, weekStart: string): WeeklySession[] {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\s*\|\s*Day\s*\|/i.test(line));
  if (headerIndex < 0) throw new Error('Weekly note has no Day planning grid.');
  const headerCells = markdownCells(lines[headerIndex]);
  const intervals = headerCells.slice(1).map(parseHeaderInterval);
  const sessions: WeeklySession[] = [];
  let sourceRow = 0;
  for (const rawLine of lines.slice(headerIndex + 2)) {
    if (!rawLine.trimStart().startsWith('|')) break;
    const cells = markdownCells(rawLine);
    if (cells.length === 0) continue;
    const dayName = cells[0].trim().toLowerCase();
    if (DAY_OFFSETS[dayName] == null) break;
    sourceRow += 1;
    if (cells.length - 1 !== intervals.length) {
      throw new Error(`${cells[0].trim()} has ${cells.length - 1} cells; expected ${intervals.length}.`);
    }
    const date = addIsoDays(weekStart, DAY_OFFSETS[dayName]);
    const rowSessions: WeeklySession[] = [];
    cells.slice(1).forEach((rawCell, index) => {
      const cell = rawCell.trim();
      if (!cell) return;
      const parsed = parseSessionCell(cell);
      const sessionType = resolveTaxonomy(db, 'session_types', parsed.type);
      if (!sessionType) throw new Error(`Unknown session type in weekly grid: '${parsed.type}'.`);
      const engagement = resolveEntity(db, parsed.engagement, 'engagements');
      if (!engagement) throw new Error(`Unknown engagement in weekly grid: '${parsed.engagement}'.`);
      const interval = intervals[index];
      const candidate: WeeklySession = {
        date,
        startTime: interval.startTime,
        endTime: interval.endTime,
        durationMinutes: interval.duration,
        sessionTypeId: sessionType.id,
        engagementId: engagement.id,
        originalCellText: cell,
        notes: parsed.notes,
        sourceRow,
        sourceColumnStart: index + 1,
        sourceColumnEnd: index + 1,
      };
      const previous = rowSessions[rowSessions.length - 1];
      if (previous && canCollapse(previous, candidate)) {
        previous.endTime = candidate.endTime;
        previous.durationMinutes += candidate.durationMinutes;
        previous.sourceColumnEnd = candidate.sourceColumnEnd;
      } else rowSessions.push(candidate);
    });
    sessions.push(...rowSessions);
  }
  if (sourceRow !== 7) throw new Error(`Weekly grid must contain seven day rows; found ${sourceRow}.`);
  return sessions;
}

export function parseWeeklyPlan(db: Database, input: NativeWeeklyNoteInput): ParsedWeeklyPlan {
  assertSchemaV5(db);
  const weekStart = parseWeekStart(input.sourceText);
  if (weekStart !== input.weekStartDate) {
    throw new Error(`Weekly note index says ${input.weekStartDate}, but YAML says ${weekStart}.`);
  }
  return {
    weekStart,
    mainOutcome: labeledValue(input.sourceText, 'Main outcome'),
    importantDeadline: labeledValue(input.sourceText, 'Important deadline'),
    constraintOrRisk: labeledValue(input.sourceText, 'Constraint or risk'),
    commitments: parseCommitments(db, input.sourceText),
    sessions: parseGrid(db, input.sourceText, weekStart),
  };
}

export function inspectWeeklyPlan(db: Database, input: NativeWeeklyNoteInput): WeeklyImportResult {
  const plan = parseWeeklyPlan(db, input);
  const duplicate = queryRows(db, `SELECT source_file_name FROM weekly_plans
    WHERE week_start_date = ? OR source_file_path = ? LIMIT 1`, [plan.weekStart, input.filePath])[0];
  if (duplicate) throw new Error(`Week ${plan.weekStart} has already been imported from ${String(duplicate.source_file_name)}.`);
  return {
    weekStart: plan.weekStart,
    commitmentCount: plan.commitments.length,
    sessionCount: plan.sessions.length,
    plannedMinutes: plan.sessions.reduce((total, session) => total + session.durationMinutes, 0),
  };
}

export function writeWeeklyPlan(db: Database, input: NativeWeeklyNoteInput): WeeklyImportResult {
  const result = inspectWeeklyPlan(db, input);
  const plan = parseWeeklyPlan(db, input);
  db.run(`INSERT INTO weekly_plans (
      week_start_date, source_file_name, source_file_path, source_checksum,
      main_outcome, important_deadline, constraint_or_risk
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    plan.weekStart, input.fileName, input.filePath, input.sourceChecksum,
    plan.mainOutcome, plan.importantDeadline, plan.constraintOrRisk,
  ]);
  const planId = lastInsertId(db);
  for (const item of plan.commitments) {
    db.run(`INSERT INTO weekly_commitments (
      weekly_plan_id, source_ordinal, target_minutes, engagement_id, engagement_raw, commitment_text
    ) VALUES (?, ?, ?, ?, ?, ?)`, [
      planId, item.ordinal, item.targetMinutes, item.engagementId, item.engagementRaw, item.commitmentText,
    ]);
  }
  for (const item of plan.sessions) {
    db.run(`INSERT INTO weekly_plan_sessions (
      weekly_plan_id, date, start_time, end_time, duration_minutes,
      session_type_id, engagement_id, original_cell_text, notes,
      source_row, source_column_start, source_column_end
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      planId, item.date, item.startTime, item.endTime, item.durationMinutes,
      item.sessionTypeId, item.engagementId, item.originalCellText, item.notes,
      item.sourceRow, item.sourceColumnStart, item.sourceColumnEnd,
    ]);
  }
  return result;
}

function resolveWeeklyPlan(db: Database, selector: string): { id: number; weekStart: string } {
  const normalized = selector.trim();
  if (!normalized) throw new Error('Week selector cannot be empty.');
  const records = queryRows(db, 'SELECT id, week_start_date, source_file_name FROM weekly_plans');
  let matches: typeof records;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    matches = records.filter((record) => String(record.week_start_date) === normalized);
  } else if (/^\d{4}-W\d{1,2}$/i.test(normalized)) {
    matches = records.filter((record) => String(record.source_file_name).replace(/\.md$/i, '').toLowerCase() === normalized.toLowerCase());
  } else if (/^W\d{1,2}$/i.test(normalized)) {
    const suffix = `-${normalized.toLowerCase()}`;
    matches = records.filter((record) => {
      const stem = String(record.source_file_name).replace(/\.md$/i, '').toLowerCase();
      return stem === normalized.toLowerCase() || stem.endsWith(suffix);
    });
  } else throw new Error('Use YYYY-MM-DD, WNN, or YYYY-WNN as the week selector.');
  if (matches.length === 0) throw new Error(`No imported weekly plan matches '${selector}'.`);
  if (matches.length > 1) throw new Error(`Week selector '${selector}' is ambiguous; use YYYY-WNN or the exact start date.`);
  return { id: Number(matches[0].id), weekStart: String(matches[0].week_start_date) };
}

function sessionRows(db: Database, planId: number): Map<string, string[]> {
  const records = queryRows(db, `SELECT date, start_time, end_time, original_cell_text
    FROM weekly_plan_sessions WHERE weekly_plan_id = ? ORDER BY date, start_time, id`, [planId]);
  const result = new Map<string, string[]>();
  for (const record of records) {
    const original = String(record.original_cell_text);
    const parts = original.split(';').map((part) => part.trim());
    if ((parts.length !== 2 && parts.length !== 3) || !parts[0] || !parts[1]) {
      throw new Error(`Stored weekly session has invalid source text: '${original}'.`);
    }
    const date = String(record.date);
    const rows = result.get(date) ?? [];
    rows.push(`${String(record.start_time)}-${String(record.end_time)} | ${parts[0]} | ${parts[1]} |`);
    result.set(date, rows);
  }
  return result;
}

function sessionEntryLocation(text: string): { position: number; prefix: string; occupied: boolean } {
  const form = /^#### EH Form\s*$/m.exec(text);
  if (!form) throw new Error('no EH Form heading');
  const formTail = text.slice((form.index ?? 0) + form[0].length);
  const formEndMatch = /^#### END\s*$/m.exec(formTail);
  const formEnd = formEndMatch ? (form.index ?? 0) + form[0].length + formEndMatch.index : text.length;
  const formText = text.slice((form.index ?? 0) + form[0].length, formEnd);
  const section = /^##### Sessions\s*$/im.exec(formText);
  if (!section) throw new Error('no Sessions section');
  const sectionStart = (form.index ?? 0) + form[0].length + section.index + section[0].length;
  const tail = text.slice(sectionStart, formEnd);
  const nextHeading = /^##### .+?\s*$/m.exec(tail);
  const sectionEnd = nextHeading ? sectionStart + nextHeading.index : formEnd;
  const sectionText = text.slice(sectionStart, sectionEnd);
  const entries = /^ENTRIES:[ \t]*(\r?\n|$)/m.exec(sectionText);
  if (!entries) throw new Error('Sessions section has no ENTRIES marker');
  const position = sectionStart + entries.index + entries[0].length;
  const prefix = entries[1] ? '' : text.includes('\r\n') ? '\r\n' : '\n';
  const body = text.slice(position, sectionEnd);
  let insideComment = false;
  let occupied = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (insideComment) {
      if (line.includes('-->')) insideComment = false;
      continue;
    }
    if (line.startsWith('<!--')) {
      insideComment = !line.includes('-->');
      continue;
    }
    if (!line.startsWith('#') && !line.startsWith('>')) {
      occupied = true;
      break;
    }
  }
  return { position, prefix, occupied };
}

export function prepareWeeklyDailyNoteWrites(
  db: Database,
  selector: string,
  todayDate: string,
  notes: DailyNoteWriteInput[],
): WeeklyNoteWritePreview {
  assertSchemaV5(db);
  requireIsoDate(todayDate, 'Today');
  const plan = resolveWeeklyPlan(db, selector);
  const finalDate = addIsoDays(plan.weekStart, 6);
  const firstDate = todayDate > plan.weekStart ? todayDate : plan.weekStart;
  if (firstDate > finalDate) throw new Error(`Week ${plan.weekStart} has no current or future Daily Notes left to write.`);
  const relevantDates: string[] = [];
  for (let date = firstDate; date <= finalDate; date = addIsoDays(date, 1)) relevantDates.push(date);
  const byDate = new Map(notes.map((note) => [note.noteDate, note]));
  const missing = relevantDates.filter((date) => !byDate.has(date));
  if (missing.length > 0) {
    throw new Error(`Weekly-plan write aborted; create every relevant Daily Note first:\n  ${missing.map((date) => `${date}.md`).join('\n  ')}`);
  }
  const rowsByDate = sessionRows(db, plan.id);
  const prepared: PreparedDailyNoteWrite[] = [];
  const errors: string[] = [];
  for (const date of relevantDates) {
    const note = byDate.get(date)!;
    try {
      const location = sessionEntryLocation(note.sourceText);
      const rows = rowsByDate.get(date) ?? [];
      if (location.occupied) {
        prepared.push({ ...note, status: 'skipped-existing-sessions', sessionCount: 0, rows: [], updatedText: null });
      } else if (rows.length === 0) {
        prepared.push({ ...note, status: 'no-planned-sessions', sessionCount: 0, rows: [], updatedText: null });
      } else {
        const newline = note.sourceText.includes('\r\n') ? '\r\n' : '\n';
        const insertion = location.prefix + rows.join(newline) + newline;
        const updatedText = note.sourceText.slice(0, location.position) + insertion + note.sourceText.slice(location.position);
        prepared.push({ ...note, status: 'ready', sessionCount: rows.length, rows, updatedText });
      }
    } catch (error) {
      errors.push(`${note.fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Weekly-plan write aborted; these Daily Notes do not have a writable Sessions ENTRIES section:\n  ${errors.join('\n  ')}`);
  }
  return {
    selector,
    weekStart: plan.weekStart,
    relevantDayCount: relevantDates.length,
    writableNoteCount: prepared.filter((note) => note.status === 'ready').length,
    skippedNoteCount: prepared.filter((note) => note.status === 'skipped-existing-sessions').length,
    writtenSessionCount: prepared.reduce((total, note) => total + note.sessionCount, 0),
    notes: prepared,
  };
}
