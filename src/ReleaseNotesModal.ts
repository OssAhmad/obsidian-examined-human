import { App, Modal } from 'obsidian';

// Review build only. The owner will choose a published version after Wax testing.
export const RELEASE_NOTES_ID = 'health-command-center-review-2026-10-26';
export const RELEASE_NOTES = [
  'The Stoic portico icon opens the EH sidebar with simple Lucide icons, colored selection accents, and a compact activity summary. Select a dashboard to switch in place; Ctrl/Cmd-click or use ↗ to open another tab, including on mobile.',
  'Medical Dashboard: select an imported report or Daily medical log from the list on the right. Entries retain their imported order.',
  'Medical Forms support measurements, written findings, procedures, and confirmed report replacement with backups.',
  'Daily Forms now group Medication and Symptoms under Medical, and Transactions and Valuation Rates under Financial. Older flat forms remain supported.',
  'Medical database migration is in Settings → Examined Human → General → Tools and maintenance. It is no longer a command-palette action.',
  'Command Center → Health lists measurements, symptoms, medications, procedures, units, value types, and aliases. Add or edit a record there to stage Daily Admin Events; the confirmed Daily import applies them.',
  'Each vault represents one owner. Medical Forms no longer need a People catalog or a person field. Existing review databases need the Settings medical migration once.',
];

export class ReleaseNotesModal extends Modal {
  constructor(app: App, private dismissed?: () => void) { super(app); }
  onOpen(): void {
    this.modalEl.addClass('examined-human-release-notes-modal');
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: 'What’s new in Examined Human' });
    this.contentEl.createEl('p', { text: 'Medical Dashboard and sidebar review build — awaiting owner review before release.' });
    const list = this.contentEl.createEl('ul');
    RELEASE_NOTES.forEach(text => { list.createEl('li', { text }); });
    this.contentEl.createDiv({ cls: 'examined-human-modal-actions' }).createEl('button', { text: 'Close', cls: 'mod-cta' }).addEventListener('click', () => this.close());
  }
  onClose(): void { this.contentEl.empty(); this.dismissed?.(); }
}
