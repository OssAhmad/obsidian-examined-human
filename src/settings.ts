import { App, Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_SESSION_COLORS, SESSION_TYPES } from './events.ts';
import type EqhCalendarPlugin from './main.ts';

export interface EqhCalendarSettings {
  databasePath: string;
  mealCalorieLimitKcal: number;
  dailyCalorieLimitKcal: number;
  minimumProteinG: number;
  backupRetentionLimit: number;
  dismissedWarningKeys: string[];
  initialScrollHour: number;
  dayColumnWidth: number;
  sessionColors: Record<string, string>;
}

export const DEFAULT_SETTINGS: EqhCalendarSettings = {
  databasePath: 'EQH.db',
  mealCalorieLimitKcal: 0,
  dailyCalorieLimitKcal: 1850,
  minimumProteinG: 0,
  backupRetentionLimit: 0,
  dismissedWarningKeys: [],
  initialScrollHour: 7,
  dayColumnWidth: 180,
  sessionColors: { ...DEFAULT_SESSION_COLORS },
};

export class EqhCalendarSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: EqhCalendarPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('Database').setHeading();
    containerEl.createEl('p', {
      text: 'Dashboard queries remain read-only. Native schema-v5 creation and confirmed component imports use a separate guarded writer with backups and integrity checks.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Database path')
      .setDesc('Path relative to the vault root, for example EQH.db or data/EQH.db. Absolute paths are not supported.')
      .addText((text) => text
        .setPlaceholder('EQH.db')
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
            new Notice(`EQH database OK: ${result.sessionCount} sessions across ${result.distinctDays} days (${range}).`, 8000);
          } catch (error) {
            new Notice(`EQH database error: ${error instanceof Error ? error.message : String(error)}`, 10000);
          } finally {
            button.setDisabled(false);
          }
        }))
      .addButton((button) => button
        .setButtonText('Create v5 database')
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const result = await this.plugin.nativeLogger.createDatabase(this.plugin.settings.databasePath);
            new Notice(`Created an empty EQH schema v${result.schemaVersion} database at ${result.databasePath}.`, 9000);
            await this.plugin.refreshViews();
          } catch (error) {
            new Notice(`EQH database creation failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
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

    if (Platform.isMobile) {
      new Setting(containerEl)
        .setName('Mobile day width')
        .setDesc('The EH Dashboards calendar automatically fits approximately one full day to the mobile viewport.');
    } else {
      new Setting(containerEl)
        .setName('Day column width')
        .setDesc('Width of each day while scrolling horizontally on desktop.')
        .addSlider((slider) => slider
          .setLimits(120, 280, 10)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.dayColumnWidth)
          .onChange(async (value) => {
            this.plugin.settings.dayColumnWidth = value;
            await this.plugin.saveSettings();
            await this.plugin.refreshViews();
          }));
    }

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
