import { moment, Notice, Plugin, TFile } from 'obsidian';
import { ExaminedHumanDatabase } from './examined-human-database.ts';
import { DailyAssessmentView, EXAMINED_HUMAN_DAILY_ASSESSMENT_VIEW_TYPE } from './DailyAssessmentView.ts';
import { CommandCenterView, EXAMINED_HUMAN_COMMAND_CENTER_VIEW_TYPE } from './CommandCenterView.ts';
import { EngagementDashboardView, EXAMINED_HUMAN_ENGAGEMENT_DASHBOARD_VIEW_TYPE } from './EngagementDashboardView.ts';
import { ExerciseDashboardView, EXAMINED_HUMAN_EXERCISE_DASHBOARD_VIEW_TYPE } from './ExerciseDashboardView.ts';
import { FinancialDashboardView, EXAMINED_HUMAN_FINANCIAL_DASHBOARD_VIEW_TYPE } from './FinancialDashboardView.ts';
import { normalizeJournalFolder } from './journal-folder.ts';
import {
  cachedEhForms,
  discoverEhForms,
  formsInText,
  sanitizeFormDiscoveryCache,
  type EhFormKind,
  type FormDiscoveryResult,
} from './form-discovery.ts';
import {
  ehFormFrontmatterEntry,
  ehFormFrontmatterStatus,
  fileHasCompletedImportableForms,
} from './form-status.ts';
import { LoggerService } from './logger/service.ts';
import { NutritionDashboardView, EXAMINED_HUMAN_NUTRITION_DASHBOARD_VIEW_TYPE } from './NutritionDashboardView.ts';
import { TimelineView, EXAMINED_HUMAN_CALENDAR_VIEW_TYPE } from './TimelineView.ts';
import { WeeklyAssessmentView, EXAMINED_HUMAN_WEEKLY_ASSESSMENT_VIEW_TYPE } from './WeeklyAssessmentView.ts';
import { DEFAULT_SETTINGS, ExaminedHumanSettingTab, type ExaminedHumanSettings } from './settings.ts';
import { sanitizeDismissedWarningKeys } from './warning-preferences.ts';
import { confirmWeeklyAction } from './WeeklyActionConfirmationModal.ts';
import { confirmDailyImport } from './DailyImportConfirmationModal.ts';
import { dailyAssessmentTitle } from './DailyAssessmentReport.ts';
import { openReferenceRepair } from './CommandForms.ts';
import type { DailyNoteListItem } from './daily-note-index.ts';

const AUTHORITATIVE_DATABASE_RELOAD_INTERVAL_MS = 10 * 60 * 1000;
const COMMAND_DASHBOARD_COMMAND_ID = 'open-command-dashboard';
const COMMAND_DASHBOARD_COMMAND_NAME = 'Open Command Dashboard';

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function storedJournalFolder(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.journalFolder;
  try {
    return normalizeJournalFolder(value);
  } catch {
    return DEFAULT_SETTINGS.journalFolder;
  }
}

