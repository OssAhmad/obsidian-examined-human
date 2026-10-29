import { App, Modal } from 'obsidian';

// A versioned ID shows these notes once for this release.
export const RELEASE_NOTES_ID = '0.9.8';
export const RELEASE_NOTES = [
  'Click a Calendar date heading to open its Daily Log in a pop-up over the Calendar, including medication and symptoms, using the shared assessment report. Import controls stay in Daily Assessment.',
  'Fixed medical updates for older report tables with a separate person_id foreign key. Reports and linked measurements are preserved.',
  'Daily Assessment puts only the scrollable time summary beside the day timeline; food, finance, medical entries, and notes are full width below.',
  'The Stoic portico icon opens the EH sidebar with simple Lucide icons, colored selection accents, and a compact activity summary. Select a dashboard to switch in place; Ctrl/Cmd-click or use ↗ to open another tab, including on mobile.',
  'Medical Dashboard now lists only imported EH Medical Forms in a left navigator with wrapping names and vertical-only scrolling. Entries retain their imported order.',
  'Medical Forms support measurements, written findings, procedures, and confirmed report replacement with backups.',
  'Daily Forms now group Medication and Symptoms under Medical, and Transactions and Valuation Rates under Financial. Older flat forms remain supported.',
  'All database updates, including medical updates, use Settings → Examined Human → General → Tools and maintenance → Update to schema v1. The button shows Already updated when no updates remain.',
  'Command Center → Health lists measurements, symptoms, medications, procedures, units, value types, and aliases. Add or edit a record there to stage Daily Admin Events; the confirmed Daily import applies them.',
  'Each vault represents one owner. Medical Forms no longer need a People catalog or a person field. Existing review databases use the same Settings schema update.',
];

export class ReleaseNotesModal extends Modal {
  constructor(app: App, private dismissed?: () => void) { super(app); }
  onOpen(): void {
    this.modalEl.addClass('examined-human-release-notes-modal');
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: 'What’s new in Examined Human' });
    this.contentEl.createEl('p', { text: 'Version 0.9.8 — Medical Forms and Daily Logs' });
    const list = this.contentEl.createEl('ul');
    RELEASE_NOTES.forEach(text => { list.createEl('li', { text }); });
    this.contentEl.createDiv({ cls: 'examined-human-modal-actions' }).createEl('button', { text: 'Close', cls: 'mod-cta' }).addEventListener('click', () => this.close());
  }
  onClose(): void { this.contentEl.empty(); this.dismissed?.(); }
}
