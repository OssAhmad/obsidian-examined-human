import type { CalendarEvent } from './events.ts';

export interface PositionedEvent {
  event: CalendarEvent;
  column: number;
  columnCount: number;
}

export function layoutOverlappingEvents(events: CalendarEvent[]): PositionedEvent[] {
  const sorted = events
    .filter((event) => event.kind === 'timed')
    .slice()
    .sort((a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes || a.id.localeCompare(b.id));
  const result: PositionedEvent[] = [];
  let group: CalendarEvent[] = [];
  let groupEnd = -1;

  const flush = () => {
    if (group.length === 0) return;
    const columnEnds: number[] = [];
    const placed = group.map((event) => {
      let column = columnEnds.findIndex((end) => end <= event.startMinutes);
      if (column === -1) column = columnEnds.length;
      columnEnds[column] = event.endMinutes;
      return { event, column, columnCount: 0 };
    });
    for (const item of placed) item.columnCount = columnEnds.length;
    result.push(...placed);
    group = [];
  };

  for (const event of sorted) {
    if (group.length > 0 && event.startMinutes >= groupEnd) flush();
    group.push(event);
    groupEnd = Math.max(groupEnd, event.endMinutes);
    if (group.length === 1) groupEnd = event.endMinutes;
  }
  flush();
  return result;
}
