import { ItemView, Modal, Notice, Setting, WorkspaceLeaf } from 'obsidian';
import { openEntityEditor, openFoodEditor } from './CommandForms.ts';
import { stageAdminCommands } from './command-staging.ts';
import type {
  CommandAccountRecord,
  CommandCatalog,
  CommandEngagementRecord,
  CommandExerciseRecord,
  FoodLibraryRecord,
} from './examined-human-query.ts';
import type ExaminedHumanPlugin from './main.ts';

export const EXAMINED_HUMAN_COMMAND_CENTER_VIEW_TYPE = 'examined-human-command-center';
type CommandCenterTab = 'foods' | 'engagements' | 'exercises' | 'accounts' | 'batch';

function number(value: number | null, digits = 1): string {
  return value == null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
}

function nutritionAt(food: FoodLibraryRecord, grams: number): Array<[string, string]> {
  const factor = grams / 100;
  return [
    ['Calories', `${number(food.caloriesKcalPer100g * factor, 0)} kcal`],
    ['Protein', `${number(food.proteinGPer100g * factor)} g`],
    ['Carbs', `${number(food.carbsGPer100g * factor)} g`],
    ['Fat', `${number(food.fatGPer100g * factor)} g`],
    ['Salt', `${number(food.saltGPer100g * factor, 2)} g`],
    ['Fiber', food.fiberGPer100g == null ? '—' : `${number(food.fiberGPer100g * factor)} g`],
    ['Cholesterol', food.cholesterolMgPer100g == null ? '—' : `${number(food.cholesterolMgPer100g * factor, 0)} mg`],
  ];
}

export class CommandCenterView extends ItemView {
  private foods: FoodLibraryRecord[] = [];
  private catalog: CommandCatalog | null = null;
  private selectedFoodId: number | null = null;
  private selectedEntityId: number | null = null;
  private search = '';
  private grams = 100;
  private activeTab: CommandCenterTab = 'foods';

  constructor(leaf: WorkspaceLeaf, private plugin: ExaminedHumanPlugin) {
    super(leaf);
  }

  getViewType(): string { return EXAMINED_HUMAN_COMMAND_CENTER_VIEW_TYPE; }
  getDisplayText(): string { return 'Examined Human — Command Center'; }
  getIcon(): string { return 'wrench'; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('examined-human-command-center');
    await this.refresh();
  }

  async onClose(): Promise<void> { this.contentEl.empty(); }

  async refresh(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('examined-human-command-center');
    this.contentEl.createDiv({ cls: 'examined-human-loading', text: 'Loading Command Center…' });
    try {
      const [foods, catalog] = await Promise.all([
        this.plugin.database.foodLibrary(this.plugin.settings.databasePath),
        this.plugin.database.commandCatalog(this.plugin.settings.databasePath),
      ]);
      this.foods = foods;
      this.catalog = catalog;
      if (!this.foods.some((food) => food.id === this.selectedFoodId)) this.selectedFoodId = this.foods[0]?.id ?? null;
      this.render();
    } catch (error) {
      this.contentEl.empty();
      const panel = this.contentEl.createDiv({ cls: 'examined-human-error-panel' });
      panel.createEl('h3', { text: 'Command Center could not load.' });
      panel.createDiv({ text: error instanceof Error ? error.message : String(error) });
    }
  }

