import { sha256Text } from './checksum.ts';

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

const EH_FORM_HEADING = /^####\s+EH\s+Daily\s+Form\s*$/mi;
const EH_FORM_END = /^####\s+END\s*$/gmi;
const RATES_HEADING = /^#####\s+Valuation\s+Rates\s*$/gmi;
const SECTION_HEADING = /^#####\s+/gmi;
const ENTRIES_MARKER = /^ENTRIES:\s*$/gmi;

function lineEndingFor(text: string): string { return text.includes('\r\n') ? '\r\n' : '\n'; }

function formBounds(text: string): { start: number; end: number } {
  const form = EH_FORM_HEADING.exec(text);
  if (!form || form.index == null) throw new Error('This note has no #### EH Daily Form block to receive Valuation Rates.');
  EH_FORM_END.lastIndex = form.index + form[0].length;
  const end = EH_FORM_END.exec(text);
  if (!end || end.index == null) throw new Error('This note has an EH Daily Form but no matching #### END marker.');
  return { start: form.index, end: end.index };
}

function sectionEnd(formText: string, afterHeading: number): number {
  SECTION_HEADING.lastIndex = afterHeading;
  return SECTION_HEADING.exec(formText)?.index ?? formText.length;
}

export async function prepareValuationRateStage(input: ValuationRateStageInput): Promise<ValuationRateStagePreview> {
  const lines = input.lines.map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0 || lines.some((line) => /\r|\n/.test(line))) throw new Error('Each Valuation Rate must be one non-empty line.');
  const { start, end } = formBounds(input.sourceText);
  const beforeForm = input.sourceText.slice(0, start);
  const formText = input.sourceText.slice(start, end);
  const afterForm = input.sourceText.slice(end);
  const lineEnding = lineEndingFor(input.sourceText);
  RATES_HEADING.lastIndex = 0;
  const heading = RATES_HEADING.exec(formText);
  let updatedForm: string;
  if (!heading || heading.index == null) {
    throw new Error('This EH Daily Form has no Valuation Rates section. Add the section and its ENTRIES marker to the template first.');
  } else {
    const contentStart = heading.index + heading[0].length;
    const endOfSection = sectionEnd(formText, contentStart);
    const section = formText.slice(contentStart, endOfSection);
    ENTRIES_MARKER.lastIndex = 0;
    const marker = ENTRIES_MARKER.exec(section);
    if (!marker || marker.index == null) {
      throw new Error('The Valuation Rates section has no ENTRIES marker. Add it to the template first.');
    } else {
      const existing = section.slice(marker.index + marker[0].length).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (existing.length > 0) throw new Error('The selected Daily Note already has Valuation Rates. A date may have only one rate set.');
      const insertAt = contentStart + marker.index + marker[0].length;
      const beforeEntries = formText.slice(0, insertAt);
      const afterEntries = formText.slice(insertAt);
      const prefix = beforeEntries.endsWith(lineEnding) ? '' : lineEnding;
      const suffix = afterEntries.startsWith(lineEnding) ? '' : lineEnding;
      updatedForm = `${beforeEntries}${prefix}${lines.join(lineEnding)}${lineEnding}${suffix}${afterEntries}`;
    }
  }
  return {
    noteDate: input.noteDate, fileName: input.fileName, filePath: input.filePath, lines,
    sourceChecksum: await sha256Text(input.sourceText), updatedText: `${beforeForm}${updatedForm}${afterForm}`,
  };
}