function storedText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export default class ExaminedHumanPlugin extends Plugin {
  settings: ExaminedHumanSettings = DEFAULT_SETTINGS;
  database!: ExaminedHumanDatabase;
  logger!: LoggerService;
  /** @deprecated Use logger. Retained temporarily for integration compatibility. */
  get nativeLogger(): LoggerService { return this.logger; }
  private refreshPromise: Promise<void> | null = null;
  private todayPlanningSyncPromise: Promise<void> | null = null;
  private lastTodayPlanningSyncError: string | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.database = new ExaminedHumanDatabase(this.app);
    this.logger = new LoggerService(
      this.app,
      this.manifest.version,
      () => this.settings.backupRetentionLimit,
    );

    this.registerView(EXAMINED_HUMAN_CALENDAR_VIEW_TYPE, (leaf) => new TimelineView(leaf, this));
    this.registerView(EXAMINED_HUMAN_WEEKLY_ASSESSMENT_VIEW_TYPE, (leaf) => new WeeklyAssessmentView(leaf, this));
    this.registerView(EXAMINED_HUMAN_DAILY_ASSESSMENT_VIEW_TYPE, (leaf) => new DailyAssessmentView(leaf, this));
    this.registerView(EXAMINED_HUMAN_COMMAND_CENTER_VIEW_TYPE, (leaf) => new CommandCenterView(leaf, this));
    this.registerView(EXAMINED_HUMAN_ENGAGEMENT_DASHBOARD_VIEW_TYPE, (leaf) => new EngagementDashboardView(leaf, this));
    this.registerView(EXAMINED_HUMAN_FINANCIAL_DASHBOARD_VIEW_TYPE, (leaf) => new FinancialDashboardView(leaf, this));
    this.registerView(EXAMINED_HUMAN_NUTRITION_DASHBOARD_VIEW_TYPE, (leaf) => new NutritionDashboardView(leaf, this));
    this.registerView(EXAMINED_HUMAN_EXERCISE_DASHBOARD_VIEW_TYPE, (leaf) => new ExerciseDashboardView(leaf, this));
    this.addRibbonIcon('calendar-clock', 'Open Examined Human calendar', () => { void this.activateView(); });
    this.addCommand({
      id: 'open-daily-assessment',
      name: 'Daily Assessment',
      callback: () => { void this.activateDailyAssessmentView(); },
    });
    this.addCommand({
      id: 'import-daily-form-from-active-file',
      name: 'Import Daily Form from Active File',
      callback: () => { void this.importActiveForm('daily'); },
    });
    this.addCommand({
      id: 'import-weekly-form-from-active-file',
      name: 'Import Weekly Form from Active File',
      callback: () => { void this.importActiveForm('weekly'); },
    });
    this.addCommand({
      id: 'import-budget-form-from-active-file',
      name: 'Import Budget Form from Active File',
      callback: () => { void this.importActiveForm('budget'); },
    });
    this.addCommand({
      id: COMMAND_DASHBOARD_COMMAND_ID,
      name: COMMAND_DASHBOARD_COMMAND_NAME,
      callback: () => { void this.activateCommandCenterView(); },
    });
    this.addCommand({
      id: 'open-weekly-assessment',
      name: 'Weekly Assessment',
      callback: () => { void this.activateWeeklyAssessmentView(); },
    });
    this.addCommand({
      id: 'open-engagement-dashboard',
      name: 'Engagement Dashboard',
      callback: () => { void this.activateEngagementDashboardView(); },
    });
    this.addCommand({
      id: 'open-financial-dashboard',
      name: 'Financial Dashboard',
      callback: () => { void this.activateFinancialDashboardView(); },
    });
    this.addCommand({
      id: 'open-nutrition-dashboard',
      name: 'Nutrition Dashboard',
      callback: () => { void this.activateNutritionDashboardView(); },
    });
    this.addCommand({
      id: 'open-exercise-dashboard',
      name: 'Exercise Dashboard',
      callback: () => { void this.activateExerciseDashboardView(); },
    });
    this.addCommand({
      id: 'open-calendar',
      name: 'Open calendar dashboard',
      callback: () => { void this.activateView(); },
    });
    this.addCommand({
      id: 'refresh-calendar',
      name: 'Reload EH.db and refresh all dashboards',
      callback: () => { void this.refreshViews(); },
    });
    this.addSettingTab(new ExaminedHumanSettingTab(this.app, this));
    this.registerInterval(window.setInterval(() => {
      if (!this.logger.isRunning) void this.refreshViews();
    }, AUTHORITATIVE_DATABASE_RELOAD_INTERVAL_MS));
  }

  async loadSettings(): Promise<void> {
    const raw = await this.loadData() as (Partial<ExaminedHumanSettings> & { pythonInterpreterPath?: unknown }) | null;
    const stored = raw ? { ...raw } : null;
    const hadLegacyPythonSetting = stored !== null && 'pythonInterpreterPath' in stored;
    if (stored) delete stored.pythonInterpreterPath;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(stored ?? {}),
      sessionColors: {
        ...DEFAULT_SETTINGS.sessionColors,
        ...(stored?.sessionColors ?? {}),
      },
      backupRetentionLimit: Number.isSafeInteger(stored?.backupRetentionLimit)
        && Number(stored?.backupRetentionLimit) >= 0
        ? Number(stored?.backupRetentionLimit)
        : DEFAULT_SETTINGS.backupRetentionLimit,
      journalFolder: storedJournalFolder(stored?.journalFolder),
      formDiscoveryMode: stored?.formDiscoveryMode === 'journal-folder' ? 'journal-folder' : 'tagged-vault',
      formDiscoveryCache: sanitizeFormDiscoveryCache(stored?.formDiscoveryCache),
      dayColumnWidth: boundedInteger(stored?.dayColumnWidth, DEFAULT_SETTINGS.dayColumnWidth, 120, 280),
      mobileDayColumnWidth: boundedInteger(
        stored?.mobileDayColumnWidth,
        DEFAULT_SETTINGS.mobileDayColumnWidth,
        120,
        280,
      ),
      defaultDashboardDays: boundedInteger(
        stored?.defaultDashboardDays,
        DEFAULT_SETTINGS.defaultDashboardDays,
        1,
        3650,
      ),
      sleepDayBoundaryHour: boundedInteger(
        stored?.sleepDayBoundaryHour,
        DEFAULT_SETTINGS.sleepDayBoundaryHour,
        0,
        23,
      ),
      valuationUnitLabel: storedText(stored?.valuationUnitLabel, DEFAULT_SETTINGS.valuationUnitLabel),
      valuationReferenceUnit: storedText(stored?.valuationReferenceUnit, DEFAULT_SETTINGS.valuationReferenceUnit),
      dismissedWarningKeys: sanitizeDismissedWarningKeys(stored?.dismissedWarningKeys),
    };
    if (hadLegacyPythonSetting) await this.saveData(this.settings);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  knownForms(): FormDiscoveryResult['forms'] {
    return cachedEhForms(this.app, this.settings.formDiscoveryCache);
  }

  async discoverForms(): Promise<FormDiscoveryResult> {
    const result = await discoverEhForms(
      this.app,
      this.settings.formDiscoveryMode,
      this.settings.journalFolder,
      this.settings.formDiscoveryCache,
    );
    this.settings.formDiscoveryCache = result.cache;
    await this.saveSettings();
    return result;
  }

  async discoverFormsWithNotice(): Promise<void> {
    try {
      const result = await this.discoverForms();
      new Notice(`Found ${result.forms.length} EH Form${result.forms.length === 1 ? '' : 's'}; scanned ${result.scannedFileCount} changed file${result.scannedFileCount === 1 ? '' : 's'} and reused ${result.reusedFileCount} cached file${result.reusedFileCount === 1 ? '' : 's'}.`, 8_000);
      await this.refreshViews();
    } catch (error) {
      new Notice(`EH Form discovery stopped: ${error instanceof Error ? error.message : String(error)}`, 12_000);
    }
  }

  async syncTodayPlanningFromDailyForm(): Promise<void> {
    if (this.todayPlanningSyncPromise) return this.todayPlanningSyncPromise;
    if (this.logger.isRunning) return;
    this.todayPlanningSyncPromise = this.performTodayPlanningSync();
    try {
      await this.todayPlanningSyncPromise;
      this.lastTodayPlanningSyncError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this.lastTodayPlanningSyncError) {
        new Notice(`Today's Daily Form could not be projected: ${message}`, 12_000);
        this.lastTodayPlanningSyncError = message;
      }
    } finally {
      this.todayPlanningSyncPromise = null;
    }
  }

  private async performTodayPlanningSync(): Promise<void> {
    const today = moment().format('YYYY-MM-DD');
    const discovery = await this.discoverForms();
    const matches = discovery.forms.filter((form) => form.kind === 'daily' && form.date === today);
    if (matches.length > 1) {
      throw new Error(`Multiple eligible Daily Forms declare ${today}. Keep exactly one current form.`);
    }

    let note: {
      noteDate: string;
      fileName: string;
      filePath: string;
      sourceText: string;
    } | null = null;
    if (matches.length === 1) {
      const discovered = matches[0];
      const file = this.app.vault.getAbstractFileByPath(discovered.filePath);
      if (!(file instanceof TFile)) throw new Error(`Daily Form was not found: ${discovered.filePath}`);
      const sourceText = await this.app.vault.read(file);
      const dailyForms = formsInText(file, sourceText).filter((form) => form.kind === 'daily');
      if (dailyForms.length !== 1 || dailyForms[0].date !== today) {
        throw new Error(`${file.path} must contain exactly one Daily Form dated ${today}.`);
      }
      note = { noteDate: today, fileName: file.name, filePath: file.path, sourceText };
    }

    const result = await this.logger.syncPlanningDate({
      databasePath: this.settings.databasePath,
      noteDate: today,
      note,
    });
    if (result.changed) this.database = new ExaminedHumanDatabase(this.app);
  }

  async markImportedEhFormFileIfComplete(file: TFile): Promise<boolean> {
    try {
      const sourceText = await this.app.vault.read(file);
      const forms = formsInText(file, sourceText);
      const [dailyIndex, weeklyIndex] = await Promise.all([
        this.database.dailyNoteIndex(this.settings.databasePath),
        this.database.weeklyPlanIndex(this.settings.databasePath),
      ]);
      const complete = fileHasCompletedImportableForms(
        forms,
        file.path,
        dailyIndex.importedNotes,
        weeklyIndex.importedPlans,
      );
      if (!complete) return false;

      let markerAccepted = false;
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        if (ehFormFrontmatterStatus(frontmatter) === 'excluded') return;
        const entry = ehFormFrontmatterEntry(frontmatter);
        frontmatter[entry?.[0] ?? 'EH form'] = 'imported';
        markerAccepted = true;
      });
      if (!markerAccepted) return false;
      delete this.settings.formDiscoveryCache.entries[file.path];
      await this.saveSettings();
      return true;
    } catch (error) {
      new Notice(
        `The form import succeeded, but its EH form status could not be updated: ${error instanceof Error ? error.message : String(error)}`,
        12_000,
      );
      return false;
    }
  }

  private async activeForm(kind: EhFormKind): Promise<{ file: TFile; sourceText: string; form: FormDiscoveryResult['forms'][number] }> {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) throw new Error('Open a Markdown note that contains the form you want to import.');
    const sourceText = await this.app.vault.read(file);
    const matches = formsInText(file, sourceText).filter((form) => form.kind === kind);
    if (matches.length === 0) throw new Error(`The active note contains no EH ${kind === 'daily' ? 'Daily' : kind === 'weekly' ? 'Weekly' : 'Budget'} Form.`);
    if (matches.length > 1) throw new Error(`The active note contains ${matches.length} EH ${kind} forms. Keep one form of each kind per note before importing.`);
    return { file, sourceText, form: matches[0] };
  }

  private async importActiveForm(kind: EhFormKind): Promise<void> {
    try {
      const { file, sourceText, form } = await this.activeForm(kind);
      if (kind === 'weekly') {
        const preview = await this.logger.inspectWeekly({
          databasePath: this.settings.databasePath, weekStartDate: form.startDate!, fileName: file.name, filePath: file.path, sourceText,
        });
        const confirmed = await confirmWeeklyAction(this.app, {
          title: `Import Weekly Form starting ${preview.weekStart}`,
          explanation: 'This records the weekly direction, schedule, and commitments. Reimporting the same start date updates that weekly plan.',
          confirmLabel: 'Import week',
          dryRunOutput: `Source: ${file.path}\nWeek: ${preview.weekStart}\nCommitments: ${preview.commitmentCount}\nPlanned sessions: ${preview.sessionCount}\nPlanned time: ${preview.plannedMinutes} minutes`,
          warning: 'Nothing has changed yet. This does not write daily-note sessions; use Sync week in Weekly Assessment when you are ready.',
        });
        if (!confirmed) return;
        await this.logger.importWeekly({ databasePath: this.settings.databasePath, weekStartDate: form.startDate!, fileName: file.name, filePath: file.path, sourceText });
        await this.markImportedEhFormFileIfComplete(file);
        new Notice(`Imported Weekly Form starting ${preview.weekStart}.`, 8_000);
      } else if (kind === 'budget') {
        const preview = await this.logger.inspectBudget({ databasePath: this.settings.databasePath, fileName: file.name, filePath: file.path, sourceText });
        const confirmed = await confirmWeeklyAction(this.app, {
          title: 'Import Budget Form',
          explanation: preview.updatedExistingBudget ? 'This updates the stored Budget Form with the same start and end dates.' : 'This adds this dated Budget Form to the database.',
          confirmLabel: preview.updatedExistingBudget ? 'Update budget' : 'Import budget',
          dryRunOutput: `Source: ${file.path}\nPeriod: ${preview.periodStart} through ${preview.periodEnd}\nBudget targets: ${preview.targetCount}\nExpected movements: ${preview.expectedMovementCount}`,
          warning: 'Nothing has changed yet. Expected movements are planning evidence only; they never create transactions or reminders.',
        });
        if (!confirmed) return;
        await this.logger.importBudget({ databasePath: this.settings.databasePath, fileName: file.name, filePath: file.path, sourceText });
        new Notice(`Imported Budget Form for ${preview.periodStart} through ${preview.periodEnd}.`, 8_000);
      } else {
        const today = moment().format('YYYY-MM-DD');
        const noteDate = form.date!;
        const request = {
          databasePath: this.settings.databasePath, noteDate, todayDate: today, fileName: file.name, filePath: file.path, sourceText,
          nutritionThresholds: {
            mealCalorieLimitKcal: this.settings.mealCalorieLimitKcal,
            dailyCalorieLimitKcal: this.settings.dailyCalorieLimitKcal,
            minimumProteinG: this.settings.minimumProteinG,
          },
          valuationLabel: this.settings.valuationUnitLabel,
          valuationReferenceUnit: this.settings.valuationReferenceUnit,
          sleepDayBoundaryHour: this.settings.sleepDayBoundaryHour,
        };
        const inspection = await this.logger.inspectDaily(request);
        const temporalState: DailyNoteListItem['temporalState'] = noteDate < today
          ? 'overdue'
          : noteDate === today ? 'current' : 'future';
        const preferredTarget: DailyNoteListItem = {
          date: noteDate,
          fileName: file.name,
          filePath: file.path,
          status: noteDate < today ? 'needs-import' : 'current-future',
          temporalState,
          importedAt: null,
          sourceState: null,
        };
        const future = noteDate > today;
        const confirmed = await confirmDailyImport(this.app, {
          title: `${dailyAssessmentTitle(noteDate, today)} — ${noteDate}`,
          explanation: future
            ? 'Review the future form below. It cannot become a canonical Daily receipt until its date arrives.'
            : 'Review the complete assessment below. Confirmation writes a durable canonical Daily receipt with a backup.',
          confirmLabel: 'Import daily assessment',
          inspection,
          sessionColors: this.settings.sessionColors,
          initialScrollHour: this.settings.initialScrollHour,
          valuationLabel: this.settings.valuationUnitLabel,
          canConfirm: !future,
          blockedReason: future
            ? 'Future Daily Forms are assessment-only. Wait until this date before importing it into the database.'
            : undefined,
          onResolveReference: (reference) => {
            void this.database.commandCatalog(this.settings.databasePath).then((catalog) => {
              openReferenceRepair(this.app, {
                plugin: this,
                reference,
                catalog,
                preferredTarget,
                onStaged: async () => this.importActiveForm('daily'),
              });
            }).catch((error) => new Notice(error instanceof Error ? error.message : String(error), 10_000));
          },
        });
        if (!confirmed) return;
        await this.logger.importHistoricalDaily(request);
        await this.markImportedEhFormFileIfComplete(file);
        new Notice('Imported successfully.', 8_000);
      }
      await this.refreshViews();
    } catch (error) {
      new Notice(`EH Form import did not complete: ${error instanceof Error ? error.message : String(error)}`, 12_000);
    }
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(EXAMINED_HUMAN_CALENDAR_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: EXAMINED_HUMAN_CALENDAR_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async activateWeeklyAssessmentView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(EXAMINED_HUMAN_WEEKLY_ASSESSMENT_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: EXAMINED_HUMAN_WEEKLY_ASSESSMENT_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async activateDailyAssessmentView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(EXAMINED_HUMAN_DAILY_ASSESSMENT_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: EXAMINED_HUMAN_DAILY_ASSESSMENT_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async activateCommandCenterView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(EXAMINED_HUMAN_COMMAND_CENTER_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: EXAMINED_HUMAN_COMMAND_CENTER_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async activateEngagementDashboardView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(EXAMINED_HUMAN_ENGAGEMENT_DASHBOARD_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: EXAMINED_HUMAN_ENGAGEMENT_DASHBOARD_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async activateFinancialDashboardView(): Promise<void> {
    await this.activateDashboardView(EXAMINED_HUMAN_FINANCIAL_DASHBOARD_VIEW_TYPE);
  }

  async activateNutritionDashboardView(): Promise<void> {
    await this.activateDashboardView(EXAMINED_HUMAN_NUTRITION_DASHBOARD_VIEW_TYPE);
  }

  async activateExerciseDashboardView(): Promise<void> {
    await this.activateDashboardView(EXAMINED_HUMAN_EXERCISE_DASHBOARD_VIEW_TYPE);
  }

  private async activateDashboardView(viewType: string): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(viewType)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: viewType, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async refreshViews(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    if (this.logger.isRunning) return;
    this.refreshPromise = this.performAuthoritativeRefresh();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async performAuthoritativeRefresh(): Promise<void> {
    // Recreate the source boundary before every global/manual refresh. ExaminedHumanDatabase
    // never retains an open SQLite database, but this also discards any future
    // per-instance state and makes the physical vault file authoritative.
    this.database = new ExaminedHumanDatabase(this.app);
    const calendarRefreshes = this.app.workspace.getLeavesOfType(EXAMINED_HUMAN_CALENDAR_VIEW_TYPE)
      .map(async (leaf) => {
        if (leaf.view instanceof TimelineView) await leaf.view.refresh();
      });
    const weeklyRefreshes = this.app.workspace.getLeavesOfType(EXAMINED_HUMAN_WEEKLY_ASSESSMENT_VIEW_TYPE)
      .map(async (leaf) => {
        if (leaf.view instanceof WeeklyAssessmentView) await leaf.view.refresh();
      });
    const dailyRefreshes = this.app.workspace.getLeavesOfType(EXAMINED_HUMAN_DAILY_ASSESSMENT_VIEW_TYPE)
      .map(async (leaf) => {
        if (leaf.view instanceof DailyAssessmentView) await leaf.view.refresh();
      });
    const commandCenterRefreshes = this.app.workspace.getLeavesOfType(EXAMINED_HUMAN_COMMAND_CENTER_VIEW_TYPE)
      .map(async (leaf) => {
        if (leaf.view instanceof CommandCenterView) await leaf.view.refresh();
      });
    const engagementRefreshes = this.app.workspace.getLeavesOfType(EXAMINED_HUMAN_ENGAGEMENT_DASHBOARD_VIEW_TYPE)
      .map(async (leaf) => {
        if (leaf.view instanceof EngagementDashboardView) await leaf.view.refresh();
      });
    const financialRefreshes = this.app.workspace.getLeavesOfType(EXAMINED_HUMAN_FINANCIAL_DASHBOARD_VIEW_TYPE)
      .map(async (leaf) => {
        if (leaf.view instanceof FinancialDashboardView) await leaf.view.refresh();
      });
    const nutritionRefreshes = this.app.workspace.getLeavesOfType(EXAMINED_HUMAN_NUTRITION_DASHBOARD_VIEW_TYPE)
      .map(async (leaf) => {
        if (leaf.view instanceof NutritionDashboardView) await leaf.view.refresh();
      });
    const exerciseRefreshes = this.app.workspace.getLeavesOfType(EXAMINED_HUMAN_EXERCISE_DASHBOARD_VIEW_TYPE)
      .map(async (leaf) => {
        if (leaf.view instanceof ExerciseDashboardView) await leaf.view.refresh();
      });
    await Promise.all([
      ...calendarRefreshes,
      ...weeklyRefreshes,
      ...dailyRefreshes,
      ...commandCenterRefreshes,
      ...engagementRefreshes,
      ...financialRefreshes,
      ...nutritionRefreshes,
      ...exerciseRefreshes,
    ]);
  }
}
