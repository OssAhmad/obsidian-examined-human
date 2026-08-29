import { Plugin } from 'obsidian';
import { ExaminedHumanDatabase } from './examined-human-database.ts';
import { DailyAssessmentView, EXAMINED_HUMAN_DAILY_ASSESSMENT_VIEW_TYPE } from './DailyAssessmentView.ts';
import { EngagementDashboardView, EXAMINED_HUMAN_ENGAGEMENT_DASHBOARD_VIEW_TYPE } from './EngagementDashboardView.ts';
import { ExerciseDashboardView, EXAMINED_HUMAN_EXERCISE_DASHBOARD_VIEW_TYPE } from './ExerciseDashboardView.ts';
import { FinancialDashboardView, EXAMINED_HUMAN_FINANCIAL_DASHBOARD_VIEW_TYPE } from './FinancialDashboardView.ts';
import { normalizeJournalFolder } from './journal-folder.ts';
import { NativeLoggerWriteService } from './native-logger/write-service.ts';
import { NutritionDashboardView, EXAMINED_HUMAN_NUTRITION_DASHBOARD_VIEW_TYPE } from './NutritionDashboardView.ts';
import { TimelineView, EXAMINED_HUMAN_CALENDAR_VIEW_TYPE } from './TimelineView.ts';
import { WeeklyAssessmentView, EXAMINED_HUMAN_WEEKLY_ASSESSMENT_VIEW_TYPE } from './WeeklyAssessmentView.ts';
import { DEFAULT_SETTINGS, ExaminedHumanSettingTab, type ExaminedHumanSettings } from './settings.ts';
import { sanitizeDismissedWarningKeys } from './warning-preferences.ts';

const AUTHORITATIVE_DATABASE_RELOAD_INTERVAL_MS = 10 * 60 * 1000;

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

export default class ExaminedHumanPlugin extends Plugin {
  settings: ExaminedHumanSettings = DEFAULT_SETTINGS;
  database!: ExaminedHumanDatabase;
  nativeLogger!: NativeLoggerWriteService;
  private refreshPromise: Promise<void> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.database = new ExaminedHumanDatabase(this.app);
    this.nativeLogger = new NativeLoggerWriteService(
      this.app,
      this.manifest.version,
      () => this.settings.backupRetentionLimit,
    );

    this.registerView(EXAMINED_HUMAN_CALENDAR_VIEW_TYPE, (leaf) => new TimelineView(leaf, this));
    this.registerView(EXAMINED_HUMAN_WEEKLY_ASSESSMENT_VIEW_TYPE, (leaf) => new WeeklyAssessmentView(leaf, this));
    this.registerView(EXAMINED_HUMAN_DAILY_ASSESSMENT_VIEW_TYPE, (leaf) => new DailyAssessmentView(leaf, this));
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
      if (!this.nativeLogger.isRunning) void this.refreshViews();
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
      dismissedWarningKeys: sanitizeDismissedWarningKeys(stored?.dismissedWarningKeys),
    };
    if (hadLegacyPythonSetting) await this.saveData(this.settings);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
    if (this.nativeLogger.isRunning) return;
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
      ...engagementRefreshes,
      ...financialRefreshes,
      ...nutritionRefreshes,
      ...exerciseRefreshes,
    ]);
  }
}
