import { ItemView, moment, normalizePath, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type EqhCalendarPlugin from './main.ts';
import { buildDailyNoteList, type DailyNoteListItem } from './daily-note-index.ts';
import { confirmDailyImport } from './DailyImportConfirmationModal.ts';
import { confirmNativeMealImport } from './NativeMealImportConfirmationModal.ts';
import type { CalendarEvent, ExerciseSetDetails, SessionExerciseDetails } from './events.ts';
import {
  formatExerciseNumber,
  parseDatabaseTime,
  titleForEngagement,
} from './events.ts';
import type {
  DailyAssessmentQueryResult,
  DailyMealRecord,
  DailyMetricsRecord,
} from './eqh-query.ts';
import type {
  DashboardPreviewExercise,
  DashboardPreviewTransaction,
  NativeDailyInspection,
} from './native-logger/daily-note.ts';
import { layoutOverlappingEvents } from './overlap.ts';
import { inspectMeals, type MealInspection } from './native-logger/meals.ts';
import { backupMutationOutput } from './native-logger/write-service.ts';
import { createSessionElement } from './session-element.ts';
import { layoutVisualStack } from './visual-stack.ts';

export const EQH_DAILY_ASSESSMENT_VIEW_TYPE = 'eqh-daily-assessment';

const FINGERPRINT_INTERVAL_MS = 10_000;
const DAY_PX_PER_MINUTE = 0.8;

interface DisplayExercise {
  name: string;
  category: string | null;
  sets: ExerciseSetDetails[];
  notes: string | null;
}

interface DisplayTransaction {
  id: number;
  accountName: string;
  amount: number | string;
  engagement: string;
  description: string;
}

function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export class DailyAssessmentView extends ItemView {
  private selectedDate: string | null = null;
  private items: DailyNoteListItem[] = [];
  private selectedItem: DailyNoteListItem | null = null;
  private assessment: DailyAssessmentQueryResult | null = null;
  private inspection: NativeDailyInspection | null = null;
  private mealInspection: MealInspection | null = null;
  private loggerOutput: string | null = null;
  private renderGeneration = 0;
  private fingerprintTimer: number | null = null;
  private lastFingerprint: string | null = null;
  private actionButton: HTMLButtonElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: EqhCalendarPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return EQH_DAILY_ASSESSMENT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'EH Dashboards — Daily Assessment';
  }

  getIcon(): string {
    return 'clipboard-check';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('eqh-daily-view');
    await this.refresh();
    this.registerEvent(this.app.vault.on('modify', (file) => {
      try {
        const databaseChanged = normalizePath(file.path)
          === this.plugin.database.normalizeVaultPath(this.plugin.settings.databasePath);
        const selectedNoteChanged = file.path === this.selectedItem?.filePath;
        if ((databaseChanged || selectedNoteChanged)
          && !this.plugin.nativeLogger.isRunning) void this.refresh();
      } catch {
        // The visible error state explains invalid paths.
      }
    }));
    try {
      this.lastFingerprint = await this.plugin.database.fingerprint(this.plugin.settings.databasePath);
    } catch {
      this.lastFingerprint = null;
    }
    this.fingerprintTimer = window.setInterval(() => { void this.checkDatabaseFingerprint(); }, FINGERPRINT_INTERVAL_MS);
  }

  async onClose(): Promise<void> {
    if (this.fingerprintTimer != null) window.clearInterval(this.fingerprintTimer);
    this.contentEl.empty();
  }

  async refresh(): Promise<void> {
    const generation = ++this.renderGeneration;
    this.contentEl.empty();
    this.contentEl.addClass('eqh-daily-view');
    this.contentEl.createDiv({ cls: 'eqh-loading', text: 'Loading Daily Assessment…' });
    try {
      const today = moment().format('YYYY-MM-DD');
      const index = await this.plugin.database.dailyNoteIndex(this.plugin.settings.databasePath);
      const items = await buildDailyNoteList(this.app, index, today, this.plugin.settings.journalFolder);
      if (generation !== this.renderGeneration) return;
      this.items = items;
      if (!this.selectedDate || !items.some((item) => item.date === this.selectedDate)) {
        this.selectedDate = items.find((item) => item.temporalState === 'current')?.date
          ?? items[0]?.date
          ?? null;
      }
      this.selectedItem = items.find((item) => item.date === this.selectedDate) ?? null;
      this.assessment = this.selectedDate
        ? await this.plugin.database.dailyAssessment(this.plugin.settings.databasePath, this.selectedDate, today)
        : null;
      this.inspection = null;
      this.mealInspection = null;
      if (this.selectedItem && this.selectedItem.status !== 'imported') {
        const noteFile = this.app.vault.getAbstractFileByPath(this.selectedItem.filePath);
        if (noteFile instanceof TFile) {
          const sourceText = await this.app.vault.read(noteFile);
          const thresholds = {
            mealCalorieLimitKcal: this.plugin.settings.mealCalorieLimitKcal,
            dailyCalorieLimitKcal: this.plugin.settings.dailyCalorieLimitKcal,
            minimumProteinG: this.plugin.settings.minimumProteinG,
          };
          this.mealInspection = inspectMeals(sourceText, thresholds);
          try {
            this.inspection = await this.plugin.nativeLogger.inspectDaily({
              databasePath: this.plugin.settings.databasePath,
              noteDate: this.selectedItem.date,
              todayDate: today,
              fileName: this.selectedItem.fileName,
              filePath: this.selectedItem.filePath,
              sourceText,
              nutritionThresholds: thresholds,
            });
          } catch (error) {
            this.loggerOutput = error instanceof Error ? error.message : String(error);
          }
        }
      }
      if (generation !== this.renderGeneration) return;
      this.renderDashboard();
    } catch (error) {
      if (generation !== this.renderGeneration) return;
      this.contentEl.empty();
      this.renderError(error);
    }
  }

  private renderDashboard(): void {
    this.contentEl.empty();
    this.contentEl.addClass('eqh-daily-view');
    this.renderHeader();
    if (!this.selectedItem || !this.assessment) {
      this.contentEl.createDiv({ cls: 'eqh-daily-empty', text: 'No EH Daily Notes were found.' });
      return;
    }
    const body = this.contentEl.createDiv({ cls: 'eqh-daily-layout' });
    this.renderSidebar(body);
    const main = body.createEl('main', { cls: 'eqh-daily-main' });
    const events = this.displayEvents();
    this.renderValidation(main);
    this.renderDayTimeline(main, events);
    this.renderEngagementTime(main, events);
    this.renderMetrics(main);
    this.renderTransactions(main);
    this.renderExercises(main);
  }

  private renderHeader(): void {
    const header = this.contentEl.createDiv({ cls: 'eqh-toolbar eqh-daily-toolbar' });
    const identity = header.createDiv({ cls: 'eqh-toolbar-identity' });
    identity.createEl('h2', { text: 'EH Dashboards — Daily Assessment' });
    identity.createDiv({
      cls: 'eqh-toolbar-status',
      text: this.selectedItem
        ? `${moment(this.selectedItem.date, 'YYYY-MM-DD').format('ddd, MMM D, YYYY')} · ${this.statusLabel(this.selectedItem)}`
        : 'Review journal data and safely import historical notes',
    });
    const actions = header.createDiv({ cls: 'eqh-toolbar-actions' });
    this.actionButton = actions.createEl('button', { cls: 'eqh-toolbar-button mod-cta' });
    if (!this.selectedItem) {
      this.actionButton.setText('Import');
      this.actionButton.disabled = true;
    } else if (this.selectedItem.status === 'imported') {
      this.actionButton.setText('Already imported');
      this.actionButton.disabled = true;
    } else {
      this.actionButton.setText(this.selectedItem.status === 'current-future' ? 'Sync future' : 'Import');
      this.actionButton.addEventListener('click', () => { void this.handleImport(); });
    }
    actions.createEl('button', { text: 'Refresh', cls: 'eqh-toolbar-button' })
      .addEventListener('click', () => { void this.plugin.refreshViews(); });
  }

  private renderSidebar(container: HTMLElement): void {
    const sidebar = container.createEl('aside', {
      cls: 'eqh-daily-sidebar',
      attr: { 'aria-label': 'Daily Notes, newest first' },
    });
    for (const item of this.items) {
      const button = sidebar.createEl('button', {
        cls: [
          'eqh-daily-date-button',
          `is-${item.temporalState}`,
          item.date === this.selectedDate ? 'is-selected' : '',
        ].join(' '),
        attr: { 'aria-label': `${item.date}, ${this.statusLabel(item)}` },
      });
      button.createSpan({ cls: 'eqh-daily-date-primary', text: moment(item.date, 'YYYY-MM-DD').format('MMM D, YYYY') });
      button.createSpan({ cls: 'eqh-daily-date-secondary', text: moment(item.date, 'YYYY-MM-DD').format('dddd') });
      button.addEventListener('click', () => {
        if (item.date === this.selectedDate) return;
        this.selectedDate = item.date;
        this.loggerOutput = null;
        void this.refresh();
      });
    }
  }

  private renderValidation(container: HTMLElement): void {
    const item = this.selectedItem;
    if (!item) return;
    const section = container.createEl('section', { cls: 'eqh-daily-validation' });
    const heading = section.createDiv({ cls: 'eqh-daily-section-heading' });
    heading.createEl('h3', { text: 'Import readiness' });
    const badge = heading.createSpan({ cls: 'eqh-daily-status-badge' });
    if (item.status === 'imported') {
      badge.addClass('is-ready');
      badge.setText('Imported');
      section.createDiv({ text: 'This date is finalized. Import controls are disabled.', cls: 'eqh-daily-validation-note' });
    } else if (this.inspection) {
      badge.addClass(this.inspection.ready ? 'is-ready' : 'is-blocked');
      badge.setText(this.inspection.ready ? 'Ready for confirmation' : 'Needs attention');
      this.renderCompleteness(section, this.inspection);
      if (this.inspection.warnings.length > 0) {
        this.renderMessageList(section, 'Warnings', this.inspection.warnings, 'is-warning');
      }
      if (this.inspection.errors.length > 0) {
        this.renderCopyableOutput(section, 'Validation errors', this.inspection.errors.join('\n\n'));
      }
    }
    this.renderNativeMeals(section, item);
    if (this.loggerOutput) this.renderCopyableOutput(section, 'Logger output', this.loggerOutput);
  }

  private renderNativeMeals(container: HTMLElement, item: DailyNoteListItem): void {
    const block = container.createDiv({ cls: 'eqh-native-meals' });
    const heading = block.createDiv({ cls: 'eqh-daily-section-heading' });
    heading.createEl('h4', { text: 'Native Meals' });
    const component = this.assessment?.mealImport ?? null;
    const state = heading.createSpan({ cls: 'eqh-daily-status-badge' });
    if (item.status === 'imported' || component?.lifecycleState === 'finalized') {
      state.addClass('is-ready');
      state.setText('Finalized');
      block.createDiv({
        cls: 'eqh-daily-validation-note',
        text: 'Historical Meals are immutable once finalized by a component or full Daily Note import.',
      });
      return;
    }

    const inspection = this.mealInspection;
    if (!inspection) {
      state.addClass('is-blocked');
      state.setText('Unavailable');
      block.createDiv({ cls: 'eqh-daily-validation-note', text: 'The selected Daily Note could not be read.' });
      return;
    }

    state.addClass(inspection.ready ? 'is-ready' : 'is-blocked');
    state.setText(component ? 'Ephemeral · replaceable' : inspection.ready ? 'Ready' : 'Needs attention');
    block.createDiv({
      cls: 'eqh-daily-section-subtitle',
      text: 'Parsed and validated inside Obsidian on desktop and mobile. Snacks count toward daily calories but never directly as leisure.',
    });
    const grid = block.createDiv({ cls: 'eqh-daily-completeness-grid' });
    const values = [
      ['Foods', inspection.foodRowCount],
      ['Direct leisure', `${inspection.directLeisureMeals}/3`],
      ['Final leisure', `${inspection.leisureMeals}/3`],
      ['Calories', inspection.nutrition.dailyCaloriesKcal ?? '—'],
      ['Protein', inspection.nutrition.proteinG == null ? '—' : `${inspection.nutrition.proteinG} g`],
      ['Dieted', inspection.nutrition.evaluatedDieted == null
        ? '—'
        : inspection.nutrition.evaluatedDieted === 1 ? 'Yes' : 'No'],
    ];
    for (const [label, value] of values) {
      const card = grid.createDiv({ cls: 'eqh-daily-mini-stat' });
      card.createSpan({ text: String(label) });
      card.createEl('strong', { text: String(value) });
    }
    if (inspection.warnings.length > 0) {
      this.renderMessageList(block, 'Meals warnings', inspection.warnings, 'is-warning');
    }
    if (inspection.errors.length > 0) {
      this.renderMessageList(block, 'Meals blockers', inspection.errors, 'is-error');
    }
    const actions = block.createDiv({ cls: 'eqh-native-meals-actions' });
    const button = actions.createEl('button', {
      cls: 'mod-cta',
      text: component ? 'Replace Meals' : 'Import Meals',
    });
    button.disabled = !inspection.ready || this.plugin.nativeLogger.isRunning;
    button.addEventListener('click', () => { void this.handleNativeMealImport(); });
    if (component) {
      actions.createSpan({
        cls: 'eqh-daily-validation-note',
        text: `Last written by v${component.pluginVersion} · ${component.rowCount} food row${component.rowCount === 1 ? '' : 's'}`,
      });
      if (item.status === 'needs-import' && component.lifecycleState === 'ephemeral') {
        actions.createSpan({
          cls: 'eqh-daily-validation-note',
          text: 'This replacement finalizes the completed historical Meals component.',
        });
      }
    } else if (item.status === 'needs-import') {
      actions.createSpan({
        cls: 'eqh-daily-validation-note',
        text: 'First import finalizes this historical Meals component.',
      });
    }
  }

  private renderCompleteness(container: HTMLElement, inspection: NativeDailyInspection): void {
    const completeness = inspection.completeness;
    if (!completeness) return;
    const grid = container.createDiv({ cls: 'eqh-daily-completeness-grid' });
    const counts = [
      ['Sessions', completeness.session_count],
      ['Transactions', completeness.transaction_count],
      ['Exercises', completeness.exercise_count],
      ['Foods', completeness.meal_count],
      ['Milestones', completeness.milestone_count],
    ];
    for (const [label, value] of counts) {
      const card = grid.createDiv({ cls: 'eqh-daily-mini-stat' });
      card.createSpan({ text: String(label) });
      card.createEl('strong', { text: String(value) });
    }
    const missing = completeness.missing_daily_metrics;
    const metricState = container.createDiv({
      cls: `eqh-daily-completeness-callout ${missing.length > 0 ? 'is-incomplete' : 'is-complete'}`,
    });
    metricState.createEl('strong', {
      text: missing.length > 0
        ? `${missing.length} empty daily metric cell${missing.length === 1 ? '' : 's'}`
        : 'All daily metric cells are filled',
    });
    if (missing.length > 0) metricState.createDiv({ text: missing.join(', ') });
  }

  private renderMessageList(container: HTMLElement, label: string, messages: string[], className: string): void {
    const callout = container.createDiv({ cls: `eqh-daily-validation-callout ${className}` });
    callout.createEl('strong', { text: label });
    const list = callout.createEl('ul');
    for (const message of messages) list.createEl('li', { text: message });
  }

  private renderCopyableOutput(container: HTMLElement, label: string, output: string): void {
    const block = container.createDiv({ cls: 'eqh-daily-output-block' });
    const header = block.createDiv({ cls: 'eqh-daily-output-header' });
    header.createEl('strong', { text: label });
    header.createEl('button', { text: 'Copy', cls: 'eqh-toolbar-button' }).addEventListener('click', () => {
      void navigator.clipboard.writeText(output).then(() => new Notice('Copied logger output.'));
    });
    const textarea = block.createEl('textarea', { cls: 'eqh-daily-output', attr: { readonly: 'true', rows: '7' } });
    textarea.value = output;
  }

  private renderDayTimeline(container: HTMLElement, events: CalendarEvent[]): void {
    const section = container.createEl('section', { cls: 'eqh-daily-panel' });
    const heading = section.createDiv({ cls: 'eqh-daily-section-heading' });
    heading.createEl('h3', { text: 'Day timeline' });
    heading.createSpan({ text: `${events.length} session${events.length === 1 ? '' : 's'}`, cls: 'eqh-daily-section-meta' });
    if (events.length === 0) {
      section.createDiv({ cls: 'eqh-daily-empty-inline', text: 'No sessions are available for this date.' });
      return;
    }
    const scroll = section.createDiv({ cls: 'eqh-daily-timeline-scroll' });
    const grid = scroll.createDiv({ cls: 'eqh-daily-timeline-grid' });
    grid.style.height = `${1440 * DAY_PX_PER_MINUTE}px`;
    grid.style.setProperty('--eqh-px-per-minute', `${DAY_PX_PER_MINUTE}px`);
    const gutter = grid.createDiv({ cls: 'eqh-daily-time-gutter' });
    const column = grid.createDiv({ cls: 'eqh-day-column eqh-daily-session-column' });
    column.style.backgroundSize = `100% ${60 * DAY_PX_PER_MINUTE}px, 100% ${30 * DAY_PX_PER_MINUTE}px`;
    for (let hour = 0; hour < 24; hour++) {
      const label = gutter.createDiv({ cls: 'eqh-hour-label', text: `${String(hour).padStart(2, '0')}:00` });
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
        this.app,
        positioned.event,
        positioned.column,
        positioned.columnCount,
        vertical,
        DAY_PX_PER_MINUTE,
        this.plugin.settings.sessionColors,
      ));
    }
    window.requestAnimationFrame(() => {
      scroll.scrollTop = this.plugin.settings.initialScrollHour * 60 * DAY_PX_PER_MINUTE;
    });
  }

  private renderEngagementTime(container: HTMLElement, events: CalendarEvent[]): void {
    const totals = new Map<string, number>();
    for (const event of events) totals.set(event.engagementName, (totals.get(event.engagementName) ?? 0) + event.durationMinutes);
    const rows = [...totals.entries()].sort((left, right) => right[1] - left[1]);
    const section = container.createEl('section', { cls: 'eqh-daily-panel' });
    section.createEl('h3', { text: 'Time by engagement' });
    section.createDiv({ cls: 'eqh-daily-section-subtitle', text: 'Logged or inspected session minutes for the selected date' });
    if (rows.length === 0) {
      section.createDiv({ cls: 'eqh-daily-empty-inline', text: 'No engagement time is available.' });
      return;
    }
    const maximum = Math.max(...rows.map(([, minutes]) => minutes));
    const chart = section.createDiv({ cls: 'eqh-daily-engagement-chart' });
    for (const [engagement, minutes] of rows) {
      const row = chart.createDiv({ cls: 'eqh-daily-engagement-row' });
      const labels = row.createDiv({ cls: 'eqh-daily-engagement-labels' });
      labels.createSpan({ text: engagement });
      labels.createEl('strong', { text: formatDuration(minutes) });
      const track = row.createDiv({ cls: 'eqh-daily-engagement-track' });
      const bar = track.createDiv({ cls: 'eqh-daily-engagement-bar' });
      bar.style.width = `${minutes / maximum * 100}%`;
    }
  }

  private renderMetrics(container: HTMLElement): void {
    const metrics = this.displayMetrics();
    const section = container.createEl('section', { cls: 'eqh-daily-panel' });
    section.createEl('h3', { text: 'Daily metrics' });
    const grid = section.createDiv({ cls: 'eqh-daily-metrics-grid' });
    const definitions: Array<[string, keyof DailyMetricsRecord, string]> = [
      ['Mood', 'mood', ''],
      ['Energy', 'energy', ''],
      ['Stress', 'stress', ''],
      ['Weight', 'weightKg', ' kg'],
      ['Sleep', 'sleepHours', ' h'],
      ['Calories', 'calories', ' kcal'],
      ['Protein', 'proteinG', ' g'],
      ['Fasted', 'fasted', ''],
      ['Dieted', 'dieted', ''],
    ];
    for (const [label, key, suffix] of definitions) {
      const value = metrics?.[key] ?? null;
      const card = grid.createDiv({ cls: `eqh-daily-metric-card ${value == null ? 'is-empty' : ''}` });
      card.createDiv({ cls: 'eqh-weekly-eyebrow', text: label });
      const display = (key === 'fasted' || key === 'dieted') && value != null
        ? Number(value) === 1 ? 'Yes' : 'No'
        : value == null ? '—' : `${value}${suffix}`;
      card.createDiv({ cls: 'eqh-daily-metric-value', text: display });
    }
    const meals = this.displayMeals();
    if (meals.length > 0) {
      section.createEl('h4', { text: 'Foods' });
      const list = section.createEl('ul', { cls: 'eqh-daily-food-list' });
      for (const meal of meals) {
        const details = [
          meal.calories == null ? null : `${meal.calories} kcal`,
          meal.proteinG == null ? null : `${meal.proteinG} g protein`,
        ].filter(Boolean).join(' · ');
        list.createEl('li', { text: details ? `${meal.food} — ${details}` : meal.food });
      }
    }
  }

  private renderTransactions(container: HTMLElement): void {
    const transactions = this.displayTransactions();
    const section = container.createEl('section', { cls: 'eqh-daily-panel' });
    const heading = section.createDiv({ cls: 'eqh-daily-section-heading' });
    heading.createEl('h3', { text: 'Transactions' });
    heading.createSpan({ text: String(transactions.length), cls: 'eqh-daily-section-meta' });
    if (transactions.length === 0) {
      section.createDiv({ cls: 'eqh-daily-empty-inline', text: 'No transactions recorded.' });
      return;
    }
    const wrap = section.createDiv({ cls: 'eqh-exercise-table-wrap' });
    const table = wrap.createEl('table', { cls: 'eqh-exercise-table eqh-daily-transaction-table' });
    const header = table.createEl('thead').createEl('tr');
    for (const label of ['Account', 'Amount', 'Engagement', 'Description']) header.createEl('th', { text: label });
    const body = table.createEl('tbody');
    for (const transaction of transactions) {
      const row = body.createEl('tr');
      row.createEl('td', { text: transaction.accountName });
      row.createEl('td', { text: String(transaction.amount) });
      row.createEl('td', { text: transaction.engagement || '—' });
      row.createEl('td', { text: transaction.description || '—' });
    }
  }

  private renderExercises(container: HTMLElement): void {
    const exercises = this.displayExercises();
    const section = container.createEl('section', { cls: 'eqh-daily-panel' });
    const heading = section.createDiv({ cls: 'eqh-daily-section-heading' });
    heading.createEl('h3', { text: 'Exercise details' });
    heading.createSpan({ text: String(exercises.length), cls: 'eqh-daily-section-meta' });
    if (exercises.length === 0) {
      section.createDiv({ cls: 'eqh-daily-empty-inline', text: 'No exercise details recorded.' });
      return;
    }
    const grid = section.createDiv({ cls: 'eqh-daily-exercise-grid' });
    for (const exercise of exercises) {
      const card = grid.createDiv({ cls: 'eqh-daily-exercise-card' });
      card.createEl('h4', { text: exercise.name });
      if (exercise.category) card.createDiv({ cls: 'eqh-exercise-category', text: exercise.category });
      if (exercise.sets.length > 0) {
        const table = card.createEl('table', { cls: 'eqh-exercise-table' });
        const head = table.createEl('thead').createEl('tr');
        for (const label of ['Set', 'Weight', 'Reps', 'Distance', 'Duration']) head.createEl('th', { text: label });
        const body = table.createEl('tbody');
        for (const [index, set] of exercise.sets.entries()) {
          const row = body.createEl('tr');
          row.createEl('td', { text: String(set.setNumber ?? index + 1) });
          row.createEl('td', { text: set.weight == null ? '—' : formatExerciseNumber(set.weight) });
          row.createEl('td', { text: set.reps == null ? '—' : formatExerciseNumber(set.reps) });
          row.createEl('td', { text: set.distance == null ? '—' : formatExerciseNumber(set.distance) });
          row.createEl('td', { text: set.durationMinutes == null ? '—' : formatDuration(set.durationMinutes) });
        }
      }
      if (exercise.notes) card.createDiv({ cls: 'eqh-session-notes', text: exercise.notes });
    }
  }

  private displayEvents(): CalendarEvent[] {
    if (this.selectedItem?.status !== 'imported' && this.inspection?.preview) {
      return this.inspection.preview.sessions.flatMap((session) => {
        const start = parseDatabaseTime(session.start_time ?? '');
        const end = parseDatabaseTime(session.end_time ?? '');
        if (start == null || end == null || end <= start) return [];
        return [{
          id: `inspection:${session.ordinal}`,
          date: this.selectedItem?.date ?? this.inspection?.date ?? '',
          sessionType: session.session_type,
          engagementName: session.engagement,
          engagementType: '',
          title: titleForEngagement(session.engagement),
          kind: 'timed' as const,
          startMinutes: start,
          endMinutes: end,
          durationMinutes: session.duration_minutes ?? end - start,
          notes: session.notes,
          sourceKind: 'planned' as const,
        }];
      });
    }
    return this.assessment?.sessionResult.events ?? [];
  }

  private displayMetrics(): DailyMetricsRecord | null {
    if (this.selectedItem?.status === 'imported') return this.assessment?.metrics ?? null;
    const raw = this.inspection?.preview?.daily_metrics;
    if (!raw) return this.assessment?.metrics ?? null;
    const number = (key: string): number | null => {
      const value = raw[key];
      if (value == null || value === '') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      mood: number('mood'),
      energy: number('energy'),
      stress: number('stress'),
      weightKg: number('weight_kg'),
      sleepHours: number('sleep_hours'),
      calories: number('calories'),
      proteinG: number('protein_g'),
      fasted: number('fasted'),
      dieted: number('dieted'),
    };
  }

  private displayMeals(): DailyMealRecord[] {
    if (this.selectedItem?.status === 'imported') return this.assessment?.meals ?? [];
    return (this.inspection?.preview?.meals ?? []).map((meal, index) => ({
      id: index + 1,
      food: meal.food,
      calories: meal.calories,
      proteinG: meal.protein_g,
    }));
  }

  private displayTransactions(): DisplayTransaction[] {
    if (this.selectedItem?.status === 'imported') return this.assessment?.transactions ?? [];
    return (this.inspection?.preview?.transactions ?? []).map((transaction: DashboardPreviewTransaction) => ({
      id: transaction.ordinal,
      accountName: transaction.account,
      amount: transaction.amount,
      engagement: transaction.engagement,
      description: transaction.description,
    }));
  }

  private displayExercises(): DisplayExercise[] {
    if (this.selectedItem?.status !== 'imported') {
      return (this.inspection?.preview?.exercises ?? []).map((exercise: DashboardPreviewExercise) => ({
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
    const exercises: DisplayExercise[] = [];
    for (const event of this.assessment?.sessionResult.events ?? []) {
      for (const exercise of event.exerciseDetails ?? []) exercises.push(this.displayExerciseFromSession(exercise));
    }
    return exercises;
  }

  private displayExerciseFromSession(exercise: SessionExerciseDetails): DisplayExercise {
    return {
      name: exercise.name,
      category: exercise.category,
      sets: exercise.sets,
      notes: null,
    };
  }

  private async handleNativeMealImport(): Promise<void> {
    const item = this.selectedItem;
    if (!item || item.status === 'imported') return;
    if (item.status === 'needs-import'
      && this.assessment?.mealImport?.lifecycleState === 'finalized') {
      new Notice(`Meals for historical date ${item.date} were already imported.`, 8000);
      return;
    }
    const noteFile = this.app.vault.getAbstractFileByPath(item.filePath);
    if (!(noteFile instanceof TFile)) {
      new Notice(`Daily Note not found: ${item.filePath}`, 8000);
      return;
    }

    try {
      const sourceText = await this.app.vault.read(noteFile);
      const inspection = inspectMeals(sourceText, {
        mealCalorieLimitKcal: this.plugin.settings.mealCalorieLimitKcal,
        dailyCalorieLimitKcal: this.plugin.settings.dailyCalorieLimitKcal,
        minimumProteinG: this.plugin.settings.minimumProteinG,
      });
      this.mealInspection = inspection;
      if (!inspection.ready) {
        this.renderDashboard();
        new Notice('Meals validation failed. Review the blockers before importing.', 10000);
        return;
      }
      const confirmed = await confirmNativeMealImport(this.app, {
        date: item.date,
        historical: item.status === 'needs-import',
        replacing: this.assessment?.mealImport != null,
        inspection,
      });
      if (!confirmed) return;

      const result = await this.plugin.nativeLogger.importMeals({
        databasePath: this.plugin.settings.databasePath,
        noteDate: item.date,
        todayDate: moment().format('YYYY-MM-DD'),
        sourceFilePath: item.filePath,
        sourceText,
        inspection,
      });
      this.loggerOutput = [
        `${result.replaced ? 'Replaced' : 'Imported'} ${result.foodRowCount} food row${result.foodRowCount === 1 ? '' : 's'} across ${result.mealEventCount} meal events.`,
        `Leisure result: ${result.leisureMeals}/3. Lifecycle: ${result.lifecycleState}.`,
        ...backupMutationOutput(result),
      ].join('\n');
      await this.refresh();
      new Notice(
        `${result.replaced ? 'Meals replaced' : 'Meals imported'} for ${item.date}. ${result.backupPath ? 'Backup created.' : 'No backup was needed for this ephemeral write.'}`,
        8000,
      );
    } catch (error) {
      this.loggerOutput = error instanceof Error ? error.message : String(error);
      this.renderDashboard();
      new Notice('Native Meals import did not complete. No unverified write was kept.', 10000);
    }
  }

  private async handleImport(): Promise<void> {
    const item = this.selectedItem;
    if (!item || item.status === 'imported') return;
    this.actionButton?.setText('Validating…');
    const activeButton = this.actionButton;
    if (activeButton) activeButton.disabled = true;
    try {
      const noteFile = this.app.vault.getAbstractFileByPath(item.filePath);
      if (!(noteFile instanceof TFile)) throw new Error(`Daily Note not found: ${item.filePath}`);
      const sourceText = await this.app.vault.read(noteFile);
      const request = {
        databasePath: this.plugin.settings.databasePath,
        noteDate: item.date,
        todayDate: moment().format('YYYY-MM-DD'),
        fileName: item.fileName,
        filePath: item.filePath,
        sourceText,
        nutritionThresholds: {
          mealCalorieLimitKcal: this.plugin.settings.mealCalorieLimitKcal,
          dailyCalorieLimitKcal: this.plugin.settings.dailyCalorieLimitKcal,
          minimumProteinG: this.plugin.settings.minimumProteinG,
        },
      };
      const inspection = await this.plugin.nativeLogger.inspectDaily(request);
      this.inspection = inspection;
      if (item.status === 'needs-import' && !inspection.ready) {
        this.loggerOutput = inspection.errors.join('\n\n');
        this.renderDashboard();
        new Notice('Dry run failed. Review and copy the validation errors.', 10000);
        return;
      }

      let dryRunOutput = 'Native validation completed successfully.';
      let planningRequest: Awaited<ReturnType<DailyAssessmentView['planningSyncRequest']>> | null = null;
      if (item.status === 'current-future') {
        planningRequest = await this.planningSyncRequest();
        const preview = await this.plugin.nativeLogger.previewPlanning(planningRequest);
        dryRunOutput = [
          `${preview.noteCount} current/future note${preview.noteCount === 1 ? '' : 's'} inspected.`,
          `${preview.sessionCount} planned session${preview.sessionCount === 1 ? '' : 's'} projected.`,
          `${preview.warningCount} warning${preview.warningCount === 1 ? '' : 's'}.`,
          `${preview.deletedSourceCount} missing source${preview.deletedSourceCount === 1 ? '' : 's'} would be marked deleted.`,
        ].join('\n');
      }

      const confirmed = await confirmDailyImport(this.app, {
        title: item.status === 'current-future'
          ? `Sync current and future plans from ${item.date}`
          : `Import ${item.date}`,
        explanation: item.status === 'current-future'
          ? 'This replaces ephemeral planning projections for all current and future EH Daily Notes. It does not create canonical sessions or a database backup.'
          : 'The native validation passed. This writes the canonical historical import for this date.',
        confirmLabel: item.status === 'current-future' ? 'Sync future plans' : 'Import date',
        inspection,
        dryRunOutput,
      });
      if (!confirmed) return;

      this.actionButton?.setText(item.status === 'current-future' ? 'Syncing…' : 'Importing…');
      if (item.status === 'current-future') {
        const result = await this.plugin.nativeLogger.syncPlanning(planningRequest!);
        this.loggerOutput = [
          `Projected ${result.sessionCount} session${result.sessionCount === 1 ? '' : 's'} from ${result.noteCount} note${result.noteCount === 1 ? '' : 's'}.`,
          `Warnings: ${result.warningCount}. Missing sources marked deleted: ${result.deletedSourceCount}.`,
          ...backupMutationOutput(result),
        ].join('\n');
      } else {
        const result = await this.plugin.nativeLogger.importHistoricalDaily(request);
        this.loggerOutput = [
          `Imported ${result.sessionCount} sessions, ${result.transactionCount} transactions, ${result.exerciseCount} exercises, and ${result.foodRowCount} food rows.`,
          `Milestones: ${result.milestoneCount}. Admin events: ${result.adminEventCount}.`,
          ...backupMutationOutput(result),
        ].join('\n');
      }
      await this.refresh();
      if (item.status === 'current-future') {
        new Notice('Current and future planning projections were refreshed.', 8000);
      } else {
        const imported = this.selectedItem?.status === 'imported';
        if (imported) new Notice(`${item.date} imported successfully.`, 8000);
        else new Notice('Import did not complete. Review the logger output.', 10000);
      }
    } catch (error) {
      this.loggerOutput = error instanceof Error ? error.message : String(error);
      this.renderDashboard();
      new Notice('EH Logger could not complete the requested action.', 10000);
    } finally {
      if (activeButton?.isConnected) {
        activeButton.disabled = false;
        activeButton.setText(item.status === 'current-future' ? 'Sync future' : 'Import');
      }
    }
  }

  private async planningSyncRequest(): Promise<{
    databasePath: string;
    cutoffDate: string;
    notes: Array<{
      noteDate: string;
      fileName: string;
      filePath: string;
      sourceText: string;
    }>;
  }> {
    const cutoffDate = moment().format('YYYY-MM-DD');
    const candidates = this.items.filter((candidate) => (
      candidate.status === 'current-future' && candidate.date >= cutoffDate
    ));
    const notes = await Promise.all(candidates.map(async (candidate) => {
      const file = this.app.vault.getAbstractFileByPath(candidate.filePath);
      if (!(file instanceof TFile)) throw new Error(`Daily Note not found: ${candidate.filePath}`);
      return {
        noteDate: candidate.date,
        fileName: candidate.fileName,
        filePath: candidate.filePath,
        sourceText: await this.app.vault.read(file),
      };
    }));
    return { databasePath: this.plugin.settings.databasePath, cutoffDate, notes };
  }

  private statusLabel(item: DailyNoteListItem): string {
    if (item.status === 'imported') return 'Imported';
    if (item.temporalState === 'overdue') return 'Awaiting historical import';
    if (item.temporalState === 'current') return item.sourceState ? 'Today · projected' : 'Today';
    return item.sourceState ? 'Future · projected' : 'Future';
  }

  private renderError(error: unknown): void {
    const panel = this.contentEl.createDiv({ cls: 'eqh-error-panel' });
    panel.createEl('h3', { text: 'Could not open Daily Assessment' });
    panel.createDiv({ text: error instanceof Error ? error.message : String(error) });
  }

  private async checkDatabaseFingerprint(): Promise<void> {
    try {
      const fingerprint = await this.plugin.database.fingerprint(this.plugin.settings.databasePath);
      if (this.lastFingerprint != null
        && fingerprint !== this.lastFingerprint
        && !this.plugin.nativeLogger.isRunning) {
        await this.refresh();
      }
      this.lastFingerprint = fingerprint;
    } catch {
      // The visible error state or next successful poll will explain/recover.
    }
  }
}