  private render(): void {
    this.contentEl.empty();
    const toolbar = this.contentEl.createDiv({ cls: 'examined-human-toolbar examined-human-command-toolbar' });
    const identity = toolbar.createDiv({ cls: 'examined-human-toolbar-identity' });
    identity.createEl('h2', { text: 'Examined Human — Command Center' });
    identity.createDiv({
      cls: 'examined-human-toolbar-status',
      text: 'Audit canonical dictionaries and stage changes into an unimported Daily Note.',
    });
    const actions = toolbar.createDiv({ cls: 'examined-human-toolbar-actions' });
    this.renderPrimaryAction(actions);
    actions.createEl('button', { cls: 'examined-human-toolbar-button', text: 'Refresh' })
      .addEventListener('click', () => { void this.plugin.refreshViews(); void this.refresh(); });

    const tabs = this.contentEl.createDiv({ cls: 'examined-human-command-tabs' });
    const tabDefinitions: Array<[CommandCenterTab, string, number | null]> = [
      ['foods', 'Foods', this.foods.length],
      ['engagements', 'Engagements', this.catalog?.engagements.length ?? null],
      ['exercises', 'Exercises', this.catalog?.exercises.length ?? null],
      ['accounts', 'Accounts', this.catalog?.accounts.length ?? null],
      ['batch', 'Batch', null],
    ];
    for (const [tab, label, count] of tabDefinitions) {
      const button = tabs.createEl('button', { text: count == null ? label : `${label} (${count})`, cls: tab === this.activeTab ? 'is-selected' : '' });
      button.addEventListener('click', () => { this.activeTab = tab; this.selectedEntityId = null; this.search = ''; this.render(); });
    }

    if (this.activeTab === 'batch') {
      this.renderBatch();
      return;
    }
    if (this.activeTab !== 'foods') {
      this.renderEntityTab();
      return;
    }
    const layout = this.contentEl.createDiv({ cls: 'examined-human-command-layout' });
    const sidebar = layout.createEl('aside', { cls: 'examined-human-command-sidebar', attr: { 'aria-label': 'Food Library' } });
    const search = sidebar.createEl('input', {
      type: 'search', value: this.search, cls: 'examined-human-engagement-search',
      attr: { placeholder: 'Search foods or aliases…', 'aria-label': 'Search Food Library' },
    });
    search.addEventListener('input', () => { this.search = search.value; this.renderFoodList(list); });
    const list = sidebar.createDiv({ cls: 'examined-human-command-food-list' });
    this.renderFoodList(list);
    const main = layout.createEl('main', { cls: 'examined-human-command-main' });
    const selected = this.foods.find((food) => food.id === this.selectedFoodId) ?? null;
    if (!selected) {
      main.createDiv({ cls: 'examined-human-daily-empty-inline', text: 'No canonical foods yet. Add the first Food Dictionary record.' });
      return;
    }
    this.renderFoodDetails(main, selected);
  }

  private renderPrimaryAction(actions: HTMLElement): void {
    const catalog = this.catalog;
    if (this.activeTab === 'foods') {
      actions.createEl('button', { cls: 'mod-cta', text: 'Add food' }).addEventListener('click', () => {
        openFoodEditor(this.app, { plugin: this.plugin, onStaged: async () => this.refresh() });
      });
    } else if (this.activeTab !== 'batch' && catalog) {
      const kind = this.activeTab === 'engagements' ? 'engagement' : this.activeTab === 'exercises' ? 'exercise' : 'account';
      actions.createEl('button', { cls: 'mod-cta', text: `Add ${kind}` }).addEventListener('click', () => {
        openEntityEditor(this.app, { plugin: this.plugin, catalog, kind, onStaged: async () => this.refresh() });
      });
    }
  }

  private renderEntityTab(): void {
    const catalog = this.catalog;
    if (!catalog) return;
    const tab = this.activeTab;
    const label = tab === 'engagements' ? 'Engagement' : tab === 'exercises' ? 'Exercise' : 'Account';
    const entities: Array<CommandEngagementRecord | CommandExerciseRecord | CommandAccountRecord> = tab === 'engagements'
      ? catalog.engagements
      : tab === 'exercises' ? catalog.exercises : catalog.accounts;
    if (!entities.some((entity) => entity.id === this.selectedEntityId)) this.selectedEntityId = entities[0]?.id ?? null;
    const layout = this.contentEl.createDiv({ cls: 'examined-human-command-layout' });
    const sidebar = layout.createEl('aside', { cls: 'examined-human-command-sidebar', attr: { 'aria-label': `${label} library` } });
    const search = sidebar.createEl('input', {
      type: 'search', value: this.search, cls: 'examined-human-engagement-search',
      attr: { placeholder: `Search ${label.toLocaleLowerCase()}s or aliases…`, 'aria-label': `Search ${label} Library` },
    });
    const list = sidebar.createDiv({ cls: 'examined-human-command-food-list' });
    const drawList = (): void => {
      list.empty();
      const needle = this.search.trim().toLocaleLowerCase();
      const filtered = entities.filter((entity) => !needle || [entity.name, ...entity.aliases]
        .some((value) => value.toLocaleLowerCase().includes(needle)));
      if (filtered.length === 0) {
        list.createDiv({ cls: 'examined-human-daily-empty-inline', text: `No ${label.toLocaleLowerCase()}s match this search.` });
        return;
      }
      for (const entity of filtered) {
        const button = list.createEl('button', {
          cls: `examined-human-command-food-item${entity.id === this.selectedEntityId ? ' is-selected' : ''}`,
          attr: { title: entity.name },
        });
        button.createEl('strong', { cls: 'examined-human-command-item-name', text: entity.name });
        button.createSpan({ cls: 'examined-human-command-item-meta', text: this.entityMeta(entity) });
        button.addEventListener('click', () => { this.selectedEntityId = entity.id; this.render(); });
      }
    };
    search.addEventListener('input', () => { this.search = search.value; drawList(); });
    drawList();
    const selected = entities.find((entity) => entity.id === this.selectedEntityId);
    const main = layout.createEl('main', { cls: 'examined-human-command-main' });
    if (!selected) {
      main.createDiv({ cls: 'examined-human-daily-empty-inline', text: `No canonical ${label.toLocaleLowerCase()} records yet.` });
      return;
    }
    this.renderEntityDetails(main, selected);
  }

