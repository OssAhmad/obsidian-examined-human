import { App, Modal } from 'obsidian';

// Review build only. The owner will choose a published version after Wax testing.
export const RELEASE_NOTES_ID = 'medical-dashboard-review-2026-10-26';
export const RELEASE_NOTES = [
  'Medical Dashboard: select an imported report or Daily medical log from the list on the right. Entries retain their imported order.',
  'Medical Forms support measurements, written findings, procedures, and confirmed report replacement with backups.',
  'Daily Forms now group Medication and Symptoms under Medical, and Transactions and Valuation Rates under Financial. Older flat forms remain supported.',
  'Medical database migration is in Settings → Examined Human → General → Tools and maintenance. It is no longer a command-palette action.',
  'Canonical health catalogs retain measurement and medication units; blank and explicit none remain distinct.',
];

export class ReleaseNotesModal extends Modal {
  constructor(app: App, private dismissed?: () => void) { super(app); }
  onOpen(): void {
    this.contentEl.createEl('h2', { text: 'What’s new in Examined Human' });
    this.contentEl.createEl('p', { text: 'Medical Dashboard review build — awaiting owner review before release.' });
    const list = this.contentEl.createEl('ul');
    RELEASE_NOTES.forEach(text => { list.createEl('li', { text }); });
    this.contentEl.createEl('button', { text: 'Close', cls: 'mod-cta' }).addEventListener('click', () => this.close());
  }
  onClose(): void { this.contentEl.empty(); this.dismissed?.(); }
}
