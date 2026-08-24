import type { CalendarEvent } from './events.ts';

export interface VisualEventPosition {
  startMinutes: number;
  durationMinutes: number;
  stacked: boolean;
}

export interface VisualStackOptions {
  normalMinHeightPx: number;
  compactMinHeightPx: number;
  normalGapPx: number;
  compactGapPx: number;
  toleranceMinutes: number;
  dayMinutes: number;
}

const DEFAULT_OPTIONS: VisualStackOptions = {
  normalMinHeightPx: 18,
  compactMinHeightPx: 13,
  normalGapPx: 2,
  compactGapPx: 1,
  toleranceMinutes: 10,
  dayMinutes: 1440,
};

interface CandidatePosition {
  event: CalendarEvent;
  desiredStart: number;
  duration: number;
  preliminaryStart: number;
}

/**
 * Gives close, non-overlapping sessions a compact visual stack without changing
 * their stored times. If every endpoint cannot stay within the configured
 * tolerance, the entire cluster falls back to the original exact-top layout.
 */
export function layoutVisualStack(
  events: CalendarEvent[],
  pxPerMinute: number,
  options: Partial<VisualStackOptions> = {},
): Map<string, VisualEventPosition> {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const sorted = events.slice().sort((a, b) =>
    a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes || a.id.localeCompare(b.id));
  const positions = new Map<string, VisualEventPosition>();
  const normalMinimumMinutes = settings.normalMinHeightPx / pxPerMinute;

  const useFallback = (event: CalendarEvent): void => {
    positions.set(event.id, {
      startMinutes: event.startMinutes,
      durationMinutes: Math.max(event.endMinutes - event.startMinutes, normalMinimumMinutes),
      stacked: false,
    });
  };

  const temporalGroups: CalendarEvent[][] = [];
  let group: CalendarEvent[] = [];
  let groupEnd = -1;
  for (const event of sorted) {
    if (group.length > 0 && event.startMinutes >= groupEnd) {
      temporalGroups.push(group);
      group = [];
      groupEnd = -1;
    }
    group.push(event);
    groupEnd = Math.max(groupEnd, event.endMinutes);
  }
  if (group.length > 0) temporalGroups.push(group);

  let singletonRun: CalendarEvent[] = [];
  let previousBoundaryEnd: number | undefined;

  const flushSingletonRun = (nextBoundaryStart?: number): void => {
    if (singletonRun.length === 0) return;
    layoutSingletonRun(
      singletonRun,
      positions,
      pxPerMinute,
      settings,
      previousBoundaryEnd,
      nextBoundaryStart,
    );
    previousBoundaryEnd = visualEnd(positions, singletonRun[singletonRun.length - 1]);
    singletonRun = [];
  };

  for (const temporalGroup of temporalGroups) {
    if (temporalGroup.length === 1) {
      singletonRun.push(temporalGroup[0]);
      continue;
    }

    flushSingletonRun(Math.min(...temporalGroup.map((event) => event.startMinutes)));
    for (const event of temporalGroup) useFallback(event);
    previousBoundaryEnd = Math.max(...temporalGroup.map((event) => visualEnd(positions, event)));
  }
  flushSingletonRun();

  return positions;

  function layoutSingletonRun(
    run: CalendarEvent[],
    output: Map<string, VisualEventPosition>,
    scale: number,
    stackSettings: VisualStackOptions,
    outsidePreviousEnd?: number,
    outsideNextStart?: number,
  ): void {
    let index = 0;
    let previousEnd = outsidePreviousEnd;

    while (index < run.length) {
      const first = run[index];
      let clusterEnd = index;
      let normalEnvelopeEnd = first.startMinutes
        + Math.max(first.endMinutes - first.startMinutes, stackSettings.normalMinHeightPx / scale);

      while (clusterEnd + 1 < run.length) {
        const next = run[clusterEnd + 1];
        if (next.startMinutes >= normalEnvelopeEnd + stackSettings.normalGapPx / scale) break;
        clusterEnd += 1;
        normalEnvelopeEnd = Math.max(
          normalEnvelopeEnd,
          next.startMinutes + Math.max(
            next.endMinutes - next.startMinutes,
            stackSettings.normalMinHeightPx / scale,
          ),
        );
      }

      if (clusterEnd === index) {
        useFallback(first);
        previousEnd = visualEnd(output, first);
        index += 1;
        continue;
      }

      const cluster = run.slice(index, clusterEnd + 1);
      const nextStart = clusterEnd + 1 < run.length
        ? run[clusterEnd + 1].startMinutes
        : outsideNextStart;
      const packed = tryPackCluster(cluster, scale, stackSettings, previousEnd, nextStart);
      if (packed) {
        for (const [id, position] of packed) output.set(id, position);
      } else {
        for (const event of cluster) useFallback(event);
      }
      previousEnd = visualEnd(output, cluster[cluster.length - 1]);
      index = clusterEnd + 1;
    }
  }
}

