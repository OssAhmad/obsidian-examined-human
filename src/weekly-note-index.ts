import type { App } from 'obsidian';
import type { NoteTemporalState } from './daily-note-index.ts';
import type { WeeklyPlanIndexQueryResult } from './examined-human-query.ts';
import type { DiscoveredEhForm } from './form-discovery.ts';

export type WeeklyNoteStatus = 'pending' | 'imported';

export interface WeeklyNoteListItem {
  weekStartDate: string;
  weekEndDate: string;
  weekLabel: string;
  fileName: string;
  filePath: string;
  status: WeeklyNoteStatus;
  temporalState: NoteTemporalState;
}

function temporalState(
  startDate: string,
  endDate: string,
  todayDate: string,
  imported: boolean,
): NoteTemporalState {
  if (imported) return 'imported';
  if (endDate < todayDate) return 'overdue';
  if (startDate > todayDate) return 'future';
  return 'current';
}

function weekEnd(startDate: string): string {
  const parsed = new Date(`${startDate}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 6);
  return parsed.toISOString().slice(0, 10);
}

export async function buildWeeklyNoteList(
  _app: App,
  index: WeeklyPlanIndexQueryResult,
  todayDate: string,
  discoveredForms: Array<Omit<DiscoveredEhForm, 'formText'>> = [],
): Promise<WeeklyNoteListItem[]> {
  const importedByStart = new Map(index.importedPlans.map((plan) => [plan.weekStartDate, plan]));
  const scanned = discoveredForms
    .filter((form): form is Omit<DiscoveredEhForm, 'formText'> & { startDate: string; endDate: string } => (
      form.kind === 'weekly' && form.startDate != null && form.endDate != null
    )).map((form) => {
    const startDate = form.startDate;
    const imported = importedByStart.has(startDate);
    return {
      weekStartDate: startDate,
      weekEndDate: form.endDate,
      weekLabel: form.fileName.replace(/\.md$/i, ''),
      fileName: form.fileName,
      filePath: form.filePath,
      status: imported ? 'imported' : 'pending',
      temporalState: temporalState(startDate, form.endDate, todayDate, imported),
    } satisfies WeeklyNoteListItem;
  });

  const byStart = new Map<string, WeeklyNoteListItem>();
  for (const item of scanned) {
    if (byStart.has(item.weekStartDate)) {
      throw new Error(`Two EH Weekly Forms declare ${item.weekStartDate}: ${byStart.get(item.weekStartDate)!.filePath} and ${item.filePath}.`);
    }
    byStart.set(item.weekStartDate, item);
  }
  for (const plan of index.importedPlans) {
    if (byStart.has(plan.weekStartDate)) continue;
    const endDate = weekEnd(plan.weekStartDate);
    byStart.set(plan.weekStartDate, {
      weekStartDate: plan.weekStartDate,
      weekEndDate: endDate,
      weekLabel: plan.sourceFileName.replace(/\.md$/i, ''),
      fileName: plan.sourceFileName,
      filePath: plan.sourceFilePath,
      status: 'imported',
      temporalState: 'imported',
    });
  }
  const ordered = [...byStart.values()].sort((left, right) => left.weekStartDate.localeCompare(right.weekStartDate));
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (current.weekStartDate <= previous.weekEndDate) {
      throw new Error(`EH Weekly Forms overlap: ${previous.filePath} (${previous.weekStartDate}–${previous.weekEndDate}) and ${current.filePath} (${current.weekStartDate}–${current.weekEndDate}).`);
    }
  }
  return ordered.reverse();
}