  private entityMeta(entity: CommandEngagementRecord | CommandExerciseRecord | CommandAccountRecord): string {
    if ('status' in entity) return `${entity.status} · ${entity.type} · ${entity.aliases.length} aliases`;
    if ('currency' in entity) return `${entity.type ?? 'unspecified'} · ${entity.currency ?? 'no currency'} · ${entity.aliases.length} aliases`;
    return `${entity.category ?? 'uncategorized'} · ${entity.aliases.length} aliases`;
  }

  private renderEntityDetails(
    container: HTMLElement,
    entity: CommandEngagementRecord | CommandExerciseRecord | CommandAccountRecord,
  ): void {
    const tab = this.activeTab;
    const kind = tab === 'engagements' ? 'engagement' : tab === 'exercises' ? 'exercise' : 'account';
    const commandPrefix = kind.toUpperCase();
    const title = container.createDiv({ cls: 'examined-human-command-food-title' });
    title.createEl('h3', { text: entity.name });
    if ('status' in entity) {
      title.createSpan({ cls: `examined-human-engagement-badge is-${entity.status}`, text: entity.status });
      title.createSpan({ cls: 'examined-human-engagement-badge', text: entity.type });
    } else if ('category' in entity && entity.category) title.createSpan({ cls: 'examined-human-engagement-badge', text: entity.category });
    else if ('currency' in entity && entity.currency) title.createSpan({ cls: 'examined-human-engagement-badge', text: entity.currency });
    const actions = title.createDiv({ cls: 'examined-human-command-food-actions' });
    actions.createEl('button', { text: 'Edit' }).addEventListener('click', () => {
      if (!this.catalog) return;
      openEntityEditor(this.app, { plugin: this.plugin, catalog: this.catalog, kind, entity, onStaged: async () => this.refresh() });
    });
    if ('status' in entity) this.renderEngagementActions(actions, entity);

    const detail = container.createEl('section', { cls: 'examined-human-daily-panel' });
    detail.createEl('h4', { text: 'Canonical details' });
    const grid = detail.createDiv({ cls: 'examined-human-daily-completeness-grid' });
    const facts: Array<[string, string]> = 'status' in entity
      ? [
        ['Type', entity.type], ['Status', entity.status], ['Started', entity.startDate ?? '—'],
        ['Target', entity.targetDate ?? '—'], ['Completed', entity.completionDate ?? '—'],
      ]
      : 'currency' in entity
        ? [['Type', entity.type ?? '—'], ['Currency', entity.currency ?? '—'], ['Address', entity.address ?? '—']]
        : [['Category', entity.category ?? '—']];
    for (const [label, value] of facts) {
      const card = grid.createDiv({ cls: 'examined-human-daily-mini-stat' });
      card.createSpan({ text: label }); card.createEl('strong', { text: value });
    }
    if ('notes' in entity && entity.notes) detail.createDiv({ cls: 'examined-human-engagement-notes', text: entity.notes });

    const aliases = container.createEl('section', { cls: 'examined-human-daily-panel' });
    const heading = aliases.createDiv({ cls: 'examined-human-daily-section-heading' });
    heading.createEl('h4', { text: 'Aliases' });
    heading.createSpan({ text: String(entity.aliases.length), cls: 'examined-human-daily-section-meta' });
    const list = aliases.createDiv({ cls: 'examined-human-command-aliases' });
    if (entity.aliases.length === 0) list.createSpan({ text: 'No aliases yet.', cls: 'examined-human-daily-validation-note' });
    for (const alias of entity.aliases) {
      const chip = list.createDiv({ cls: 'examined-human-command-alias' });
      chip.createSpan({ text: alias });
      chip.createEl('button', { text: 'Remove' }).addEventListener('click', () => {
        void this.stage([`${commandPrefix}_ALIAS_REMOVE | ${entity.name} | ${alias}`]);
      });
      chip.createEl('button', { text: 'Move' }).addEventListener('click', () => {
        new EntityAliasMoveModal(this.app, this.plugin, kind, entity.name, alias, this.entityNames(kind), async () => this.refresh()).open();
      });
    }
    const add = aliases.createDiv({ cls: 'examined-human-command-alias-add' });
    const input = add.createEl('input', { attr: { placeholder: 'New alias', 'aria-label': `New ${kind} alias` } });
    add.createEl('button', { text: 'Stage alias' }).addEventListener('click', () => {
      const alias = input.value.trim();
      if (alias) void this.stage([`${commandPrefix}_ALIAS_ADD | ${entity.name} | [${alias}]`]);
    });
  }

