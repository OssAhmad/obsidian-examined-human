import { App, TFile } from 'obsidian';
import { hasBudgetForm } from './native-logger/budget.ts';

export interface BudgetNoteListItem {
  fileName: string;
  filePath: string;
}

/**
 * Budget notes deliberately have no configured folder. The picker searches file
 * names and paths only, then reads just the chosen file to validate its form.
 */
export function budgetNoteCandidates(app: App): BudgetNoteListItem[] {
  return app.vault.getMarkdownFiles()
    .map((file) => ({ fileName: file.name, filePath: file.path }))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
}

export async function readBudgetNote(app: App, candidate: BudgetNoteListItem): Promise<BudgetNoteListItem & { sourceText: string }> {
  const file = app.vault.getAbstractFileByPath(candidate.filePath);
  if (!(file instanceof TFile)) throw new Error(`Budget note was not found: ${candidate.filePath}`);
  const sourceText = await app.vault.read(file);
  if (!hasBudgetForm(sourceText)) throw new Error(`${candidate.filePath} does not contain an EH Budget Form.`);
  return { ...candidate, sourceText };
}
