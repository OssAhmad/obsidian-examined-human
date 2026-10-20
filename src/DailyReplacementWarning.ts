import type { DailyReplacementPreview } from './logger/daily-replacement.ts';

const RECORD_LABELS: Record<string, string> = {
  sessions: 'Sessions', transactions: 'Transactions', daily_metrics: 'Daily metrics',
  daily_meals: 'Food entries', meal_events: 'Meals', daily_meal_assessments: 'Nutrition assessments',
  session_exercises: 'Exercise entries', exercise_sets: 'Exercise sets',
  engagement_milestones: 'Milestones', engagement_measurements: 'Milestone measurements',
  stoicism_entries: 'Stoicism entries', valuation_rate_sets: 'Valuation rate sets',
  valuation_rates: 'Valuation rates', imported_notes: 'Import receipts',
  note_import_components: 'Component receipts', note_sources: 'Daily sources', planned_sessions: 'Daily planning sessions',
};

export function dailyReplacementWarning(date: string): string {
  return `${date} has already been imported. Reimport deletes all old daily records for this date and fills them anew from this form. This is a complete replacement, not a merge. Anything missing from this form will be removed, including records added through another tool. A database backup will be created first.`;
}

export function renderDailyReplacementWarning(container: HTMLElement, replacement: DailyReplacementPreview): void {
  const warning = container.createDiv({
    cls: 'examined-human-daily-replacement-warning',
    attr: { role: 'alert' },
  });
  warning.createEl('strong', { text: 'Replace the entire imported day' });
  warning.createEl('p', { text: dailyReplacementWarning(replacement.date) });
  warning.createEl('p', {
    text: 'Shared foods, accounts, engagements, exercises, aliases, and weekly/budget plans are retained. Admin Events must be empty: earlier shared changes are not undone or replayed. Replacing valuation rates can change later financial displays. Cross-date milestone conflicts block replacement.',
  });
  const rows = Object.entries(replacement.records).filter(([, count]) => count > 0);
  if (Object.keys(replacement.records).length === 0) return;
  warning.createDiv({
    cls: 'examined-human-daily-replacement-counts',
    text: `Old records to remove: ${rows.map(([table, count]) => `${RECORD_LABELS[table] ?? table}: ${count}`).join('; ') || 'none'}.`,
  });
}
