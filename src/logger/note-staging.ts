import {
  entryLines,
  findEntriesMarker,
  findFormSection,
  lineEndingFor,
  requireEhForm,
} from '../forms/form-document.ts';

export interface StageDailyFormSectionOptions {
  sourceText: string;
  sectionName: string;
  lines: string[];
  missingFormMessage: string;
  missingFormEndMessage: string;
  createSectionIfMissing: boolean;
  createEntriesIfMissing: boolean;
  missingSectionMessage?: string;
  missingEntriesMessage?: string;
  extraLineEndingAfterLines?: boolean;
  validateExisting?: (lines: string[]) => void;
}

/**
 * Inserts normalized lines immediately after a bounded Daily Form section's
 * ENTRIES marker without exposing staging workflows to offset arithmetic.
 */
export function stageDailyFormSection(options: StageDailyFormSectionOptions): string {
  const form = requireEhForm(
    options.sourceText,
    'daily',
    options.missingFormMessage,
    options.missingFormEndMessage,
  );
  const beforeForm = options.sourceText.slice(0, form.headingStart);
  const formText = options.sourceText.slice(form.headingStart, form.endStart);
  const afterForm = options.sourceText.slice(form.endStart);
  const lineEnding = lineEndingFor(options.sourceText);
  const sectionInfo = findFormSection(formText, options.sectionName);
  let updatedForm: string;

  if (!sectionInfo) {
    if (!options.createSectionIfMissing) {
      throw new Error(options.missingSectionMessage ?? `This EH Daily Form has no ${options.sectionName} section.`);
    }
    const separator = formText.endsWith(lineEnding.repeat(2)) ? '' : lineEnding;
    updatedForm = `${formText}${separator}${lineEnding}##### ${options.sectionName}${lineEnding}ENTRIES:${lineEnding}${options.lines.join(lineEnding)}${lineEnding}`;
  } else {
    const section = formText.slice(sectionInfo.contentStart, sectionInfo.contentEnd);
    const marker = findEntriesMarker(section);
    if (!marker) {
      if (!options.createEntriesIfMissing) {
        throw new Error(options.missingEntriesMessage ?? `The ${options.sectionName} section has no ENTRIES marker.`);
      }
      const prefix = section.startsWith(lineEnding) ? '' : lineEnding;
      const replacement = `${prefix}ENTRIES:${lineEnding}${options.lines.join(lineEnding)}${lineEnding}${section}`;
      updatedForm = `${formText.slice(0, sectionInfo.contentStart)}${replacement}${formText.slice(sectionInfo.contentEnd)}`;
    } else {
      options.validateExisting?.(entryLines(section));
      const insertAt = sectionInfo.contentStart + marker.end;
      const beforeLines = formText.slice(0, insertAt);
      const afterLines = formText.slice(insertAt);
      const prefix = beforeLines.endsWith(lineEnding) ? '' : lineEnding;
      const extra = options.extraLineEndingAfterLines ? lineEnding : '';
      const suffix = afterLines.startsWith(lineEnding) ? '' : lineEnding;
      updatedForm = `${beforeLines}${prefix}${options.lines.join(lineEnding)}${extra}${suffix}${afterLines}`;
    }
  }

  return `${beforeForm}${updatedForm}${afterForm}`;
}
