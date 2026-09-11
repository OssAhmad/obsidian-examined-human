import { App, Notice } from 'obsidian';
import type { DailyAssessmentQueryResult, DailyMealRecord, DailyMetricsRecord } from './read-models/daily.ts';
import type {
  DashboardCompleteness,
  DashboardPreviewExercise,
  DashboardPreviewTransaction,
  DailyInspection,
} from './logger/daily-note.ts';
import type { CalendarEvent, ExerciseSetDetails } from './events.ts';
import { formatExerciseNumber, parseDatabaseTime, titleForEngagement } from './events.ts';
import { layoutOverlappingEvents } from './overlap.ts';
import { layoutVisualStack } from './visual-stack.ts';
import { createSessionElement } from './session-element.ts';
import { unresolvedReferencesFromErrors, type UnresolvedReference } from './unresolved-references.ts';

const DAY_PX_PER_MINUTE = 0.8;

export interface DailyReportExercise {
  name: string;
  category: string | null;
  sets: ExerciseSetDetails[];
  notes: string | null;
}

export interface DailyAssessmentReport {
  date: string;
  imported: boolean;
  ready: boolean;
  errors: string[];
  warnings: string[];
  completeness: DashboardCompleteness | null;
  metrics: DailyMetricsRecord | null;
  events: CalendarEvent[];
  foods: DailyMealRecord[];
  transactions: Array<{
    id: number;
    accountName: string;
    amount: number;
    engagement: string;
    description: string;
    currency: string;
    valuationAmount: number | null;
  }>;
  exercises: DailyReportExercise[];
}

export interface DailyAssessmentReportRenderOptions {
  sessionColors: Record<string, string>;
  initialScrollHour: number;
  valuationLabel: string;
  onResolveReference?: (reference: UnresolvedReference) => void;
}

function numberFromRecord(record: Record<string, string | number | null>, key: string): number | null {
  const value = record[key];
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metricsFromInspection(inspection: DailyInspection): DailyMetricsRecord {
  const metrics = inspection.preview.daily_metrics;
  return {
    mood: numberFromRecord(metrics, 'mood'),
    energy: numberFromRecord(metrics, 'energy'),
    stress: numberFromRecord(metrics, 'stress'),
    weightKg: numberFromRecord(metrics, 'weight_kg'),
    sleepHours: numberFromRecord(metrics, 'sleep_hours'),
    calories: numberFromRecord(metrics, 'calories'),
    proteinG: numberFromRecord(metrics, 'protein_g'),
    fasted: numberFromRecord(metrics, 'fasted'),
    dieted: numberFromRecord(metrics, 'dieted'),
    studied: numberFromRecord(metrics, 'studied'),
    worked: numberFromRecord(metrics, 'worked'),
    exercised: numberFromRecord(metrics, 'exercised'),
    notes: typeof metrics.notes === 'string' ? metrics.notes : null,
  };
}

function inspectionEvents(inspection: DailyInspection): CalendarEvent[] {
  return inspection.preview.sessions.flatMap((session) => {
    const start = parseDatabaseTime(session.start_time ?? '');
    const end = parseDatabaseTime(session.end_time ?? '');
    if (start == null || end == null || end <= start) return [];
    return [{
      id: `inspection:${session.ordinal}`,
      date: inspection.date,
      sessionType: session.session_type,
      engagementName: session.engagement,
      engagementType: session.engagement_type,
      title: titleForEngagement(session.engagement),
      kind: 'timed' as const,
      startMinutes: start,
      endMinutes: end,
      durationMinutes: session.duration_minutes ?? end - start,
      notes: session.notes,
      sourceKind: 'planned' as const,
      planningSource: 'daily-note' as const,
    }];
  });
}

function previewExercises(exercises: DashboardPreviewExercise[]): DailyReportExercise[] {
  return exercises.map((exercise) => ({
    name: exercise.exercise,
    category: null,
    sets: exercise.sets.map((set, index) => ({
      setNumber: set.set_number ?? index + 1,
      weight: set.weight ?? null,
      reps: set.reps ?? null,
      distance: set.distance ?? null,
      durationMinutes: set.duration_minutes ?? null,
      notes: set.notes ?? null,
    })),
    notes: exercise.notes,
  }));
}

function previewTransactions(transactions: DashboardPreviewTransaction[]): DailyAssessmentReport['transactions'] {
  return transactions.flatMap((transaction) => {
    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount)) return [];
    return [{
      id: transaction.ordinal,
      accountName: transaction.account,
      amount,
      engagement: transaction.engagement,
      description: transaction.description,
      currency: transaction.currency,
      valuationAmount: transaction.valuation_amount,
    }];
  });
}

