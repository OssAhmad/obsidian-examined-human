import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_SESSION_COLORS, ENGAGEMENT_TYPES, SESSION_TYPES } from './events.ts';
import type { FormDiscoveryCache, FormDiscoveryMode } from './form-discovery.ts';
import { DEFAULT_JOURNAL_FOLDER, normalizeJournalFolder } from './journal-folder.ts';
import { confirmWeeklyAction } from './WeeklyActionConfirmationModal.ts';
import type ExaminedHumanPlugin from './main.ts';

export interface ExaminedHumanSettings {
  databasePath: string;
  journalFolder: string;
  formDiscoveryMode: FormDiscoveryMode;
  formDiscoveryCache: FormDiscoveryCache;
  mealCalorieLimitKcal: number;
  dailyCalorieLimitKcal: number;
  minimumProteinG: number;
  sleepDayBoundaryHour: number;
  backupRetentionLimit: number;
  dismissedWarningKeys: string[];
  initialScrollHour: number;
  dayColumnWidth: number;
  mobileDayColumnWidth: number;
  defaultDashboardDays: number;
  valuationUnitLabel: string;
  valuationReferenceUnit: string;
  sessionColors: Record<string, string>;
  removeFormAfterDailyImport: boolean;
  removeFormAfterWeeklyImport: boolean;
  removeFormAfterBudgetImport: boolean;
}

export const DEFAULT_SETTINGS: ExaminedHumanSettings = {
  databasePath: 'EH.db',
  journalFolder: DEFAULT_JOURNAL_FOLDER,
  formDiscoveryMode: 'tagged-vault',
  formDiscoveryCache: { version: 1, entries: {} },
  mealCalorieLimitKcal: 0,
  dailyCalorieLimitKcal: 1850,
  minimumProteinG: 0,
  sleepDayBoundaryHour: 21,
  backupRetentionLimit: 0,
  dismissedWarningKeys: [],
  initialScrollHour: 7,
  dayColumnWidth: 180,
  mobileDayColumnWidth: 160,
  defaultDashboardDays: 14,
  valuationUnitLabel: 'EHM',
  valuationReferenceUnit: 'USD',
  sessionColors: { ...DEFAULT_SESSION_COLORS },
  removeFormAfterDailyImport: false,
  removeFormAfterWeeklyImport: false,
  removeFormAfterBudgetImport: false,
};

type DeclarativeControl =
  | { type: 'toggle'; key: string }
  | { type: 'text'; key: string; placeholder?: string; validate?: (value: string) => string | void }
  | { type: 'number'; key: string; min?: number; max?: number; step?: number; placeholder?: string; validate?: (value: number) => string | void }
  | { type: 'slider'; key: string; min: number; max: number; step: number }
  | { type: 'dropdown'; key: string; options: Record<string, string>; defaultValue?: string }
  | { type: 'color'; key: string };

/**
 * Obsidian 1.13's declarative setting shape. The id/name/description fields
 * also satisfy the settings-search compatibility descriptor in older API
 * typings, while desc/control/items are consumed by Obsidian 1.13+.
 */
interface DeclarativeSettingDefinition {
  [key: string]: unknown;
  id: string;
  name: string;
  description: string;
  desc?: string;
  type?: 'group' | 'page';
  heading?: string;
  items?: DeclarativeSettingDefinition[];
  control?: DeclarativeControl;
  render?: (setting: Setting) => void;
  action?: () => void | Promise<void>;
  searchable?: boolean;
}

function definition(
  id: string,
  name: string,
  description: string,
  details: Omit<DeclarativeSettingDefinition, 'id' | 'name' | 'description' | 'desc'> = {},
): DeclarativeSettingDefinition {
  return { id, name, description, desc: description, ...details };
}

function group(
  id: string,
  heading: string,
  description: string,
  items: DeclarativeSettingDefinition[],
): DeclarativeSettingDefinition {
  return definition(id, heading, description, { type: 'group', heading, items });
}

