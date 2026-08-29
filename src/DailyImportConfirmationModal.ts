import { App, Modal } from 'obsidian';
import type { NativeDailyInspection } from './native-logger/daily-note.ts';

export interface DailyImportConfirmationOptions {
  title: string;
  explanation: string;
  confirmLabel: string;
  inspection: NativeDailyInspection;
  dryRunOutput?: string;
}

export function confirmDailyImport(
  app: App,
  options: DailyImportConfirmationOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    new DailyImportConfirmationModal(app, options, resolve).open();
  });
}

class DailyImportConfirmationModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private options: DailyImportConfirmationOptions,
    private resolveChoice: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('examined-human-daily-confirm-modal');
    this.contentEl.createEl('h2', { text: this.options.title });
    this.contentEl.createEl('p', { text: this.options.explanation });
    const completeness = this.options.inspection.completeness;
    if (completeness) {
      const summary = this.contentEl.createDiv({ cls: 'examined-human-daily-confirm-summary' });
      const items = [
        ['Sessions', completeness.session_count],
        ['Transactions', completeness.transaction_count],
        ['Exercises', completeness.exercise_count],
        ['Foods', completeness.meal_count],
        ['Milestones', completeness.milestone_count],
        ['Admin events', completeness.admin_event_count],
      ];
      for (const [label, value] of items) {
        const card = summary.createDiv({ cls: 'examined-human-daily-confirm-stat' });
        card.createDiv({ cls: 'examined-human-weekly-eyebrow', text: String(label) });
        card.createDiv({ cls: 'examined-human-daily-confirm-value', text: String(value) });
      }
      const missing = completeness.missing_daily_metrics;
      const metrics = this.contentEl.createDiv({
        cls: `examined-human-daily-completeness-callout ${missing.length > 0 ? 'is-incomplete' : 'is-complete'}`,
      });
      metrics.createEl('strong', {
        text: missing.length > 0
          ? `${missing.length} empty daily metric cell${missing.length === 1 ? '' : 's'}`
          : 'All daily metric cells are filled',
      });
      if (missing.length > 0) metrics.createDiv({ text: missing.join(', ') });
    }

    if (this.options.inspection.warnings.length > 0) {
      const warnings = this.contentEl.createDiv({ cls: 'examined-human-daily-validation-callout is-warning' });
      warnings.createEl('strong', { text: 'Validation warnings' });
      warnings.createEl('ul');
      const list = warnings.querySelector('ul');
      for (const warning of this.options.inspection.warnings) list?.createEl('li', { text: warning });
    }

    if (this.options.inspection.errors.length > 0) {
      const errors = this.contentEl.createDiv({ cls: 'examined-human-daily-validation-callout is-error' });
      errors.createEl('strong', { text: 'Historical import blockers' });
      const list = errors.createEl('ul');
      for (const error of this.options.inspection.errors) list.createEl('li', { text: error });
    }

    if (this.options.dryRunOutput?.trim()) {
      this.contentEl.createEl('details', { cls: 'examined-human-daily-dry-run-details' }, (details) => {
        details.createEl('summary', { text: 'Dry-run output' });
        details.createEl('textarea', {
          cls: 'examined-human-daily-output',
          text: this.options.dryRunOutput,
          attr: { readonly: 'true', rows: '8' },
        });
      });
    }

    const warning = this.contentEl.createEl('p', { cls: 'examined-human-daily-confirm-warning' });
    warning.createEl('strong', { text: 'Nothing has been imported yet. ' });
    warning.appendText('Confirm only after reviewing the preview and completeness summary.');

    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.finish(false));
    actions.createEl('button', {
      text: this.options.confirmLabel,
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