  private renderEngagementActions(actions: HTMLElement, entity: CommandEngagementRecord): void {
    if (entity.status !== 'completed') {
      actions.createEl('button', { text: 'Stage completion' }).addEventListener('click', () => {
        void this.stage([`ENGAGEMENT_COMPLETE | ${entity.name}`]);
      });
    }
    if (entity.status !== 'paused') {
      actions.createEl('button', { text: 'Stage pause' }).addEventListener('click', () => {
        void this.stage([`ENGAGEMENT_PAUSE | ${entity.name}`]);
      });
    }
    if (entity.status !== 'active') {
      actions.createEl('button', { text: 'Stage reopen' }).addEventListener('click', () => {
        void this.stage([`ENGAGEMENT_REOPEN | ${entity.name}`]);
      });
    }
  }

  private entityNames(kind: 'engagement' | 'exercise' | 'account'): string[] {
    if (!this.catalog) return [];
    return kind === 'engagement'
      ? this.catalog.engagements.map((entity) => entity.name)
      : kind === 'exercise'
        ? this.catalog.exercises.map((entity) => entity.name)
        : this.catalog.accounts.map((entity) => entity.name);
  }

  private renderBatch(): void {
    const panel = this.contentEl.createEl('section', { cls: 'examined-human-daily-panel examined-human-command-batch' });
    panel.createEl('h3', { text: 'Batch command staging' });
    panel.createDiv({
      cls: 'examined-human-daily-section-subtitle',
      text: 'Paste one valid Admin Event per line. The commands are shown for confirmation, written into a chosen unimported Daily Note, and then validated by the normal note import workflow.',
    });
    const input = panel.createEl('textarea', { attr: { rows: '12', placeholder: 'FOOD_CREATE | …\nENGAGEMENT_CREATE | …' } });
    const actions = panel.createDiv({ cls: 'examined-human-modal-actions' });
    actions.createEl('button', { cls: 'mod-cta', text: 'Review and stage batch' }).addEventListener('click', () => {
      const commands = input.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      void this.stage(commands);
    });
  }

  private renderFoodList(container: HTMLElement): void {
    container.empty();
    const needle = this.search.trim().toLocaleLowerCase();
    const foods = this.foods.filter((food) => !needle || [food.name, food.category ?? '', ...food.aliases]
      .some((value) => value.toLocaleLowerCase().includes(needle)));
    if (foods.length === 0) {
      container.createDiv({ cls: 'examined-human-daily-empty-inline', text: 'No foods match this search.' });
      return;
    }
    for (const food of foods) {
      const button = container.createEl('button', {
        cls: `examined-human-command-food-item${food.id === this.selectedFoodId ? ' is-selected' : ''}`,
        attr: { title: food.name },
      });
      button.createEl('strong', { cls: 'examined-human-command-item-name', text: food.name });
      button.createSpan({
        cls: 'examined-human-command-item-meta',
        text: `${number(food.caloriesKcalPer100g, 0)} kcal / 100 g · ${food.timesLogged} logs`,
      });
      button.addEventListener('click', () => { this.selectedFoodId = food.id; this.render(); });
    }
  }

