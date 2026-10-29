import { WorkspaceLeaf } from 'obsidian';
import { ReadingView } from './refresh/reading-view.ts';
import type { DashboardServices } from './plugin-services.ts';
import type { MedicalDashboardItem } from './read-models/medical.ts';
import { recordsTable } from './MedicalForms.ts';

// Keep the saved workspace type so an existing records tab upgrades in place.
export const MEDICAL_DASHBOARD_VIEW_TYPE = 'examined-human-records';

export class MedicalDashboardView extends ReadingView {
  private page = 0;
  private selectedKey: string | null = null;
  private selectedItem: MedicalDashboardItem | null = null;
  private generation = 0;

  constructor(leaf: WorkspaceLeaf, private plugin: DashboardServices) { super(leaf, plugin); }
  getViewType(): string { return MEDICAL_DASHBOARD_VIEW_TYPE; }
  getDisplayText(): string { return 'Medical Dashboard'; }
  getIcon(): string { return 'clipboard-list'; }
  protected scrollContext(): string { return `${this.page}:${this.selectedKey ?? ''}`; }
  protected sourceNotePath(): string | null { return this.selectedItem?.sourcePath ?? null; }
  async onOpen(): Promise<void> {
    this.startReadingUpdates();
    this.contentEl.addClass('examined-human-medical-view');
    await this.refresh();
  }
  async onClose(): Promise<void> { this.generation++; this.stopReadingUpdates(); this.contentEl.empty(); }

  protected async refreshContent(): Promise<void> {
    const generation = ++this.generation;
    try {
      let index = await this.plugin.database.medicalDashboardPage(this.plugin.settings.databasePath, this.page);
      if (generation !== this.generation) return;
      if (!index.items.length && this.page > 0 && index.total > 0) {
        this.page = Math.floor((index.total - 1) / 50);
        index = await this.plugin.database.medicalDashboardPage(this.plugin.settings.databasePath, this.page);
        if (generation !== this.generation) return;
      }
      this.selectedItem = index.items.find(item => item.key === this.selectedKey) ?? index.items[0] ?? null;
      this.selectedKey = this.selectedItem?.key ?? null;
      const item = this.selectedItem;
      const report = item?.kind === 'report' && item.reportId != null
        ? await this.plugin.database.medicalReport(this.plugin.settings.databasePath, item.reportId) : null;
      const health = item?.kind === 'daily'
        ? await this.plugin.database.dailyHealth(this.plugin.settings.databasePath, item.date) : undefined;
      if (generation !== this.generation || (item?.key ?? null) !== this.selectedKey) return;

      this.contentEl.empty();
      const toolbar = this.contentEl.createDiv({ cls: 'examined-human-medical-toolbar' });
      toolbar.createEl('h2', { text: 'Medical Dashboard' });
      toolbar.createEl('button', { text: 'Refresh', cls: 'examined-human-toolbar-button' })
        .addEventListener('click', () => { void this.plugin.refreshViews(); });
      if (index.needsMigration) {
        this.contentEl.createEl('p', { text: 'Enable medical records in Settings → Examined Human → General → Tools and maintenance → Medical database migration.' });
        return;
      }

      const layout = this.contentEl.createDiv({ cls: 'examined-human-medical-layout' });
      const main = layout.createEl('main', { cls: 'examined-human-medical-report', attr: { 'aria-label': 'Selected medical record' } });
      main.dataset.ehScrollKey = 'medical-report';
      if (!item) {
        main.createEl('p', { text: 'No imported medical records yet. Import a Medical Form or a Daily Form with Medical entries to begin.' });
      } else {
        main.createEl('h3', { text: item.title });
        main.createEl('p', { cls: 'examined-human-medical-meta', text: item.date || 'Unknown date' });
        main.createEl('button', { text: 'Open source note', cls: 'examined-human-toolbar-button' }).addEventListener('click', () => {
          void this.app.workspace.openLinkText(item.sourcePath, '');
        });
        if (report) {
          main.createEl('p', { cls: 'examined-human-medical-meta', text: `Report ID: ${String(report.report.report_id)} · Performed: ${String(report.report.performed ?? 'unknown')} · Reported: ${String(report.report.reported ?? 'unknown')}` });
          main.createEl('h4', { text: 'Measurements' });
          main.createEl('p', { text: `Recording state: ${String(report.report.measurements_state)}` });
          recordsTable(main, ['Measurement', 'Value', 'Unit', 'Notes'], report.measurements.map(m => [String(m.name), String(m.value_text), String(m.unit_at_time ?? '—'), String(m.notes ?? '')]));
          main.createEl('h4', { text: 'Procedures' });
          main.createEl('p', { text: `Recording state: ${String(report.report.procedures_state)}` });
          recordsTable(main, ['Procedure', 'Notes'], report.procedures.map(p => [String(p.name), String(p.notes)]));
        } else if (health) {
          main.createEl('h4', { text: 'Medication' });
          main.createEl('p', { text: `Recording state: ${health.medicationState}` });
          recordsTable(main, ['Time', 'Medication', 'Amount', 'Unit', 'Notes'], health.intakes.map(i => [i.time, i.name, String(i.amount), i.unit, i.notes]));
          main.createEl('h4', { text: 'Symptoms' });
          main.createEl('p', { text: `Recording state: ${health.symptomsState}` });
          recordsTable(main, ['Time', 'Symptom', 'Notes'], health.occurrences.map(s => [s.time, s.name, s.notes]));
        }
      }

      const sidebar = layout.createEl('aside', { cls: 'examined-human-medical-sidebar', attr: { 'aria-label': 'Imported medical records, newest first' } });
      sidebar.dataset.ehScrollKey = 'medical-list';
      sidebar.createEl('h3', { text: 'Imported records' });
      sidebar.createEl('p', { text: `${index.total} records` });
      for (const entry of index.items) {
        const button = sidebar.createEl('button', {
          cls: `examined-human-daily-date-button${entry.key === this.selectedKey ? ' is-selected' : ''}`,
          attr: { 'aria-pressed': String(entry.key === this.selectedKey) },
        });
        button.createSpan({ cls: 'examined-human-daily-date-primary', text: entry.title });
        button.createSpan({ cls: 'examined-human-daily-date-secondary', text: `${entry.date || 'Unknown date'} · ${entry.kind === 'report' ? 'Medical report' : 'Daily medical'}` });
        button.addEventListener('click', () => {
          if (entry.key === this.selectedKey) return;
          this.selectedKey = entry.key;
          void this.refresh();
        });
      }
      if (index.total > 50) {
        const paging = sidebar.createDiv({ cls: 'examined-human-medical-paging' });
        const previous = paging.createEl('button', { text: 'Newer' }); previous.disabled = this.page === 0;
        previous.addEventListener('click', () => { this.page--; this.selectedKey = null; void this.refresh(); });
        const next = paging.createEl('button', { text: 'Older' }); next.disabled = (this.page + 1) * 50 >= index.total;
        next.addEventListener('click', () => { this.page++; this.selectedKey = null; void this.refresh(); });
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.contentEl.empty(); this.contentEl.createEl('p', { text: error instanceof Error ? error.message : String(error) });
    }
  }
}
