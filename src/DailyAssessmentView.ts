import { ItemView, moment, normalizePath, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type { FormWorkflowServices } from './plugin-services.ts';
import { buildDailyNoteList, type DailyNoteListItem } from './daily-note-index.ts';
import { confirmMealImport } from './MealImportConfirmationModal.ts';
import type { DailyAssessmentQueryResult } from './read-models/daily.ts';
import type { DailyInspection } from './logger/daily-note.ts';
import type { MealInspection } from './logger/meals.ts';
import { backupMutationOutput } from './logger/service.ts';
import { openReferenceRepair } from './CommandForms.ts';
import { unresolvedReferencesFromErrors } from './unresolved-references.ts';
import {
  renderDailyAssessmentReport,
  reportFromAssessment,
  reportFromInspection,
} from './DailyAssessmentReport.ts';

export const EXAMINED_HUMAN_DAILY_ASSESSMENT_VIEW_TYPE = 'examined-human-daily-assessment';

const FINGERPRINT_INTERVAL_MS = 10_000;

function formatDecimal(value: number): string {
  return value.toFixed(2);
}

export class DailyAssessmentView extends ItemView {
  private selectedDate: string | null = null;
  private items: DailyNoteListItem[] = [];
  private selectedItem: DailyNoteListItem | null = null;
  private assessment: DailyAssessmentQueryResult | null = null;
  private inspection: DailyInspection | null = null;
  private mealInspection: MealInspection | null = null;
  private loggerOutput: string | null = null;
  private renderGeneration = 0;
  private fingerprintTimer: number | null = null;
  private lastFingerprint: string | null = null;
  private actionButton: HTMLButtonElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: FormWorkflowServices) {
    super(leaf);
  }

  getViewType(): string {
    return EXAMINED_HUMAN_DAILY_ASSESSMENT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Examined Human — Daily Assessment';
  }

  getIcon(): string {
    return 'clipboard-check';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('examined-human-daily-view');
    await this.refresh();
    this.registerEvent(this.app.vault.on('modify', (file) => {
      try {
        const databaseChanged = normalizePath(file.path)
          === this.plugin.database.normalizeVaultPath(this.plugin.settings.databasePath);
        const selectedNoteChanged = file.path === this.selectedItem?.filePath;
        if ((databaseChanged || selectedNoteChanged)
          && !this.plugin.logger.isRunning) void this.refresh();
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
    this.contentEl.addClass('examined-human-daily-view');
    this.contentEl.createDiv({ cls: 'examined-human-loading', text: 'Loading Daily Assessment…' });
    try {
      const today = moment().format('YYYY-MM-DD');
      const index = await this.plugin.database.dailyNoteIndex(this.plugin.settings.databasePath);
      const items = await buildDailyNoteList(this.app, index, today, this.plugin.knownForms());
      if (generation !== this.renderGeneration) return;
      this.items = items;
      if (!this.selectedDate || !items.some((item) => item.date === this.selectedDate)) {
        this.selectedDate = items.find((item) => item.temporalState === 'current')?.date
          ?? items[0]?.date
          ?? null;
      }
      this.selectedItem = items.find((item) => item.date === this.selectedDate) ?? null;
      this.assessment = this.selectedDate
        ? await this.plugin.database.dailyAssessment(
          this.plugin.settings.databasePath,
          this.selectedDate,
          today,
          {
            label: this.plugin.settings.valuationUnitLabel,
            referenceUnit: this.plugin.settings.valuationReferenceUnit,
          },
          this.plugin.settings.sleepDayBoundaryHour,
        )
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
          this.mealInspection = await this.plugin.logger.inspectMeals({
            databasePath: this.plugin.settings.databasePath,
            sourceText,
            nutritionThresholds: thresholds,
          });
          try {
            this.inspection = await this.plugin.logger.inspectDaily({
              databasePath: this.plugin.settings.databasePath,
              noteDate: this.selectedItem.date,
              todayDate: today,
              fileName: this.selectedItem.fileName,
              filePath: this.selectedItem.filePath,
              sourceText,
              nutritionThresholds: thresholds,
              valuationLabel: this.plugin.settings.valuationUnitLabel,
              valuationReferenceUnit: this.plugin.settings.valuationReferenceUnit,
              sleepDayBoundaryHour: this.plugin.settings.sleepDayBoundaryHour,
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
    this.contentEl.addClass('examined-human-daily-view');
    this.renderHeader();
    if (!this.selectedItem || !this.assessment) {
      this.contentEl.createDiv({ cls: 'examined-human-daily-empty', text: 'No EH Daily Notes were found.' });
      return;
    }
    const body = this.contentEl.createDiv({ cls: 'examined-human-daily-layout' });
    this.renderSidebar(body);
    const main = body.createEl('main', { cls: 'examined-human-daily-main' });
    this.renderValidation(main);
    if (this.inspection?.errors.length) return;
    const report = this.inspection && this.selectedItem.status !== 'imported'
      ? reportFromInspection(this.inspection)
      : reportFromAssessment(this.selectedItem.date, this.assessment);
    if (this.inspection) report.warnings = [];
    renderDailyAssessmentReport(this.app, main, report, {
      sessionColors: this.plugin.settings.sessionColors,
      initialScrollHour: this.plugin.settings.initialScrollHour,
      valuationLabel: this.plugin.settings.valuationUnitLabel,
    });
  }

  private renderHeader(): void {
    const header = this.contentEl.createDiv({ cls: 'examined-human-toolbar examined-human-daily-toolbar' });
    const identity = header.createDiv({ cls: 'examined-human-toolbar-identity' });
    identity.createEl('h2', { text: 'Examined Human — Daily Assessment' });
    identity.createDiv({
      cls: 'examined-human-toolbar-status',
      text: this.selectedItem
        ? `${moment(this.selectedItem.date, 'YYYY-MM-DD').format('ddd, MMM D, YYYY')} · ${this.statusLabel(this.selectedItem)}`
        : 'Review journal data and safely import historical notes',
    });
    const actions = header.createDiv({ cls: 'examined-human-toolbar-actions' });
    this.actionButton = actions.createEl('button', { cls: 'examined-human-toolbar-button mod-cta' });
    if (!this.selectedItem) {
      this.actionButton.setText('Import');
      this.actionButton.disabled = true;
    } else if (this.selectedItem.status === 'imported') {
      this.actionButton.setText('Already imported');
      this.actionButton.disabled = true;
    } else {
      if (this.selectedItem.temporalState === 'future') {
        this.actionButton.setText('Future assessment');
        this.actionButton.disabled = true;
      } else {
        this.actionButton.setText('Import');
        this.actionButton.addEventListener('click', () => { void this.handleImport(); });
      }
    }
    const discoverButton = actions.createEl('button', { text: 'Discover forms', cls: 'examined-human-toolbar-button' });
    discoverButton.addEventListener('click', () => {
      discoverButton.disabled = true;
      discoverButton.setText('Discovering…');
      void this.plugin.discoverFormsWithNotice().finally(() => {
        if (discoverButton.isConnected) { discoverButton.disabled = false; discoverButton.setText('Discover forms'); }
      });
    });
    actions.createEl('button', { text: 'Refresh', cls: 'examined-human-toolbar-button' })
      .addEventListener('click', () => { void this.plugin.refreshViews(); });
  }

  private renderSidebar(container: HTMLElement): void {
    const sidebar = container.createEl('aside', {
      cls: 'examined-human-daily-sidebar',
      attr: { 'aria-label': 'Daily Notes, newest first' },
    });
    for (const item of this.items) {
      const button = sidebar.createEl('button', {
        cls: [
          'examined-human-daily-date-button',
          `is-${item.temporalState}`,
          item.date === this.selectedDate ? 'is-selected' : '',
        ].join(' '),
        attr: { 'aria-label': `${item.date}, ${this.statusLabel(item)}` },
      });
      button.createSpan({ cls: 'examined-human-daily-date-primary', text: moment(item.date, 'YYYY-MM-DD').format('MMM D, YYYY') });
      button.createSpan({ cls: 'examined-human-daily-date-secondary', text: moment(item.date, 'YYYY-MM-DD').format('dddd') });
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
    const section = container.createEl('section', { cls: 'examined-human-daily-validation' });
    const heading = section.createDiv({ cls: 'examined-human-daily-section-heading' });
    heading.createEl('h3', { text: 'Import readiness' });
    const badge = heading.createSpan({ cls: 'examined-human-daily-status-badge' });
    if (item.status === 'imported') {
      badge.addClass('is-ready');
      badge.setText('Imported');
      section.createDiv({ text: 'This date is finalized. Import controls are disabled.', cls: 'examined-human-daily-validation-note' });
    } else if (this.inspection) {
      badge.addClass(this.inspection.ready ? 'is-ready' : 'is-blocked');
      badge.setText(this.inspection.ready ? 'Ready for confirmation' : 'Needs attention');
      this.renderCompleteness(section, this.inspection);
      this.renderUnresolvedReferences(section);
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

  private renderUnresolvedReferences(container: HTMLElement): void {
    const item = this.selectedItem;
    if (!item || item.status === 'imported') return;
    const references = unresolvedReferencesFromErrors([
      ...(this.inspection?.errors ?? []),
      ...(this.mealInspection?.errors ?? []),
    ]);
    if (references.length === 0) return;
    const panel = container.createDiv({ cls: 'examined-human-unresolved-references' });
    const heading = panel.createDiv({ cls: 'examined-human-daily-section-heading' });
    heading.createEl('h4', { text: 'Unresolved references' });
    heading.createSpan({
      cls: 'examined-human-daily-section-meta',
      text: `${references.length} to review`,
    });
    panel.createDiv({
      cls: 'examined-human-daily-section-subtitle',
      text: 'Resolve only the names you are ready to decide. A correction is staged in this Daily Note, then validation runs again.',
    });
    const list = panel.createDiv({ cls: 'examined-human-unresolved-list' });
    for (const reference of references) {
      const row = list.createDiv({ cls: 'examined-human-unresolved-item' });
      const text = row.createDiv();
      text.createEl('strong', { text: reference.rawName });
      text.createDiv({
        cls: 'examined-human-unresolved-meta',
        text: `${reference.kind} · ${reference.contexts.join(', ')}`,
      });
      const fix = row.createEl('button', { text: 'Resolve…' });
      fix.addEventListener('click', () => { void this.openReferenceRepair(reference, fix); });
    }
  }

  private async openReferenceRepair(
    reference: ReturnType<typeof unresolvedReferencesFromErrors>[number],
    button: HTMLButtonElement,
  ): Promise<void> {
    try {
      button.disabled = true;
      const catalog = await this.plugin.database.commandCatalog(this.plugin.settings.databasePath);
      openReferenceRepair(this.app, {
        plugin: this.plugin,
        reference,
        catalog,
        preferredTarget: this.selectedItem?.status === 'imported' ? null : this.selectedItem,
        onStaged: async () => this.refresh(),
      });
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 10_000);
    } finally {
      button.disabled = false;
    }
  }

  private renderNativeMeals(container: HTMLElement, item: DailyNoteListItem): void {
    const block = container.createDiv({ cls: 'examined-human-native-meals' });
    const heading = block.createDiv({ cls: 'examined-human-daily-section-heading' });
    heading.createEl('h4', { text: 'Native Meals' });
    const component = this.assessment?.mealImport ?? null;
    const state = heading.createSpan({ cls: 'examined-human-daily-status-badge' });
    if (item.status === 'imported' || component?.lifecycleState === 'finalized') {
      state.addClass('is-ready');
      state.setText('Finalized');
      block.createDiv({
        cls: 'examined-human-daily-validation-note',
        text: 'Historical Meals are immutable once finalized by a component or full Daily Note import.',
      });
      return;
    }

    const inspection = this.mealInspection;
    if (!inspection) {
      state.addClass('is-blocked');
      state.setText('Unavailable');
      block.createDiv({ cls: 'examined-human-daily-validation-note', text: 'The selected Daily Note could not be read.' });
      return;
    }

    state.addClass(inspection.ready ? 'is-ready' : 'is-blocked');
    state.setText(component ? 'Ephemeral · replaceable' : inspection.ready ? 'Ready' : 'Needs attention');
    block.createDiv({
      cls: 'examined-human-daily-section-subtitle',
      text: 'Parsed and validated inside Obsidian on desktop and mobile. Snacks count toward daily calories but never directly as leisure.',
    });
    const grid = block.createDiv({ cls: 'examined-human-daily-completeness-grid' });
    const values = [
      ['Foods', inspection.foodRowCount],
      ['Direct leisure', `${inspection.directLeisureMeals}/3`],
      ['Final leisure', `${inspection.leisureMeals}/3`],
      ['Calories', inspection.nutrition.dailyCaloriesKcal == null ? '—' : formatDecimal(inspection.nutrition.dailyCaloriesKcal)],
      ['Protein', inspection.nutrition.proteinG == null ? '—' : `${formatDecimal(inspection.nutrition.proteinG)} g`],
      ['Dieted', inspection.nutrition.evaluatedDieted == null
        ? '—'
        : inspection.nutrition.evaluatedDieted === 1 ? 'Yes' : 'No'],
    ];
    for (const [label, value] of values) {
      const card = grid.createDiv({ cls: 'examined-human-daily-mini-stat' });
      card.createSpan({ text: String(label) });
      card.createEl('strong', { text: String(value) });
    }
    if (inspection.warnings.length > 0) {
      this.renderMessageList(block, 'Meals warnings', inspection.warnings, 'is-warning');
    }
    if (inspection.errors.length > 0) {
      this.renderMessageList(block, 'Meals blockers', inspection.errors, 'is-error');
    }
    const actions = block.createDiv({ cls: 'examined-human-native-meals-actions' });
    const button = actions.createEl('button', {
      cls: 'mod-cta',
      text: component ? 'Replace Meals' : 'Import Meals',
    });
    button.disabled = !inspection.ready || this.plugin.logger.isRunning;
    button.addEventListener('click', () => { void this.handleNativeMealImport(); });
    if (component) {
      actions.createSpan({
        cls: 'examined-human-daily-validation-note',
        text: `Last written by v${component.pluginVersion} · ${component.rowCount} food row${component.rowCount === 1 ? '' : 's'}`,
      });
      if (item.status === 'needs-import' && component.lifecycleState === 'ephemeral') {
        actions.createSpan({
          cls: 'examined-human-daily-validation-note',
          text: 'This replacement finalizes the completed historical Meals component.',
        });
      }
    } else if (item.status === 'needs-import') {
      actions.createSpan({
        cls: 'examined-human-daily-validation-note',
        text: 'First import finalizes this historical Meals component.',
      });
    }
  }

  private renderCompleteness(container: HTMLElement, inspection: DailyInspection): void {
    const completeness = inspection.completeness;
    if (!completeness) return;
    const grid = container.createDiv({ cls: 'examined-human-daily-completeness-grid' });
    const counts = [
      ['Sessions', completeness.session_count],
      ['Transactions', completeness.transaction_count],
      ['Exercises', completeness.exercise_count],
      ['Foods', completeness.meal_count],
      ['Milestones', completeness.milestone_count],
    ];
    for (const [label, value] of counts) {
      const card = grid.createDiv({ cls: 'examined-human-daily-mini-stat' });
      card.createSpan({ text: String(label) });
      card.createEl('strong', { text: String(value) });
    }
    const missing = completeness.missing_daily_metrics;
    const metricState = container.createDiv({
      cls: `examined-human-daily-completeness-callout ${missing.length > 0 ? 'is-incomplete' : 'is-complete'}`,
    });
    metricState.createEl('strong', {
      text: missing.length > 0
        ? `${missing.length} empty daily metric cell${missing.length === 1 ? '' : 's'}`
        : 'All daily metric cells are filled',
    });
    if (missing.length > 0) metricState.createDiv({ text: missing.join(', ') });
  }

  private renderMessageList(container: HTMLElement, label: string, messages: string[], className: string): void {
    const callout = container.createDiv({ cls: `examined-human-daily-validation-callout ${className}` });
    callout.createEl('strong', { text: label });
    const list = callout.createEl('ul');
    for (const message of messages) list.createEl('li', { text: message });
  }

  private renderCopyableOutput(container: HTMLElement, label: string, output: string): void {
    const block = container.createDiv({ cls: 'examined-human-daily-output-block' });
    const header = block.createDiv({ cls: 'examined-human-daily-output-header' });
    header.createEl('strong', { text: label });
    header.createEl('button', { text: 'Copy', cls: 'examined-human-toolbar-button' }).addEventListener('click', () => {
      void navigator.clipboard.writeText(output).then(() => new Notice('Copied logger output.'));
    });
    const textarea = block.createEl('textarea', { cls: 'examined-human-daily-output', attr: { readonly: 'true', rows: '7' } });
    textarea.value = output;
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
      const inspection = await this.plugin.logger.inspectMeals({
        databasePath: this.plugin.settings.databasePath,
        sourceText,
        nutritionThresholds: {
          mealCalorieLimitKcal: this.plugin.settings.mealCalorieLimitKcal,
          dailyCalorieLimitKcal: this.plugin.settings.dailyCalorieLimitKcal,
          minimumProteinG: this.plugin.settings.minimumProteinG,
        },
      });
      this.mealInspection = inspection;
      if (!inspection.ready) {
        this.renderDashboard();
        new Notice('Meals validation failed. Review the blockers before importing.', 10000);
        return;
      }
      const confirmed = await confirmMealImport(this.app, {
        date: item.date,
        historical: item.status === 'needs-import',
        replacing: this.assessment?.mealImport != null,
        inspection,
      });
      if (!confirmed) return;

      const result = await this.plugin.logger.importMeals({
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
    if (item.temporalState === 'future') {
      new Notice('Future Daily Forms cannot be imported. Wait until that date.', 10_000);
      return;
    }
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
        valuationLabel: this.plugin.settings.valuationUnitLabel,
        valuationReferenceUnit: this.plugin.settings.valuationReferenceUnit,
        sleepDayBoundaryHour: this.plugin.settings.sleepDayBoundaryHour,
      };
      const inspection = await this.plugin.logger.inspectDaily(request);
      this.inspection = inspection;
      if (!inspection.ready) {
        this.loggerOutput = inspection.errors.join('\n\n');
        this.renderDashboard();
        new Notice('Failed. Look at the errors in the assessment.', 10000);
        return;
      }
      this.actionButton?.setText('Importing…');
      const result = await this.plugin.logger.importHistoricalDaily(request);
      await this.plugin.markImportedEhFormFileIfComplete(noteFile);
      this.loggerOutput = [
        `Imported ${result.sessionCount} sessions, ${result.transactionCount} transactions, ${result.exerciseCount} exercises, and ${result.foodRowCount} food rows.`,
        `Milestones: ${result.milestoneCount}. Admin events: ${result.adminEventCount}.`,
        ...backupMutationOutput(result),
      ].join('\n');
      await this.refresh();
      const imported = this.selectedItem?.status === 'imported';
      if (imported) new Notice('Imported successfully.', 8000);
      else new Notice('Failed. Look at the errors in the assessment.', 10000);
    } catch (error) {
      this.loggerOutput = error instanceof Error ? error.message : String(error);
      this.renderDashboard();
      new Notice('EH Logger could not complete the requested action.', 10000);
    } finally {
      if (activeButton?.isConnected) {
        activeButton.disabled = false;
        activeButton.setText('Import');
      }
    }
  }

  private statusLabel(item: DailyNoteListItem): string {
    if (item.status === 'imported') return 'Imported';
    if (item.temporalState === 'overdue') return 'Awaiting historical import';
    if (item.temporalState === 'current') return item.sourceState ? 'Today · projected' : 'Today';
    return item.sourceState ? 'Future · projected' : 'Future';
  }

  private renderError(error: unknown): void {
    const panel = this.contentEl.createDiv({ cls: 'examined-human-error-panel' });
    panel.createEl('h3', { text: 'Could not open Daily Assessment' });
    panel.createDiv({ text: error instanceof Error ? error.message : String(error) });
  }

  private async checkDatabaseFingerprint(): Promise<void> {
    try {
      const fingerprint = await this.plugin.database.fingerprint(this.plugin.settings.databasePath);
      if (this.lastFingerprint != null
        && fingerprint !== this.lastFingerprint
        && !this.plugin.logger.isRunning) {
        await this.refresh();
      }
      this.lastFingerprint = fingerprint;
    } catch {
      // The visible error state or next successful poll will explain/recover.
    }
  }
}
