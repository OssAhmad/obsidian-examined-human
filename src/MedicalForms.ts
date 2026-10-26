import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import type ExaminedHumanPlugin from './main.ts';
import type { HealthCatalogKind } from './read-models/medical.ts';
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
    this.contentEl.createEl('p', { text: `${p.title} — ${p.person.name}` });
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
      explanation: 'Enable Medical Forms, typed measurements, procedures, canonical health catalogs, and Daily Medication/Symptoms.',
      dryRunOutput: 'Existing numeric measurement IDs, values, report links, notes, and source ranges are preserved. Other domains are retained. The SQLite schema marker stays at official v1.',
      warning: 'This creates a verified backup and upgrades the configured database after checking its reviewed checksum.',
    })) return;
    await plugin.logger.upgradeMedical(plugin.settings.databasePath, preview.databaseChecksum);
    await plugin.refreshViews(); new Notice('Medical database upgrade completed.');
  } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 12_000); }
}
export function openHealthCatalog(plugin: ExaminedHumanPlugin): void { new HealthCatalogModal(plugin).open(); }
class HealthCatalogModal extends Modal {
  private kind: HealthCatalogKind = 'measurement';
  private selected = 0;
  private generation = 0;
  constructor(private plugin: ExaminedHumanPlugin) { super(plugin.app); }
  onOpen(): void { void this.render(); }
  private async render(): Promise<void> {
    const generation = ++this.generation;
    try {
      const catalog = await this.plugin.database.healthCatalog(this.plugin.settings.databasePath, this.kind);
      if (generation !== this.generation) return;
      this.contentEl.empty(); this.contentEl.createEl('h2', { text: 'Manage health catalogs' });
      new Setting(this.contentEl).setName('Catalog').addDropdown(d => d.addOptions({ measurement: 'Measurements', procedure: 'Procedures', person: 'People', medication: 'Medications', symptom: 'Symptoms' }).setValue(this.kind).onChange(v => { this.kind = v as HealthCatalogKind; this.selected = 0; void this.render(); }));
      new Setting(this.contentEl).setName('Record').addDropdown(d => {
        d.addOption('0', 'Create a new record'); catalog.forEach(r => { d.addOption(String(r.id), r.name); });
        d.setValue(String(this.selected)).onChange(v => { this.selected = Number(v); void this.render(); });
      });
      const row = catalog.find(r => r.id === this.selected);
      const input = { kind: this.kind, id: this.selected || undefined, name: row?.name ?? '', unit: row?.unit ?? '', valueType: row?.valueType || 'number', aliases: row?.aliases ?? [] };
      new Setting(this.contentEl).setName('Canonical name').addText(t => t.setValue(input.name).onChange(v => { input.name = v; }));
      if (this.kind === 'measurement') new Setting(this.contentEl).setName('Value type').addDropdown(d => d.addOptions({ number: 'Number or numeric limit', qualitative: 'Qualitative result', text: 'Written finding' }).setValue(input.valueType).onChange(v => { input.valueType = v; }));
      if (['measurement', 'medication'].includes(this.kind)) new Setting(this.contentEl).setName('Unit').setDesc('Required for numeric measurements and medication dose amounts. Leave blank for text or qualitative results.').addText(t => t.setValue(input.unit).onChange(v => { input.unit = v; }));
      if (this.kind !== 'person') new Setting(this.contentEl).setName('Aliases').setDesc('One alias per line. Saving replaces this record’s alias list.').addTextArea(t => t.setValue(input.aliases.join('\n')).onChange(v => { input.aliases = v.split('\n').map(a => a.trim()).filter(Boolean); }));
      new Setting(this.contentEl).addButton(b => b.setButtonText('Review and save').setCta().onClick(() => {
        void (async () => {
          const preview = await this.plugin.logger.inspectHealthCatalog(this.plugin.settings.databasePath, input);
          if (!await confirmWeeklyAction(this.app, { title: 'Save canonical health record', explanation: 'This updates shared vocabulary. Historical observation and dose units remain unchanged.', confirmLabel: 'Save record',
            dryRunOutput: `${input.kind}: ${input.name}\nUnit: ${input.unit || 'none'}\nValue type: ${input.valueType}\nAliases: ${input.aliases.join(', ') || 'none'}`, warning: 'A durable backup is created. Existing aliases are replaced by the displayed list.' })) return;
          await this.plugin.logger.saveHealthCatalog(this.plugin.settings.databasePath, input, preview.databaseChecksum);
          await this.plugin.refreshViews(); this.close(); new Notice('Health catalog record saved.');
        })().catch(error => new Notice(error instanceof Error ? error.message : String(error), 12_000));
      }));
    } catch (error) { this.contentEl.empty(); this.contentEl.createEl('p', { text: error instanceof Error ? error.message : String(error) }); }
  }
  onClose(): void { this.generation++; this.contentEl.empty(); }
}