export function reportFromInspection(inspection: DailyInspection): DailyAssessmentReport {
  return {
    date: inspection.date,
    imported: inspection.imported,
    ready: inspection.ready,
    errors: [...inspection.errors],
    warnings: [...inspection.warnings],
    completeness: inspection.completeness,
    metrics: metricsFromInspection(inspection),
    events: inspectionEvents(inspection),
    foods: inspection.preview.meals.map((food, index) => ({
      id: index + 1,
      mealType: food.meal_type,
      food: food.food,
      amountG: food.amount_g,
      calories: food.calories,
      proteinG: food.protein_g,
      carbsG: food.carbs_g,
      fatG: food.fat_g,
      saltG: food.salt_g,
      fiberG: food.fiber_g,
      cholesterolMg: food.cholesterol_mg,
    })),
    transactions: previewTransactions(inspection.preview.transactions),
    exercises: previewExercises(inspection.preview.exercises),
  };
}

export function reportFromAssessment(date: string, assessment: DailyAssessmentQueryResult): DailyAssessmentReport {
  const exercises: DailyReportExercise[] = [];
  for (const event of assessment.sessionResult.events) {
    for (const exercise of event.exerciseDetails ?? []) {
      exercises.push({ name: exercise.name, category: exercise.category, sets: exercise.sets, notes: null });
    }
  }
  return {
    date,
    imported: assessment.imported,
    ready: false,
    errors: [],
    warnings: assessment.sessionResult.issues.map((issue) => issue.message),
    completeness: null,
    metrics: assessment.metrics,
    events: assessment.sessionResult.events,
    foods: assessment.meals,
    transactions: assessment.transactions,
    exercises,
  };
}

export function dailyAssessmentTitle(date: string, todayDate: string): string {
  if (date === todayDate) return 'Daily assessment so far';
  if (date > todayDate) return 'Future date assessment';
  return 'Daily assessment';
}

function decimal(value: number | null): string {
  return value == null ? '—' : value.toFixed(2);
}

function flag(value: number | null): string {
  return value == null ? '—' : Number(value) === 1 ? 'Yes' : 'No';
}

function duration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function renderMessages(container: HTMLElement, label: string, messages: string[], className: string): void {
  if (messages.length === 0) return;
  const callout = container.createDiv({ cls: `examined-human-daily-validation-callout ${className}` });
  callout.createEl('strong', { text: label });
  const list = callout.createEl('ul');
  for (const message of messages) list.createEl('li', { text: message });
}

function renderBlockers(
  container: HTMLElement,
  report: DailyAssessmentReport,
  options: DailyAssessmentReportRenderOptions,
): void {
  const section = container.createEl('section', { cls: 'examined-human-daily-validation' });
  const heading = section.createDiv({ cls: 'examined-human-daily-section-heading' });
  heading.createEl('h3', { text: 'Assessment needs attention' });
  heading.createSpan({ cls: 'examined-human-daily-status-badge is-blocked', text: 'Import blocked' });
  section.createDiv({
    cls: 'examined-human-daily-validation-note',
    text: 'The report is hidden until its hard errors are resolved. No database write has occurred.',
  });
  const references = unresolvedReferencesFromErrors(report.errors);
  if (references.length > 0) {
    const panel = section.createDiv({ cls: 'examined-human-unresolved-references' });
    panel.createEl('h4', { text: 'Resolve references' });
    for (const reference of references) {
      const row = panel.createDiv({ cls: 'examined-human-unresolved-item' });
      const text = row.createDiv();
      text.createEl('strong', { text: reference.rawName });
      text.createDiv({ cls: 'examined-human-unresolved-meta', text: `${reference.kind} · ${reference.contexts.join(', ')}` });
      if (options.onResolveReference) {
        row.createEl('button', { text: 'Resolve…' }).addEventListener('click', () => options.onResolveReference?.(reference));
      }
    }
  }
  renderMessages(section, 'Validation errors', report.errors, 'is-error');
  const copy = section.createEl('button', { text: 'Copy errors', cls: 'examined-human-toolbar-button' });
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(report.errors.join('\n\n')).then(() => new Notice('Copied validation errors.'));
  });
}

