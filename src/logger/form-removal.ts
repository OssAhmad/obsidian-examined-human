import { findAllEhForms, type EhFormKind } from '../forms/form-document.ts';

export interface ImportedFormRemovalInput {
  kind: EhFormKind;
  expectedFormText: string;
  sourceText: string;
}

function withoutTrailingSeparator(text: string): string {
  return text.replace(/(\r?\n)[ \t]*(\r?\n)$/, '$1');
}

/**
 * Removes exactly the form bytes that were validated and imported.
 *
 * Matching the complete bounded block is intentional: a kind-only lookup can
 * delete a different form, while an exact match safely refuses cleanup if the
 * user edits the form during the import.
 */
export function removeImportedFormBlock(input: ImportedFormRemovalInput): string {
  const matches = findAllEhForms(input.sourceText).filter((form) => (
    form.kind === input.kind && form.text === input.expectedFormText
  ));
  if (matches.length === 0) {
    throw new Error('The imported form changed or disappeared after validation, so its source block was left untouched.');
  }
  if (matches.length > 1) {
    throw new Error('The note contains duplicate copies of the imported form, so no source block was removed.');
  }

  const match = matches[0];
  const before = input.sourceText.slice(0, match.headingStart);
  const after = input.sourceText.slice(match.endEnd);
  if (!after) return withoutTrailingSeparator(before);

  // The bounded form excludes the END marker's line ending. Consume that line
  // ending and at most one blank separator without normalizing unrelated text.
  const afterWithoutSeparator = after.replace(/^(?:\r?\n)(?:[ \t]*(?:\r?\n))?/, '');
  return before + afterWithoutSeparator;
}
