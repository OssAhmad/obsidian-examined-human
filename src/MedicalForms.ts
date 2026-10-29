import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type ExaminedHumanPlugin from './main.ts';
import type { MedicalPreview } from './logger/medical.ts';
import { confirmWeeklyAction } from './WeeklyActionConfirmationModal.ts';

export function recordsTable(container: HTMLElement, headings: string[], rows: string[][]): void {
  const wrapper = container.createDiv({ cls: 'examined-human-records-scroll' });
  const table = wrapper.createEl('table', { cls: 'examined-human-records-table' });
  const head = table.createEl('thead').createEl('tr');
  headings.forEach(h => head.createEl('th', { text: h }));
  const body = table.createEl('tbody');
  rows.forEach(row => { const tr = body.createEl('tr'); row.forEach(value => tr.createEl('td', { text: value })); });
  if (!rows.length) body.createEl('tr').createEl('td', { text: 'No recorded entries.', attr: { colspan: String(headings.length) } });
}
function confirmMedical(app: App, preview: MedicalPreview): Promise<boolean> {
  return new Promise(resolve => new MedicalConfirmation(app, preview, resolve).open());
}
class MedicalConfirmation extends Modal {
  private resolved = false;
  constructor(app: App, private preview: MedicalPreview, private choose: (value: boolean) => void) { super(app); }
  onOpen(): void {
    const p = this.preview;
    this.contentEl.createEl('h2', { text: p.reportId ? 'Replace imported Medical Form' : 'Import Medical Form' });
    this.contentEl.createEl('p', { text: p.title });
    this.contentEl.createEl('p', { text: `Performed: ${p.performed ?? 'unknown'}; Reported: ${p.reported ?? 'unknown'}; Source document: ${p.source ?? 'not attached'}` });
    this.contentEl.createEl('p', { text: `Measurements: ${p.measurementState}; Procedures: ${p.procedureState}` });
    recordsTable(this.contentEl, ['Measurement', 'Value', 'Unit', 'Notes'], p.measurements.map(m => [m.name, m.value, m.unit ?? '—', m.notes]));
    recordsTable(this.contentEl, ['Procedure', 'Notes'], p.procedures.map(p => [p.name, p.notes]));
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.finish(false));
    const submit = actions.createEl('button', { text: p.reportId ? 'Delete old entries and reimport' : 'Import report', cls: 'mod-cta' });
    if (p.reportId) {
      this.contentEl.createEl('p', { cls: 'examined-human-daily-confirm-warning', text: `Report ${p.reportId}: ${p.previousMeasurements} old measurements and ${p.previousProcedures} old procedures will be replaced. Omitted entries are deleted. Shared catalogs and other reports are retained. A backup is created first.` });
      submit.disabled = true;
      new Setting(this.contentEl).setName('I understand this replaces the complete report').addToggle(t => t.onChange(v => { submit.disabled = !v; }));
    } else this.contentEl.createEl('p', { text: 'Confirmation creates a durable report with a database backup. The source form is retained.' });
    submit.addEventListener('click', () => this.finish(true));
  }
  private finish(value: boolean): void { this.resolved = true; this.choose(value); this.close(); }
  onClose(): void { this.contentEl.empty(); if (!this.resolved) this.choose(false); }
}
export async function importMedicalActiveFile(plugin: ExaminedHumanPlugin): Promise<void> {
  try {
    const file = plugin.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) throw new Error('Open the Markdown note containing one Medical Form.');
    const request = { databasePath: plugin.settings.databasePath, filePath: file.path, sourceText: await plugin.app.vault.read(file), replaceExisting: true };
    const preview = await plugin.logger.inspectMedical(request);
    if (!await confirmMedical(plugin.app, preview)) return;
    const result = await plugin.logger.importMedical({ ...request, expectedDatabaseChecksum: preview.databaseChecksum });
    await plugin.markImportedEhFormFileIfComplete(file);
    new Notice(`Medical report ${result.value.reportId} ${result.value.replaced ? 'replaced' : 'imported'}. Source note retained.`, 8_000);
    try { await plugin.refreshViews(); }
    catch (error) { new Notice(`Medical import succeeded, but refreshing views failed: ${error instanceof Error ? error.message : String(error)}`, 12_000); }
  } catch (error) { new Notice(`Medical import did not complete: ${error instanceof Error ? error.message : String(error)}`, 12_000); }
}
export async function upgradeMedicalDatabase(plugin: ExaminedHumanPlugin): Promise<void> {
  try {
    const preview = await plugin.logger.inspectMedicalUpgrade(plugin.settings.databasePath);
    if (!preview.needed) { new Notice('Medical and Daily health tables are already enabled.'); return; }
    if (!await confirmWeeklyAction(plugin.app, {
      title: 'Medical database migration', confirmLabel: 'Back up and upgrade',
      explanation: 'Enable single-owner Medical Forms, typed measurements, procedures, canonical health catalogs, and Daily Medication/Symptoms. This vault represents one person; no People catalog is needed.',
      dryRunOutput: 'Existing numeric measurement IDs, values, report links, notes, and source ranges are preserved. Other domains are retained. The SQLite schema marker stays at official v1.',
      warning: 'This creates a verified backup and upgrades the configured database after checking its reviewed checksum.',
    })) return;
    await plugin.logger.upgradeMedical(plugin.settings.databasePath, preview.databaseChecksum);
    await plugin.refreshViews(); new Notice('Medical database upgrade completed.');
  } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 12_000); }
}
/** Compatibility entry point; catalog changes now use the normal staging flow. */
export function openHealthCatalog(plugin: ExaminedHumanPlugin): void { void plugin.activateHealthCatalogs(); }