function renderMetrics(container: HTMLElement, metrics: DailyMetricsRecord | null): void {
  const section = container.createEl('section', { cls: 'examined-human-daily-panel' });
  section.createEl('h3', { text: 'Daily metrics' });
  const grid = section.createDiv({ cls: 'examined-human-daily-metrics-grid' });
  const definitions: Array<[string, string]> = [
    ['Mood', metrics?.mood == null ? '—' : String(metrics.mood)],
    ['Energy', metrics?.energy == null ? '—' : String(metrics.energy)],
    ['Stress', metrics?.stress == null ? '—' : String(metrics.stress)],
    ['Weight', metrics?.weightKg == null ? '—' : `${metrics.weightKg} kg`],
    ['Sleep', metrics?.sleepHours == null ? '—' : `${decimal(metrics.sleepHours)} h`],
    ['Calories', metrics?.calories == null ? '—' : `${decimal(metrics.calories)} kcal`],
    ['Protein', metrics?.proteinG == null ? '—' : `${decimal(metrics.proteinG)} g`],
    ['Fasted', flag(metrics?.fasted ?? null)],
    ['Dieted', flag(metrics?.dieted ?? null)],
    ['Studied', flag(metrics?.studied ?? null)],
    ['Worked', flag(metrics?.worked ?? null)],
    ['Exercised', flag(metrics?.exercised ?? null)],
  ];
  for (const [label, value] of definitions) {
    const card = grid.createDiv({ cls: `examined-human-daily-metric-card ${value === '—' ? 'is-empty' : ''}` });
    card.createDiv({ cls: 'examined-human-weekly-eyebrow', text: label });
    card.createDiv({ cls: 'examined-human-daily-metric-value', text: value });
  }
}

function renderTimeline(
  app: App,
  container: HTMLElement,
  events: CalendarEvent[],
  options: DailyAssessmentReportRenderOptions,
): void {
  const section = container.createEl('section', { cls: 'examined-human-daily-panel' });
  const heading = section.createDiv({ cls: 'examined-human-daily-section-heading' });
  heading.createEl('h3', { text: 'Day timeline' });
  heading.createSpan({ text: `${events.length} session${events.length === 1 ? '' : 's'}`, cls: 'examined-human-daily-section-meta' });
  if (events.length === 0) {
    section.createDiv({ cls: 'examined-human-daily-empty-inline', text: 'No sessions are available for this date.' });
    return;
  }
  const scroll = section.createDiv({ cls: 'examined-human-daily-timeline-scroll' });
  const grid = scroll.createDiv({ cls: 'examined-human-daily-timeline-grid' });
  grid.style.height = `${1440 * DAY_PX_PER_MINUTE}px`;
  grid.style.setProperty('--examined-human-px-per-minute', `${DAY_PX_PER_MINUTE}px`);
  const gutter = grid.createDiv({ cls: 'examined-human-daily-time-gutter' });
  const column = grid.createDiv({ cls: 'examined-human-day-column examined-human-daily-session-column' });
  column.style.backgroundSize = `100% ${60 * DAY_PX_PER_MINUTE}px, 100% ${30 * DAY_PX_PER_MINUTE}px`;
  for (let hour = 0; hour < 24; hour += 1) {
    const label = gutter.createDiv({ cls: 'examined-human-hour-label', text: `${String(hour).padStart(2, '0')}:00` });
    label.style.top = `${hour * 60 * DAY_PX_PER_MINUTE}px`;
  }
  const visualPositions = layoutVisualStack(events, DAY_PX_PER_MINUTE);
  for (const positioned of layoutOverlappingEvents(events)) {
    const vertical = visualPositions.get(positioned.event.id) ?? {
      startMinutes: positioned.event.startMinutes,
      durationMinutes: positioned.event.endMinutes - positioned.event.startMinutes,
      stacked: false,
    };
    column.appendChild(createSessionElement(
      app, positioned.event, positioned.column, positioned.columnCount, vertical,
      DAY_PX_PER_MINUTE, options.sessionColors,
    ));
  }
  window.requestAnimationFrame(() => {
    scroll.scrollTop = options.initialScrollHour * 60 * DAY_PX_PER_MINUTE;
  });
}

function renderEngagementTime(container: HTMLElement, events: CalendarEvent[]): void {
  const totals = new Map<string, number>();
  for (const event of events) totals.set(event.engagementName, (totals.get(event.engagementName) ?? 0) + event.durationMinutes);
  const rows = [...totals.entries()].sort((left, right) => right[1] - left[1]);
  const section = container.createEl('section', { cls: 'examined-human-daily-panel' });
  section.createEl('h3', { text: 'Time by engagement' });
  if (rows.length === 0) {
    section.createDiv({ cls: 'examined-human-daily-empty-inline', text: 'No engagement time is available.' });
    return;
  }
  const maximum = Math.max(...rows.map(([, minutes]) => minutes));
  const chart = section.createDiv({ cls: 'examined-human-daily-engagement-chart' });
  for (const [engagement, minutes] of rows) {
    const row = chart.createDiv({ cls: 'examined-human-daily-engagement-row' });
    const labels = row.createDiv({ cls: 'examined-human-daily-engagement-labels' });
    labels.createSpan({ text: engagement });
    labels.createEl('strong', { text: duration(minutes) });
    const track = row.createDiv({ cls: 'examined-human-daily-engagement-track' });
    const bar = track.createDiv({ cls: 'examined-human-daily-engagement-bar' });
    bar.style.width = `${minutes / maximum * 100}%`;
  }
}

