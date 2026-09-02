export interface AdminEventStageInput {
  noteDate: string;
  fileName: string;
  filePath: string;
  sourceText: string;
  sourceChecksum: string;
  command?: string;
  commands?: string[];
}

export interface AdminEventStagePreview extends Omit<AdminEventStageInput, 'sourceText'> {
  commands: string[];
  updatedText: string;
}

const EH_FORM_HEADING = /^####\s+EH\s+Daily\s+Form\s*$/mi;
const EH_FORM_END = /^####\s+END\s*$/gmi;
const ADMIN_EVENTS_HEADING = /^#####\s+Admin\s+Events\s*$/gmi;
const SECTION_HEADING = /^#####\s+/gmi;
const ENTRIES_MARKER = /^ENTRIES:\s*$/gmi;

function lineEndingFor(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function formBounds(text: string): { start: number; end: number } {
  const form = EH_FORM_HEADING.exec(text);
  if (!form || form.index == null) throw new Error('This note has no #### EH Daily Form block to receive an Admin Event.');
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

export function prepareAdminEventStage(input: AdminEventStageInput): AdminEventStagePreview {
  const commands = (input.commands ?? (input.command == null ? [] : [input.command]))
    .map((command) => command.trim());
  if (commands.length === 0 || commands.some((command) => !command)) {
    throw new Error('An Admin Event command is empty.');
  }
  if (commands.some((command) => /\r|\n/.test(command))) {
    throw new Error('Each Admin Event command must be exactly one line.');
  }

  const { start, end } = formBounds(input.sourceText);
  const beforeForm = input.sourceText.slice(0, start);
  const formText = input.sourceText.slice(start, end);
  const afterForm = input.sourceText.slice(end);
  const lineEnding = lineEndingFor(input.sourceText);
  ADMIN_EVENTS_HEADING.lastIndex = 0;
  const heading = ADMIN_EVENTS_HEADING.exec(formText);
  let updatedForm: string;

  if (!heading || heading.index == null) {
    const separator = formText.endsWith(lineEnding.repeat(2)) ? '' : lineEnding;
    updatedForm = `${formText}${separator}${lineEnding}##### Admin Events${lineEnding}ENTRIES:${lineEnding}${commands.join(lineEnding)}${lineEnding}`;
  } else {
    const contentStart = heading.index + heading[0].length;
    const endOfSection = sectionEnd(formText, contentStart);
    const section = formText.slice(contentStart, endOfSection);
    ENTRIES_MARKER.lastIndex = 0;
    const marker = ENTRIES_MARKER.exec(section);
    if (!marker || marker.index == null) {
      const prefix = section.startsWith(lineEnding) ? '' : lineEnding;
      const replacement = `${prefix}ENTRIES:${lineEnding}${commands.join(lineEnding)}${lineEnding}${section}`;
      updatedForm = `${formText.slice(0, contentStart)}${replacement}${formText.slice(endOfSection)}`;
    } else {
      const commandLines = section.slice(marker.index + marker[0].length)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const duplicate = commands.find((command) => commandLines.includes(command));
      if (duplicate) {
        throw new Error(`This Admin Event is already staged in the selected Daily Note: ${duplicate}`);
      }
      const insertAt = contentStart + marker.index + marker[0].length;
      const beforeCommands = formText.slice(0, insertAt);
      const afterCommands = formText.slice(insertAt);
      const prefix = beforeCommands.endsWith(lineEnding) ? '' : lineEnding;
      const suffix = afterCommands.startsWith(lineEnding) ? '' : lineEnding;
      updatedForm = `${beforeCommands}${prefix}${commands.join(lineEnding)}${suffix}${afterCommands}`;
    }
  }

  return {
    noteDate: input.noteDate,
    fileName: input.fileName,
    filePath: input.filePath,
    sourceChecksum: input.sourceChecksum,
    command: commands.join(lineEnding),
    commands,
    updatedText: `${beforeForm}${updatedForm}${afterForm}`,
  };
}
