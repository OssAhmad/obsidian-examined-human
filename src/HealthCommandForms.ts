import { App, Modal, Notice, Setting } from 'obsidian';
import { stageAdminCommands } from './command-staging.ts';
import type { CommandServices } from './plugin-services.ts';
import type { HealthCatalogEntry, HealthCatalogKind } from './read-models/medical.ts';

export const HEALTH_CATALOG_LABELS: Record<HealthCatalogKind, string> = {
  measurement: 'Measurements', symptom: 'Symptoms', medication: 'Medications',
  procedure: 'Procedures',
};

export interface HealthCommandFields {
  name: string; unit: string; valueType: string; aliases: string[];
}

export function healthCatalogCommand(kind: HealthCatalogKind, input: HealthCommandFields, priorName?: string): string {
  const field = (value: string, label: string): string => {
    if (/[|\r\n]/.test(value)) throw new Error(`${label} cannot contain a vertical bar or line break.`);
    return value.trim();
  };
  const name = field(input.name, 'Canonical name');
  if (!name) throw new Error('Canonical name is required.');
  const unit = field(input.unit, 'Unit');
  if (kind === 'measurement' && !['number', 'qualitative', 'text'].includes(input.valueType)) throw new Error('Select a measurement value type.');
  if ((kind === 'measurement' && input.valueType === 'number') || kind === 'medication') {
    if (!unit) throw new Error('A canonical unit is required.');
  }
  if (kind === 'measurement' && input.valueType !== 'number' && unit) throw new Error('Text and qualitative measurements do not have a numeric unit.');
  const aliases = input.aliases.map(alias => field(alias, 'Alias')).filter(Boolean);
  if (aliases.some(alias => /,|\[|\]/.test(alias))) throw new Error('Use one alias per line without commas or square brackets.');
  const values = [name];
  if (kind === 'measurement') values.push(input.valueType, unit);
  if (kind === 'medication') values.push(unit);
  values.push(aliases.length ? `[${aliases.join(', ')}]` : '');
  if (priorName != null) values.unshift(field(priorName, 'Existing canonical name'));
  return [`${kind.toUpperCase()}_${priorName == null ? 'CREATE' : 'UPDATE'}`, ...values].join(' | ');
}

interface HealthEditorOptions {
  plugin: CommandServices;
  kind: HealthCatalogKind;
  entry?: HealthCatalogEntry;
  onStaged: () => Promise<void>;
}

export function openHealthEditor(app: App, options: HealthEditorOptions): void {
  new HealthCommandModal(app, options).open();
}

class HealthCommandModal extends Modal {
  private fields: HealthCommandFields;
  constructor(app: App, private options: HealthEditorOptions) {
    super(app);
    this.fields = {
      name: options.entry?.name ?? '', unit: options.entry?.unit ?? '',
      valueType: options.entry?.valueType || 'number', aliases: [...(options.entry?.aliases ?? [])],
    };
  }
  onOpen(): void {
    this.modalEl.addClass('examined-human-command-modal');
    this.modalEl.addClass('examined-human-health-command-modal');
    this.render();
  }
  private render(): void {
    this.contentEl.empty();
    const { kind, entry } = this.options;
    this.contentEl.createEl('h2', { text: `${entry ? 'Edit' : 'Add'} ${kind}` });
    this.contentEl.createEl('p', { text: 'Review the command and stage it in an unimported Daily Form. The normal Daily import applies the change.' });
    new Setting(this.contentEl).setName('Canonical name').setDesc('Required. Use the name that identifies this record.').addText(text => {
      text.setValue(this.fields.name).onChange(value => { this.fields.name = value; });
    });
    if (kind === 'measurement') {
      new Setting(this.contentEl).setName('Value type').setDesc('Numbers include limits such as <5; qualitative results and written findings remain text.')
        .addDropdown(dropdown => dropdown.addOptions({ number: 'Number or numeric limit', qualitative: 'Qualitative result', text: 'Written finding' })
          .setValue(this.fields.valueType).onChange(value => {
            this.fields.valueType = value;
            if (value !== 'number') this.fields.unit = '';
            this.render();
          }));
    }
    if (kind === 'medication' || (kind === 'measurement' && this.fields.valueType === 'number')) {
      new Setting(this.contentEl).setName(kind === 'medication' ? 'Dose unit' : 'Measurement unit')
        .setDesc(kind === 'medication'
          ? 'Required, for example tablet, mL, or mg. Include product strength and formulation in its name when needed.'
          : 'Required, for example mg/dL, mmHg, or %. Keep the source unit.')
        .addText(text => text.setValue(this.fields.unit).onChange(value => { this.fields.unit = value; }));
    }
    new Setting(this.contentEl).setName('Aliases (optional)')
      .setDesc('One alternative spelling per line. This command replaces the alias list with the entries shown here.')
      .addTextArea(text => {
        text.inputEl.rows = 3;
        text.setValue(this.fields.aliases.join('\n')).onChange(value => { this.fields.aliases = value.split(/\r?\n/).map(alias => alias.trim()).filter(Boolean); });
      });
    if (entry) this.contentEl.createEl('p', { cls: 'examined-human-daily-validation-note', text: 'Imported observation and dose unit snapshots keep their original meaning. These edits apply to the catalog used for later entries.' });
    const actions = this.contentEl.createDiv({ cls: 'examined-human-modal-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const stage = actions.createEl('button', { text: entry ? 'Review and stage update' : 'Review and stage creation', cls: 'mod-cta' });
    stage.addEventListener('click', () => { void this.stage(stage); });
  }
  private async stage(button: HTMLButtonElement): Promise<void> {
    try {
      button.disabled = true;
      const command = healthCatalogCommand(this.options.kind, this.fields, this.options.entry?.name);
      const staged = await stageAdminCommands({ plugin: this.options.plugin, commands: [command] });
      if (!staged) return;
      this.close();
      await this.options.onStaged();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 10_000);
    } finally { button.disabled = false; }
  }
  onClose(): void { this.contentEl.empty(); }
}
