import { dailyTimeTypeLabel, type CalendarEvent } from './events.ts';

export type DailyTimeGrouping = 'engagement' | 'session-type';

export function dailyTimeTotals(events: CalendarEvent[], grouping: DailyTimeGrouping): Array<{ label: string; minutes: number }> {
  const totals = new Map<string, number>();
  for (const event of events) {
    const label = grouping === 'session-type' ? dailyTimeTypeLabel(event) : event.engagementName;
    totals.set(label, (totals.get(label) ?? 0) + event.durationMinutes);
  }
  return [...totals].map(([label, minutes]) => ({ label, minutes }))
    .sort((left, right) => right.minutes - left.minutes || left.label.localeCompare(right.label));
}
