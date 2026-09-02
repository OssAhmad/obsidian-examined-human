import type { App } from 'obsidian';
import type { DailyNoteIndexQueryResult, DailyNoteSourceRecord } from './examined-human-query.ts';
import type { DiscoveredEhForm } from './form-discovery.ts';

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

export async function buildDailyNoteList(
  _app: App,
  index: DailyNoteIndexQueryResult,
  todayDate: string,
  discoveredForms: Array<Omit<DiscoveredEhForm, 'formText'>> = [],
): Promise<DailyNoteListItem[]> {
  const importedByDate = new Map(index.importedNotes.map((note) => [note.date, note]));
  const sourceByDate = new Map(index.noteSources.map((source) => [source.date, source]));
  const earliestImported = index.importedNotes.length > 0
    ? index.importedNotes[index.importedNotes.length - 1].date
    : null;
  const unimportedCandidates = discoveredForms
    .filter((form): form is Omit<DiscoveredEhForm, 'formText'> & { date: string } => (
      form.kind === 'daily'
      && form.date != null
      && !importedByDate.has(form.date)
      && (earliestImported == null || form.date >= earliestImported)
    ));
  const unimported = unimportedCandidates.map((form) => ({
    date: form.date,
    fileName: form.fileName,
    filePath: form.filePath,
    status: form.date < todayDate ? 'needs-import' as const : 'current-future' as const,
    temporalState: form.date < todayDate ? 'overdue' as const : form.date === todayDate ? 'current' as const : 'future' as const,
    importedAt: null,
    sourceState: sourceByDate.get(form.date) ?? null,
  }));
  const byDate = new Map<string, DailyNoteListItem>();
  for (const item of unimported) {
    const existing = byDate.get(item.date);
    if (existing) throw new Error(`Two EH Daily Forms declare ${item.date}: ${existing.filePath} and ${item.filePath}.`);
    byDate.set(item.date, item);
  }
  const imported = index.importedNotes.slice(0, 50).map((note) => ({
    date: note.date,
    fileName: note.fileName,
    filePath: note.filePath,
    status: 'imported' as const,
    temporalState: 'imported' as const,
    importedAt: note.importedAt,
    sourceState: sourceByDate.get(note.date) ?? null,
  }));
  return [...byDate.values(), ...imported]
    .sort((left, right) => right.date.localeCompare(left.date));
}
