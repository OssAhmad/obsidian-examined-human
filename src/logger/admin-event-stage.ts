import { lineEndingFor } from '../forms/form-document.ts';
import { stageDailyFormSection } from './note-staging.ts';

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

export function prepareAdminEventStage(input: AdminEventStageInput): AdminEventStagePreview {
  const commands = (input.commands ?? (input.command == null ? [] : [input.command]))
    .map((command) => command.trim());
  if (commands.length === 0 || commands.some((command) => !command)) {
    throw new Error('An Admin Event command is empty.');
  }
  if (commands.some((command) => /\r|\n/.test(command))) {
    throw new Error('Each Admin Event command must be exactly one line.');
  }

  const lineEnding = lineEndingFor(input.sourceText);
  const updatedText = stageDailyFormSection({
    sourceText: input.sourceText,
    sectionName: 'Admin Events',
    lines: commands,
    missingFormMessage: 'This note has no #### EH Daily Form block to receive an Admin Event.',
    missingFormEndMessage: 'This note has an EH Daily Form but no matching #### END marker.',
    createSectionIfMissing: true,
    createEntriesIfMissing: true,
    validateExisting: (existing) => {
      const duplicate = commands.find((command) => existing.includes(command));
      if (duplicate) {
        throw new Error(`This Admin Event is already staged in the selected Daily Note: ${duplicate}`);
      }
    },
  });

  return {
    noteDate: input.noteDate,
    fileName: input.fileName,
    filePath: input.filePath,
    sourceChecksum: input.sourceChecksum,
    command: commands.join(lineEnding),
    commands,
    updatedText,
  };
}
