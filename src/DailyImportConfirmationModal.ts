import { App, Modal } from 'obsidian';
import type { DailyInspection } from './logger/daily-note.ts';
import { renderDailyAssessmentReport, reportFromInspection } from './DailyAssessmentReport.ts';
import type { UnresolvedReference } from './unresolved-references.ts';

export interface DailyImportConfirmationOptions {
  title: string;
  explanation: string;
  confirmLabel: string;
  inspection: DailyInspection;
  sessionColors: Record<string, string>;
  initialScrollHour: number;
  valuationLabel: string;
  canConfirm?: boolean;
  blockedReason?: string;
  onResolveReference?: (reference: UnresolvedReference) => void;
}

export function confirmDailyImport(app: App, options: DailyImportConfirmationOptions): Promise<boolean> {
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
    const report = reportFromInspection(this.options.inspection);
    const rendered = renderDailyAssessmentReport(this.app, this.contentEl, report, {
      sessionColors: this.options.sessionColors,
      initialScrollHour: this.options.initialScrollHour,
      valuationLabel: this.options.valuationLabel,
      onResolveReference: this.options.onResolveReference
        ? (reference) => {
          this.finish(false);
          this.options.onResolveReference?.(reference);
        }
        : undefined,
    });

    if (this.options.blockedReason) {
      const blocked = this.contentEl.createDiv({ cls: 'examined-human-daily-validation-callout is-warning' });
      blocked.createEl('strong', { text: 'Import unavailable' });
      blocked.createDiv({ text: this.options.blockedReason });
    } else if (rendered && this.options.inspection.ready) {
      const warning = this.contentEl.createEl('p', { cls: 'examined-human-daily-confirm-warning' });
      warning.createEl('strong', { text: 'Nothing has been imported yet. ' });
      warning.appendText('Confirm only after reviewing the complete assessment above.');
    }

    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    actions.createEl('button', { text: 'Close' }).addEventListener('click', () => this.finish(false));
    const canConfirm = this.options.canConfirm !== false
      && rendered
      && this.options.inspection.ready
      && !this.options.blockedReason;
    if (canConfirm) {
      actions.createEl('button', { text: this.options.confirmLabel, cls: 'mod-cta' })
        .addEventListener('click', () => this.finish(true));
    }
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
