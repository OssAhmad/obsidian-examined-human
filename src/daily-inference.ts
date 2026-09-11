import type { CalendarEvent } from './events.ts';

export interface DailySessionSignal {
  date: string;
  startMinutes: number;
  endMinutes: number;
  sessionType: string;
  engagementType: string;
  engagementName: string;
  hasExerciseDetails?: boolean;
}

export interface InferredDailyActivity {
  studied: 0 | 1;
  worked: 0 | 1;
  exercised: 0 | 1;
}

function code(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function isSleepSession(session: DailySessionSignal): boolean {
  return code(session.sessionType) === 'sleep'
    || code(session.engagementType) === 'sleep'
    || code(session.engagementName) === 'sleep';
}

export function inferDailyActivity(sessions: DailySessionSignal[]): InferredDailyActivity {
  const studied = sessions.some((session) => {
    const sessionType = code(session.sessionType);
    const engagementType = code(session.engagementType);
    return sessionType === 'study' || engagementType === 'study' || engagementType === 'course';
  });
  const worked = sessions.some((session) => (
    code(session.sessionType) === 'work' || code(session.engagementType) === 'work'
  ));
  const exercised = sessions.some((session) => {
    const sessionType = code(session.sessionType);
    const engagementType = code(session.engagementType);
    return session.hasExerciseDetails === true
      || sessionType === 'exercise'
      || engagementType === 'exercise'
      || engagementType === 'fitness';
  });
  return { studied: studied ? 1 : 0, worked: worked ? 1 : 0, exercised: exercised ? 1 : 0 };
}

function previousIsoDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return [
    previous.getUTCFullYear(),
    String(previous.getUTCMonth() + 1).padStart(2, '0'),
    String(previous.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Counts sleep in [21:00 on the previous date, 21:00 on the assessment date).
 * A 23:59 endpoint is treated as midnight so split overnight entries do not
 * lose the otherwise unrepresentable final minute of the day.
 */
export function inferSleepHours(assessmentDate: string, sessions: DailySessionSignal[]): number {
  const previousDate = previousIsoDate(assessmentDate);
  const windowStart = 21 * 60;
  const windowEnd = 24 * 60 + 21 * 60;
  const intervals = sessions.flatMap((session): Array<[number, number]> => {
    if (!isSleepSession(session)) return [];
    const dayOffset = session.date === previousDate ? 0 : session.date === assessmentDate ? 24 * 60 : null;
    if (dayOffset == null) return [];
    const adjustedEnd = session.endMinutes === 23 * 60 + 59 ? 24 * 60 : session.endMinutes;
    const start = Math.max(windowStart, dayOffset + session.startMinutes);
    const end = Math.min(windowEnd, dayOffset + adjustedEnd);
    return end > start ? [[start, end]] : [];
  }).sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  let totalMinutes = 0;
  let current: [number, number] | null = null;
  for (const interval of intervals) {
    if (!current) current = [...interval];
    else if (interval[0] <= current[1]) current[1] = Math.max(current[1], interval[1]);
    else {
      totalMinutes += current[1] - current[0];
      current = [...interval];
    }
  }
  if (current) totalMinutes += current[1] - current[0];
  return totalMinutes / 60;
}

export function eventSignal(event: CalendarEvent): DailySessionSignal {
  return {
    date: event.date,
    startMinutes: event.startMinutes,
    endMinutes: event.endMinutes,
    sessionType: event.sessionType,
    engagementType: event.engagementType,
    engagementName: event.engagementName,
    hasExerciseDetails: (event.exerciseDetails?.length ?? 0) > 0,
  };
}

function overlaps(left: CalendarEvent, right: CalendarEvent): boolean {
  return left.date === right.date
    && left.startMinutes < right.endMinutes
    && right.startMinutes < left.endMinutes;
}

/** Daily/canonical sessions win only the Weekly Form intervals they overlap. */
export function mergeTodayWithWeekly(primary: CalendarEvent[], weekly: CalendarEvent[]): CalendarEvent[] {
  return [
    ...primary,
    ...weekly.filter((candidate) => !primary.some((event) => overlaps(event, candidate))),
  ];
}