  private renderFoodDetails(container: HTMLElement, food: FoodLibraryRecord): void {
    const title = container.createDiv({ cls: 'examined-human-command-food-title' });
    title.createEl('h3', { text: food.name });
    if (food.category) title.createSpan({ cls: 'examined-human-engagement-badge', text: food.category });
    const actions = title.createDiv({ cls: 'examined-human-command-food-actions' });
    actions.createEl('button', { text: 'Edit food' }).addEventListener('click', () => {
      openFoodEditor(this.app, { plugin: this.plugin, food, onStaged: async () => this.refresh() });
    });
    actions.createEl('button', { text: 'Delete food', cls: 'mod-warning' }).addEventListener('click', () => {
      new FoodDeleteModal(this.app, this.plugin, food, async () => this.refresh()).open();
    });
    container.createDiv({
      cls: 'examined-human-command-food-meta',
      text: `${food.timesLogged} linked meal row${food.timesLogged === 1 ? '' : 's'}${food.lastLoggedDate ? ` · last logged ${food.lastLoggedDate}` : ''}`,
    });
    if (food.notes) container.createDiv({ cls: 'examined-human-engagement-notes', text: food.notes });

    const nutrition = container.createEl('section', { cls: 'examined-human-daily-panel' });
    nutrition.createEl('h4', { text: 'Nutrition per 100 g' });
    const grid = nutrition.createDiv({ cls: 'examined-human-daily-completeness-grid' });
    for (const [label, value] of nutritionAt(food, 100)) {
      const card = grid.createDiv({ cls: 'examined-human-daily-mini-stat' });
      card.createSpan({ text: label }); card.createEl('strong', { text: value });
    }

    const calculator = container.createEl('section', { cls: 'examined-human-daily-panel examined-human-food-calculator' });
    calculator.createEl('h4', { text: 'Amount calculator' });
    const input = calculator.createEl('input', { type: 'number', value: String(this.grams), attr: { min: '0', step: 'any', 'aria-label': 'Food amount in grams' } });
    const result = calculator.createDiv({ cls: 'examined-human-daily-completeness-grid' });
    const paint = (): void => {
      result.empty();
      const grams = Number(input.value);
      const values = nutritionAt(food, Number.isFinite(grams) && grams >= 0 ? grams : 0);
      for (const [label, value] of values) {
        const card = result.createDiv({ cls: 'examined-human-daily-mini-stat' });
        card.createSpan({ text: label }); card.createEl('strong', { text: value });
      }
    };
    input.addEventListener('input', () => { this.grams = Number(input.value) || 0; paint(); });
    paint();

    const aliases = container.createEl('section', { cls: 'examined-human-daily-panel' });
    const aliasHeader = aliases.createDiv({ cls: 'examined-human-daily-section-heading' });
    aliasHeader.createEl('h4', { text: 'Aliases' });
    aliasHeader.createSpan({ text: String(food.aliases.length), cls: 'examined-human-daily-section-meta' });
    const aliasList = aliases.createDiv({ cls: 'examined-human-command-aliases' });
    if (food.aliases.length === 0) aliasList.createSpan({ text: 'No aliases yet.', cls: 'examined-human-daily-validation-note' });
    for (const alias of food.aliases) {
      const chip = aliasList.createDiv({ cls: 'examined-human-command-alias' });
      chip.createSpan({ text: alias });
      chip.createEl('button', { text: 'Remove', attr: { 'aria-label': `Remove alias ${alias}` } }).addEventListener('click', () => {
        void this.stage([`FOOD_ALIAS_REMOVE | ${food.name} | [${alias}]`]);
      });
      chip.createEl('button', { text: 'Move', attr: { 'aria-label': `Move alias ${alias}` } }).addEventListener('click', () => {
        new FoodAliasMoveModal(this.app, this.plugin, food, alias, this.foods, async () => this.refresh()).open();
      });
    }
    const add = aliases.createDiv({ cls: 'examined-human-command-alias-add' });
    const aliasInput = add.createEl('input', { attr: { placeholder: 'New alias', 'aria-label': 'New food alias' } });
    add.createEl('button', { text: 'Stage alias' }).addEventListener('click', () => {
      const alias = aliasInput.value.trim();
      if (!alias) return;
      void this.stage([`FOOD_ALIAS_ADD | ${food.name} | [${alias}]`]);
    });
  }

  private async stage(commands: string[]): Promise<void> {
    try {
      const staged = await stageAdminCommands({ plugin: this.plugin, commands });
      if (staged) await this.refresh();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 10_000);
    }
  }
}

