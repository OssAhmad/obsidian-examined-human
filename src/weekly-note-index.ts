import type { App, TFile } from 'obsidian';
import type { NoteTemporalState } from './daily-note-index.ts';
import type { WeeklyPlanIndexQueryResult } from './examined-human-query.ts';

const WEEKLY_NOTE_PATTERN = /^\d{4}-W\d{1,2}\.md$/i;
const WEEK_START_PATTERN = /^week start:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/mi;

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

function parseWeekStart(content: string): string | null {
  const match = WEEK_START_PATTERN.exec(content);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === match[1]
    ? match[1]
    : null;
}

function weekEnd(startDate: string): string {
  const parsed = new Date(`${startDate}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 6);
  return parsed.toISOString().slice(0, 10);
}

export async function buildWeeklyNoteList(
  app: App,
  index: WeeklyPlanIndexQueryResult,
  todayDate: string,
): Promise<WeeklyNoteListItem[]> {
  const importedByStart = new Map(index.importedPlans.map((plan) => [plan.weekStartDate, plan]));
  const weeklyFiles = app.vault.getMarkdownFiles().filter((file) => WEEKLY_NOTE_PATTERN.test(file.name));
  const scanned = await Promise.all(weeklyFiles.map(async (file: TFile) => {
    const content = await app.vault.cachedRead(file);
    const startDate = parseWeekStart(content);
    if (!startDate) return null;
    const imported = importedByStart.has(startDate);
    const endDate = weekEnd(startDate);
    return {
      weekStartDate: startDate,
      weekEndDate: endDate,
      weekLabel: file.basename,
      fileName: file.name,
      filePath: file.path,
      status: imported ? 'imported' : 'pending',
      temporalState: temporalState(startDate, endDate, todayDate, imported),
    } satisfies WeeklyNoteListItem;
  }));

  const byStart = new Map<string, WeeklyNoteListItem>();
  for (const item of scanned) {
    if (!item) continue;
    if (byStart.has(item.weekStartDate)) {
      throw new Error(`More than one weekly note declares ${item.weekStartDate}.`);
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
  return [...byStart.values()]
    .sort((left, right) => right.weekStartDate.localeCompare(left.weekStartDate));
}