function renderFoods(container: HTMLElement, foods: DailyMealRecord[]): void {
  const section = container.createEl('section', { cls: 'examined-human-daily-panel' });
  const heading = section.createDiv({ cls: 'examined-human-daily-section-heading' });
  heading.createEl('h3', { text: 'Foods consumed' });
  heading.createSpan({ text: `${foods.length} row${foods.length === 1 ? '' : 's'}`, cls: 'examined-human-daily-section-meta' });
  if (foods.length === 0) {
    section.createDiv({ cls: 'examined-human-daily-empty-inline', text: 'No foods recorded.' });
    return;
  }
  const wrap = section.createDiv({ cls: 'examined-human-exercise-table-wrap' });
  const table = wrap.createEl('table', { cls: 'examined-human-exercise-table examined-human-daily-food-table' });
  const header = table.createEl('thead').createEl('tr');
  for (const label of ['Meal', 'Food', 'Amount g', 'Calories', 'Protein g', 'Carbs g', 'Fat g', 'Salt g', 'Fiber g', 'Cholesterol mg']) {
    header.createEl('th', { text: label });
  }
  const body = table.createEl('tbody');
  for (const food of foods) {
    const row = body.createEl('tr');
    row.createEl('td', { text: food.mealType ?? '—' });
    row.createEl('td', { text: food.food });
    for (const value of [food.amountG, food.calories, food.proteinG, food.carbsG, food.fatG, food.saltG, food.fiberG, food.cholesterolMg]) {
      row.createEl('td', { text: decimal(value) });
    }
  }
  const total = table.createEl('tfoot').createEl('tr');
  total.createEl('th', { text: 'Total', attr: { colspan: '2' } });
  const numericKeys: Array<keyof DailyMealRecord> = [
    'amountG', 'calories', 'proteinG', 'carbsG', 'fatG', 'saltG', 'fiberG', 'cholesterolMg',
  ];
  for (const key of numericKeys) {
    const values = foods.map((food) => food[key]).filter((value): value is number => typeof value === 'number');
    total.createEl('th', { text: values.length === 0 ? '—' : decimal(values.reduce((sum, value) => sum + value, 0)) });
  }
}

function renderFinance(
  container: HTMLElement,
  transactions: DailyAssessmentReport['transactions'],
  valuationLabel: string,
): void {
  const section = container.createEl('section', { cls: 'examined-human-daily-panel' });
  const heading = section.createDiv({ cls: 'examined-human-daily-section-heading' });
  heading.createEl('h3', { text: 'Finance' });
  heading.createSpan({ text: `${transactions.length} transaction${transactions.length === 1 ? '' : 's'}`, cls: 'examined-human-daily-section-meta' });
  if (transactions.length === 0) {
    section.createDiv({ cls: 'examined-human-daily-empty-inline', text: 'No transactions recorded.' });
    return;
  }
  const wrap = section.createDiv({ cls: 'examined-human-exercise-table-wrap' });
  const table = wrap.createEl('table', { cls: 'examined-human-exercise-table examined-human-daily-transaction-table' });
  const header = table.createEl('thead').createEl('tr');
  for (const label of ['Account', 'Amount', 'Unit', valuationLabel, 'Engagement', 'Description']) header.createEl('th', { text: label });
  const body = table.createEl('tbody');
  for (const transaction of transactions) {
    const row = body.createEl('tr');
    row.createEl('td', { text: transaction.accountName });
    row.createEl('td', { text: decimal(transaction.amount) });
    row.createEl('td', { text: transaction.currency });
    row.createEl('td', { text: transaction.valuationAmount == null ? '%$% error' : decimal(transaction.valuationAmount) });
    row.createEl('td', { text: transaction.engagement || '—' });
    row.createEl('td', { text: transaction.description || '—' });
  }
  const totals = new Map<string, number>();
  for (const transaction of transactions) totals.set(transaction.currency, (totals.get(transaction.currency) ?? 0) + transaction.amount);
  const foot = table.createEl('tfoot');
  for (const [currency, amount] of [...totals.entries()].sort()) {
    const row = foot.createEl('tr');
    row.createEl('th', { text: `Total ${currency}` });
    row.createEl('th', { text: decimal(amount) });
    row.createEl('th', { text: currency });
    row.createEl('th', { text: '' });
    row.createEl('th', { text: '', attr: { colspan: '2' } });
  }
  const net = foot.createEl('tr', { cls: 'examined-human-daily-net-flow' });
  net.createEl('th', { text: 'Net flow', attr: { colspan: '3' } });
  const missing = transactions.some((transaction) => transaction.amount !== 0 && transaction.valuationAmount == null);
  const netAmount = transactions.reduce((sum, transaction) => sum + (transaction.valuationAmount ?? 0), 0);
  net.createEl('th', { text: missing ? '%$% error' : `${decimal(netAmount)} ${valuationLabel}`, attr: { colspan: '3' } });
}

