import type { CalendarDayState, CalendarEvent, DataIssue } from '../events.ts';

export interface SessionQueryResult {
  events: CalendarEvent[];
  issues: DataIssue[];
  dayStates: Record<string, CalendarDayState>;
}

export { querySessions } from '../examined-human-query.ts';
