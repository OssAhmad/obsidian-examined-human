import { sha256Text } from './checksum.ts';

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

const EH_FORM_HEADING = /^####\s+EH\s+Daily\s+Form\s*$/mi;
const EH_FORM_END = /^####\s+END\s*$/gmi;
const TRANSACTIONS_HEADING = /^#####\s+Transactions\s*$/gmi;
const SECTION_HEADING = /^#####\s+/gmi;
const ENTRIES_MARKER = /^ENTRIES:\s*$/gmi;

function lineEndingFor(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function formBounds(text: string): { start: number; end: number } {
  const form = EH_FORM_HEADING.exec(text);
  if (!form || form.index == null) throw new Error('This note has no #### EH Daily Form block to receive a financial entry.');
  EH_FORM_END.lastIndex = form.index + form[0].length;
  const end = EH_FORM_END.exec(text);
  if (!end || end.index == null) throw new Error('This note has an EH Daily Form but no matching #### END marker.');
  return { start: form.index, end: end.index };
}

function sectionEnd(formText: string, afterHeading: number): number {
  SECTION_HEADING.lastIndex = afterHeading;
  const next = SECTION_HEADING.exec(formText);
  return next?.index ?? formText.length;
}

export async function prepareFinanceEntryStage(input: FinanceEntryStageInput): Promise<FinanceEntryStagePreview> {
  const line = input.line.trim();
  if (!line || /\r|\n/.test(line)) throw new Error('A financial entry must be exactly one non-empty line.');
  const { start, end } = formBounds(input.sourceText);
  const beforeForm = input.sourceText.slice(0, start);
  const formText = input.sourceText.slice(start, end);
  const afterForm = input.sourceText.slice(end);
  const lineEnding = lineEndingFor(input.sourceText);
  TRANSACTIONS_HEADING.lastIndex = 0;
  const heading = TRANSACTIONS_HEADING.exec(formText);
  let updatedForm: string;
  if (!heading || heading.index == null) {
    const separator = formText.endsWith(lineEnding.repeat(2)) ? '' : lineEnding;
    updatedForm = `${formText}${separator}${lineEnding}##### Transactions${lineEnding}ENTRIES:${lineEnding}${line}${lineEnding}`;
  } else {
    const contentStart = heading.index + heading[0].length;
    const endOfSection = sectionEnd(formText, contentStart);
    const section = formText.slice(contentStart, endOfSection);
    ENTRIES_MARKER.lastIndex = 0;
    const marker = ENTRIES_MARKER.exec(section);
    if (!marker || marker.index == null) {
      const prefix = section.startsWith(lineEnding) ? '' : lineEnding;
      const replacement = `${prefix}ENTRIES:${lineEnding}${line}${lineEnding}${section}`;
      updatedForm = `${formText.slice(0, contentStart)}${replacement}${formText.slice(endOfSection)}`;
    } else {
      const transactionLines = section.slice(marker.index + marker[0].length)
        .split(/\r?\n/).map((candidate) => candidate.trim()).filter(Boolean);
      if (transactionLines.includes(line)) throw new Error('This financial entry is already staged in the selected Daily Note.');
      const insertAt = contentStart + marker.index + marker[0].length;
      const beforeEntries = formText.slice(0, insertAt);
      const afterEntries = formText.slice(insertAt);
      const prefix = beforeEntries.endsWith(lineEnding) ? '' : lineEnding;
      const suffix = afterEntries.startsWith(lineEnding) ? '' : lineEnding;
      updatedForm = `${beforeEntries}${prefix}${line}${lineEnding}${suffix}${afterEntries}`;
    }
  }
  return {
    ...input,
    line,
    sourceChecksum: await sha256Text(input.sourceText),
    updatedText: `${beforeForm}${updatedForm}${afterForm}`,
  };
}
