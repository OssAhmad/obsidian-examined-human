import { sha256Text } from './checksum.ts';
import { stageDailyFormSection } from './note-staging.ts';

export interface FinanceEntryStageInput {
  noteDate: string;
  fileName: string;
  filePath: string;
  sourceText: string;
  line: string;
}

export interface FinanceEntryStagePreview extends FinanceEntryStageInput {
  sourceChecksum: string;
  updatedText: string;
}

export async function prepareFinanceEntryStage(input: FinanceEntryStageInput): Promise<FinanceEntryStagePreview> {
  const line = input.line.trim();
  if (!line || /\r|\n/.test(line)) throw new Error('A financial entry must be exactly one non-empty line.');
  const updatedText = stageDailyFormSection({
    sourceText: input.sourceText,
    sectionName: 'Transactions',
    lines: [line],
    missingFormMessage: 'This note has no #### EH Daily Form block to receive a financial entry.',
    missingFormEndMessage: 'This note has an EH Daily Form but no matching #### END marker.',
    createSectionIfMissing: true,
    createEntriesIfMissing: true,
    extraLineEndingAfterLines: true,
    validateExisting: (existing) => {
      if (existing.includes(line)) throw new Error('This financial entry is already staged in the selected Daily Note.');
    },
  });
  return {
    ...input,
    line,
    sourceChecksum: await sha256Text(input.sourceText),
    updatedText,
  };
}