function page(
  id: string,
  name: string,
  description: string,
  items: DeclarativeSettingDefinition[],
): DeclarativeSettingDefinition {
  return definition(id, name, description, { type: 'page', items });
}

function wholeNumber(minimum: number, maximum?: number): (value: number) => string | void {
  return (value) => {
    if (!Number.isSafeInteger(value) || value < minimum || (maximum != null && value > maximum)) {
      return maximum == null
        ? `Enter a whole number of at least ${minimum}.`
        : `Enter a whole number from ${minimum} through ${maximum}.`;
    }
  };
}

function nonNegativeNumber(value: number): string | void {
  if (!Number.isFinite(value) || value < 0) return 'Enter zero or a positive number.';
}

function scalarString(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : fallback;
}

const COLOR_TYPES = [...new Set([...SESSION_TYPES, ...ENGAGEMENT_TYPES])];

export class ExaminedHumanSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ExaminedHumanPlugin) {
    super(app, plugin);
  }

  /**
   * Obsidian 1.13+ uses these definitions for rendering and global settings
   * search. Older Obsidian versions fall back to display(), which renders this
   * same definition tree so the two interfaces cannot drift apart.
   */
  getSettingDefinitions(): DeclarativeSettingDefinition[] {
    const sleepHours = Object.fromEntries(Array.from({ length: 24 }, (_, hour) => [
      String(hour),
      `${String(hour).padStart(2, '0')}:00`,
    ]));

    return [
      page('general', 'General', 'Database, Journal, assessment, import, and maintenance preferences.', [
        group('general-storage', 'Storage and discovery', 'Connect the plugin to its database and EH Form notes.', [
          definition(
            'database-path',
            'Database path',
            'Vault-relative path, for example EH.db or data/EH.db. Absolute paths are not supported.',
            { render: (setting: Setting) => this.renderDatabasePath(setting) },
          ),
          definition(
            'journal-folder',
            'Journal folder',
            'Vault-relative base folder containing Daily Notes and their subfolders. Leave blank to scan the vault root.',
            {
              control: {
                type: 'text',
                key: 'journalFolder',
                placeholder: DEFAULT_JOURNAL_FOLDER,
                validate: (value: string) => {
                  try { normalizeJournalFolder(value); } catch (error) {
                    return error instanceof Error ? error.message : String(error);
                  }
                },
              },
            },
          ),
          definition(
            'form-discovery',
            'Form discovery',
            'Choose a fast vault-wide scan of explicitly marked forms or a broader scan inside the Journal folder.',
            {
              control: {
                type: 'dropdown',
                key: 'formDiscoveryMode',
                defaultValue: 'tagged-vault',
                options: {
                  'tagged-vault': 'Only unimported EH Form notes',
                  'journal-folder': 'Every note in Journal folder',
                },
              },
            },
          ),
          definition(
            'backup-retention-limit',
            'Backup retention limit',
            'Maximum newest EH-created database backups to keep. Use 0 to keep every backup.',
            {
              control: {
                type: 'number', key: 'backupRetentionLimit', min: 0, step: 1,
                placeholder: '0', validate: wholeNumber(0),
              },
            },
          ),
        ]),
        group('general-assessment', 'Assessment defaults', 'Defaults shared by daily and domain dashboards.', [
          definition(
            'sleep-day-boundary',
            'Sleep day boundary',
            'Sleep from this hour on the previous date up to the same hour on the assessment date counts toward that day.',
            { control: { type: 'dropdown', key: 'sleepDayBoundaryHour', options: sleepHours, defaultValue: '21' } },
          ),
          definition(
            'default-dashboard-period',
            'Default dashboard period',
            'Inclusive days shown when analytical dashboards open. Each dashboard can still switch to all time.',
            {
              control: {
                type: 'number', key: 'defaultDashboardDays', min: 1, max: 3650, step: 1,
                validate: wholeNumber(1, 3650),
              },
            },
          ),
          definition(
            'hidden-dashboard-warnings',
            'Hidden dashboard warnings',
            'Restore non-blocking warning types hidden with “Don’t show again.” Import blockers and confirmations are never hidden.',
            { render: (setting: Setting) => this.renderHiddenWarnings(setting) },
          ),
        ]),
        group('general-form-cleanup', 'Form cleanup after import', 'Optional source-note cleanup after a successful confirmed import.', [
          definition(
            'remove-daily-form-after-import',
            'Remove Daily Form after import',
            'After a successful Daily import, remove the exact validated Daily Form block from its source note. Note cleanup has no separate backup.',
            { control: { type: 'toggle', key: 'removeFormAfterDailyImport' } },
          ),
          definition(
            'remove-weekly-form-after-import',
            'Remove Weekly Form after import',
            'After a successful Weekly import, remove the exact validated Weekly Form block from its source note. Note cleanup has no separate backup.',
            { control: { type: 'toggle', key: 'removeFormAfterWeeklyImport' } },
          ),
          definition(
            'remove-budget-form-after-import',
            'Remove Budget Form after import',
            'After a successful Budget import, remove the exact validated Budget Form block from its source note. Note cleanup has no separate backup.',
            { control: { type: 'toggle', key: 'removeFormAfterBudgetImport' } },
          ),
        ]),
        group('general-tools', 'Tools and maintenance', 'Open administrative tools and maintain the official database schema.', [
          definition(
            'command-center',
            'Open Command Center',
            'Audit canonical data and stage corrections into eligible EH Forms.',
            { action: () => this.plugin.activateCommandCenterView() },
          ),
          definition(
            'schema-upgrade',
            'Upgrade database to current Schema v1',
            'Preview and apply missing official Schema v1 foundations with a verified backup.',
            { render: (setting: Setting) => this.renderSchemaUpgrade(setting) },
          ),
        ]),
      ]),
      page('nutrition', 'Nutrition', 'Configure automatic daily nutrition evaluation.', [
        definition(
          'meal-calorie-limit',
          'Meal calorie limit',
          'Calories above this limit make Breakfast, Lunch, or Dinner leisure. Snacks never count directly. Use 0 to disable.',
          { control: { type: 'number', key: 'mealCalorieLimitKcal', min: 0, step: 1, validate: nonNegativeNumber } },
        ),
        definition(
          'daily-calorie-limit',
          'Daily calorie limit',
          'The complete daily total includes snacks. Exceeding a positive limit participates in automatic dieted evaluation. Use 0 to disable.',
          { control: { type: 'number', key: 'dailyCalorieLimitKcal', min: 0, step: 1, validate: nonNegativeNumber } },
        ),
        definition(
          'minimum-daily-protein',
          'Minimum daily protein',
          'A positive gram target participates in automatic dieted evaluation. Use 0 to ignore protein.',
          { control: { type: 'number', key: 'minimumProteinG', min: 0, step: 0.1, validate: nonNegativeNumber } },
        ),
        definition(
          'open-nutrition-dashboard',
          'Open Nutrition Dashboard',
          'Review calorie, protein, diet, and leisure-meal history.',
          { action: () => this.plugin.activateNutritionDashboardView() },
        ),
      ]),
      page('financial', 'Financial', 'Configure valuation display and open the financial dashboard.', [
        definition(
          'valuation-display-label',
          'Valuation display label',
          'Label displayed beside total valued assets and liabilities, such as EHM, USD, or Satoshi.',
          { control: { type: 'text', key: 'valuationUnitLabel', placeholder: 'EHM' } },
        ),
        definition(
          'reference-asset-class',
          'Reference asset class',
          'Exact account unit automatically worth one valuation unit. Matching ignores case and extra spaces.',
          { control: { type: 'text', key: 'valuationReferenceUnit', placeholder: 'USD' } },
        ),
        definition(
          'open-financial-dashboard',
          'Open Financial Dashboard',
          'Review accounts, transactions, budgets, valuations, and net flow.',
          { action: () => this.plugin.activateFinancialDashboardView() },
        ),
      ]),
      page('styling', 'Styling', 'Configure calendar layout and session colors.', [
        group('styling-calendar', 'Calendar layout', 'Choose the opening position and day-column widths.', [
          definition(
            'initial-calendar-hour',
            'Initial hour',
            'Vertical position used when the calendar opens or jumps to today.',
            { control: { type: 'slider', key: 'initialScrollHour', min: 0, max: 23, step: 1 } },
          ),
          definition(
            'desktop-day-width',
            'Desktop day width',
            'Width of each calendar day while scrolling horizontally on desktop.',
            { control: { type: 'slider', key: 'dayColumnWidth', min: 120, max: 280, step: 10 } },
          ),
          definition(
            'mobile-day-width',
            'Mobile day width',
            'Width of each calendar day while scrolling horizontally on mobile.',
            { control: { type: 'slider', key: 'mobileDayColumnWidth', min: 120, max: 280, step: 10 } },
          ),
        ]),
        group(
          'styling-colors',
          'Calendar type colors',
          'A session type controls color when present; otherwise the engagement type is used.',
          COLOR_TYPES.map((type) => definition(
            `color-${type}`,
            `${type} color`,
            `Calendar color for ${type} sessions or engagements.`,
            { render: (setting: Setting) => this.renderSessionColor(setting, type) },
          )),
        ),
      ]),
      page('exercise', 'Exercise', 'Exercise data is resolved from canonical exercise sessions and structured sets.', [
        definition(
          'exercise-session-recognition',
          'Exercise session recognition',
          'A Daily Form with Exercise Details must have exactly one session whose optional session type is exercise. All sets attach to that session.',
        ),
        definition(
          'open-exercise-dashboard',
          'Open Exercise Dashboard',
          'Review sessions, exercises, sets, volume, distance, and duration.',
          { action: () => this.plugin.activateExerciseDashboardView() },
        ),
      ]),
    ];
  }

  getControlValue(key: string): unknown {
    if (key === 'sleepDayBoundaryHour') return String(this.plugin.settings.sleepDayBoundaryHour);
    return this.plugin.settings[key as keyof ExaminedHumanSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key as keyof ExaminedHumanSettings) {
      case 'databasePath': this.plugin.settings.databasePath = String(value).trim(); break;
      case 'journalFolder': this.plugin.settings.journalFolder = normalizeJournalFolder(String(value)); break;
      case 'formDiscoveryMode':
        this.plugin.settings.formDiscoveryMode = value === 'journal-folder' ? 'journal-folder' : 'tagged-vault';
        break;
      case 'backupRetentionLimit': this.plugin.settings.backupRetentionLimit = Number(value); break;
      case 'sleepDayBoundaryHour': this.plugin.settings.sleepDayBoundaryHour = Number(value); break;
      case 'defaultDashboardDays': this.plugin.settings.defaultDashboardDays = Number(value); break;
      case 'mealCalorieLimitKcal': this.plugin.settings.mealCalorieLimitKcal = Number(value); break;
      case 'dailyCalorieLimitKcal': this.plugin.settings.dailyCalorieLimitKcal = Number(value); break;
      case 'minimumProteinG': this.plugin.settings.minimumProteinG = Number(value); break;
      case 'valuationUnitLabel':
        this.plugin.settings.valuationUnitLabel = String(value).trim() || DEFAULT_SETTINGS.valuationUnitLabel;
        break;
      case 'valuationReferenceUnit':
        this.plugin.settings.valuationReferenceUnit = String(value).trim() || DEFAULT_SETTINGS.valuationReferenceUnit;
        break;
      case 'initialScrollHour': this.plugin.settings.initialScrollHour = Number(value); break;
      case 'dayColumnWidth': this.plugin.settings.dayColumnWidth = Number(value); break;
      case 'mobileDayColumnWidth': this.plugin.settings.mobileDayColumnWidth = Number(value); break;
      case 'removeFormAfterDailyImport': this.plugin.settings.removeFormAfterDailyImport = value === true; break;
      case 'removeFormAfterWeeklyImport': this.plugin.settings.removeFormAfterWeeklyImport = value === true; break;
      case 'removeFormAfterBudgetImport': this.plugin.settings.removeFormAfterBudgetImport = value === true; break;
      default: throw new Error(`Unsupported declarative setting key: ${key}`);
    }
    await this.plugin.saveSettings();
    if (['sleepDayBoundaryHour', 'valuationUnitLabel', 'valuationReferenceUnit', 'dayColumnWidth', 'mobileDayColumnWidth'].includes(key)) {
      await this.plugin.refreshViews();
    }
  }

  display(): void {
    this.containerEl.empty();
    for (const item of this.getSettingDefinitions()) this.renderLegacyDefinition(item);
  }

  private renderLegacyDefinition(item: DeclarativeSettingDefinition): void {
    if (item.type === 'page' || item.type === 'group') {
      new Setting(this.containerEl).setName(item.name).setHeading();
      if (item.description) this.containerEl.createEl('p', { text: item.description, cls: 'setting-item-description' });
      for (const child of item.items ?? []) this.renderLegacyDefinition(child);
      return;
    }

    const setting = new Setting(this.containerEl).setName(item.name).setDesc(item.description);
    if (item.render) {
      item.render(setting);
      return;
    }
    if (item.action) {
      setting.addButton((button) => button.setButtonText(item.name).onClick(() => { void item.action?.(); }));
      return;
    }
    if (item.control) this.renderLegacyControl(setting, item.control);
  }

  private renderLegacyControl(setting: Setting, control: DeclarativeControl): void {
    const current = this.getControlValue(control.key);
    if (control.type === 'toggle') {
      setting.addToggle((toggle) => toggle.setValue(current === true).onChange(async (value) => {
        await this.setControlValue(control.key, value);
      }));
      return;
    }
    if (control.type === 'slider') {
      setting.addSlider((slider) => slider
        .setLimits(control.min, control.max, control.step)
        .setDynamicTooltip()
        .setValue(Number(current))
        .onChange(async (value) => { await this.setControlValue(control.key, value); }));
      return;
    }
    if (control.type === 'dropdown') {
      setting.addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(control.options)) dropdown.addOption(value, label);
        dropdown.setValue(scalarString(current, control.defaultValue ?? ''));
        dropdown.onChange(async (value) => { await this.setControlValue(control.key, value); });
      });
      return;
    }
    if (control.type === 'color') {
      setting.addColorPicker((picker) => picker.setValue(String(current)).onChange(async (value) => {
        await this.setControlValue(control.key, value);
      }));
      return;
    }

    setting.addText((text) => {
      if (control.type === 'number') {
        text.inputEl.type = 'number';
        if (control.min != null) text.inputEl.min = String(control.min);
        if (control.max != null) text.inputEl.max = String(control.max);
        if (control.step != null) text.inputEl.step = String(control.step);
      }
      if (control.placeholder) text.setPlaceholder(control.placeholder);
      text.setValue(scalarString(current));
      text.onChange(async (rawValue) => {
        const value = control.type === 'number' ? Number(rawValue) : rawValue;
        const error = control.validate?.(value as never);
        if (error) return;
        try {
          await this.setControlValue(control.key, value);
        } catch (caught) {
          new Notice(caught instanceof Error ? caught.message : String(caught), 8000);
        }
      });
    });
  }

  private renderDatabasePath(setting: Setting): void {
    setting
      .addText((text) => text
        .setPlaceholder('EH.db')
        .setValue(this.plugin.settings.databasePath)
        .onChange(async (value) => { await this.setControlValue('databasePath', value); }))
      .addButton((button) => button.setButtonText('Test connection').onClick(async () => {
        button.setDisabled(true);
        try {
          const result = await this.plugin.database.inspect(this.plugin.settings.databasePath);
          const range = result.firstDate && result.lastDate ? `${result.firstDate} to ${result.lastDate}` : 'no dated sessions';
          new Notice(`Examined Human database OK: ${result.sessionCount} sessions across ${result.distinctDays} days (${range}).`, 8000);
        } catch (error) {
          new Notice(`Examined Human database error: ${error instanceof Error ? error.message : String(error)}`, 10000);
        } finally { button.setDisabled(false); }
      }))
      .addButton((button) => button.setButtonText('Create Schema v1 database').onClick(async () => {
        button.setDisabled(true);
        try {
          const result = await this.plugin.logger.createDatabase(this.plugin.settings.databasePath);
          new Notice(`Created an empty Examined Human Data Schema v${result.schemaVersion} database at ${result.databasePath}.`, 9000);
          await this.plugin.refreshViews();
        } catch (error) {
          new Notice(`Examined Human database creation failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
        } finally { button.setDisabled(false); }
      }));
  }

  private renderHiddenWarnings(setting: Setting): void {
    const count = this.plugin.settings.dismissedWarningKeys.length;
    setting.setDesc(`${count} warning type${count === 1 ? '' : 's'} currently hidden. Import blockers and safety confirmations cannot be hidden.`);
    setting.addButton((button) => button
      .setButtonText('Show all warnings')
      .setDisabled(count === 0)
      .onClick(async () => {
        this.plugin.settings.dismissedWarningKeys = [];
        await this.plugin.saveSettings();
        await this.plugin.refreshViews();
        this.updateDeclarativeOrLegacy();
      }));
  }

  private renderSessionColor(setting: Setting, type: string): void {
    setting.addColorPicker((picker) => picker
      .setValue(this.plugin.settings.sessionColors[type] ?? DEFAULT_SESSION_COLORS[type])
      .onChange(async (value) => {
        this.plugin.settings.sessionColors[type] = value;
        await this.plugin.saveSettings();
        await this.plugin.refreshViews();
      }));
  }

  private renderSchemaUpgrade(setting: Setting): void {
    setting.addButton((button) => button.setButtonText('Preview upgrade').onClick(async () => {
      button.setDisabled(true);
      try {
        const preview = await this.plugin.logger.inspectSchemaV1Upgrade(this.plugin.settings.databasePath);
        const confirmed = await confirmWeeklyAction(this.app, {
          title: 'Upgrade to official Data Schema v1',
          explanation: 'This guarded upgrade adds any missing official Schema v1 foundations. Existing data is preserved.',
          confirmLabel: 'Upgrade database',
          dryRunOutput: `Current SQLite schema marker: v${preview.currentSchemaVersion}\nTarget official schema marker: v${preview.targetSchemaVersion}\nRetired migration records to replace: ${preview.migrationEntryCount}\nFood Dictionary needed: ${preview.needsFoodDictionary ? 'yes' : 'already present'}\nFinance foundation needed: ${preview.needsFinanceFoundation ? 'yes' : 'already present'}\nMutable dated budgets needed: ${preview.needsMutableBudgets ? 'yes' : 'already present'}\nValuation history needed: ${preview.needsValuationHistory ? 'yes' : 'already present'}\nOptional canonical session types needed: ${preview.needsOptionalSessionTypes ? 'yes' : 'already present'}`,
          warning: 'A backup, transaction, integrity checks, and post-write verification run before the upgraded database becomes the source of truth.',
        });
        if (!confirmed) return;
        const result = await this.plugin.logger.upgradeToOfficialSchemaV1(this.plugin.settings.databasePath);
        new Notice(`Upgraded ${result.databasePath} to official Data Schema v1. ${result.backupPath ? `Backup: ${result.backupPath}` : ''}`, 12_000);
        await this.plugin.refreshViews();
        this.updateDeclarativeOrLegacy();
      } catch (error) {
        new Notice(`Database upgrade was not performed: ${error instanceof Error ? error.message : String(error)}`, 12_000);
      } finally { button.setDisabled(false); }
    }));
  }

  private updateDeclarativeOrLegacy(): void {
    const update = (this as unknown as PluginSettingTab & { update?: () => void }).update;
    if (typeof update === 'function') update.call(this);
    else this.display();
  }
}
