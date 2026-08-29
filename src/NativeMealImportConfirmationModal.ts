import { App, Modal } from 'obsidian';
import type { MealInspection } from './native-logger/meals.ts';

export interface NativeMealImportConfirmationOptions {
  date: string;
  historical: boolean;
  replacing: boolean;
  inspection: MealInspection;
}

export function confirmNativeMealImport(
  app: App,
  options: NativeMealImportConfirmationOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    new NativeMealImportConfirmationModal(app, options, resolve).open();
  });
}

class NativeMealImportConfirmationModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private options: NativeMealImportConfirmationOptions,
    private resolveChoice: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { inspection } = this.options;
    this.modalEl.addClass('examined-human-daily-confirm-modal');
    this.contentEl.createEl('h2', {
      text: this.options.replacing
        ? `Replace Meals for ${this.options.date}`
        : `Import Meals for ${this.options.date}`,
    });
    this.contentEl.createEl('p', {
      text: this.options.historical
        ? 'This is a finalized component import. After confirmation, historical Meals cannot be re-imported.'
        : 'This is an ephemeral component import. You can replace it freely while the date is current or future.',
    });

    const summary = this.contentEl.createDiv({ cls: 'examined-human-daily-confirm-summary' });
    const values = [
      ['Food rows', inspection.foodRowCount],
      ['Direct leisure', `${inspection.directLeisureMeals}/3`],
      ['Final leisure', `${inspection.leisureMeals}/3`],
      ['Daily calories', inspection.nutrition.dailyCaloriesKcal ?? '—'],
      ['Daily protein', inspection.nutrition.proteinG == null ? '—' : `${inspection.nutrition.proteinG} g`],
      ['Dieted', inspection.nutrition.evaluatedDieted == null
        ? '—'
        : inspection.nutrition.evaluatedDieted === 1 ? 'Yes' : 'No'],
    ];
    for (const [label, value] of values) {
      const card = summary.createDiv({ cls: 'examined-human-daily-confirm-stat' });
      card.createDiv({ cls: 'examined-human-weekly-eyebrow', text: String(label) });
      card.createDiv({ cls: 'examined-human-daily-confirm-value', text: String(value) });
    }

    if (inspection.warnings.length > 0) {
      const warnings = this.contentEl.createDiv({ cls: 'examined-human-daily-validation-callout is-warning' });
      warnings.createEl('strong', { text: 'Validation warnings' });
      const list = warnings.createEl('ul');
      for (const warning of inspection.warnings) list.createEl('li', { text: warning });
    }

    const safety = this.contentEl.createEl('p', { cls: 'examined-human-daily-confirm-warning' });
    safety.createEl('strong', {
      text: this.options.historical
        ? 'A database backup will be created first. '
        : 'No backup is created for this ephemeral-only write. ',
    });
    safety.appendText('The write is transactional and will be checked for stale-file conflicts and SQLite integrity.');

    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.finish(false));
    actions.createEl('button', {
      text: this.options.replacing ? 'Replace Meals' : 'Import Meals',
      cls: 'mod-cta',
    }).addEventListener('click', () => this.finish(true));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolveChoice(false);
  }

  private finish(confirmed: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveChoice(confirmed);
    this.close();
  }
}
