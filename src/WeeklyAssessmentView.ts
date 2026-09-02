import { ItemView, moment, normalizePath, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type ExaminedHumanPlugin from './main.ts';
import { buildDailyNoteList } from './daily-note-index.ts';
import { pathIsInJournalFolder } from './journal-folder.ts';
import type {
  FinancialDashboardQueryResult,
  WeeklyAssessmentQueryResult,
  WeeklyCommitmentAssessmentRecord,
} from './examined-human-query.ts';
import { formatDashboardAmount, formatDashboardDate } from './DashboardViewBase.ts';
import { confirmWeeklyAction } from './WeeklyActionConfirmationModal.ts';
import { buildWeeklyNoteList, type WeeklyNoteListItem } from './weekly-note-index.ts';
import type { WeeklyImportResult, WeeklyNoteWritePreview } from './native-logger/weekly.ts';
import type { PlanningSyncResult } from './native-logger/planning.ts';
import { backupMutationOutput } from './native-logger/write-service.ts';

export const EXAMINED_HUMAN_WEEKLY_ASSESSMENT_VIEW_TYPE = 'examined-human-weekly-assessment';

const FINGERPRINT_INTERVAL_MS = 10_000;
const WEEKLY_NOTE_PATTERN = /^\d{4}-W\d{1,2}\.md$/i;

function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function formatWeekRange(startDate: string, endDate: string): string {
  const start = moment(startDate, 'YYYY-MM-DD', true);
  const end = moment(endDate, 'YYYY-MM-DD', true);
  if (!start.isValid() || !end.isValid()) return `${startDate} – ${endDate}`;
  if (start.year() === end.year() && start.month() === end.month()) {
    return `${start.format('MMM D')}–${end.format('D, YYYY')}`;
  }
  if (start.year() === end.year()) return `${start.format('MMM D')} – ${end.format('MMM D, YYYY')}`;
  return `${start.format('MMM D, YYYY')} – ${end.format('MMM D, YYYY')}`;
}

function weeklyImportOutput(result: WeeklyImportResult): string {
  return [
    `Week start: ${result.weekStart}`,
    `Commitments: ${result.commitmentCount}`,
    `Planned sessions: ${result.sessionCount}`,
    `Planned time: ${formatDuration(result.plannedMinutes)}`,
  ].join('\n');
}

function weeklyWriteOutput(result: WeeklyNoteWritePreview): string {
  const details = result.notes.map((note) => (
    `${note.noteDate}: ${note.status}${note.sessionCount ? ` (${note.sessionCount} sessions)` : ''}`
  ));
  return [
    `Relevant Daily Notes: ${result.relevantDayCount}`,
    `Writable notes: ${result.writableNoteCount}`,
    `Existing-session notes skipped: ${result.skippedNoteCount}`,
    `Session rows: ${result.writtenSessionCount}`,
    ...details,
  ].join('\n');
}

function planningOutput(result: PlanningSyncResult): string {
  return [
    `Projected notes: ${result.noteCount}`,
    `Projected sessions: ${result.sessionCount}`,
    `Warnings: ${result.warningCount}`,
    `Missing sources marked deleted: ${result.deletedSourceCount}`,
  ].join('\n');
}

export class WeeklyAssessmentView extends ItemView {
  private selectedWeekStart: string | null = null;
  private items: WeeklyNoteListItem[] = [];
  private selectedItem: WeeklyNoteListItem | null = null;
  private assessment: WeeklyAssessmentQueryResult | null = null;
  private financeBriefing: FinancialDashboardQueryResult | null = null;
  private loggerOutput: string | null = null;
  private renderGeneration = 0;
  private fingerprintTimer: number | null = null;
  private lastFingerprint: string | null = null;
  private actionButton: HTMLButtonElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: ExaminedHumanPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return EXAMINED_HUMAN_WEEKLY_ASSESSMENT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Examined Human — Weekly Assessment';
  }

  getIcon(): string {
    return 'chart-column';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('examined-human-weekly-view');
    await this.refresh();
    this.registerEvent(this.app.vault.on('modify', (file) => {
      try {
        const databaseChanged = normalizePath(file.path)
          === this.plugin.database.normalizeVaultPath(this.plugin.settings.databasePath);
        const selectedNoteChanged = file.path === this.selectedItem?.filePath;
        if ((databaseChanged || selectedNoteChanged) && !this.plugin.nativeLogger.isRunning) void this.refresh();
      } catch {
        // Invalid database paths are explained by the visible query error.
      }
    }));
    this.registerEvent(this.app.vault.on('create', (file) => {
      if (WEEKLY_NOTE_PATTERN.test(file.name)) void this.refresh();
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (WEEKLY_NOTE_PATTERN.test(file.name)) void this.refresh();
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      const oldName = oldPath.split('/').pop() ?? '';
      if (WEEKLY_NOTE_PATTERN.test(file.name) || WEEKLY_NOTE_PATTERN.test(oldName)) void this.refresh();
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
    this.contentEl.addClass('examined-human-weekly-view');
    this.contentEl.createDiv({ cls: 'examined-human-loading', text: 'Loading Weekly Assessment…' });
    try {
      const today = moment().format('YYYY-MM-DD');
      const index = await this.plugin.database.weeklyPlanIndex(this.plugin.settings.databasePath);
      const items = await buildWeeklyNoteList(this.app, index, today, this.plugin.knownForms());
      if (generation !== this.renderGeneration) return;
      this.items = items;
      if (!this.selectedWeekStart || !items.some((item) => item.weekStartDate === this.selectedWeekStart)) {
        this.selectedWeekStart = items.find((item) => (
          item.weekStartDate <= today && item.weekEndDate >= today
        ))?.weekStartDate
          ?? items[0]?.weekStartDate
          ?? null;
      }
      this.selectedItem = items.find((item) => item.weekStartDate === this.selectedWeekStart) ?? null;
      this.assessment = this.selectedItem?.status === 'imported'
        ? await this.plugin.database.weeklyAssessment(
          this.plugin.settings.databasePath,
          this.selectedItem.weekStartDate,
        )
        : null;
      this.financeBriefing = null;
      if (this.assessment) {
        try {
          this.financeBriefing = await this.plugin.database.financialDashboard(
            this.plugin.settings.databasePath,
            this.assessment.weekStartDate,
            this.assessment.weekEndDate,
            {
              label: this.plugin.settings.valuationUnitLabel,
              referenceUnit: this.plugin.settings.valuationReferenceUnit,
            },
          );
        } catch {
          // Finance is an additive Schema v1 extension. Weekly assessment stays usable until it is upgraded.
        }
      }
      if (generation !== this.renderGeneration) return;
      this.renderDashboard();
    } catch (error) {
      if (generation !== this.renderGeneration) return;
      this.contentEl.empty();
      this.renderHeader();
      this.renderError(error);
    }
  }

  private renderDashboard(): void {
    this.contentEl.empty();
    this.contentEl.addClass('examined-human-weekly-view');
    this.renderHeader();
    if (!this.selectedItem) {
      this.contentEl.createDiv({
        cls: 'examined-human-weekly-empty',
        text: 'No weekly notes or imported weekly plans were found.',
      });
      return;
    }
    const body = this.contentEl.createDiv({ cls: 'examined-human-weekly-layout' });
    this.renderSidebar(body);
    const main = body.createEl('main', { cls: 'examined-human-weekly-main' });
    this.renderActionStatus(main);
    if (!this.assessment) {
      main.createDiv({
        cls: 'examined-human-weekly-empty',
        text: 'Import this weekly note to display its direction, commitments, and actual progress.',
      });
      return;
    }
    this.renderDirection(main, this.assessment);
    this.renderSummary(main, this.assessment.commitments);
    this.renderFinanceBriefing(main);
    this.renderCommitments(main, this.assessment);
  }

  private renderHeader(): void {
    const item = this.selectedItem;
    const today = moment().format('YYYY-MM-DD');
    const header = this.contentEl.createDiv({ cls: 'examined-human-toolbar examined-human-weekly-toolbar' });
    const identity = header.createDiv({ cls: 'examined-human-toolbar-identity' });
    identity.createEl('h2', { text: 'Examined Human — Weekly Assessment' });
    identity.createDiv({
      cls: 'examined-human-toolbar-status',
      text: item
        ? `${formatWeekRange(item.weekStartDate, item.weekEndDate)} · ${item.fileName} · ${this.statusLabel(item)}`
        : 'Committed time compared with logged sessions',
    });

    const controls = header.createDiv({ cls: 'examined-human-weekly-controls' });
    const dateInput = controls.createEl('input', {
      type: 'text',
      value: item?.weekStartDate ?? today,
      cls: 'examined-human-weekly-date-input',
      attr: {
        'aria-label': 'Date within a weekly note',
        placeholder: 'YYYY-MM-DD',
        inputmode: 'numeric',
      },
    });
    const submitDate = (): void => {
      const value = dateInput.value.trim();
      if (!moment(value, 'YYYY-MM-DD', true).isValid()) {
        new Notice('Enter a date as YYYY-MM-DD.', 5000);
        return;
      }
      const match = this.items.find((candidate) => (
        candidate.weekStartDate <= value && candidate.weekEndDate >= value
      ));
      if (!match) {
        new Notice('No weekly note contains that date.', 6000);
        return;
      }
      this.selectedWeekStart = match.weekStartDate;
      this.loggerOutput = null;
      void this.refresh();
    };
    dateInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submitDate();
    });
    controls.createEl('button', { text: 'Go', cls: 'examined-human-toolbar-button' })
      .addEventListener('click', submitDate);

    this.actionButton = controls.createEl('button', { cls: 'examined-human-toolbar-button mod-cta' });
    const syncEligible = item != null && item.status === 'imported' && item.weekEndDate >= today;
    if (!item) {
      this.actionButton.setText('Import week');
      this.actionButton.disabled = true;
    } else if (item.status === 'pending') {
      this.actionButton.setText('Import week');
      this.actionButton.addEventListener('click', () => { void this.handleAction(); });
    } else if (syncEligible) {
      this.actionButton.setText('Sync week');
      this.actionButton.addEventListener('click', () => { void this.handleAction(); });
    } else {
      this.actionButton.setText('Already imported');
      this.actionButton.disabled = true;
    }
    const discoverButton = controls.createEl('button', { text: 'Discover forms', cls: 'examined-human-toolbar-button' });
    discoverButton.addEventListener('click', () => {
      discoverButton.disabled = true;
      discoverButton.setText('Discovering…');
      void this.plugin.discoverFormsWithNotice().finally(() => {
        if (discoverButton.isConnected) { discoverButton.disabled = false; discoverButton.setText('Discover forms'); }
      });
    });
    controls.createEl('button', { text: 'Refresh', cls: 'examined-human-toolbar-button' })
      .addEventListener('click', () => { void this.plugin.refreshViews(); });
  }

  private renderSidebar(container: HTMLElement): void {
    const sidebar = container.createEl('aside', {
      cls: 'examined-human-daily-sidebar examined-human-weekly-sidebar',
      attr: { 'aria-label': 'Weekly notes, newest first' },
    });
    for (const item of this.items) {
      const button = sidebar.createEl('button', {
        cls: [
          'examined-human-daily-date-button',
          'examined-human-weekly-date-button',
          `is-${item.temporalState}`,
          item.weekStartDate === this.selectedWeekStart ? 'is-selected' : '',
        ].join(' '),
        attr: {
          'aria-label': `${item.weekLabel}, ${this.statusLabel(item)}, ${formatWeekRange(item.weekStartDate, item.weekEndDate)}`,
        },
      });
      button.createSpan({ cls: 'examined-human-daily-date-primary', text: item.weekLabel });
      button.createSpan({
        cls: 'examined-human-daily-date-secondary',
        text: formatWeekRange(item.weekStartDate, item.weekEndDate),
      });
      button.addEventListener('click', () => {
        if (item.weekStartDate === this.selectedWeekStart) return;
        this.selectedWeekStart = item.weekStartDate;
        this.loggerOutput = null;
        void this.refresh();
      });
    }
  }

  private renderActionStatus(container: HTMLElement): void {
    const item = this.selectedItem;
    if (!item) return;
    const section = container.createEl('section', { cls: 'examined-human-daily-validation examined-human-weekly-action-status' });
    const heading = section.createDiv({ cls: 'examined-human-daily-section-heading' });
    heading.createEl('h3', { text: 'Week readiness' });
    const badge = heading.createSpan({ cls: 'examined-human-daily-status-badge' });
    if (item.status === 'pending') {
      badge.addClass('is-blocked');
      badge.setText('Pending import');
      section.createDiv({
        cls: 'examined-human-daily-validation-note',
        text: 'Importing validates and records the weekly plan. It does not write Daily Notes.',
      });
    } else if (item.weekEndDate >= moment().format('YYYY-MM-DD')) {
      badge.addClass('is-ready');
      badge.setText('Ready to sync');
      section.createDiv({
        cls: 'examined-human-daily-validation-note',
        text: 'Sync week writes planned rows only to empty Daily Note Sessions sections, then refreshes future database projections.',
      });
    } else {
      badge.addClass('is-ready');
      badge.setText('Imported');
      section.createDiv({
        cls: 'examined-human-daily-validation-note',
        text: 'This historical weekly plan is available for assessment. Note-writing controls are disabled.',
      });
    }
    section.createDiv({
      cls: 'examined-human-daily-validation-note',
      text: 'Validation, import, Daily Note writing, and projection sync run natively on desktop and mobile.',
    });
    if (this.loggerOutput) this.renderCopyableOutput(section, 'Logger output', this.loggerOutput);
  }

  private renderCopyableOutput(container: HTMLElement, label: string, output: string): void {
    const block = container.createDiv({ cls: 'examined-human-daily-output-block' });
    const header = block.createDiv({ cls: 'examined-human-daily-output-header' });
    header.createEl('strong', { text: label });
    header.createEl('button', { text: 'Copy', cls: 'examined-human-toolbar-button' }).addEventListener('click', () => {
      void navigator.clipboard.writeText(output).then(() => new Notice('Copied logger output.'));
    });
    const textarea = block.createEl('textarea', {
      cls: 'examined-human-daily-output',
      attr: { readonly: 'true', rows: '9' },
    });
    textarea.value = output;
  }

  private renderDirection(container: HTMLElement, result: WeeklyAssessmentQueryResult): void {
    const values = [
      ['Main outcome', result.mainOutcome],
      ['Important deadline', result.importantDeadline],
      ['Constraint or risk', result.constraintOrRisk],
    ] as const;
    if (!values.some(([, value]) => value)) return;
    const section = container.createEl('section', { cls: 'examined-human-weekly-direction' });
    section.createEl('h3', { text: 'Weekly direction' });
    const grid = section.createDiv({ cls: 'examined-human-weekly-direction-grid' });
    for (const [label, value] of values) {
      if (!value) continue;
      const card = grid.createDiv({ cls: 'examined-human-weekly-direction-card' });
      card.createDiv({ cls: 'examined-human-weekly-eyebrow', text: label });
      card.createDiv({ cls: 'examined-human-weekly-direction-value', text: value });
    }
  }

  private renderSummary(container: HTMLElement, commitments: WeeklyCommitmentAssessmentRecord[]): void {
    const target = commitments.reduce((sum, commitment) => sum + commitment.targetMinutes, 0);
    const actual = commitments.reduce((sum, commitment) => sum + commitment.actualMinutes, 0);
    const remaining = Math.max(0, target - actual);
    const summary = container.createEl('section', {
      cls: 'examined-human-weekly-summary',
      attr: { 'aria-label': 'Weekly totals' },
    });
    const cards = [
      ['Commitments', String(commitments.length)],
      ['Committed', formatDuration(target)],
      ['Actual logged', formatDuration(actual)],
      [actual > target ? 'Above commitment' : 'Remaining', formatDuration(Math.abs(actual > target ? actual - target : remaining))],
    ];
    for (const [label, value] of cards) {
      const card = summary.createDiv({ cls: 'examined-human-weekly-summary-card' });
      card.createDiv({ cls: 'examined-human-weekly-eyebrow', text: label });
      card.createDiv({ cls: 'examined-human-weekly-summary-value', text: value });
    }
  }

  private renderFinanceBriefing(container: HTMLElement): void {
    const finance = this.financeBriefing;
    if (!finance) return;
    const section = container.createEl('section', { cls: 'examined-human-weekly-direction' });
    section.createEl('h3', { text: 'Weekly finance briefing' });
    const subtitle = section.createDiv({ cls: 'examined-human-weekly-chart-subtitle' });
    const budget = finance.activeBudget;
    subtitle.setText(budget
      ? `Active budget: ${formatDashboardDate(budget.periodStart)} – ${formatDashboardDate(budget.periodEnd)} · transfers and balance adjustments are excluded from cash flow.`
      : 'No active Budget Form. Cash flow excludes conservative internal transfers and marked balance adjustments.');
    const grid = section.createDiv({ cls: 'examined-human-weekly-direction-grid' });
    for (const currency of finance.currencies) {
      const card = grid.createDiv({ cls: 'examined-human-weekly-direction-card' });
      card.createDiv({ cls: 'examined-human-weekly-eyebrow', text: `${currency.currency} cash flow` });
      card.createDiv({ cls: 'examined-human-weekly-direction-value', text: formatDashboardAmount(currency.net, currency.currency) });
      card.createDiv({ text: `Inflow ${formatDashboardAmount(currency.inflow, currency.currency)} · outflow ${formatDashboardAmount(currency.outflow, currency.currency)}` });
    }
    if (finance.currencies.length === 0) grid.createDiv({ cls: 'examined-human-weekly-empty', text: 'No personal cash-flow entries were recorded in this week.' });
    if (!budget) return;
    const unmatched = budget.expectedMovements.filter((movement) => !movement.isMatched).length;
    section.createDiv({ cls: 'examined-human-daily-validation-note', text: `${budget.targets.length} budget target${budget.targets.length === 1 ? '' : 's'} · ${unmatched} expected movement${unmatched === 1 ? '' : 's'} unmatched` });
  }

  private renderCommitments(container: HTMLElement, result: WeeklyAssessmentQueryResult): void {
    const section = container.createEl('section', { cls: 'examined-human-weekly-commitments' });
    const heading = section.createDiv({ cls: 'examined-human-weekly-section-heading' });
    const copy = heading.createDiv();
    copy.createEl('h3', { text: 'Commitment assessment' });
    copy.createDiv({
      cls: 'examined-human-weekly-chart-subtitle',
      text: `Hours for ${formatWeekRange(result.weekStartDate, result.weekEndDate)} · all logged session types`,
    });
    const legend = heading.createDiv({ cls: 'examined-human-weekly-legend', attr: { 'aria-label': 'Chart legend' } });
    this.renderLegendItem(legend, 'Committed target', 'target');
    this.renderLegendItem(legend, 'Actual logged', 'actual');
    if (result.commitments.length === 0) {
      section.createDiv({ cls: 'examined-human-weekly-empty', text: 'This weekly plan has no commitments.' });
      return;
    }
    const maximum = Math.max(1, ...result.commitments.flatMap((item) => [item.targetMinutes, item.actualMinutes]));
    const chart = section.createDiv({ cls: 'examined-human-weekly-chart' });
    for (const commitment of result.commitments) this.renderCommitment(chart, commitment, maximum);
  }

  private renderLegendItem(container: HTMLElement, text: string, type: 'target' | 'actual'): void {
    const item = container.createDiv({ cls: 'examined-human-weekly-legend-item' });
    item.createSpan({ cls: `examined-human-weekly-legend-swatch examined-human-weekly-legend-swatch--${type}` });
    item.createSpan({ text });
  }

  private renderCommitment(
    container: HTMLElement,
    commitment: WeeklyCommitmentAssessmentRecord,
    maximum: number,
  ): void {
    const item = container.createEl('article', { cls: 'examined-human-weekly-commitment-card' });
    item.createEl('h4', { text: commitment.engagementName });
    const stage = item.createDiv({
      cls: 'examined-human-weekly-bar-stage',
      attr: {
        'aria-label': `${commitment.engagementName}: committed ${formatDuration(commitment.targetMinutes)}, actual ${formatDuration(commitment.actualMinutes)}`,
      },
    });
    const target = stage.createDiv({ cls: 'examined-human-weekly-bar-column' });
    target.createDiv({ cls: 'examined-human-weekly-bar-value', text: formatDuration(commitment.targetMinutes) });
    const targetBar = target.createDiv({ cls: 'examined-human-weekly-bar examined-human-weekly-bar--target' });
    targetBar.style.height = `calc((100% - 52px) * ${commitment.targetMinutes / maximum})`;
    target.createDiv({ cls: 'examined-human-weekly-bar-label', text: 'Planned' });
    const actual = stage.createDiv({ cls: 'examined-human-weekly-bar-column' });
    actual.createDiv({ cls: 'examined-human-weekly-bar-value', text: formatDuration(commitment.actualMinutes) });
    const actualBar = actual.createDiv({ cls: 'examined-human-weekly-bar examined-human-weekly-bar--actual' });
    actualBar.style.height = `calc((100% - 52px) * ${commitment.actualMinutes / maximum})`;
    actual.createDiv({ cls: 'examined-human-weekly-bar-label', text: 'Actual' });
    item.createDiv({ cls: 'examined-human-weekly-goal-label', text: 'Goal' });
    item.createDiv({ cls: 'examined-human-weekly-goal', text: commitment.commitmentText });
    const difference = commitment.targetMinutes - commitment.actualMinutes;
    item.createDiv({
      cls: `examined-human-weekly-variance ${difference >= 0 ? 'is-remaining' : 'is-exceeded'}`,
      text: difference >= 0
        ? `${formatDuration(difference)} remaining`
        : `${formatDuration(Math.abs(difference))} above commitment`,
    });
  }

  private async handleAction(): Promise<void> {
    const item = this.selectedItem;
    if (!item) return;
    const activeButton = this.actionButton;
    if (activeButton) {
      activeButton.disabled = true;
      activeButton.setText('Validating…');
    }
    try {
      if (item.status === 'pending') await this.importSelectedWeek(item);
      else if (item.weekEndDate >= moment().format('YYYY-MM-DD')) await this.syncSelectedWeek(item);
    } catch (error) {
      this.loggerOutput = error instanceof Error ? error.message : String(error);
      this.renderDashboard();
      new Notice('EH Logger could not complete the weekly action.', 10000);
    } finally {
      if (activeButton?.isConnected) {
        activeButton.disabled = false;
        activeButton.setText(item.status === 'pending' ? 'Import week' : 'Sync week');
      }
    }
  }

  private async importSelectedWeek(item: WeeklyNoteListItem): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(item.filePath);
    if (!(file instanceof TFile)) throw new Error(`Weekly note not found: ${item.filePath}`);
    const request = {
      databasePath: this.plugin.settings.databasePath,
      weekStartDate: item.weekStartDate,
      fileName: item.fileName,
      filePath: item.filePath,
      sourceText: await this.app.vault.read(file),
    };
    const preview = await this.plugin.nativeLogger.inspectWeekly(request);
    const output = weeklyImportOutput(preview);
    const confirmed = await confirmWeeklyAction(this.app, {
      title: `Import ${item.weekLabel}`,
      explanation: 'The weekly note passed validation. Importing records its direction, schedule, and commitments in EH.db.',
      confirmLabel: 'Import week',
      dryRunOutput: output,
      warning: 'Confirm only after reviewing the native weekly parser output.',
    });
    if (!confirmed) return;
    this.actionButton?.setText('Importing…');
    const live = await this.plugin.nativeLogger.importWeekly(request);
    await this.plugin.markImportedEhFormFileIfComplete(file);
    this.loggerOutput = [weeklyImportOutput(live), ...backupMutationOutput(live)].join('\n');
    await this.plugin.refreshViews();
    new Notice(`${item.weekLabel} imported successfully.`, 8000);
  }

  private async syncSelectedWeek(item: WeeklyNoteListItem): Promise<void> {
    const writeRequest = await this.weeklyDailyNoteRequest(item);
    const dryWrite = await this.plugin.nativeLogger.previewWeeklyDailyNoteWrites(writeRequest);
    const preview = weeklyWriteOutput(dryWrite);
    const confirmed = await confirmWeeklyAction(this.app, {
      title: `Sync ${item.weekLabel}`,
      explanation: 'This writes the displayed weekly sessions into empty Daily Note Sessions sections for today onward. Occupied days are skipped.',
      confirmLabel: 'Write and sync week',
      dryRunOutput: preview,
      warning: 'After note writing succeeds, the plugin will validate and refresh all current/future planning projections automatically.',
    });
    if (!confirmed) return;

    this.actionButton?.setText('Writing notes…');
    const liveWrite = await this.plugin.nativeLogger.writeWeeklyDailyNotes(writeRequest);

    this.actionButton?.setText('Checking projections…');
    const planningRequest = await this.planningSyncRequest();
    const futureDryRun = await this.plugin.nativeLogger.previewPlanning(planningRequest);

    this.actionButton?.setText('Syncing projections…');
    const futureLive = await this.plugin.nativeLogger.syncPlanning(planningRequest);
    this.loggerOutput = [
      `Week note write\n${weeklyWriteOutput(liveWrite)}`,
      `Future projection preview\n${planningOutput(futureDryRun)}`,
      `Future projection sync\n${planningOutput(futureLive)}\n${backupMutationOutput(futureLive).join('\n')}`,
    ].join('\n\n');
    await this.plugin.refreshViews();
    new Notice(`${item.weekLabel} was written to Daily Notes and future projections were refreshed.`, 10000);
  }

  private async weeklyDailyNoteRequest(item: WeeklyNoteListItem): Promise<{
    databasePath: string;
    selector: string;
    todayDate: string;
    notes: Array<{ noteDate: string; fileName: string; filePath: string; sourceText: string }>;
  }> {
    const todayDate = moment().format('YYYY-MM-DD');
    const first = item.weekStartDate > todayDate ? item.weekStartDate : todayDate;
    const dates: string[] = [];
    for (let date = moment(first, 'YYYY-MM-DD'); date.format('YYYY-MM-DD') <= item.weekEndDate; date = date.clone().add(1, 'day')) {
      dates.push(date.format('YYYY-MM-DD'));
    }
    const notes = await Promise.all(dates.map(async (date) => {
      const matches = this.app.vault.getMarkdownFiles().filter((file) => (
        file.basename === date && pathIsInJournalFolder(file.path, this.plugin.settings.journalFolder)
      ));
      if (matches.length !== 1) throw new Error(`Expected exactly one Daily Note for ${date}; found ${matches.length}.`);
      const file = matches[0];
      return {
        noteDate: date,
        fileName: file.name,
        filePath: file.path,
        sourceText: await this.app.vault.read(file),
      };
    }));
    return {
      databasePath: this.plugin.settings.databasePath,
      selector: item.weekStartDate,
      todayDate,
      notes,
    };
  }

  private async planningSyncRequest(): Promise<{
    databasePath: string;
    cutoffDate: string;
    notes: Array<{ noteDate: string; fileName: string; filePath: string; sourceText: string }>;
  }> {
    const cutoffDate = moment().format('YYYY-MM-DD');
    const index = await this.plugin.database.dailyNoteIndex(this.plugin.settings.databasePath);
    const items = await buildDailyNoteList(
      this.app,
      index,
      cutoffDate,
      this.plugin.knownForms(),
    );
    const candidates = items.filter((item) => item.status === 'current-future' && item.date >= cutoffDate);
    const notes = await Promise.all(candidates.map(async (item) => {
      const file = this.app.vault.getAbstractFileByPath(item.filePath);
      if (!(file instanceof TFile)) throw new Error(`Daily Note not found: ${item.filePath}`);
      return {
        noteDate: item.date,
        fileName: item.fileName,
        filePath: item.filePath,
        sourceText: await this.app.vault.read(file),
      };
    }));
    return { databasePath: this.plugin.settings.databasePath, cutoffDate, notes };
  }

  private statusLabel(item: WeeklyNoteListItem): string {
    if (item.status === 'imported') return 'Imported';
    if (item.temporalState === 'overdue') return 'Overdue import';
    if (item.temporalState === 'current') return 'Current week';
    return 'Future week';
  }

  private renderError(error: unknown): void {
    const panel = this.contentEl.createDiv({ cls: 'examined-human-error-panel' });
    panel.createEl('h3', { text: 'Could not open Weekly Assessment' });
    panel.createDiv({ text: error instanceof Error ? error.message : String(error) });
    panel.createEl('code', { text: this.plugin.settings.databasePath || '(no path configured)' });
  }

  private async checkDatabaseFingerprint(): Promise<void> {
    try {
      const fingerprint = await this.plugin.database.fingerprint(this.plugin.settings.databasePath);
      if (this.lastFingerprint != null && fingerprint !== this.lastFingerprint
        && !this.plugin.nativeLogger.isRunning) await this.refresh();
      this.lastFingerprint = fingerprint;
    } catch {
      // The visible error state or next successful poll will explain/recover.
    }
  }
}