function tryPackCluster(
  cluster: CalendarEvent[],
  pxPerMinute: number,
  settings: VisualStackOptions,
  previousBoundaryEnd?: number,
  nextBoundaryStart?: number,
): Map<string, VisualEventPosition> | null {
  const minimumMinutes = settings.compactMinHeightPx / pxPerMinute;
  const gapMinutes = settings.compactGapPx / pxPerMinute;
  const candidates: CandidatePosition[] = [];

  for (const event of cluster) {
    const actualDuration = event.endMinutes - event.startMinutes;
    const duration = Math.max(actualDuration, minimumMinutes);
    const desiredStart = event.startMinutes - (duration - actualDuration) / 2;
    const prior = candidates[candidates.length - 1];
    const preliminaryStart = prior
      ? Math.max(desiredStart, prior.preliminaryStart + prior.duration + gapMinutes)
      : desiredStart;
    candidates.push({ event, desiredStart, duration, preliminaryStart });
  }

  let lowerTranslation = Number.NEGATIVE_INFINITY;
  let upperTranslation = Number.POSITIVE_INFINITY;
  let centerShiftTotal = 0;

  for (const candidate of candidates) {
    const actualDuration = candidate.event.endMinutes - candidate.event.startMinutes;
    const startShiftBeforeTranslation = candidate.preliminaryStart - candidate.event.startMinutes;
    const endShiftBeforeTranslation = candidate.preliminaryStart + candidate.duration
      - (candidate.event.startMinutes + actualDuration);

    lowerTranslation = Math.max(
      lowerTranslation,
      startShiftBeforeTranslation - settings.toleranceMinutes,
      endShiftBeforeTranslation - settings.toleranceMinutes,
    );
    upperTranslation = Math.min(
      upperTranslation,
      startShiftBeforeTranslation + settings.toleranceMinutes,
      endShiftBeforeTranslation + settings.toleranceMinutes,
    );
    centerShiftTotal += candidate.preliminaryStart + candidate.duration / 2
      - (candidate.event.startMinutes + actualDuration / 2);
  }

  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  upperTranslation = Math.min(upperTranslation, first.preliminaryStart);
  lowerTranslation = Math.max(
    lowerTranslation,
    last.preliminaryStart + last.duration - settings.dayMinutes,
  );
  if (previousBoundaryEnd != null) {
    upperTranslation = Math.min(
      upperTranslation,
      first.preliminaryStart - previousBoundaryEnd - gapMinutes,
    );
  }
  if (nextBoundaryStart != null) {
    lowerTranslation = Math.max(
      lowerTranslation,
      last.preliminaryStart + last.duration + gapMinutes - nextBoundaryStart,
    );
  }

  if (lowerTranslation > upperTranslation) return null;
  const idealTranslation = centerShiftTotal / candidates.length;
  const translation = Math.max(lowerTranslation, Math.min(upperTranslation, idealTranslation));
  const result = new Map<string, VisualEventPosition>();
  for (const candidate of candidates) {
    result.set(candidate.event.id, {
      startMinutes: candidate.preliminaryStart - translation,
      durationMinutes: candidate.duration,
      stacked: true,
    });
  }
  return result;
}

function visualEnd(positions: Map<string, VisualEventPosition>, event: CalendarEvent): number {
  const position = positions.get(event.id);
  return position ? position.startMinutes + position.durationMinutes : event.endMinutes;
}
