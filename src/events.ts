export const SESSION_TYPES = [
  'authorship',
  'chore',
  'exercise',
  'leisure',
  'maintenance',
  'meditation',
  'reading',
  'research',
  'social',
  'study',
  'thinking',
  'work',
  'writing',
] as const;

export const DEFAULT_SESSION_COLORS: Record<string, string> = {
  authorship: '#a855f7',
  chore: '#64748b',
  exercise: '#f97316',
  leisure: '#14b8a6',
  maintenance: '#78716c',
  meditation: '#8b5cf6',
  reading: '#06b6d4',
  research: '#6366f1',
  social: '#ec4899',
  study: '#3b82f6',
  thinking: '#eab308',
  work: '#22c55e',
  writing: '#d946ef',
};

export const UNKNOWN_TYPE_COLOR = '#6b7280';

export interface ExerciseSetDetails {
  setNumber: number | null;
  weight: number | null;
  reps: number | null;
  distance: number | null;
  durationMinutes: number | null;
  notes: string | null;
}

export interface SessionExerciseDetails {
  name: string;
  category: string | null;
  sets: ExerciseSetDetails[];
}

export interface MilestoneMeasurementDetails {
  metricName: string;
  metricValue: string;
  measurementDate: string | null;
  notes: string | null;
}

export interface SessionMilestoneDetails {
  name: string;
  date: string | null;
  notes: string | null;
  measurements: MilestoneMeasurementDetails[];
}

export interface CalendarDayState {
  source: 'planned';
  lifecycleState: string;
  overdue: boolean;
  message: string | null;
}

export interface CalendarEvent {
  id: string;
  date: string;
  sessionType: string;
  engagementName: string;
  engagementType: string;
  title: string;
  kind: 'timed';
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  notes: string | null;
  sourceKind?: 'actual' | 'planned';
  timeEstimated?: boolean;
  planningWarnings?: string[];
  exerciseDetails?: SessionExerciseDetails[];
  milestoneDetails?: SessionMilestoneDetails[];
  dataWarning?: string;
}

export interface DataIssue {
  sessionId?: string;
  message: string;
}

export function parseDatabaseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59)
    return null;
  return hour * 60 + minute;
}

export function formatMinutesAsClock(totalMinutes: number): string {
  const normalized = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatTimeOfDay(totalMinutes: number): string {
  const normalized = Math.max(0, Math.min(1439, Math.round(totalMinutes)));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatExerciseNumber(value: number): string {
  return String(value);
}

export const SESSION_TYPE_FOOTER_MIN_HEIGHT_PX = 44;

export function titleForEngagement(engagementName: string): string {
  return engagementName;
}

export function shouldShowSessionTypeFooter(renderedHeightPx: number, stacked: boolean): boolean {
  return !stacked && renderedHeightPx >= SESSION_TYPE_FOOTER_MIN_HEIGHT_PX;
}

export function sessionFooterText(event: CalendarEvent): string {
  const milestoneCount = event.milestoneDetails?.length ?? 0;
  if (milestoneCount === 0) return event.sessionType;
  return `${event.sessionType}, ${milestoneCount} milestone${milestoneCount === 1 ? '' : 's'}`;
}

export function colorForSession(event: CalendarEvent, colors: Record<string, string>): string {
  const sessionType = event.sessionType.trim().toLowerCase();
  if (sessionType === 'chor') return UNKNOWN_TYPE_COLOR;
  return colors[sessionType] ?? UNKNOWN_TYPE_COLOR;
}
