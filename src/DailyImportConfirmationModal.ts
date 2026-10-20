import { App, Modal } from 'obsidian';
import type { DailyInspection } from './logger/daily-note.ts';
import { renderDailyAssessmentReport, reportFromInspection } from './DailyAssessmentReport.ts';
import type { UnresolvedReference } from './unresolved-references.ts';
import { renderDailyReplacementWarning } from './DailyReplacementWarning.ts';

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
    const replacement = this.options.inspection.replacement;
    if (replacement) renderDailyReplacementWarning(this.contentEl, replacement);
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
      warning.createEl('strong', { text: replacement ? 'The old day has not been changed. ' : 'Nothing has been imported yet. ' });
      warning.appendText('Confirm only after reviewing the complete assessment above.');
    }

    const canConfirm = this.options.canConfirm !== false
      && rendered
      && this.options.inspection.ready
      && !this.options.blockedReason;
    let acknowledged = !replacement;
    let checkbox: HTMLInputElement | null = null;
    if (canConfirm && replacement) {
      const label = this.contentEl.createEl('label', { cls: 'examined-human-daily-replacement-acknowledgement' });
      checkbox = label.createEl('input', { type: 'checkbox' });
      label.createSpan({ text: `I understand: all old daily records for ${replacement.date} will be deleted and replaced, not merged.` });
    }
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    actions.createEl('button', { text: 'Close' }).addEventListener('click', () => this.finish(false));
    if (canConfirm) {
      const confirm = actions.createEl('button', {
        text: replacement ? `Delete and reimport ${replacement.date}` : this.options.confirmLabel,
        cls: replacement ? 'mod-warning' : 'mod-cta',
      });
      confirm.disabled = !acknowledged;
      checkbox?.addEventListener('change', () => {
        acknowledged = checkbox?.checked === true;
        confirm.disabled = !acknowledged;
      });
      confirm.addEventListener('click', () => {
        if (acknowledged) this.finish(true);
      });
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
