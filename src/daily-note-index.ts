import { App, moment } from 'obsidian';
import type { DailyNoteIndexQueryResult, DailyNoteSourceRecord } from './eqh-query.ts';

const EH_FORM_PATTERN = /^####\s+(?:EH|EQH)\s+Form\s*$/mi;
const DAILY_NOTE_ROOT = 'Oss Ahmad Journal/';

export type DailyNoteStatus = 'needs-import' | 'current-future' | 'imported';
export type NoteTemporalState = 'overdue' | 'current' | 'future' | 'imported';

export interface DailyNoteListItem {
  date: string;
  fileName: string;
  filePath: string;
  status: DailyNoteStatus;
  temporalState: NoteTemporalState;
  importedAt: string | null;
  sourceState: DailyNoteSourceRecord | null;
}

function parseDailyFilename(fileName: string): string | null {
  if (!fileName.endsWith('.md')) return null;
  const label = fileName.slice(0, -3);
  const parsed = moment(label, ['YYYY-MM-DD', 'MMM D, YYYY', 'MMM DD, YYYY'], true);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
}

export async function buildDailyNoteList(
  app: App,
  index: DailyNoteIndexQueryResult,
  todayDate: string,
): Promise<DailyNoteListItem[]> {
  const importedByDate = new Map(index.importedNotes.map((note) => [note.date, note]));
  const sourceByDate = new Map(index.noteSources.map((source) => [source.date, source]));
  const earliestImported = index.importedNotes.length > 0
    ? index.importedNotes[index.importedNotes.length - 1].date
    : null;
  const unimportedCandidates = app.vault.getMarkdownFiles()
    .filter((file) => file.path.startsWith(DAILY_NOTE_ROOT))
    .map((file) => ({ file, date: parseDailyFilename(file.name) }))
    .filter((candidate): candidate is { file: typeof candidate.file; date: string } => (
      candidate.date != null
      && !importedByDate.has(candidate.date)
      && (earliestImported == null || candidate.date >= earliestImported)
    ));

  const inspectedCandidates = await Promise.all(unimportedCandidates.map(async ({ file, date }) => {
    const content = await app.vault.cachedRead(file);
    if (!EH_FORM_PATTERN.test(content)) return null;
    return {
      date,
      fileName: file.name,
      filePath: file.path,
      status: date < todayDate ? 'needs-import' : 'current-future',
      temporalState: date < todayDate ? 'overdue' : date === todayDate ? 'current' : 'future',
      importedAt: null,
      sourceState: sourceByDate.get(date) ?? null,
    } satisfies DailyNoteListItem;
  }));
  const unimported = inspectedCandidates.filter((item) => item != null);

  const imported = index.importedNotes.slice(0, 50).map((note) => ({
    date: note.date,
    fileName: note.fileName,
    filePath: note.filePath,
    status: 'imported' as const,
    temporalState: 'imported' as const,
    importedAt: note.importedAt,
    sourceState: sourceByDate.get(note.date) ?? null,
  }));
  return [...unimported, ...imported]
    .sort((left, right) => right.date.localeCompare(left.date));
}