function renderExercises(container: HTMLElement, exercises: DailyReportExercise[]): void {
  const section = container.createEl('section', { cls: 'examined-human-daily-panel' });
  const heading = section.createDiv({ cls: 'examined-human-daily-section-heading' });
  heading.createEl('h3', { text: 'Exercise details' });
  heading.createSpan({ text: String(exercises.length), cls: 'examined-human-daily-section-meta' });
  if (exercises.length === 0) {
    section.createDiv({ cls: 'examined-human-daily-empty-inline', text: 'No exercise details recorded.' });
    return;
  }
  const grid = section.createDiv({ cls: 'examined-human-daily-exercise-grid' });
  for (const exercise of exercises) {
    const card = grid.createDiv({ cls: 'examined-human-daily-exercise-card' });
    card.createEl('h4', { text: exercise.name });
    if (exercise.category) card.createDiv({ cls: 'examined-human-exercise-category', text: exercise.category });
    if (exercise.sets.length > 0) {
      const table = card.createEl('table', { cls: 'examined-human-exercise-table' });
      const head = table.createEl('thead').createEl('tr');
      for (const label of ['Set', 'Weight', 'Reps', 'Distance', 'Duration', 'Notes']) head.createEl('th', { text: label });
      const body = table.createEl('tbody');
      for (const [index, set] of exercise.sets.entries()) {
        const row = body.createEl('tr');
        row.createEl('td', { text: String(set.setNumber ?? index + 1) });
        row.createEl('td', { text: set.weight == null ? '—' : formatExerciseNumber(set.weight) });
        row.createEl('td', { text: set.reps == null ? '—' : formatExerciseNumber(set.reps) });
        row.createEl('td', { text: set.distance == null ? '—' : formatExerciseNumber(set.distance) });
        row.createEl('td', { text: set.durationMinutes == null ? '—' : duration(set.durationMinutes) });
        row.createEl('td', { text: set.notes ?? '—' });
      }
    }
    if (exercise.notes) card.createDiv({ cls: 'examined-human-session-notes', text: exercise.notes });
  }
}

function renderNotes(container: HTMLElement, report: DailyAssessmentReport): void {
  const notes = [
    ...(report.metrics?.notes ? [{ label: 'Daily note', text: report.metrics.notes }] : []),
    ...report.events.flatMap((event) => event.notes ? [{ label: event.engagementName, text: event.notes }] : []),
    ...report.exercises.flatMap((exercise) => exercise.notes ? [{ label: exercise.name, text: exercise.notes }] : []),
  ];
  if (notes.length === 0) return;
  const section = container.createEl('section', { cls: 'examined-human-daily-panel' });
  section.createEl('h3', { text: 'Notes' });
  const list = section.createEl('ul', { cls: 'examined-human-daily-notes-list' });
  for (const note of notes) {
    const item = list.createEl('li');
    item.createEl('strong', { text: `${note.label}: ` });
    item.appendText(note.text);
  }
}

/** Returns false when hard blockers intentionally suppress the report body. */
export function renderDailyAssessmentReport(
  app: App,
  container: HTMLElement,
  report: DailyAssessmentReport,
  options: DailyAssessmentReportRenderOptions,
): boolean {
  if (report.errors.length > 0) {
    renderBlockers(container, report, options);
    return false;
  }
  renderMessages(container, 'Assessment warnings', report.warnings, 'is-warning');
  renderMetrics(container, report.metrics);
  renderTimeline(app, container, report.events, options);
  renderEngagementTime(container, report.events);
  renderFoods(container, report.foods);
  renderFinance(container, report.transactions, options.valuationLabel);
  renderExercises(container, report.exercises);
  renderNotes(container, report);
  return true;
}