class FoodDeleteModal extends Modal {
  constructor(
    app: import('obsidian').App,
    private plugin: ExaminedHumanPlugin,
    private food: FoodLibraryRecord,
    private onStaged: () => Promise<void>,
  ) { super(app); }

  onOpen(): void {
    this.modalEl.addClass('examined-human-command-modal');
    this.contentEl.createEl('h2', { text: `Delete ${this.food.name}?` });
    this.contentEl.createEl('p', {
      text: 'This stages a deletion in a Daily Note. Existing historical meal text and nutrient snapshots remain, but their canonical food link will be cleared when the note is imported.',
    });
    const actions = this.contentEl.createDiv({ cls: 'examined-human-modal-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    actions.createEl('button', { text: 'Stage deletion', cls: 'mod-warning' }).addEventListener('click', () => { void this.stage(); });
  }

  private async stage(): Promise<void> {
    try {
      const staged = await stageAdminCommands({ plugin: this.plugin, commands: [`FOOD_DELETE | ${this.food.name}`] });
      if (!staged) return;
      this.close(); await this.onStaged();
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 10_000); }
  }
  onClose(): void { this.contentEl.empty(); }
}

class FoodAliasMoveModal extends Modal {
  private destination: string;
  constructor(
    app: import('obsidian').App,
    private plugin: ExaminedHumanPlugin,
    private source: FoodLibraryRecord,
    private alias: string,
    foods: FoodLibraryRecord[],
    private onStaged: () => Promise<void>,
  ) {
    super(app);
    this.destination = foods.find((food) => food.id !== source.id)?.name ?? '';
    this.foods = foods;
  }
  private foods: FoodLibraryRecord[];
  onOpen(): void {
    this.modalEl.addClass('examined-human-command-modal');
    this.contentEl.createEl('h2', { text: `Move alias “${this.alias}”` });
    new Setting(this.contentEl).setName('Destination food').addDropdown((dropdown) => {
      for (const food of this.foods.filter((food) => food.id !== this.source.id)) dropdown.addOption(food.name, food.name);
      return dropdown.setValue(this.destination).onChange((value) => { this.destination = value; });
    });
    const actions = this.contentEl.createDiv({ cls: 'examined-human-modal-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    actions.createEl('button', { cls: 'mod-cta', text: 'Stage alias move' }).addEventListener('click', () => { void this.stage(); });
  }
  private async stage(): Promise<void> {
    if (!this.destination) return;
    try {
      const staged = await stageAdminCommands({
        plugin: this.plugin,
        commands: [`FOOD_ALIAS_MOVE | [${this.alias}] | ${this.destination}`],
      });
      if (!staged) return;
      this.close(); await this.onStaged();
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 10_000); }
  }
  onClose(): void { this.contentEl.empty(); }
}

class EntityAliasMoveModal extends Modal {
  private destination: string;
  constructor(
    app: import('obsidian').App,
    private plugin: ExaminedHumanPlugin,
    private kind: 'engagement' | 'exercise' | 'account',
    private sourceName: string,
    private alias: string,
    names: string[],
    private onStaged: () => Promise<void>,
  ) {
    super(app);
    this.names = names.filter((name) => name !== sourceName);
    this.destination = this.names[0] ?? '';
  }
  private names: string[];
  onOpen(): void {
    this.modalEl.addClass('examined-human-command-modal');
    this.contentEl.createEl('h2', { text: `Move alias “${this.alias}”` });
    if (this.names.length === 0) {
      this.contentEl.createDiv({ text: 'Create another canonical record before moving this alias.' });
      return;
    }
    new Setting(this.contentEl).setName(`Destination ${this.kind}`).addDropdown((dropdown) => {
      for (const name of this.names) dropdown.addOption(name, name);
      return dropdown.setValue(this.destination).onChange((value) => { this.destination = value; });
    });
    const actions = this.contentEl.createDiv({ cls: 'examined-human-modal-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    actions.createEl('button', { cls: 'mod-cta', text: 'Stage alias move' }).addEventListener('click', () => { void this.stage(); });
  }
  private async stage(): Promise<void> {
    if (!this.destination) return;
    try {
      const staged = await stageAdminCommands({
        plugin: this.plugin,
        commands: [`${this.kind.toUpperCase()}_ALIAS_MOVE | ${this.alias} | ${this.destination}`],
      });
      if (!staged) return;
      this.close(); await this.onStaged();
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 10_000); }
  }
  onClose(): void { this.contentEl.empty(); }
}
