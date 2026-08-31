import type { Database, SqlValue } from 'sql.js';
import { inspectMeals, type MealInspection, type NutritionThresholds } from './meals.ts';
import { mealComponentMatchesInspection, queryMealComponentState, writeMealInspection } from './meal-import.ts';
import {
  assertSchemaV1,
  ensureAlias,
  lastInsertId,
  moveAlias,
  parseAliases,
  queryRows,
  removeAlias,
  requireIsoDate,
  resolveEntity,
  resolveTaxonomy,
  taxonomyCodes,
  type ResolvedEntity,
  type ResolvedTaxonomy,
} from './database-utils.ts';

export interface NativeDailyNoteInput {
  noteDate: string;
  todayDate: string;
  fileName: string;
  filePath: string;
  sourceText: string;
  sourceChecksum: string;
  pluginVersion: string;
  nutritionThresholds: NutritionThresholds;
}

export interface DashboardCompleteness {
  missing_daily_metrics: string[];
  session_count: number;
  transaction_count: number;
  exercise_count: number;
  meal_count: number;
  milestone_count: number;
  admin_event_count: number;
}

export interface DashboardPreviewSession {
  ordinal: number;
  interval: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  session_type: string;
  engagement: string;
  notes: string | null;
}

export interface DashboardPreviewTransaction {
  ordinal: number;
  amount: number | string;
  account: string;
  engagement: string;
  engagement_raw: string;
  engagement_id: number | null;
  description: string;
}

export interface DashboardPreviewExerciseSet {
  set_number?: number | null;
  weight?: number | null;
  reps?: number | null;
  distance?: number | null;
  duration_minutes?: number | null;
  notes?: string | null;
}

export interface DashboardPreviewExercise {
  ordinal: number;
  exercise: string;
  sets: DashboardPreviewExerciseSet[];
  notes: string | null;
}

export interface NativeDailyInspection {
  date: string;
  filename: string;
  file_path: string;
  imported: boolean;
  ready: boolean;
  errors: string[];
  warnings: string[];
  completeness: DashboardCompleteness;
  preview: {
    daily_metrics: Record<string, string | number | null>;
    meals: Array<{ food: string; calories: number; protein_g: number }>;
    sessions: DashboardPreviewSession[];
    transactions: DashboardPreviewTransaction[];
    exercises: DashboardPreviewExercise[];
  };
  mealInspection: MealInspection;
}

export interface NativeDailyImportResult {
  noteDate: string;
  sessionCount: number;
  transactionCount: number;
  exerciseCount: number;
  exerciseSetCount: number;
  milestoneCount: number;
  foodRowCount: number;
  adminEventCount: number;
  rowCount: number;
}

interface ParsedInterval {
  start: string;
  end: string;
  durationMinutes: number;
}

interface ParsedSession {
  ordinal: number;
  interval: string;
  type: string;
  engagement: string;
  notes: string;
  parsedInterval: ParsedInterval | null;
  sessionType: ResolvedTaxonomy | null;
  resolvedEngagement: ResolvedEntity | null;
}

interface ParsedTransaction {
  ordinal: number;
  amountRaw: string;
  amount: number | null;
  account: string;
  engagement: string;
  description: string;
  resolvedAccount: ResolvedEntity | null;
  resolvedEngagement: ResolvedEntity | null;
}

export interface ParsedExerciseSet {
  weight: number | null;
  reps: number | null;
  distance: number | null;
  duration_minutes: number | null;
  pain_level: number | null;
  duration_seconds: number | null;
}

interface ParsedExercise {
  ordinal: number;
  exercise: string;
  setsRaw: string;
  notes: string;
  sets: ParsedExerciseSet[];
  resolvedExercise: ResolvedEntity | null;
}

interface ParsedMilestone {
  engagement: string;
  milestone: string;
  metric: string;
  value: string;
  sessionInterval: string;
  resolvedEngagement: ResolvedEntity | null;
  sessionIndex: number | null;
}

interface AdminEvent {
  command: string;
  args: string[];
  raw: string;
}

interface ParsedDailyNote {
  metrics: Record<string, string | number | null>;
  sessions: ParsedSession[];
  transactions: ParsedTransaction[];
  exercises: ParsedExercise[];
  milestones: ParsedMilestone[];
  stoicism: { score: string | null; notes: string | null };
  adminEvents: AdminEvent[];
  mealInspection: MealInspection;
}

interface PreparedDailyNote {
  parsed: ParsedDailyNote;
  inspection: NativeDailyInspection;
}

const FEEDBACK_PATTERN = /(?:\r?\n)?<!-- EH LOGGER FEEDBACK START -->.*?<!-- EH LOGGER FEEDBACK END -->(?:\r?\n)?/gs;
const METRIC_FIELDS = [
  'mood', 'energy', 'stress', 'weight_kg', 'sleep_hours',
  'calories', 'protein_g', 'fasted', 'dieted',
] as const;
const ADMIN_ARGUMENTS: Record<string, number | readonly number[]> = {
  ENGAGEMENT_CREATE: 4,
  ENGAGEMENT_COMPLETE: 1,
  ENGAGEMENT_PAUSE: 1,
  ENGAGEMENT_RENAME: 2,
  ENGAGEMENT_UPDATE: 9,
  ENGAGEMENT_ALIAS: 2,
  ENGAGEMENT_ALIAS_ADD: 2,
  ENGAGEMENT_ALIAS_REMOVE: 2,
  ENGAGEMENT_ALIAS_MOVE: 2,
  ENGAGEMENT_SET_STATUS: 2,
  ENGAGEMENT_SET_DATES: 3,
  ENGAGEMENT_SET_NOTES: 2,
  ENGAGEMENT_REOPEN: 1,
  EXERCISE_CREATE: 2,
  EXERCISE_UPDATE: 4,
  EXERCISE_RENAME: 2,
  EXERCISE_ALIAS: 2,
  EXERCISE_ALIAS_ADD: 2,
  EXERCISE_ALIAS_REMOVE: 2,
  EXERCISE_ALIAS_MOVE: 2,
  ACCOUNT_CREATE: [3, 4],
  ACCOUNT_ALIAS: 2,
  ACCOUNT_ALIAS_ADD: 2,
  ACCOUNT_ALIAS_REMOVE: 2,
  ACCOUNT_ALIAS_MOVE: 2,
  ACCOUNT_UPDATE: 4,
  ACCOUNT_RENAME: 2,
  ACCOUNT_SET_TYPE: 2,
  ACCOUNT_SET_CURRENCY: 2,
  ACCOUNT_SET_ADDRESS: 2,
  FOOD_CREATE: [10, 11],
  FOOD_UPDATE: 10,
  FOOD_RENAME: 2,
  FOOD_DELETE: 1,
  FOOD_ALIAS_ADD: 2,
  FOOD_ALIAS_REMOVE: 2,
  FOOD_ALIAS_MOVE: 2,
};

function acceptsArgumentCount(expected: number | readonly number[], received: number): boolean {
  return Array.isArray(expected) ? expected.includes(received) : expected === received;
}

