import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_SESSION_COLORS, SESSION_TYPES } from './events.ts';
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
  backupRetentionLimit: number;
  dismissedWarningKeys: string[];
  initialScrollHour: number;
  dayColumnWidth: number;
  mobileDayColumnWidth: number;
  defaultDashboardDays: number;
  valuationUnitLabel: string;
  valuationReferenceUnit: string;
  sessionColors: Record<string, string>;
}

export const DEFAULT_SETTINGS: ExaminedHumanSettings = {
  databasePath: 'EH.db',
  journalFolder: DEFAULT_JOURNAL_FOLDER,
  formDiscoveryMode: 'tagged-vault',
  formDiscoveryCache: { version: 1, entries: {} },
  mealCalorieLimitKcal: 0,
  dailyCalorieLimitKcal: 1850,
  minimumProteinG: 0,
  backupRetentionLimit: 0,
  dismissedWarningKeys: [],
  initialScrollHour: 7,
  dayColumnWidth: 180,
  mobileDayColumnWidth: 160,
  defaultDashboardDays: 14,
  valuationUnitLabel: 'EHM',
  valuationReferenceUnit: 'USD',
  sessionColors: { ...DEFAULT_SESSION_COLORS },
};

export class ExaminedHumanSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ExaminedHumanPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('Database').setHeading();
    containerEl.createEl('p', {
      text: 'Dashboard queries remain read-only. Official Data Schema v1 creation and confirmed imports use a separate guarded writer with backups and integrity checks.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Database path')
      .setDesc('Path relative to the vault root, for example EH.db or data/EH.db. Absolute paths are not supported.')
      .addText((text) => text
        .setPlaceholder('EH.db')
        .setValue(this.plugin.settings.databasePath)
        .onChange(async (value) => {
          this.plugin.settings.databasePath = value.trim();
          await this.plugin.saveSettings();
        }))
      .addButton((button) => button
        .setButtonText('Test connection')
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const result = await this.plugin.database.inspect(this.plugin.settings.databasePath);
            const range = result.firstDate && result.lastDate ? `${result.firstDate} to ${result.lastDate}` : 'no dated sessions';
            new Notice(`Examined Human database OK: ${result.sessionCount} sessions across ${result.distinctDays} days (${range}).`, 8000);
          } catch (error) {
            new Notice(`Examined Human database error: ${error instanceof Error ? error.message : String(error)}`, 10000);
          } finally {
            button.setDisabled(false);
          }
        }))
      .addButton((button) => button
        .setButtonText('Create Schema v1 database')
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const result = await this.plugin.nativeLogger.createDatabase(this.plugin.settings.databasePath);
            new Notice(`Created an empty Examined Human Data Schema v${result.schemaVersion} database at ${result.databasePath}.`, 9000);
            await this.plugin.refreshViews();
          } catch (error) {
            new Notice(`Examined Human database creation failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
          } finally {
            button.setDisabled(false);
          }
        }));

    new Setting(containerEl).setName('Valuation').setHeading();
    containerEl.createEl('p', {
      text: 'Valuation Rates are user-entered dated observations. The Finance Dashboard carries each known rate forward until a newer one is imported; it never fetches market data.',
      cls: 'setting-item-description',
    });
    new Setting(containerEl)
      .setName('Valuation display label')
      .setDesc('Label displayed beside total valued assets and liabilities. It can be EHM, USD, Satoshi, or any other text.')
      .addText((text) => text
        .setPlaceholder('EHM')
        .setValue(this.plugin.settings.valuationUnitLabel)
        .onChange(async (value) => {
          this.plugin.settings.valuationUnitLabel = value.trim() || DEFAULT_SETTINGS.valuationUnitLabel;
          await this.plugin.saveSettings();
          await this.plugin.refreshViews();
        }));
    new Setting(containerEl)
      .setName('Reference asset class')
      .setDesc('Exact account unit that is automatically worth 1 valuation unit. Default: USD. Matching ignores case and extra spaces.')
      .addText((text) => text
        .setPlaceholder('USD')
        .setValue(this.plugin.settings.valuationReferenceUnit)
        .onChange(async (value) => {
          this.plugin.settings.valuationReferenceUnit = value.trim() || DEFAULT_SETTINGS.valuationReferenceUnit;
          await this.plugin.saveSettings();
          await this.plugin.refreshViews();
        }));

    new Setting(containerEl)
      .setName('Upgrade legacy database to Schema v1')
      .setDesc('One-time pre-1.0 upgrade for the Food Dictionary, Finance, and Valuation foundations. It preserves existing meal rows, adds canonical foods/aliases, budget tables, and valuation history, resets retired migration metadata to official Data Schema v1, and creates a verified backup.')
      .addButton((button) => button
        .setButtonText('Preview upgrade')
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const preview = await this.plugin.nativeLogger.inspectSchemaV1Upgrade(this.plugin.settings.databasePath);
            const confirmed = await confirmWeeklyAction(this.app, {
              title: 'Upgrade to official Data Schema v1',
              explanation: 'This one-time upgrade adds the Food Dictionary, Finance, and Valuation foundations. It keeps existing meal rows unchanged, but replaces retired schema migration history with one official Schema v1 record.',
              confirmLabel: 'Upgrade database',
              dryRunOutput: `Current SQLite schema marker: v${preview.currentSchemaVersion}\nTarget official schema marker: v${preview.targetSchemaVersion}\nRetired migration records to replace: ${preview.migrationEntryCount}\nFood Dictionary needed: ${preview.needsFoodDictionary ? 'yes' : 'already present'}\nFinance foundation needed: ${preview.needsFinanceFoundation ? 'yes' : 'already present'}\nMutable dated budgets needed: ${preview.needsMutableBudgets ? 'yes' : 'already present'}\nValuation history needed: ${preview.needsValuationHistory ? 'yes' : 'already present'}\nNew tables when needed: foods, food_aliases, budget_plans, budget_targets, expected_financial_movements, valuation_rate_sets, valuation_rates\nNew daily_meals links when needed: food_id, amount_g, nutrient snapshots`,
              warning: 'A backup, transaction, integrity checks, and post-write verification will run before the upgraded database becomes the source of truth.',
            });
            if (!confirmed) return;
            const result = await this.plugin.nativeLogger.upgradeToOfficialSchemaV1(this.plugin.settings.databasePath);
            new Notice(`Upgraded ${result.databasePath} to official Data Schema v1. ${result.backupPath ? `Backup: ${result.backupPath}` : ''}`, 12_000);
            await this.plugin.refreshViews();
            this.display();
          } catch (error) {
            new Notice(`Database upgrade was not performed: ${error instanceof Error ? error.message : String(error)}`, 12_000);
          } finally {
            button.setDisabled(false);
          }
        }));

    new Setting(containerEl)
      .setName('Backup retention limit')
      .setDesc('Maximum number of newest EH-created database backups to keep. Use 0 to keep every backup. Cleanup runs only after a successful verified database write and never removes unrelated files.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.step = '1';
        text.setPlaceholder('0');
        text.setValue(String(this.plugin.settings.backupRetentionLimit));
        text.onChange(async (value) => {
          const parsed = Number(value);
          if (!Number.isSafeInteger(parsed) || parsed < 0) return;
          this.plugin.settings.backupRetentionLimit = parsed;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName('Journal notes').setHeading();
    containerEl.createEl('p', {
      text: 'Examined Human recursively scans the selected vault folder for Daily Notes. The currently supported canonical filename format is YYYY-MM-DD.md.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Journal folder')
      .setDesc('Vault-relative base folder containing Daily Notes, including any year or daily subfolders. Leave blank to scan the entire vault.')
      .addText((text) => text
        .setPlaceholder(DEFAULT_JOURNAL_FOLDER)
        .setValue(this.plugin.settings.journalFolder)
        .onChange(async (value) => {
          try {
            this.plugin.settings.journalFolder = normalizeJournalFolder(value);
            await this.plugin.saveSettings();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error), 8000);
          }
        }));

    new Setting(containerEl)
      .setName('Form discovery')
      .setDesc('Default: scan only Markdown notes whose YAML frontmatter contains EH form: true or unimported (case-insensitive). Imported and false markers are skipped. Journal folder mode also scans unmarked notes in that folder and can take noticeably longer in a large vault.')
      .addDropdown((dropdown) => dropdown
        .addOption('tagged-vault', 'Only unimported EH Form notes')
        .addOption('journal-folder', 'Every note in Journal folder')
        .setValue(this.plugin.settings.formDiscoveryMode)
        .onChange(async (value) => {
          this.plugin.settings.formDiscoveryMode = value === 'journal-folder' ? 'journal-folder' : 'tagged-vault';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName('Nutrition evaluation').setHeading();
    containerEl.createEl('p', {
      text: 'These limits are used by the native Meals inspector. Zero disables that automatic rule. When both daily calories and minimum protein are zero, the EH Form dieted value is trusted.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Meal calorie limit')
      .setDesc('Calories above this limit make Breakfast, Lunch, or Dinner leisure. Snacks never count directly. Set to 0 to use only is_leisure from the note.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.step = '1';
        text.setValue(String(this.plugin.settings.mealCalorieLimitKcal));
        text.onChange(async (value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed < 0) return;
          this.plugin.settings.mealCalorieLimitKcal = parsed;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Daily calorie limit')
      .setDesc('The complete daily total includes snacks. Exceeding a positive limit makes the day count at least two leisure meals and participates in automatic dieted evaluation. Set to 0 to disable.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.step = '1';
        text.setValue(String(this.plugin.settings.dailyCalorieLimitKcal));
        text.onChange(async (value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed < 0) return;
          this.plugin.settings.dailyCalorieLimitKcal = parsed;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Minimum daily protein')
      .setDesc('A positive gram target participates in automatic dieted evaluation. Set to 0 to ignore protein and trust the remaining enabled rules or the EH Form value.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.step = '0.1';
        text.setValue(String(this.plugin.settings.minimumProteinG));
        text.onChange(async (value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed < 0) return;
          this.plugin.settings.minimumProteinG = parsed;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName('Native logger').setHeading();
    containerEl.createEl('p', {
      text: 'Daily validation and import, current/future projections, weekly-plan import, and weekly Daily Note writing run inside Obsidian on desktop and mobile. Python is not required.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Command Center')
      .setDesc('Audit the Food Library and stage corrections into unimported Daily Notes. Contextual validation fixes use the current unimported note automatically; Command Center changes let you choose a current or future note.')
      .addButton((button) => button
        .setButtonText('Open Command Center')
        .onClick(() => { void this.plugin.activateCommandCenterView(); }));

    new Setting(containerEl)
      .setName('Default dashboard period')
      .setDesc('Number of inclusive days used by Finance, Nutrition, Exercise, and other analytical dashboards when they open. Use All time inside a dashboard for the complete history.')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.step = '1';
        text.setValue(String(this.plugin.settings.defaultDashboardDays));
        text.onChange(async (value) => {
          const parsed = Number(value);
          if (!Number.isSafeInteger(parsed) || parsed < 1) return;
          this.plugin.settings.defaultDashboardDays = parsed;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Hidden dashboard warnings')
      .setDesc(`${this.plugin.settings.dismissedWarningKeys.length} warning type${this.plugin.settings.dismissedWarningKeys.length === 1 ? '' : 's'} hidden with “Don't show again”. Import blockers and safety confirmations cannot be hidden.`)
      .addButton((button) => button
        .setButtonText('Show all warnings')
        .setDisabled(this.plugin.settings.dismissedWarningKeys.length === 0)
        .onClick(async () => {
          this.plugin.settings.dismissedWarningKeys = [];
          await this.plugin.saveSettings();
          await this.plugin.refreshViews();
          this.display();
        }));

    new Setting(containerEl)
      .setName('Initial hour')
      .setDesc('Vertical position used when the calendar opens or jumps to today.')
      .addSlider((slider) => slider
        .setLimits(0, 23, 1)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.initialScrollHour)
        .onChange(async (value) => {
          this.plugin.settings.initialScrollHour = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Desktop day width')
      .setDesc('Width of each calendar day while scrolling horizontally on desktop.')
      .addSlider((slider) => slider
        .setLimits(120, 280, 10)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.dayColumnWidth)
        .onChange(async (value) => {
          this.plugin.settings.dayColumnWidth = value;
          await this.plugin.saveSettings();
          await this.plugin.refreshViews();
        }));

    new Setting(containerEl)
      .setName('Mobile day width')
      .setDesc('Width of each calendar day while scrolling horizontally on mobile.')
      .addSlider((slider) => slider
        .setLimits(120, 280, 10)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.mobileDayColumnWidth)
        .onChange(async (value) => {
          this.plugin.settings.mobileDayColumnWidth = value;
          await this.plugin.saveSettings();
          await this.plugin.refreshViews();
        }));

    new Setting(containerEl).setName('Session colors').setHeading();
    containerEl.createEl('p', {
      text: 'Colors are keyed by the canonical session_types.code referenced by sessions.session_type_id. Unknown values render in gray.',
      cls: 'setting-item-description',
    });

    for (const type of SESSION_TYPES) {
      new Setting(containerEl)
        .setName(type)
        .addColorPicker((picker) => picker
          .setValue(this.plugin.settings.sessionColors[type] ?? DEFAULT_SESSION_COLORS[type])
          .onChange(async (value) => {
            this.plugin.settings.sessionColors[type] = value;
            await this.plugin.saveSettings();
            await this.plugin.refreshViews();
          }));
    }
  }
}
