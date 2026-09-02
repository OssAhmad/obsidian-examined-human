export type EhFormFrontmatterStatus = 'unimported' | 'imported' | 'missing' | 'excluded';

export function ehFormFrontmatterEntry(frontmatter: Record<string, unknown>): [string, unknown] | null {
  return Object.entries(frontmatter).find(([key]) => key.trim().toLocaleLowerCase() === 'eh form') ?? null;
}

export function ehFormFrontmatterStatus(frontmatter: Record<string, unknown>): EhFormFrontmatterStatus {
  const entry = ehFormFrontmatterEntry(frontmatter);
  if (!entry) return 'missing';
  const value = entry[1];
  if (value === true) return 'unimported';
  const normalized = String(value).trim().toLocaleLowerCase();
  if (normalized === 'true' || normalized === 'unimported') return 'unimported';
  if (normalized === 'imported') return 'imported';
  return 'excluded';
}

export function shouldDiscoverEhFormFile(
  status: EhFormFrontmatterStatus,
  mode: 'tagged-vault' | 'journal-folder',
  isInJournalFolder: boolean,
): boolean {
  if (status === 'imported' || status === 'excluded') return false;
  if (mode === 'tagged-vault') return status === 'unimported';
  return isInJournalFolder;
}

export interface EhFormImportIdentity {
  kind: 'daily' | 'weekly' | 'budget';
  date: string | null;
  startDate: string | null;
}

export function fileHasCompletedImportableForms(
  forms: EhFormImportIdentity[],
  filePath: string,
  importedDailyNotes: Array<{ date: string; filePath: string }>,
  importedWeeklyPlans: Array<{ weekStartDate: string; sourceFilePath: string }>,
): boolean {
  const tracked = forms.filter((form) => form.kind !== 'budget');
  return tracked.length > 0 && tracked.every((form) => (
    form.kind === 'daily'
      ? importedDailyNotes.some((note) => note.date === form.date && note.filePath === filePath)
      : importedWeeklyPlans.some((plan) => plan.weekStartDate === form.startDate && plan.sourceFilePath === filePath)
  ));
}
