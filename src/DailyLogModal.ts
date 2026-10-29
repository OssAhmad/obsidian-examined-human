import { App, Modal, TFile, moment } from 'obsidian';
import type { FormWorkflowServices } from './plugin-services.ts';
import { renderDailyAssessmentReport, reportFromAssessment, reportFromInspection } from './DailyAssessmentReport.ts';
import type { DailyTimeGrouping } from './daily-time.ts';
import { captureScrollState, restoreScrollState } from './refresh/scroll-state.ts';

/** The calendar's read-only day report, presented over the unchanged calendar. */
export class DailyLogModal extends Modal {
  private closed = false;
  private generation = 0;
  private refreshing: Promise<void> | null = null;
  private releaseUpdates: (() => void) | null = null;
  private sourcePath: string | null = null;
  private timeGrouping: DailyTimeGrouping = 'engagement';
  private updateVersion = 0;
  private pendingMessage: string | null = null;
  private noticeEl: HTMLElement | null = null;

  constructor(app: App, private plugin: FormWorkflowServices, private date: string, private dismissed?: () => void) {
    super(app);
  }

  onOpen(): void {
    this.closed = false;
    this.modalEl.addClass('examined-human-daily-log-modal');
    this.releaseUpdates = this.plugin.watchSourceUpdates(message => {
      this.updateVersion++;
      this.pendingMessage = message;
      this.renderNotice();
    }, () => this.sourcePath);
    this.contentEl.createEl('p', { text: 'Loading Daily Log…' });
    void this.refresh();
  }

  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshContent().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async refreshContent(): Promise<void> {
    const generation = ++this.generation;
    const version = this.updateVersion;
    const scroll = captureScrollState(this.contentEl);
    try {
      const today = moment().format('YYYY-MM-DD');
      const settings = this.plugin.settings;
      const assessment = await this.plugin.database.dailyAssessment(settings.databasePath, this.date, today,
        { label: settings.valuationUnitLabel, referenceUnit: settings.valuationReferenceUnit }, settings.sleepDayBoundaryHour);
      if (this.closed || generation !== this.generation) return;
      const sources = this.plugin.knownForms().filter(form => form.kind === 'daily' && form.date === this.date);
      let report = reportFromAssessment(this.date, assessment);
      this.sourcePath = sources.length === 1 ? sources[0].filePath : null;
      if (!assessment.imported) {
        if (sources.length > 1) throw new Error(`Two EH Daily Forms declare ${this.date}.`);
        const file = this.sourcePath ? this.app.vault.getAbstractFileByPath(this.sourcePath) : null;
        if (file instanceof TFile) {
          const inspection = await this.plugin.logger.inspectDaily({
            databasePath: settings.databasePath, noteDate: this.date, todayDate: today,
            fileName: file.name, filePath: file.path, sourceText: await this.app.vault.read(file),
            nutritionThresholds: { mealCalorieLimitKcal: settings.mealCalorieLimitKcal,
              dailyCalorieLimitKcal: settings.dailyCalorieLimitKcal, minimumProteinG: settings.minimumProteinG },
            valuationLabel: settings.valuationUnitLabel, valuationReferenceUnit: settings.valuationReferenceUnit,
            sleepDayBoundaryHour: settings.sleepDayBoundaryHour,
          });
          report = reportFromInspection(inspection);
        }
      }
      if (this.closed || generation !== this.generation) return;
      this.renderHeader();
      renderDailyAssessmentReport(this.app, this.contentEl, report, {
        dayColumnWidth: settings.dayColumnWidth, sessionColors: settings.sessionColors,
        initialScrollHour: settings.initialScrollHour, valuationLabel: settings.valuationUnitLabel,
        timeGrouping: this.timeGrouping, onTimeGroupingChange: grouping => { this.timeGrouping = grouping; },
      });
    } catch (error) {
      if (this.closed || generation !== this.generation) return;
      this.renderHeader();
      this.contentEl.createEl('p', { text: error instanceof Error ? error.message : String(error) });
    }
    if (this.closed || generation !== this.generation) return;
    this.contentEl.createEl('p', { cls: 'examined-human-daily-import-guidance', text: 'For imports, please visit the Daily Assessment dashboard.' });
    this.contentEl.createDiv({ cls: 'examined-human-daily-log-actions' }).createEl('button', { text: 'Close' })
      .addEventListener('click', () => this.close());
    if (version === this.updateVersion) this.pendingMessage = null;
    this.renderNotice();
    restoreScrollState(this.contentEl, scroll);
    window.requestAnimationFrame(() => {
      if (!this.closed && generation === this.generation) restoreScrollState(this.contentEl, scroll);
    });
  }

  private renderHeader(): void {
    this.contentEl.empty();
    const header = this.contentEl.createDiv({ cls: 'examined-human-toolbar examined-human-daily-toolbar' });
    header.createEl('h2', { text: `Daily Log — ${moment(this.date, 'YYYY-MM-DD').format('ddd, MMM D, YYYY')}` });
    header.createEl('button', { text: 'Refresh', cls: 'examined-human-toolbar-button' })
      .addEventListener('click', () => { void this.plugin.refreshViews(); });
    this.noticeEl = this.contentEl.createDiv();
  }

  private renderNotice(): void {
    this.noticeEl?.empty();
    if (!this.pendingMessage || !this.noticeEl) return;
    this.noticeEl.createEl('p', { attr: { role: 'status' }, text: `${this.pendingMessage}. Your current display is unchanged. Use Refresh to update this report.` });
  }

  onClose(): void {
    this.closed = true;
    this.generation++;
    this.releaseUpdates?.();
    this.releaseUpdates = null;
    this.noticeEl = null;
    this.contentEl.empty();
    this.dismissed?.();
  }
}