function argumentExpectation(expected: number | readonly number[]): string {
  return Array.isArray(expected) ? expected.join(' or ') : String(expected);
}

function optionalIsoDate(value: string, label: string): string | null {
  if (!value.trim()) return null;
  requireIsoDate(value, label);
  return value;
}

function requiredNonNegativeNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative number.`);
  return parsed;
}

function optionalNonNegativeNumber(value: string, label: string): number | null {
  if (!value.trim()) return null;
  return requiredNonNegativeNumber(value, label);
}

function assertFoodNameAvailable(db: Database, name: string, exceptId: number | null = null): void {
  const normalized = name.trim();
  if (!normalized) throw new Error('Food name is empty.');
  const rows = queryRows(db, `
    SELECT id, name FROM foods WHERE name = ? COLLATE NOCASE
    UNION ALL
    SELECT food.id, food.name FROM food_aliases AS alias
      JOIN foods AS food ON food.id = alias.food_id
      WHERE alias.alias = ? COLLATE NOCASE
  `, [normalized, normalized]);
  if (rows.some((row) => Number(row.id) !== exceptId)) {
    throw new Error(`Food name '${normalized}' is already used by a canonical food or food alias.`);
  }
}

function assertFoodAliasDoesNotShadowCanonicalName(db: Database, alias: string): void {
  const canonical = queryRows(db, 'SELECT name FROM foods WHERE name = ? COLLATE NOCASE LIMIT 1', [alias.trim()])[0];
  if (canonical) throw new Error(`Food alias '${alias.trim()}' conflicts with canonical food '${String(canonical.name)}'.`);
}

function splitFields(line: string, expected?: number): string[] {
  if (expected != null) {
    for (const delimiter of ['|', ';']) {
      const parts = line.split(delimiter).map((part) => part.trim());
      if (parts.length === expected) return parts;
    }
  }
  const command = /^\s*[A-Z_]+\s*([|;])/.exec(line);
  const delimiter = command?.[1] ?? (line.includes('|') ? '|' : ';');
  return line.split(delimiter).map((part) => part.trim());
}

function sectionsFromForm(sourceText: string): Map<string, string> {
  const text = sourceText.replace(FEEDBACK_PATTERN, '\n');
  const form = /^####\s+EH\s+Form\s*$/mi.exec(text);
  if (!form) throw new Error('The note does not contain an EH Form heading.');
  const formStart = form.index + form[0].length;
  const afterForm = text.slice(formStart);
  const end = /^####\s+END\s*$/mi.exec(afterForm);
  if (!end) throw new Error('The note does not contain a #### END marker.');
  const body = afterForm.slice(0, end.index);
  const headings = [...body.matchAll(/^#####(?!#)\s+(.+?)\s*$/gm)];
  const result = new Map<string, string>();
  headings.forEach((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const finish = index + 1 < headings.length ? headings[index + 1].index ?? body.length : body.length;
    result.set(heading[1].trim().toLowerCase(), body.slice(start, finish).trim());
  });
  return result;
}

function entries(section: string | undefined): string[] {
  if (!section) return [];
  const marker = /^ENTRIES:[ \t]*$/mi.exec(section);
  if (!marker) return [];
  return section.slice(marker.index + marker[0].length).split(/\r?\n/)
    .map((line) => line.trim()).filter(Boolean);
}

class ExpressionParser {
  private index = 0;
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  parse(): number {
    const value = this.expression();
    this.space();
    if (this.index !== this.text.length || !Number.isFinite(value)) throw new Error('invalid expression');
    return value;
  }

  private expression(): number {
    let value = this.term();
    while (true) {
      this.space();
      const operator = this.text[this.index];
      if (operator !== '+' && operator !== '-') return value;
      this.index += 1;
      const right = this.term();
      value = operator === '+' ? value + right : value - right;
    }
  }

  private term(): number {
    let value = this.factor();
    while (true) {
      this.space();
      const operator = this.text[this.index];
      if (operator !== '*' && operator !== '/') return value;
      this.index += 1;
      const right = this.factor();
      if (operator === '/' && right === 0) throw new Error('division by zero');
      value = operator === '*' ? value * right : value / right;
    }
  }

  private factor(): number {
    this.space();
    const sign = this.text[this.index] === '-' || this.text[this.index] === '+'
      ? this.text[this.index++]
      : '+';
    this.space();
    let value: number;
    if (this.text[this.index] === '(') {
      this.index += 1;
      value = this.expression();
      this.space();
      if (this.text[this.index] !== ')') throw new Error('missing closing parenthesis');
      this.index += 1;
    } else {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(this.text.slice(this.index));
      if (!match) throw new Error('number expected');
      this.index += match[0].length;
      value = Number(match[0]);
    }
    return sign === '-' ? -value : value;
  }

  private space(): void {
    while (/\s/.test(this.text[this.index] ?? '')) this.index += 1;
  }
}

function optionalNumber(raw: string | null | undefined, label: string, errors: string[]): number | null {
  const text = raw?.trim() ?? '';
  if (!text) return null;
  try {
    return new ExpressionParser(text).parse();
  } catch {
    errors.push(`${label} must be numeric or a simple arithmetic expression.`);
    return null;
  }
}

function optionalFlag(raw: string | null | undefined, label: string, errors: string[]): 0 | 1 | null {
  const text = raw?.trim() ?? '';
  if (!text) return null;
  if (text === '0') return 0;
  if (text === '1') return 1;
  errors.push(`${label} must be blank, 0, or 1.`);
  return null;
}

export function parseSessionInterval(raw: string): ParsedInterval | null {
  const match = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(raw);
  if (!match) return null;
  const [startHour, startMinute, endHour, endMinute] = match.slice(1).map(Number);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null;
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  if (endTotal <= startTotal) return null;
  return {
    start: `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`,
    end: `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`,
    durationMinutes: endTotal - startTotal,
  };
}

export function parseExerciseSets(rawSets: string): ParsedExerciseSet[] {
  const text = rawSets.trim().replace(/^\[/, '').replace(/\]$/, '');
  const tokens = text.split(',').map((token) => token.trim()).filter(Boolean);
  const result: ParsedExerciseSet[] = [];
  let endurance: ParsedExerciseSet | null = null;
  const empty = (): ParsedExerciseSet => ({
    weight: null, reps: null, distance: null, duration_minutes: null,
    pain_level: null, duration_seconds: null,
  });
  const flush = (): void => {
    if (endurance) result.push(endurance);
    endurance = null;
  };
  for (const token of tokens) {
    const enduranceMatch = /^(\d+(?:\.\d+)?)(min|km)$/i.exec(token);
    if (enduranceMatch) {
      endurance ??= empty();
      const field = enduranceMatch[2].toLowerCase() === 'min' ? 'duration_minutes' : 'distance';
      if (endurance[field] != null) throw new Error(`Exercise set '${token}' duplicates an endurance ${field}.`);
      endurance[field] = Number(enduranceMatch[1]);
      if (endurance.duration_minutes != null && endurance.distance != null) flush();
      continue;
    }
    flush();
    const bodyweight = /^BWx(\d+)$/i.exec(token);
    const strength = /^\+?(\d+(?:\.\d+)?)x(\d+)$/.exec(token);
    if (!bodyweight && !strength) {
      throw new Error(`Unsupported exercise set '${token}'. Use 80x6, +10x5, BWx8, 30min, or 5km.`);
    }
    const set = empty();
    if (bodyweight) set.reps = Number(bodyweight[1]);
    else if (strength) {
      set.weight = Number(strength[1]);
      set.reps = Number(strength[2]);
    }
    result.push(set);
  }
  flush();
  return result;
}

function metricMap(section: string | undefined, errors: string[]): Record<string, string | number | null> {
  const raw: Record<string, string> = {};
  for (const line of (section ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    raw[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  const metrics: Record<string, string | number | null> = { ...raw };
  for (const field of ['mood', 'energy', 'stress', 'weight_kg', 'sleep_hours', 'calories', 'protein_g']) {
    metrics[field] = optionalNumber(raw[field], field, errors);
  }
  for (const field of ['fasted', 'dieted', 'studied', 'worked', 'exercised']) {
    metrics[field] = optionalFlag(raw[field], field, errors);
  }
  return metrics;
}

function parseDaily(db: Database, sourceText: string, thresholds: NutritionThresholds, errors: string[]): ParsedDailyNote {
  const sections = sectionsFromForm(sourceText);
  const metrics = metricMap(sections.get('daily metrics'), errors);
  const sessions: ParsedSession[] = entries(sections.get('sessions')).map((line, index) => {
    const parts = splitFields(line, 4);
    if (parts.length !== 4) errors.push(`Invalid session row '${line}'; expected interval | type | engagement | notes.`);
    const [interval = '', type = '', engagement = '', notes = ''] = parts;
    return {
      ordinal: index + 1, interval, type, engagement, notes,
      parsedInterval: null, sessionType: null, resolvedEngagement: null,
    };
  });
  const transactions: ParsedTransaction[] = entries(sections.get('transactions')).map((line, index) => {
    const parts = splitFields(line, 4);
    if (parts.length !== 4) errors.push(`Invalid transaction row '${line}'; expected amount | account | engagement | description.`);
    const [amountRaw = '', account = '', engagement = '', description = ''] = parts;
    return {
      ordinal: index + 1,
      amountRaw,
      amount: null,
      account,
      engagement,
      description,
      resolvedAccount: null,
      resolvedEngagement: null,
    };
  });
  const exercises: ParsedExercise[] = entries(sections.get('exercise details')).map((line, index) => {
    const parts = splitFields(line, 3);
    if (parts.length !== 3) errors.push(`Invalid exercise row '${line}'; expected exercise | [sets] | notes.`);
    const [exercise = '', setsRaw = '', notes = ''] = parts;
    return { ordinal: index + 1, exercise, setsRaw, notes, sets: [], resolvedExercise: null };
  });
  const milestones: ParsedMilestone[] = entries(sections.get('milestones')).map((line) => {
    const parts = splitFields(line, 5);
    if (parts.length !== 5) {
      errors.push(`Invalid milestone row '${line}'; expected engagement | milestone | metric | value | owner session interval.`);
    }
    return {
      engagement: parts[0] ?? '', milestone: parts[1] ?? '', metric: parts[2] ?? '',
      value: parts[3] ?? '', sessionInterval: parts[4] ?? '',
      resolvedEngagement: null, sessionIndex: null,
    };
  });
  const stoicismLines = sections.get('stoicism') ?? '';
  const score = /^score:[ \t]*(.*?)\s*$/im.exec(stoicismLines)?.[1]?.trim() || null;
  const notes = /^notes:[ \t]*(.*?)\s*$/im.exec(stoicismLines)?.[1]?.trim() || null;
  const adminEvents: AdminEvent[] = entries(sections.get('admin events')).map((line) => {
    const parts = splitFields(line);
    return { command: parts[0] ?? '', args: parts.slice(1), raw: line };
  });
  return {
    metrics, sessions, transactions, exercises, milestones,
    stoicism: { score, notes }, adminEvents,
    mealInspection: inspectMeals(db, sourceText, thresholds),
  };
}

function applyAdminEvents(db: Database, parsed: ParsedDailyNote, noteDate: string, errors: string[]): void {
  for (const event of parsed.adminEvents) {
    const expected = ADMIN_ARGUMENTS[event.command];
    if (expected == null) {
      errors.push(`Unknown admin command '${event.command}'. Supported commands: ${Object.keys(ADMIN_ARGUMENTS).join(', ')}.`);
      continue;
    }
    if (!acceptsArgumentCount(expected, event.args.length)) {
      errors.push(`${event.command} expects ${argumentExpectation(expected)} arguments; received ${event.args.length}.`);
      continue;
    }
    try {
      const args = event.args;
      if (event.command === 'ENGAGEMENT_CREATE') {
        const [name, typeRaw, statusRaw, notes] = args;
        if (!name) throw new Error('ENGAGEMENT_CREATE name is empty.');
        if (resolveEntity(db, name, 'engagements')) throw new Error(`Engagement already exists: ${name}`);
        const type = resolveTaxonomy(db, 'engagement_types', typeRaw);
        const status = resolveTaxonomy(db, 'engagement_statuses', statusRaw);
        if (!type) throw new Error(`Unknown engagement type '${typeRaw}'. Supported: ${taxonomyCodes(db, 'engagement_types').join(', ')}.`);
        if (!status) throw new Error(`Unknown engagement status '${statusRaw}'. Supported: ${taxonomyCodes(db, 'engagement_statuses').join(', ')}.`);
        db.run('INSERT INTO engagements (name, type_id, status_id, notes, start_date) VALUES (?, ?, ?, ?, ?)', [name, type.id, status.id, notes, noteDate]);
      } else if (event.command === 'ENGAGEMENT_COMPLETE' || event.command === 'ENGAGEMENT_PAUSE') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        const code = event.command === 'ENGAGEMENT_COMPLETE' ? 'completed' : 'paused';
        const status = resolveTaxonomy(db, 'engagement_statuses', code);
        if (!status) throw new Error(`Database has no active '${code}' engagement status.`);
        db.run(
          event.command === 'ENGAGEMENT_COMPLETE'
            ? 'UPDATE engagements SET status_id = ?, completion_date = ? WHERE id = ?'
            : 'UPDATE engagements SET status_id = ? WHERE id = ?',
          event.command === 'ENGAGEMENT_COMPLETE'
            ? [status.id, noteDate, engagement.id]
            : [status.id, engagement.id],
        );
      } else if (event.command === 'ENGAGEMENT_RENAME') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        if (!args[1]) throw new Error('ENGAGEMENT_RENAME new name is empty.');
        db.run('UPDATE engagements SET name = ? WHERE id = ?', [args[1], engagement.id]);
      } else if (event.command === 'ENGAGEMENT_UPDATE') {
        const [raw, newName, typeRaw, statusRaw, startDate, targetDate, completionDate, notes, aliases] = args;
        const engagement = resolveEntity(db, raw, 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${raw}`);
        const type = resolveTaxonomy(db, 'engagement_types', typeRaw);
        const status = resolveTaxonomy(db, 'engagement_statuses', statusRaw);
        if (!type) throw new Error(`Unknown engagement type '${typeRaw}'.`);
        if (!status) throw new Error(`Unknown engagement status '${statusRaw}'.`);
        const finalName = newName || engagement.name;
        db.run(`UPDATE engagements SET name = ?, type_id = ?, status_id = ?, start_date = ?, target_date = ?, completion_date = ?, notes = ? WHERE id = ?`, [
          finalName, type.id, status.id, startDate || null, targetDate || null,
          completionDate || null, notes, engagement.id,
        ]);
        const updated = { id: engagement.id, name: finalName };
        for (const alias of parseAliases(aliases)) ensureAlias(db, 'engagements', updated, alias);
      } else if (event.command === 'ENGAGEMENT_ALIAS' || event.command === 'ENGAGEMENT_ALIAS_ADD') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        for (const alias of parseAliases(args[1])) ensureAlias(db, 'engagements', engagement, alias);
      } else if (event.command === 'ENGAGEMENT_ALIAS_REMOVE') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        removeAlias(db, 'engagements', engagement, args[1]);
      } else if (event.command === 'ENGAGEMENT_ALIAS_MOVE') {
        const destination = resolveEntity(db, args[1], 'engagements');
        if (!destination) throw new Error(`Unknown destination engagement: ${args[1]}`);
        moveAlias(db, 'engagements', args[0], destination);
      } else if (event.command === 'ENGAGEMENT_SET_STATUS') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        const status = resolveTaxonomy(db, 'engagement_statuses', args[1]);
        if (!status) throw new Error(`Unknown engagement status '${args[1]}'. Supported: ${taxonomyCodes(db, 'engagement_statuses').join(', ')}.`);
        db.run('UPDATE engagements SET status_id = ? WHERE id = ?', [status.id, engagement.id]);
      } else if (event.command === 'ENGAGEMENT_SET_DATES') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        const startDate = optionalIsoDate(args[1], 'Engagement start date');
        const targetDate = optionalIsoDate(args[2], 'Engagement target date');
        db.run('UPDATE engagements SET start_date = ?, target_date = ? WHERE id = ?', [startDate, targetDate, engagement.id]);
      } else if (event.command === 'ENGAGEMENT_SET_NOTES') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        db.run('UPDATE engagements SET notes = ? WHERE id = ?', [args[1] || null, engagement.id]);
      } else if (event.command === 'ENGAGEMENT_REOPEN') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        const status = resolveTaxonomy(db, 'engagement_statuses', 'active');
        if (!status) throw new Error("Database has no active 'active' engagement status.");
        db.run('UPDATE engagements SET status_id = ?, completion_date = NULL WHERE id = ?', [status.id, engagement.id]);
      } else if (event.command === 'EXERCISE_CREATE') {
        if (!args[0]) throw new Error('EXERCISE_CREATE name is empty.');
        if (resolveEntity(db, args[0], 'exercises')) throw new Error(`Exercise already exists: ${args[0]}`);
        db.run('INSERT INTO exercises (name, category) VALUES (?, ?)', [args[0], args[1] || null]);
      } else if (event.command === 'EXERCISE_UPDATE') {
        const [raw, newName, category, aliases] = args;
        const exercise = resolveEntity(db, raw, 'exercises');
        if (!exercise) throw new Error(`Unknown exercise: ${raw}`);
        const finalName = newName || exercise.name;
        db.run('UPDATE exercises SET name = ?, category = ? WHERE id = ?', [finalName, category || null, exercise.id]);
        const updated = { id: exercise.id, name: finalName };
        for (const alias of parseAliases(aliases)) ensureAlias(db, 'exercises', updated, alias);
      } else if (event.command === 'EXERCISE_RENAME') {
        const exercise = resolveEntity(db, args[0], 'exercises');
        if (!exercise) throw new Error(`Unknown exercise: ${args[0]}`);
        if (!args[1]) throw new Error('EXERCISE_RENAME new name is empty.');
        db.run('UPDATE exercises SET name = ? WHERE id = ?', [args[1], exercise.id]);
      } else if (event.command === 'EXERCISE_ALIAS' || event.command === 'EXERCISE_ALIAS_ADD') {
        const exercise = resolveEntity(db, args[0], 'exercises');
        if (!exercise) throw new Error(`Unknown exercise: ${args[0]}`);
        for (const alias of parseAliases(args[1])) ensureAlias(db, 'exercises', exercise, alias);
      } else if (event.command === 'EXERCISE_ALIAS_REMOVE') {
        const exercise = resolveEntity(db, args[0], 'exercises');
        if (!exercise) throw new Error(`Unknown exercise: ${args[0]}`);
        removeAlias(db, 'exercises', exercise, args[1]);
      } else if (event.command === 'EXERCISE_ALIAS_MOVE') {
        const destination = resolveEntity(db, args[1], 'exercises');
        if (!destination) throw new Error(`Unknown destination exercise: ${args[1]}`);
        moveAlias(db, 'exercises', args[0], destination);
      } else if (event.command === 'ACCOUNT_CREATE') {
        if (!args[0]) throw new Error('ACCOUNT_CREATE name is empty.');
        if (resolveEntity(db, args[0], 'accounts')) throw new Error(`Account already exists: ${args[0]}`);
        if (args.length === 3) {
          db.run('INSERT INTO accounts (name, type, address) VALUES (?, ?, ?)', args);
        } else {
          db.run('INSERT INTO accounts (name, type, currency, address) VALUES (?, ?, ?, ?)', [args[0], args[1] || null, args[2] || null, args[3] || null]);
        }
      } else if (event.command === 'ACCOUNT_ALIAS' || event.command === 'ACCOUNT_ALIAS_ADD') {
        const account = resolveEntity(db, args[0], 'accounts');
        if (!account) throw new Error(`Unknown account: ${args[0]}`);
        for (const alias of parseAliases(args[1])) ensureAlias(db, 'accounts', account, alias);
      } else if (event.command === 'ACCOUNT_ALIAS_REMOVE') {
        const account = resolveEntity(db, args[0], 'accounts');
        if (!account) throw new Error(`Unknown account: ${args[0]}`);
        removeAlias(db, 'accounts', account, args[1]);
      } else if (event.command === 'ACCOUNT_ALIAS_MOVE') {
        const destination = resolveEntity(db, args[1], 'accounts');
        if (!destination) throw new Error(`Unknown destination account: ${args[1]}`);
        moveAlias(db, 'accounts', args[0], destination);
      } else if (event.command === 'ACCOUNT_UPDATE') {
        const [raw, newName, type, aliases] = args;
        const account = resolveEntity(db, raw, 'accounts');
        if (!account) throw new Error(`Unknown account: ${raw}`);
        const finalName = newName || account.name;
        db.run('UPDATE accounts SET name = ?, type = ? WHERE id = ?', [finalName, type || null, account.id]);
        const updated = { id: account.id, name: finalName };
        for (const alias of parseAliases(aliases)) ensureAlias(db, 'accounts', updated, alias);
      } else if (event.command === 'ACCOUNT_RENAME') {
        const account = resolveEntity(db, args[0], 'accounts');
        if (!account) throw new Error(`Unknown account: ${args[0]}`);
        if (!args[1]) throw new Error('ACCOUNT_RENAME new name is empty.');
        db.run('UPDATE accounts SET name = ? WHERE id = ?', [args[1], account.id]);
      } else if (event.command === 'ACCOUNT_SET_TYPE') {
        const account = resolveEntity(db, args[0], 'accounts');
        if (!account) throw new Error(`Unknown account: ${args[0]}`);
        db.run('UPDATE accounts SET type = ? WHERE id = ?', [args[1] || null, account.id]);
      } else if (event.command === 'ACCOUNT_SET_CURRENCY') {
        const account = resolveEntity(db, args[0], 'accounts');
        if (!account) throw new Error(`Unknown account: ${args[0]}`);
        db.run('UPDATE accounts SET currency = ? WHERE id = ?', [args[1] || null, account.id]);
      } else if (event.command === 'ACCOUNT_SET_ADDRESS') {
        const account = resolveEntity(db, args[0], 'accounts');
        if (!account) throw new Error(`Unknown account: ${args[0]}`);
        db.run('UPDATE accounts SET address = ? WHERE id = ?', [args[1] || null, account.id]);
      } else if (event.command === 'FOOD_CREATE') {
        const [name, category, calories, protein, carbs, fat, salt, fiber, cholesterol, notes, aliases = ''] = args;
        assertFoodNameAvailable(db, name);
        db.run(`
          INSERT INTO foods (
            name, category, calories_kcal_per_100g, protein_g_per_100g,
            carbs_g_per_100g, fat_g_per_100g, salt_g_per_100g,
            fiber_g_per_100g, cholesterol_mg_per_100g, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          name.trim(), category || null,
          requiredNonNegativeNumber(calories, 'Food calories per 100 g'),
          requiredNonNegativeNumber(protein, 'Food protein per 100 g'),
          requiredNonNegativeNumber(carbs, 'Food carbs per 100 g'),
          requiredNonNegativeNumber(fat, 'Food fat per 100 g'),
          requiredNonNegativeNumber(salt, 'Food salt per 100 g'),
          optionalNonNegativeNumber(fiber, 'Food fiber per 100 g'),
          optionalNonNegativeNumber(cholesterol, 'Food cholesterol per 100 g'),
          notes || null,
        ]);
        const food = { id: lastInsertId(db), name: name.trim() };
        for (const alias of parseAliases(aliases)) {
          assertFoodAliasDoesNotShadowCanonicalName(db, alias);
          ensureAlias(db, 'foods', food, alias);
        }
      } else if (event.command === 'FOOD_UPDATE') {
        const [raw, category, calories, protein, carbs, fat, salt, fiber, cholesterol, notes] = args;
        const food = resolveEntity(db, raw, 'foods');
        if (!food) throw new Error(`Unknown food: ${raw}`);
        db.run(`
          UPDATE foods SET
            category = ?, calories_kcal_per_100g = ?, protein_g_per_100g = ?,
            carbs_g_per_100g = ?, fat_g_per_100g = ?, salt_g_per_100g = ?,
            fiber_g_per_100g = ?, cholesterol_mg_per_100g = ?, notes = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `, [
          category || null,
          requiredNonNegativeNumber(calories, 'Food calories per 100 g'),
          requiredNonNegativeNumber(protein, 'Food protein per 100 g'),
          requiredNonNegativeNumber(carbs, 'Food carbs per 100 g'),
          requiredNonNegativeNumber(fat, 'Food fat per 100 g'),
          requiredNonNegativeNumber(salt, 'Food salt per 100 g'),
          optionalNonNegativeNumber(fiber, 'Food fiber per 100 g'),
          optionalNonNegativeNumber(cholesterol, 'Food cholesterol per 100 g'),
          notes || null,
          food.id,
        ]);
      } else if (event.command === 'FOOD_RENAME') {
        const food = resolveEntity(db, args[0], 'foods');
        if (!food) throw new Error(`Unknown food: ${args[0]}`);
        assertFoodNameAvailable(db, args[1], food.id);
        db.run('UPDATE foods SET name = ?, updated_at = datetime(\'now\') WHERE id = ?', [args[1].trim(), food.id]);
      } else if (event.command === 'FOOD_DELETE') {
        const food = resolveEntity(db, args[0], 'foods');
        if (!food) throw new Error(`Unknown food: ${args[0]}`);
        db.run('DELETE FROM foods WHERE id = ?', [food.id]);
      } else if (event.command === 'FOOD_ALIAS_ADD') {
        const food = resolveEntity(db, args[0], 'foods');
        if (!food) throw new Error(`Unknown food: ${args[0]}`);
        for (const alias of parseAliases(args[1])) {
          assertFoodAliasDoesNotShadowCanonicalName(db, alias);
          ensureAlias(db, 'foods', food, alias);
        }
      } else if (event.command === 'FOOD_ALIAS_REMOVE') {
        const food = resolveEntity(db, args[0], 'foods');
        if (!food) throw new Error(`Unknown food: ${args[0]}`);
        for (const alias of parseAliases(args[1])) removeAlias(db, 'foods', food, alias);
      } else if (event.command === 'FOOD_ALIAS_MOVE') {
        const destination = resolveEntity(db, args[1], 'foods');
        if (!destination) throw new Error(`Unknown destination food: ${args[1]}`);
        for (const alias of parseAliases(args[0])) moveAlias(db, 'foods', alias, destination);
      }
    } catch (error) {
      errors.push(`${event.command}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function validateFacts(db: Database, parsed: ParsedDailyNote, errors: string[], warnings: string[]): void {
  for (const metric of ['mood', 'energy', 'stress']) {
    const value = parsed.metrics[metric];
    if (value != null && (typeof value !== 'number' || value < -2 || value > 2)) {
      errors.push(`${metric} must be between -2 and 2.`);
    }
  }
  for (const metric of ['weight_kg', 'sleep_hours', 'calories', 'protein_g']) {
    const value = parsed.metrics[metric];
    if (value != null && (typeof value !== 'number' || value < 0)) errors.push(`${metric} cannot be negative.`);
  }
  const intervals: Array<{ start: string; end: string; ordinal: number }> = [];
  for (const session of parsed.sessions) {
    session.parsedInterval = parseSessionInterval(session.interval);
    if (!session.parsedInterval) errors.push(`Session #${session.ordinal} has an invalid interval '${session.interval}'.`);
    else intervals.push({ start: session.parsedInterval.start, end: session.parsedInterval.end, ordinal: session.ordinal });
    session.sessionType = resolveTaxonomy(db, 'session_types', session.type);
    if (!session.type) errors.push(`Session #${session.ordinal} has an empty type.`);
    else if (!session.sessionType) errors.push(`Unknown session type '${session.type}'. Supported: ${taxonomyCodes(db, 'session_types').join(', ')}.`);
    session.resolvedEngagement = resolveEntity(db, session.engagement, 'engagements');
    if (!session.engagement) errors.push(`Session #${session.ordinal} has an empty engagement.`);
    else if (!session.resolvedEngagement) errors.push(`Unknown engagement in session #${session.ordinal}: '${session.engagement}'.`);
  }
  intervals.sort((left, right) => left.start.localeCompare(right.start));
  for (let index = 1; index < intervals.length; index += 1) {
    if (intervals[index].start < intervals[index - 1].end) {
      warnings.push(`Overlapping sessions #${intervals[index - 1].ordinal} and #${intervals[index].ordinal} (allowed).`);
    }
  }
  for (const transaction of parsed.transactions) {
    transaction.amount = optionalNumber(transaction.amountRaw, `Transaction #${transaction.ordinal} amount`, errors);
    transaction.resolvedAccount = resolveEntity(db, transaction.account, 'accounts');
    if (!transaction.account) errors.push(`Transaction #${transaction.ordinal} account is empty.`);
    else if (!transaction.resolvedAccount) errors.push(`Unknown account in transaction #${transaction.ordinal}: '${transaction.account}'.`);
    transaction.resolvedEngagement = resolveEntity(db, transaction.engagement, 'engagements');
    if (!transaction.engagement) {
      errors.push(`Transaction #${transaction.ordinal} engagement is empty; provide an engagement name or alias.`);
    } else if (!transaction.resolvedEngagement) {
      errors.push(`Unknown engagement in transaction #${transaction.ordinal}: '${transaction.engagement}'.`);
    }
  }
  const exerciseSessions = parsed.sessions.filter((session) => session.sessionType?.code === 'exercise');
  if (parsed.exercises.length > 0 && exerciseSessions.length !== 1) {
    errors.push(`Exercise details require exactly one exercise session; found ${exerciseSessions.length}.`);
  }
  for (const exercise of parsed.exercises) {
    exercise.resolvedExercise = resolveEntity(db, exercise.exercise, 'exercises');
    if (!exercise.resolvedExercise) errors.push(`Unknown exercise: '${exercise.exercise}'.`);
    try {
      exercise.sets = parseExerciseSets(exercise.setsRaw);
    } catch (error) {
      errors.push(`Exercise '${exercise.exercise}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const milestone of parsed.milestones) {
    milestone.resolvedEngagement = resolveEntity(db, milestone.engagement, 'engagements');
    if (!milestone.resolvedEngagement) {
      errors.push(`Unknown engagement in milestone '${milestone.milestone}': '${milestone.engagement}'.`);
      continue;
    }
    if (!milestone.sessionInterval) {
      errors.push(`Milestone '${milestone.milestone}' requires an owner session interval.`);
      continue;
    }
    const target = parseSessionInterval(milestone.sessionInterval);
    if (!target) {
      errors.push(`Milestone '${milestone.milestone}' has invalid session interval '${milestone.sessionInterval}'.`);
      continue;
    }
    const matches = parsed.sessions.map((session, index) => ({ session, index })).filter(({ session }) => (
      session.resolvedEngagement?.id === milestone.resolvedEngagement?.id
      && session.parsedInterval?.start === target.start
      && session.parsedInterval?.end === target.end
    ));
    if (matches.length !== 1) {
      errors.push(`Milestone '${milestone.milestone}' must reference exactly one same-engagement session at '${milestone.sessionInterval}'; found ${matches.length}.`);
    } else milestone.sessionIndex = matches[0].index;
  }
  errors.push(...parsed.mealInspection.errors);
  warnings.push(...parsed.mealInspection.warnings);
}

function inspectionFor(
  input: NativeDailyNoteInput,
  parsed: ParsedDailyNote,
  imported: boolean,
  errors: string[],
  warnings: string[],
): NativeDailyInspection {
  const missing = METRIC_FIELDS.filter((field) => parsed.metrics[field] == null || parsed.metrics[field] === '');
  return {
    date: input.noteDate,
    filename: input.fileName,
    file_path: input.filePath,
    imported,
    ready: errors.length === 0 && !imported,
    errors,
    warnings,
    completeness: {
      missing_daily_metrics: missing,
      session_count: parsed.sessions.length,
      transaction_count: parsed.transactions.length,
      exercise_count: parsed.exercises.length,
      meal_count: parsed.mealInspection.foodRowCount,
      milestone_count: parsed.milestones.length,
      admin_event_count: parsed.adminEvents.length,
    },
    preview: {
      daily_metrics: Object.fromEntries(METRIC_FIELDS.map((field) => [field, parsed.metrics[field] ?? null])),
      meals: parsed.mealInspection.meals.flatMap((meal) => meal.items.map((item) => ({
        food: item.food, calories: item.caloriesKcal, protein_g: item.proteinG,
      }))),
      sessions: parsed.sessions.map((session) => ({
        ordinal: session.ordinal,
        interval: session.interval,
        start_time: session.parsedInterval?.start ?? null,
        end_time: session.parsedInterval?.end ?? null,
        duration_minutes: session.parsedInterval?.durationMinutes ?? null,
        session_type: session.sessionType?.code ?? session.type,
        engagement: session.resolvedEngagement?.name ?? session.engagement,
        notes: session.notes || null,
      })),
      transactions: parsed.transactions.map((transaction) => ({
        ordinal: transaction.ordinal,
        amount: transaction.amount ?? transaction.amountRaw,
        account: transaction.resolvedAccount?.name ?? transaction.account,
        engagement: transaction.resolvedEngagement?.name ?? transaction.engagement,
        engagement_raw: transaction.engagement,
        engagement_id: transaction.resolvedEngagement?.id ?? null,
        description: transaction.description,
      })),
      exercises: parsed.exercises.map((exercise) => ({
        ordinal: exercise.ordinal,
        exercise: exercise.resolvedExercise?.name ?? exercise.exercise,
        sets: exercise.sets.map((set, index) => ({ set_number: index + 1, ...set })),
        notes: exercise.notes || null,
      })),
    },
    mealInspection: parsed.mealInspection,
  };
}

function prepareDaily(db: Database, input: NativeDailyNoteInput): PreparedDailyNote {
  assertSchemaV1(db);
  requireIsoDate(input.noteDate, 'Note date');
  requireIsoDate(input.todayDate, 'Today date');
  const errors: string[] = [];
  const warnings: string[] = [];
  let parsed: ParsedDailyNote;
  try {
    parsed = parseDaily(db, input.sourceText, input.nutritionThresholds, errors);
  } catch (error) {
    const mealInspection = inspectMeals(db, input.sourceText, input.nutritionThresholds);
    parsed = {
      metrics: {}, sessions: [], transactions: [], exercises: [], milestones: [],
      stoicism: { score: null, notes: null }, adminEvents: [], mealInspection,
    };
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const imported = queryRows(db, 'SELECT 1 AS found FROM imported_notes WHERE note_date = ? LIMIT 1', [input.noteDate]).length > 0;
  if (imported) errors.push(`${input.noteDate} is already represented by a canonical imported note.`);
  if (errors.length === 0) applyAdminEvents(db, parsed, input.noteDate, errors);
  if (errors.length === 0) {
    parsed.mealInspection = inspectMeals(db, input.sourceText, input.nutritionThresholds);
    errors.push(...parsed.mealInspection.errors);
    warnings.push(...parsed.mealInspection.warnings);
  }
  if (errors.length === 0) validateFacts(db, parsed, errors, warnings);
  if (errors.length === 0) {
    const existingMeals = queryMealComponentState(db, input.noteDate);
    if (existingMeals?.lifecycleState === 'finalized'
      && !mealComponentMatchesInspection(db, input.noteDate, parsed.mealInspection)) {
      errors.push(`Historical Meals for ${input.noteDate} differ from the finalized meal component and cannot be replaced.`);
    }
  }
  return { parsed, inspection: inspectionFor(input, parsed, imported, errors, warnings) };
}

export function inspectDailyNote(db: Database, input: NativeDailyNoteInput): NativeDailyInspection {
  return prepareDaily(db, input).inspection;
}

function insertComponent(
  db: Database,
  input: NativeDailyNoteInput,
  component: string,
  rowCount: number,
): void {
  db.run(`
    INSERT INTO note_import_components (
      note_date, component, lifecycle_state, source_file_path, source_checksum,
      plugin_version, row_count, imported_at, updated_at
    ) VALUES (?, ?, 'finalized', ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(note_date, component) DO UPDATE SET
      lifecycle_state = 'finalized', source_file_path = excluded.source_file_path,
      source_checksum = excluded.source_checksum, plugin_version = excluded.plugin_version,
      row_count = excluded.row_count, updated_at = datetime('now')
  `, [input.noteDate, component, input.filePath, input.sourceChecksum, input.pluginVersion, rowCount]);
}

export function writeHistoricalDailyNote(db: Database, input: NativeDailyNoteInput): NativeDailyImportResult {
  if (input.noteDate >= input.todayDate) throw new Error('Canonical Daily Note import is historical-only. Use planning sync for today and future notes.');
  const prepared = prepareDaily(db, input);
  if (!prepared.inspection.ready) throw new Error(prepared.inspection.errors.join('\n\n'));
  const parsed = prepared.parsed;

  const existingMeals = queryMealComponentState(db, input.noteDate);
  if (existingMeals?.lifecycleState === 'finalized'
    && !mealComponentMatchesInspection(db, input.noteDate, parsed.mealInspection)) {
    throw new Error(`Historical Meals for ${input.noteDate} differ from the finalized meal component and cannot be replaced.`);
  }
  if (!existingMeals || existingMeals.lifecycleState === 'ephemeral') {
    db.run('DELETE FROM daily_meals WHERE day = ? AND meal_event_id IS NULL', [input.noteDate]);
    writeMealInspection(db, {
      noteDate: input.noteDate,
      todayDate: input.todayDate,
      sourceFilePath: input.filePath,
      sourceChecksum: input.sourceChecksum,
      pluginVersion: input.pluginVersion,
      inspection: parsed.mealInspection,
    });
  } else {
    insertComponent(db, input, 'meals', parsed.mealInspection.foodRowCount);
  }

  const metrics = parsed.metrics;
  db.run(`
    INSERT OR REPLACE INTO daily_metrics (
      date, mood, energy, stress, weight_kg, sleep_hours, calories, protein_g,
      fasted, dieted, studied, worked, exercised, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.noteDate, metrics.mood, metrics.energy, metrics.stress,
    metrics.weight_kg, metrics.sleep_hours,
    parsed.mealInspection.nutrition.dailyCaloriesKcal,
    metrics.protein_g,
    metrics.fasted ?? 0,
    parsed.mealInspection.nutrition.evaluatedDieted ?? metrics.dieted ?? 0,
    metrics.studied ?? 0, metrics.worked ?? 0, metrics.exercised ?? 0,
    typeof metrics.notes === 'string' ? metrics.notes : null,
  ] as SqlValue[]);

  if (parsed.stoicism.score || parsed.stoicism.notes) {
    db.run('INSERT INTO stoicism_entries (date, score, notes) VALUES (?, ?, ?)', [
      input.noteDate, parsed.stoicism.score ? Number(parsed.stoicism.score) : null, parsed.stoicism.notes,
    ]);
  }

  const sessionIds: number[] = [];
  for (const session of parsed.sessions) {
    db.run(`INSERT INTO sessions (
      engagement_id, date, start_time, end_time, duration_minutes, session_type_id, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      session.resolvedEngagement!.id, input.noteDate,
      session.parsedInterval!.start, session.parsedInterval!.end,
      session.parsedInterval!.durationMinutes, session.sessionType!.id, session.notes || null,
    ]);
    sessionIds.push(lastInsertId(db));
  }

  for (const transaction of parsed.transactions) {
    db.run('INSERT INTO transactions (account_id, date, amount, category, description) VALUES (?, ?, ?, ?, ?)', [
      transaction.resolvedAccount!.id, input.noteDate, transaction.amount!,
      transaction.resolvedEngagement!.id, transaction.description || null,
    ]);
  }

  const exerciseSessionIndex = parsed.sessions.findIndex((session) => session.sessionType?.code === 'exercise');
  let exerciseSetCount = 0;
  for (const exercise of parsed.exercises) {
    db.run('INSERT INTO session_exercises (session_id, exercise_id, order_index) VALUES (?, ?, ?)', [
      sessionIds[exerciseSessionIndex], exercise.resolvedExercise!.id, exercise.ordinal,
    ]);
    const sessionExerciseId = lastInsertId(db);
    exercise.sets.forEach((set, index) => {
      db.run(`INSERT INTO exercise_sets (
        session_exercise_id, set_number, weight, reps, distance,
        duration_minutes, pain_level, duration_seconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        sessionExerciseId, index + 1, set.weight, set.reps, set.distance,
        set.duration_minutes, set.pain_level, set.duration_seconds,
      ]);
      exerciseSetCount += 1;
    });
  }

  for (const milestone of parsed.milestones) {
    const sessionId = sessionIds[milestone.sessionIndex!];
    const rows = queryRows(db, `SELECT id, date, session_id FROM engagement_milestones
      WHERE engagement_id = ? AND name = ? COLLATE NOCASE`, [milestone.resolvedEngagement!.id, milestone.milestone]);
    if (rows.length > 1) throw new Error(`Milestone '${milestone.milestone}' is duplicated in the database.`);
    let milestoneId: number;
    if (rows[0]) {
      milestoneId = Number(rows[0].id);
      if (rows[0].session_id != null && Number(rows[0].session_id) !== sessionId) {
        throw new Error(`Milestone '${milestone.milestone}' is already linked to another session.`);
      }
      if (rows[0].session_id == null) {
        db.run('UPDATE engagement_milestones SET session_id = ?, date = COALESCE(date, ?) WHERE id = ?', [sessionId, input.noteDate, milestoneId]);
      }
    } else {
      db.run('INSERT INTO engagement_milestones (engagement_id, name, date, session_id) VALUES (?, ?, ?, ?)', [
        milestone.resolvedEngagement!.id, milestone.milestone, input.noteDate, sessionId,
      ]);
      milestoneId = lastInsertId(db);
    }
    db.run(`INSERT INTO engagement_measurements (
      milestone_id, metric_name, metric_value, measurement_date
    ) VALUES (?, ?, ?, ?)`, [milestoneId, milestone.metric, milestone.value, input.noteDate]);
  }

  db.run(`INSERT INTO imported_notes (
    note_date, file_name, file_path, checksum
  ) VALUES (?, ?, ?, ?)`, [input.noteDate, input.fileName, input.filePath, input.sourceChecksum]);
  db.run(`
    INSERT INTO note_sources (
      note_date, file_name, file_path, content_checksum, lifecycle_state,
      parse_status, last_error, last_scanned_at, last_import_attempt_at, finalized_at
    ) VALUES (?, ?, ?, ?, 'finalized', 'ok', NULL, datetime('now'), datetime('now'), datetime('now'))
    ON CONFLICT(note_date) DO UPDATE SET
      file_name = excluded.file_name, file_path = excluded.file_path,
      content_checksum = excluded.content_checksum, lifecycle_state = 'finalized',
      parse_status = 'ok', last_error = NULL, last_scanned_at = datetime('now'),
      last_import_attempt_at = datetime('now'), finalized_at = datetime('now')
  `, [input.noteDate, input.fileName, input.filePath, input.sourceChecksum]);
  const source = queryRows(db, 'SELECT id FROM note_sources WHERE note_date = ?', [input.noteDate])[0];
  if (source) db.run('DELETE FROM planned_sessions WHERE source_note_id = ?', [Number(source.id)]);

  const rowCount = 1 + parsed.sessions.length + parsed.transactions.length + parsed.exercises.length
    + exerciseSetCount + parsed.milestones.length * 2 + parsed.mealInspection.foodRowCount;
  insertComponent(db, input, 'full_note', rowCount);
  insertComponent(db, input, 'daily_metrics', 1);
  insertComponent(db, input, 'sessions', parsed.sessions.length);
  insertComponent(db, input, 'transactions', parsed.transactions.length);
  insertComponent(db, input, 'exercises', parsed.exercises.length + exerciseSetCount);
  insertComponent(db, input, 'milestones', parsed.milestones.length * 2);

  return {
    noteDate: input.noteDate,
    sessionCount: parsed.sessions.length,
    transactionCount: parsed.transactions.length,
    exerciseCount: parsed.exercises.length,
    exerciseSetCount,
    milestoneCount: parsed.milestones.length,
    foodRowCount: parsed.mealInspection.foodRowCount,
    adminEventCount: parsed.adminEvents.length,
    rowCount,
  };
}

export interface MilestoneReconciliationResult {
  milestoneCount: number;
  createdMilestones: number;
  linkedMilestones: number;
  createdMeasurements: number;
}

export function reconcileImportedMilestones(
  db: Database,
  input: NativeDailyNoteInput,
): MilestoneReconciliationResult {
  assertSchemaV1(db);
  if (queryRows(db, 'SELECT id FROM imported_notes WHERE note_date = ?', [input.noteDate]).length !== 1) {
    throw new Error(`${input.noteDate} must be represented by exactly one imported note before milestone reconciliation.`);
  }
  const errors: string[] = [];
  const parsed = parseDaily(db, input.sourceText, input.nutritionThresholds, errors);
  if (errors.length > 0) throw new Error(errors.join('\n\n'));
  let createdMilestones = 0;
  let linkedMilestones = 0;
  let createdMeasurements = 0;
  for (const milestone of parsed.milestones) {
    const engagement = resolveEntity(db, milestone.engagement, 'engagements');
    if (!engagement) throw new Error(`Unknown engagement in milestone '${milestone.milestone}': '${milestone.engagement}'.`);
    if (!milestone.sessionInterval) throw new Error(`Milestone '${milestone.milestone}' requires an owner session interval.`);
    const interval = parseSessionInterval(milestone.sessionInterval);
    if (!interval) throw new Error(`Invalid milestone session interval '${milestone.sessionInterval}'.`);
    const sessions = queryRows(db, `SELECT id FROM sessions WHERE date = ? AND engagement_id = ?
      AND start_time = ? AND end_time = ?`, [input.noteDate, engagement.id, interval.start, interval.end]);
    if (sessions.length !== 1) throw new Error(`Milestone '${milestone.milestone}' must match exactly one imported session; found ${sessions.length}.`);
    const sessionId = Number(sessions[0].id);
    const rows = queryRows(db, `SELECT id, date, session_id FROM engagement_milestones
      WHERE engagement_id = ? AND name = ? COLLATE NOCASE`, [engagement.id, milestone.milestone]);
    if (rows.length > 1) throw new Error(`Milestone '${milestone.milestone}' is duplicated in the database.`);
    let milestoneId: number;
    if (!rows[0]) {
      db.run('INSERT INTO engagement_milestones (engagement_id, name, date, session_id) VALUES (?, ?, ?, ?)', [
        engagement.id, milestone.milestone, input.noteDate, sessionId,
      ]);
      milestoneId = lastInsertId(db);
      createdMilestones += 1;
      linkedMilestones += 1;
    } else {
      milestoneId = Number(rows[0].id);
      if (rows[0].date != null && String(rows[0].date) !== input.noteDate) {
        throw new Error(`Milestone '${milestone.milestone}' already belongs to ${String(rows[0].date)}.`);
      }
      if (rows[0].session_id != null && Number(rows[0].session_id) !== sessionId) {
        throw new Error(`Milestone '${milestone.milestone}' is already linked to another session.`);
      }
      if (rows[0].session_id == null) {
        db.run('UPDATE engagement_milestones SET session_id = ?, date = COALESCE(date, ?) WHERE id = ?', [sessionId, input.noteDate, milestoneId]);
        linkedMilestones += 1;
      }
    }
    const exists = queryRows(db, `SELECT 1 AS found FROM engagement_measurements
      WHERE milestone_id = ? AND metric_name = ? COLLATE NOCASE
        AND metric_value = ? AND measurement_date = ? LIMIT 1`, [
      milestoneId, milestone.metric, milestone.value, input.noteDate,
    ]).length > 0;
    if (!exists) {
      db.run('INSERT INTO engagement_measurements (milestone_id, metric_name, metric_value, measurement_date) VALUES (?, ?, ?, ?)', [
        milestoneId, milestone.metric, milestone.value, input.noteDate,
      ]);
      createdMeasurements += 1;
    }
  }
  return { milestoneCount: parsed.milestones.length, createdMilestones, linkedMilestones, createdMeasurements };
}
