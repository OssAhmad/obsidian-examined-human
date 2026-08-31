import { App, Modal } from 'obsidian';
import type { DailyNoteListItem } from './daily-note-index.ts';
import type { AdminEventStagePreview } from './native-logger/admin-event-stage.ts';

export function chooseAdminEventStageTarget(
  app: App,
  targets: DailyNoteListItem[],
): Promise<DailyNoteListItem | null> {
  return new Promise((resolve) => new AdminEventStageTargetModal(app, targets, resolve).open());
}

export function confirmAdminEventStage(app: App, preview: AdminEventStagePreview): Promise<boolean> {
  return new Promise((resolve) => new AdminEventStageConfirmationModal(app, preview, resolve).open());
}

class AdminEventStageTargetModal extends Modal {
  constructor(
    app: App,
    private targets: DailyNoteListItem[],
    private resolve: (target: DailyNoteListItem | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('examined-human-daily-confirm-modal');
    this.contentEl.createEl('h2', { text: 'Choose an unimported Daily Note' });
    this.contentEl.createEl('p', {
      text: 'The command will be added to the note and will take effect only when that note is imported.',
    });
    const select = this.contentEl.createEl('select');
    for (const target of this.targets) {
      select.createEl('option', {
        value: target.filePath,
        text: `${target.date} · ${target.fileName} · ${target.temporalState}`,
      });
    }
    const actions = this.contentEl.createDiv({ cls: 'examined-human-modal-actions' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => {
      this.resolve(null);
      this.close();
    });
    const next = actions.createEl('button', { cls: 'mod-cta', text: 'Continue' });
    next.addEventListener('click', () => {
      this.resolve(this.targets.find((target) => target.filePath === select.value) ?? null);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class AdminEventStageConfirmationModal extends Modal {
  constructor(
    app: App,
    private preview: AdminEventStagePreview,
    private resolve: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('examined-human-daily-confirm-modal');
    this.contentEl.createEl('h2', { text: 'Stage Admin Event' });
    this.contentEl.createEl('p', { text: `Daily Note: ${this.preview.fileName} (${this.preview.noteDate})` });
    this.contentEl.createEl('pre', { text: this.preview.commands.join('\n') });
    this.contentEl.createEl('p', {
      cls: 'examined-human-daily-confirm-warning',
      text: 'This does not modify the database. It adds the command to the note, where normal import validation will apply it later.',
    });
    const actions = this.contentEl.createDiv({ cls: 'examined-human-modal-actions' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => {
      this.resolve(false);
      this.close();
    });
    const stage = actions.createEl('button', { cls: 'mod-cta', text: 'Stage command' });
    stage.addEventListener('click', () => {
      this.resolve(true);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
