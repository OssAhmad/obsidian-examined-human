import { sha256Text } from './checksum.ts';
import { stageDailyFormSection } from './note-staging.ts';

export interface ValuationRateStageInput {
  noteDate: string;
  fileName: string;
  filePath: string;
  sourceText: string;
  lines: string[];
}

export interface ValuationRateStagePreview extends Omit<ValuationRateStageInput, 'sourceText'> {
  sourceChecksum: string;
  lines: string[];
  updatedText: string;
}

export async function prepareValuationRateStage(input: ValuationRateStageInput): Promise<ValuationRateStagePreview> {
  const lines = input.lines.map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0 || lines.some((line) => /\r|\n/.test(line))) throw new Error('Each Valuation Rate must be one non-empty line.');
  const updatedText = stageDailyFormSection({
    sourceText: input.sourceText,
    sectionName: 'Valuation Rates',
    lines,
    missingFormMessage: 'This note has no #### EH Daily Form block to receive Valuation Rates.',
    missingFormEndMessage: 'This note has an EH Daily Form but no matching #### END marker.',
    createSectionIfMissing: false,
    createEntriesIfMissing: false,
    missingSectionMessage: 'This EH Daily Form has no Valuation Rates section. Add the section and its ENTRIES marker to the template first.',
    missingEntriesMessage: 'The Valuation Rates section has no ENTRIES marker. Add it to the template first.',
    extraLineEndingAfterLines: true,
    validateExisting: (existing) => {
      if (existing.length > 0) throw new Error('The selected Daily Note already has Valuation Rates. A date may have only one rate set.');
    },
  });
  return {
    noteDate: input.noteDate, fileName: input.fileName, filePath: input.filePath, lines,
    sourceChecksum: await sha256Text(input.sourceText), updatedText,
  };
}
