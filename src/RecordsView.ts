import { Modal, Notice, WorkspaceLeaf } from 'obsidian';
import type ExaminedHumanPlugin from './main.ts';
import { ReadingView } from './refresh/reading-view.ts';
import { recordsTable } from './MedicalForms.ts';

export const RECORDS_VIEW_TYPE = 'examined-human-records';
export class RecordsView extends ReadingView {
  private page = 0;
  constructor(leaf: WorkspaceLeaf, private plugin: ExaminedHumanPlugin) { super(leaf, plugin); }
  getViewType(): string { return RECORDS_VIEW_TYPE; }
  getDisplayText(): string { return 'Imported forms and health records'; }
  getIcon(): string { return 'table'; }
  protected scrollContext(): string { return `${RECORDS_VIEW_TYPE}:${this.page}`; }
  async onOpen(): Promise<void> { this.startReadingUpdates(); await this.refresh(); }
  async onClose(): Promise<void> { this.stopReadingUpdates(); }
  protected async refreshContent(): Promise<void> {
    const page = this.page;
    try {
      const result = await this.plugin.database.recordsPage(this.plugin.settings.databasePath, page);
      if (this.page !== page) return;
      this.contentEl.empty();
      this.contentEl.createEl('h2', { text: 'Imported forms and health records' });
      const toolbar = this.contentEl.createDiv({ cls: 'examined-human-records-toolbar' });
      toolbar.createEl('button', { text: 'Refresh' }).addEventListener('click', () => { void this.plugin.refreshViews(); });
      const previous = toolbar.createEl('button', { text: 'Previous page' }); previous.disabled = page === 0;
      previous.addEventListener('click', () => { this.page--; void this.refresh(); });
      const next = toolbar.createEl('button', { text: 'Next page' }); next.disabled = result.forms.length < 50 && result.days.length < 50;
      next.addEventListener('click', () => { this.page++; void this.refresh(); });
      toolbar.createSpan({ text: `Page ${page + 1} · up to 50 forms and 50 days per page` });
      this.contentEl.createEl('h3', { text: 'Imported forms' });
      recordsTable(this.contentEl, ['Type', 'ID', 'Date', 'Title', 'Source note', 'Imported / updated'], result.forms.map(r => [String(r.kind), String(r.id), String(r.date || 'unknown'), String(r.title || ''), String(r.path), String(r.updated)]));
      const actions = this.contentEl.createDiv();
      result.forms.forEach(r => {
        if (r.kind === 'Medical') actions.createEl('button', { text: `View medical report ${r.id}` }).addEventListener('click', () => {
          void this.plugin.database.medicalReport(this.plugin.settings.databasePath, Number(r.id)).then(data => {
            const modal = new Modal(this.app);
            modal.contentEl.createEl('h2', { text: String(data.report.title) });
            modal.contentEl.createEl('p', { text: `Report ID: ${r.id}; Measurements: ${String(data.report.measurements_state)}; Procedures: ${String(data.report.procedures_state)}` });
            recordsTable(modal.contentEl, ['Measurement', 'Value', 'Unit', 'Notes'], data.measurements.map(m => [String(m.name), String(m.value_text), String(m.unit_at_time ?? '—'), String(m.notes ?? '')]));
            recordsTable(modal.contentEl, ['Procedure', 'Notes'], data.procedures.map(p => [String(p.name), String(p.notes)]));
            modal.open();
          }).catch(error => new Notice(String(error)));
        });
        actions.createEl('button', { text: `Open ${r.kind} source (${r.id})` }).addEventListener('click', () => { void this.app.workspace.openLinkText(String(r.path), ''); });
      });
      this.contentEl.createEl('h3', { text: 'Medication and symptoms by day' });
      this.contentEl.createEl('p', { text: 'Canonical Daily imports only. Explicit none and unrecorded are shown separately. Standalone Medical reports appear above.' });
      recordsTable(this.contentEl, ['Date', 'Medication state', 'Medication entries', 'Symptoms state', 'Symptom entries'], result.days.map(d => [d.date, d.medicationState, d.medication.join('\n'), d.symptomsState, d.symptoms.join('\n')]));
    } catch (error) { this.contentEl.empty(); this.contentEl.createEl('p', { text: error instanceof Error ? error.message : String(error) }); }
  }
}
