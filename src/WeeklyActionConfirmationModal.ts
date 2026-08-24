import { App, Modal } from 'obsidian';

export interface WeeklyActionConfirmationOptions {
  title: string;
  explanation: string;
  confirmLabel: string;
  dryRunOutput: string;
  warning: string;
}

export function confirmWeeklyAction(
  app: App,
  options: WeeklyActionConfirmationOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    new WeeklyActionConfirmationModal(app, options, resolve).open();
  });
}

class WeeklyActionConfirmationModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private options: WeeklyActionConfirmationOptions,
    private resolveChoice: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('eqh-daily-confirm-modal');
    this.contentEl.createEl('h2', { text: this.options.title });
    this.contentEl.createEl('p', { text: this.options.explanation });
    const details = this.contentEl.createEl('details', {
      cls: 'eqh-daily-dry-run-details',
      attr: { open: 'true' },
    });
    details.createEl('summary', { text: 'Dry-run output' });
    const output = details.createEl('textarea', {
      cls: 'eqh-daily-output',
      attr: { readonly: 'true', rows: '12' },
    });
    output.value = this.options.dryRunOutput;
    const warning = this.contentEl.createEl('p', { cls: 'eqh-daily-confirm-warning' });
    warning.createEl('strong', { text: 'Nothing has been changed yet. ' });
    warning.appendText(this.options.warning);

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
