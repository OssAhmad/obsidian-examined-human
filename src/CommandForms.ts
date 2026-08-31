import { App, Modal, Notice, Setting } from 'obsidian';
import { stageAdminCommands } from './command-staging.ts';
import type { DailyNoteListItem } from './daily-note-index.ts';
import type {
  CommandAccountRecord,
  CommandCatalog,
  CommandEngagementRecord,
  CommandExerciseRecord,
  FoodLibraryRecord,
} from './examined-human-query.ts';
import type ExaminedHumanPlugin from './main.ts';
import type { ReferenceKind, UnresolvedReference } from './unresolved-references.ts';

function commandValue(value: string, label: string, allowBlank = false): string {
  const trimmed = value.trim();
  if (!trimmed && !allowBlank) throw new Error(`${label} is required.`);
  if (/[|\r\n]/.test(trimmed)) throw new Error(`${label} cannot contain a vertical bar or line break.`);
  return trimmed;
}

function optionalNumber(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const number = Number(trimmed);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number.`);
  return String(number);
}

function requiredNumber(value: string, label: string): string {
  const trimmed = optionalNumber(value, label);
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function aliasList(alias: string, canonical: string, includeAlias: boolean): string[] {
  const normalizedAlias = alias.trim();
  if (!includeAlias || !normalizedAlias || normalizedAlias.localeCompare(canonical, undefined, { sensitivity: 'accent' }) === 0) return [];
  return [`[${commandValue(normalizedAlias, 'Alias')}]`];
}

function labelFor(kind: ReferenceKind): string {
  return kind === 'food' ? 'Food' : kind === 'engagement' ? 'Engagement' : kind === 'exercise' ? 'Exercise' : 'Account';
}

function collectionFor(catalog: CommandCatalog, kind: ReferenceKind): Array<{ id: number; name: string }> {
  return kind === 'food'
    ? catalog.foods
    : kind === 'engagement'
      ? catalog.engagements
      : kind === 'exercise'
        ? catalog.exercises
        : catalog.accounts;
}

export interface ReferenceRepairOptions {
  plugin: ExaminedHumanPlugin;
  reference: UnresolvedReference;
  catalog: CommandCatalog;
  preferredTarget: DailyNoteListItem | null;
  onStaged: () => Promise<void>;
}

export function openReferenceRepair(app: App, options: ReferenceRepairOptions): void {
  new ReferenceRepairModal(app, options).open();
}

class ReferenceRepairModal extends Modal {
  private mode: 'create' | 'alias' = 'create';
  private includeRawAlias = true;
  private selectedExistingName = '';
  private canonicalName: string;
  private category = '';
  private engagementType = '';
  private engagementStatus = '';
  private accountType = '';
  private currency = '';
  private notes = '';
  private nutrition = {
    calories: '', protein: '', carbs: '', fat: '', salt: '', fiber: '', cholesterol: '',
  };

  constructor(app: App, private options: ReferenceRepairOptions) {
    super(app);
    this.canonicalName = options.reference.rawName;
    this.selectedExistingName = collectionFor(options.catalog, options.reference.kind)[0]?.name ?? '';
    this.engagementType = options.catalog.engagementTypes[0] ?? '';
    this.engagementStatus = options.catalog.engagementStatuses[0] ?? '';
  }

  onOpen(): void {
    this.modalEl.addClass('examined-human-command-modal');
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    const { reference } = this.options;
    const kindLabel = labelFor(reference.kind);
    this.contentEl.createEl('h2', { text: `Resolve ${kindLabel}` });
    this.contentEl.createEl('p', {
      text: `“${reference.rawName}” is unresolved in ${reference.contexts.join(', ')}. Choose whether it is a new canonical ${kindLabel.toLocaleLowerCase()} or another name for an existing one.`,
    });
    const mode = this.contentEl.createDiv({ cls: 'examined-human-command-mode' });
    for (const [value, text] of [
      ['create', `Create a new ${kindLabel}`],
      ['alias', `Use an existing ${kindLabel} and add this as an alias`],
    ] as const) {
      const button = mode.createEl('button', { text, cls: value === this.mode ? 'is-selected' : '' });
      button.addEventListener('click', () => { this.mode = value; this.render(); });
    }
    if (this.mode === 'create') this.renderCreateFields(kindLabel);
    else this.renderAliasFields(kindLabel);
    const actions = this.contentEl.createDiv({ cls: 'examined-human-modal-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const stage = actions.createEl('button', { cls: 'mod-cta', text: 'Stage correction in Daily Note' });
    stage.addEventListener('click', () => { void this.stage(stage); });
  }

  private renderCreateFields(kindLabel: string): void {
    new Setting(this.contentEl)
      .setName(`Canonical ${kindLabel} name`)
      .setDesc('This is the name EH stores as the source of truth.')
      .addText((text) => text.setValue(this.canonicalName).onChange((value) => { this.canonicalName = value; }));
    new Setting(this.contentEl)
      .setName(`Also keep “${this.options.reference.rawName}” as an alias`)
      .setDesc('Recommended when today’s wording differs from the canonical name.')
      .addToggle((toggle) => toggle.setValue(this.includeRawAlias).onChange((value) => { this.includeRawAlias = value; }));
    if (this.options.reference.kind === 'food') this.renderFoodFields();
    if (this.options.reference.kind === 'engagement') this.renderEngagementFields();
    if (this.options.reference.kind === 'exercise') {
      new Setting(this.contentEl).setName('Category (optional)')
        .addText((text) => text.setValue(this.category).onChange((value) => { this.category = value; }));
    }
    if (this.options.reference.kind === 'account') this.renderAccountFields();
  }

  private renderFoodFields(): void {
    new Setting(this.contentEl).setName('Food category (optional)')
      .addText((text) => text.setValue(this.category).onChange((value) => { this.category = value; }));
    const fields: Array<[keyof ReferenceRepairModal['nutrition'], string, boolean, string]> = [
      ['calories', 'Calories per 100 g', true, 'kcal'],
      ['protein', 'Protein per 100 g', true, 'g'],
      ['carbs', 'Carbs per 100 g', true, 'g'],
      ['fat', 'Fat per 100 g', true, 'g'],
      ['salt', 'Salt per 100 g', true, 'g'],
      ['fiber', 'Fiber per 100 g', false, 'g, optional'],
      ['cholesterol', 'Cholesterol per 100 g', false, 'mg, optional'],
    ];
    for (const [key, name, , description] of fields) {
      new Setting(this.contentEl).setName(name).setDesc(description)
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = '0';
          text.inputEl.step = 'any';
          return text.setValue(this.nutrition[key]).onChange((value) => { this.nutrition[key] = value; });
        });
    }
    new Setting(this.contentEl).setName('Notes (optional)')
      .addTextArea((text) => text.setValue(this.notes).onChange((value) => { this.notes = value; }));
  }

  private renderEngagementFields(): void {
    new Setting(this.contentEl).setName('Engagement type')
      .addDropdown((dropdown) => {
        for (const value of this.options.catalog.engagementTypes) dropdown.addOption(value, value);
        return dropdown.setValue(this.engagementType).onChange((value) => { this.engagementType = value; });
      });
    new Setting(this.contentEl).setName('Initial status')
      .addDropdown((dropdown) => {
        for (const value of this.options.catalog.engagementStatuses) dropdown.addOption(value, value);
        return dropdown.setValue(this.engagementStatus).onChange((value) => { this.engagementStatus = value; });
      });
    new Setting(this.contentEl).setName('Notes (optional)')
      .addTextArea((text) => text.setValue(this.notes).onChange((value) => { this.notes = value; }));
  }

  private renderAccountFields(): void {
    new Setting(this.contentEl).setName('Account type (optional)')
      .addText((text) => text.setValue(this.accountType).onChange((value) => { this.accountType = value; }));
    new Setting(this.contentEl).setName('Currency (optional)')
      .addText((text) => text.setValue(this.currency).onChange((value) => { this.currency = value; }));
  }

  private renderAliasFields(kindLabel: string): void {
    const choices = collectionFor(this.options.catalog, this.options.reference.kind);
    if (choices.length === 0) {
      this.contentEl.createDiv({
        cls: 'examined-human-daily-validation-note',
        text: `There are no existing ${kindLabel.toLocaleLowerCase()} records yet. Create a canonical record instead.`,
      });
      return;
    }
    new Setting(this.contentEl).setName(`Existing ${kindLabel}`)
      .setDesc(`EH will stage “${this.options.reference.rawName}” as an alias of the selected canonical record.`)
      .addDropdown((dropdown) => {
        for (const choice of choices) dropdown.addOption(choice.name, choice.name);
        return dropdown.setValue(this.selectedExistingName).onChange((value) => { this.selectedExistingName = value; });
      });
  }

  private commands(): string[] {
    const { kind, rawName } = this.options.reference;
    if (this.mode === 'alias') {
      const canonical = commandValue(this.selectedExistingName, `Existing ${labelFor(kind)}`);
      return [`${kind.toUpperCase()}_ALIAS_ADD | ${canonical} | [${commandValue(rawName, 'Alias')}]`];
    }
    const canonical = commandValue(this.canonicalName, `Canonical ${labelFor(kind)} name`);
    const aliases = aliasList(rawName, canonical, this.includeRawAlias);
    if (kind === 'food') {
      const nutrition = this.nutrition;
      const create = [
        'FOOD_CREATE', canonical, commandValue(this.category, 'Food category', true),
        requiredNumber(nutrition.calories, 'Calories'), requiredNumber(nutrition.protein, 'Protein'),
        requiredNumber(nutrition.carbs, 'Carbs'), requiredNumber(nutrition.fat, 'Fat'), requiredNumber(nutrition.salt, 'Salt'),
        optionalNumber(nutrition.fiber, 'Fiber'), optionalNumber(nutrition.cholesterol, 'Cholesterol'),
        commandValue(this.notes, 'Notes', true), ...aliases,
      ];
      return [create.join(' | ')];
    }
    if (kind === 'engagement') {
      const create = `ENGAGEMENT_CREATE | ${canonical} | ${commandValue(this.engagementType, 'Engagement type')} | ${commandValue(this.engagementStatus, 'Initial status')} | ${commandValue(this.notes, 'Notes', true)}`;
      return [create, ...aliases.map((alias) => `ENGAGEMENT_ALIAS_ADD | ${canonical} | ${alias}`)];
    }
    if (kind === 'exercise') {
      const create = `EXERCISE_CREATE | ${canonical} | ${commandValue(this.category, 'Category', true)}`;
      return [create, ...aliases.map((alias) => `EXERCISE_ALIAS_ADD | ${canonical} | ${alias}`)];
    }
    const create = `ACCOUNT_CREATE | ${canonical} | ${commandValue(this.accountType, 'Account type', true)} | ${commandValue(this.currency, 'Currency', true)}`;
    return [create, ...aliases.map((alias) => `ACCOUNT_ALIAS_ADD | ${canonical} | ${alias}`)];
  }

  private async stage(button: HTMLButtonElement): Promise<void> {
    try {
      const commands = this.commands();
      button.disabled = true;
      const staged = await stageAdminCommands({
        plugin: this.options.plugin,
        commands,
        preferredTarget: this.options.preferredTarget,
      });
      if (!staged) return;
      this.close();
      await this.options.onStaged();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 10_000);
    } finally {
      button.disabled = false;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export interface FoodEditorOptions {
  plugin: ExaminedHumanPlugin;
  food?: FoodLibraryRecord;
  preferredTarget?: DailyNoteListItem | null;
  onStaged: () => Promise<void>;
}

export function openFoodEditor(app: App, options: FoodEditorOptions): void {
  new FoodEditorModal(app, options).open();
}

class FoodEditorModal extends Modal {
  private readonly food: FoodLibraryRecord | undefined;
  private name = '';
  private category = '';
  private calories = '';
  private protein = '';
  private carbs = '';
  private fat = '';
  private salt = '';
  private fiber = '';
  private cholesterol = '';
  private notes = '';
  private aliases = '';

  constructor(app: App, private options: FoodEditorOptions) {
    super(app);
    this.food = options.food;
    if (this.food) {
      this.name = this.food.name;
      this.category = this.food.category ?? '';
      this.calories = String(this.food.caloriesKcalPer100g);
      this.protein = String(this.food.proteinGPer100g);
      this.carbs = String(this.food.carbsGPer100g);
      this.fat = String(this.food.fatGPer100g);
      this.salt = String(this.food.saltGPer100g);
      this.fiber = this.food.fiberGPer100g == null ? '' : String(this.food.fiberGPer100g);
      this.cholesterol = this.food.cholesterolMgPer100g == null ? '' : String(this.food.cholesterolMgPer100g);
      this.notes = this.food.notes ?? '';
    }
  }

  onOpen(): void {
    this.modalEl.addClass('examined-human-command-modal');
    this.contentEl.createEl('h2', { text: this.food ? `Edit food — ${this.food.name}` : 'Create food' });
    const textField = (name: string, initial: string, assign: (value: string) => void, description?: string): void => {
      new Setting(this.contentEl).setName(name).setDesc(description ?? '')
        .addText((text) => text.setValue(initial).onChange(assign));
    };
    textField('Canonical food name', this.name, (value) => { this.name = value; });
    textField('Category (optional)', this.category, (value) => { this.category = value; });
    const numeric: Array<[string, 'calories' | 'protein' | 'carbs' | 'fat' | 'salt' | 'fiber' | 'cholesterol', boolean, string]> = [
      ['Calories per 100 g', 'calories', true, 'kcal'], ['Protein per 100 g', 'protein', true, 'g'],
      ['Carbs per 100 g', 'carbs', true, 'g'], ['Fat per 100 g', 'fat', true, 'g'],
      ['Salt per 100 g', 'salt', true, 'g'], ['Fiber per 100 g', 'fiber', false, 'g, optional'],
      ['Cholesterol per 100 g', 'cholesterol', false, 'mg, optional'],
    ];
    for (const [label, key, , description] of numeric) {
      new Setting(this.contentEl).setName(label).setDesc(description).addText((text) => {
        text.inputEl.type = 'number'; text.inputEl.min = '0'; text.inputEl.step = 'any';
        return text.setValue(this[key]).onChange((value) => { this[key] = value; });
      });
    }
    new Setting(this.contentEl).setName('Notes (optional)')
      .addTextArea((text) => text.setValue(this.notes).onChange((value) => { this.notes = value; }));
    if (!this.food) {
      new Setting(this.contentEl).setName('Aliases (optional)')
        .setDesc('Comma-separated alternate spellings to store with this new canonical food.')
        .addText((text) => text.setValue(this.aliases).onChange((value) => { this.aliases = value; }));
    }
    const actions = this.contentEl.createDiv({ cls: 'examined-human-modal-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const stage = actions.createEl('button', { cls: 'mod-cta', text: this.food ? 'Stage food update' : 'Stage new food' });
    stage.addEventListener('click', () => { void this.stage(stage); });
  }

  private command(): string {
    const name = commandValue(this.name, 'Canonical food name');
    const values = [
      commandValue(this.category, 'Category', true), requiredNumber(this.calories, 'Calories'),
      requiredNumber(this.protein, 'Protein'), requiredNumber(this.carbs, 'Carbs'), requiredNumber(this.fat, 'Fat'),
      requiredNumber(this.salt, 'Salt'), optionalNumber(this.fiber, 'Fiber'), optionalNumber(this.cholesterol, 'Cholesterol'),
      commandValue(this.notes, 'Notes', true),
    ];
    if (!this.food) {
      const aliases = this.aliases.split(',').map((alias) => alias.trim()).filter(Boolean);
      for (const alias of aliases) commandValue(alias, 'Alias');
      return ['FOOD_CREATE', name, ...values, ...(aliases.length > 0 ? [`[${aliases.join(', ')}]`] : [])].join(' | ');
    }
    return ['FOOD_UPDATE', name, ...values].join(' | ');
  }

  private async stage(button: HTMLButtonElement): Promise<void> {
    try {
      button.disabled = true;
      const command = this.command();
      const commands = this.food && this.name.trim() !== this.food.name
        ? [`FOOD_RENAME | ${this.food.name} | ${commandValue(this.name, 'Canonical food name')}`, command]
        : [command];
      const staged = await stageAdminCommands({
        plugin: this.options.plugin,
        commands,
        preferredTarget: this.options.preferredTarget,
      });
      if (!staged) return;
      this.close();
      await this.options.onStaged();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 10_000);
    } finally {
      button.disabled = false;
    }
  }

  onClose(): void { this.contentEl.empty(); }
}

export type CommandEntityKind = 'engagement' | 'exercise' | 'account';
type CommandEntityRecord = CommandEngagementRecord | CommandExerciseRecord | CommandAccountRecord;

export interface EntityEditorOptions {
  plugin: ExaminedHumanPlugin;
  catalog: CommandCatalog;
  kind: CommandEntityKind;
  entity?: CommandEntityRecord;
  onStaged: () => Promise<void>;
}

export function openEntityEditor(app: App, options: EntityEditorOptions): void {
  new EntityEditorModal(app, options).open();
}

class EntityEditorModal extends Modal {
  private name = '';
  private category = '';
  private type = '';
  private status = '';
  private startDate = '';
  private targetDate = '';
  private completionDate = '';
  private currency = '';
  private address = '';
  private notes = '';
  private aliases = '';

  constructor(app: App, private options: EntityEditorOptions) {
    super(app);
    const entity = options.entity;
    if (entity) {
      this.name = entity.name;
      this.aliases = entity.aliases.join(', ');
      if (options.kind === 'engagement') {
        const engagement = entity as CommandEngagementRecord;
        this.type = engagement.type; this.status = engagement.status;
        this.startDate = engagement.startDate ?? ''; this.targetDate = engagement.targetDate ?? '';
        this.completionDate = engagement.completionDate ?? ''; this.notes = engagement.notes ?? '';
      } else if (options.kind === 'exercise') {
        this.category = (entity as CommandExerciseRecord).category ?? '';
      } else {
        const account = entity as CommandAccountRecord;
        this.type = account.type ?? ''; this.currency = account.currency ?? ''; this.address = account.address ?? '';
      }
    } else if (options.kind === 'engagement') {
      this.type = options.catalog.engagementTypes[0] ?? '';
      this.status = options.catalog.engagementStatuses[0] ?? '';
    }
  }

  onOpen(): void {
    this.modalEl.addClass('examined-human-command-modal');
    const label = this.options.kind === 'engagement' ? 'Engagement' : this.options.kind === 'exercise' ? 'Exercise' : 'Account';
    this.contentEl.createEl('h2', { text: this.options.entity ? `Edit ${label}` : `Create ${label}` });
    new Setting(this.contentEl).setName(`Canonical ${label} name`)
      .addText((text) => text.setValue(this.name).onChange((value) => { this.name = value; }));
    if (this.options.kind === 'engagement') this.renderEngagement();
    if (this.options.kind === 'exercise') this.renderExercise();
    if (this.options.kind === 'account') this.renderAccount();
    new Setting(this.contentEl).setName('Aliases (optional)')
      .setDesc('Comma-separated alternate spellings. Existing aliases remain; this adds the listed aliases.')
      .addText((text) => text.setValue(this.aliases).onChange((value) => { this.aliases = value; }));
    const actions = this.contentEl.createDiv({ cls: 'examined-human-modal-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const button = actions.createEl('button', { cls: 'mod-cta', text: this.options.entity ? 'Stage update' : 'Stage creation' });
    button.addEventListener('click', () => { void this.stage(button); });
  }

  private renderEngagement(): void {
    new Setting(this.contentEl).setName('Engagement type').addDropdown((dropdown) => {
      for (const value of this.options.catalog.engagementTypes) dropdown.addOption(value, value);
      return dropdown.setValue(this.type).onChange((value) => { this.type = value; });
    });
    new Setting(this.contentEl).setName('Status').addDropdown((dropdown) => {
      for (const value of this.options.catalog.engagementStatuses) dropdown.addOption(value, value);
      return dropdown.setValue(this.status).onChange((value) => { this.status = value; });
    });
    for (const [name, assign, value] of [
      ['Start date (optional)', (next: string) => { this.startDate = next; }, this.startDate],
      ['Target date (optional)', (next: string) => { this.targetDate = next; }, this.targetDate],
      ['Completion date (optional)', (next: string) => { this.completionDate = next; }, this.completionDate],
    ] as Array<[string, (next: string) => void, string]>) {
      new Setting(this.contentEl).setName(name).addText((text) => {
        text.inputEl.type = 'date'; return text.setValue(value).onChange(assign);
      });
    }
    new Setting(this.contentEl).setName('Notes (optional)')
      .addTextArea((text) => text.setValue(this.notes).onChange((value) => { this.notes = value; }));
  }

  private renderExercise(): void {
    new Setting(this.contentEl).setName('Category (optional)')
      .addText((text) => text.setValue(this.category).onChange((value) => { this.category = value; }));
  }

  private renderAccount(): void {
    new Setting(this.contentEl).setName('Account type (optional)')
      .addText((text) => text.setValue(this.type).onChange((value) => { this.type = value; }));
    new Setting(this.contentEl).setName('Currency (optional)')
      .addText((text) => text.setValue(this.currency).onChange((value) => { this.currency = value; }));
    new Setting(this.contentEl).setName('Address (optional)')
      .addText((text) => text.setValue(this.address).onChange((value) => { this.address = value; }));
  }

  private aliasList(): string {
    const aliases = this.aliases.split(',').map((alias) => alias.trim()).filter(Boolean);
    for (const alias of aliases) commandValue(alias, 'Alias');
    return aliases.length > 0 ? `[${aliases.join(', ')}]` : '';
  }

  private commands(): string[] {
    const name = commandValue(this.name, 'Canonical name');
    const aliases = this.aliasList();
    const priorName = this.options.entity?.name ?? name;
    if (this.options.kind === 'engagement') {
      if (!this.options.entity) {
        const commands = [`ENGAGEMENT_CREATE | ${name} | ${commandValue(this.type, 'Engagement type')} | ${commandValue(this.status, 'Status')} | ${commandValue(this.notes, 'Notes', true)}`];
        if (aliases) commands.push(`ENGAGEMENT_ALIAS_ADD | ${name} | ${aliases}`);
        return commands;
      }
      return [`ENGAGEMENT_UPDATE | ${priorName} | ${name} | ${commandValue(this.type, 'Engagement type')} | ${commandValue(this.status, 'Status')} | ${commandValue(this.startDate, 'Start date', true)} | ${commandValue(this.targetDate, 'Target date', true)} | ${commandValue(this.completionDate, 'Completion date', true)} | ${commandValue(this.notes, 'Notes', true)} | ${aliases}`];
    }
    if (this.options.kind === 'exercise') {
      if (!this.options.entity) {
        const commands = [`EXERCISE_CREATE | ${name} | ${commandValue(this.category, 'Category', true)}`];
        if (aliases) commands.push(`EXERCISE_ALIAS_ADD | ${name} | ${aliases}`);
        return commands;
      }
      return [`EXERCISE_UPDATE | ${priorName} | ${name} | ${commandValue(this.category, 'Category', true)} | ${aliases}`];
    }
    if (!this.options.entity) {
      const commands = [`ACCOUNT_CREATE | ${name} | ${commandValue(this.type, 'Account type', true)} | ${commandValue(this.currency, 'Currency', true)} | ${commandValue(this.address, 'Address', true)}`];
      if (aliases) commands.push(`ACCOUNT_ALIAS_ADD | ${name} | ${aliases}`);
      return commands;
    }
    return [
      `ACCOUNT_UPDATE | ${priorName} | ${name} | ${commandValue(this.type, 'Account type', true)} | ${aliases}`,
      `ACCOUNT_SET_CURRENCY | ${name} | ${commandValue(this.currency, 'Currency', true)}`,
      `ACCOUNT_SET_ADDRESS | ${name} | ${commandValue(this.address, 'Address', true)}`,
    ];
  }

  private async stage(button: HTMLButtonElement): Promise<void> {
    try {
      button.disabled = true;
      const staged = await stageAdminCommands({ plugin: this.options.plugin, commands: this.commands() });
      if (!staged) return;
      this.close(); await this.options.onStaged();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 10_000);
    } finally { button.disabled = false; }
  }
  onClose(): void { this.contentEl.empty(); }
}
