import type { App } from 'obsidian';
import type { CalendarEvent } from './events.ts';
import {
  colorForSession,
  formatMinutesAsClock,
  formatTimeOfDay,
  sessionFooterText,
  shouldShowSessionTypeFooter,
} from './events.ts';
import { SessionDetailsModal } from './SessionDetailsModal.ts';
import type { VisualEventPosition } from './visual-stack.ts';

export function createSessionElement(
  app: App,
  event: CalendarEvent,
  overlapColumn: number,
  overlapCount: number,
  vertical: VisualEventPosition,
  pxPerMinute: number,
  sessionColors: Record<string, string>,
): HTMLElement {
  const element = createEl('button');
  element.className = [
    'eqh-event',
    event.dataWarning ? 'eqh-event--warning' : '',
    vertical.stacked ? 'eqh-event--stacked' : '',
  ].filter(Boolean).join(' ');
  element.type = 'button';
  element.style.top = `${vertical.startMinutes * pxPerMinute}px`;
  element.style.height = `${vertical.durationMinutes * pxPerMinute}px`;
  element.style.left = `calc(${overlapColumn * 100 / overlapCount}% + 2px)`;
  element.style.width = `calc(${100 / overlapCount}% - 4px)`;
  element.style.setProperty('--eqh-event-color', colorForSession(event, sessionColors));
  const sourceLabel = event.sourceKind === 'planned' ? ', planned journal session' : '';
  const estimatedLabel = event.timeEstimated ? ', estimated time' : '';
  const milestoneCount = event.milestoneDetails?.length ?? 0;
  const milestoneLabel = milestoneCount > 0
    ? `, ${milestoneCount} milestone${milestoneCount === 1 ? '' : 's'} achieved`
    : '';
  element.setAttribute(
    'aria-label',
    `${event.title}, ${event.sessionType}, ${formatMinutesAsClock(event.durationMinutes)}${sourceLabel}${estimatedLabel}${milestoneLabel}`,
  );
  const tooltipLines = [
    event.title,
    `Type: ${event.sessionType || 'Not specified'}`,
    `${formatTimeOfDay(event.startMinutes)}–${formatTimeOfDay(event.endMinutes)} · ${formatMinutesAsClock(event.durationMinutes)}`,
  ];
  if (event.sourceKind === 'planned') tooltipLines.push('Source: planned journal note');
  if (event.timeEstimated) tooltipLines.push('Time is an estimated display slot.');
  if (event.dataWarning) tooltipLines.push(event.dataWarning);
  if (milestoneCount > 0) {
    tooltipLines.push(`${milestoneCount} milestone${milestoneCount === 1 ? '' : 's'} achieved`);
  }
  tooltipLines.push(...(event.planningWarnings ?? []));
  element.title = tooltipLines.join('\n');

  const title = createSpan();
  title.className = 'eqh-event-title';
  title.textContent = event.dataWarning ? `⚠ ${event.title}` : event.title;
  element.appendChild(title);
  const duration = createSpan();
  duration.className = 'eqh-event-duration';
  duration.textContent = formatMinutesAsClock(event.durationMinutes);
  element.appendChild(duration);
  const renderedHeightPx = vertical.durationMinutes * pxPerMinute;
  if (shouldShowSessionTypeFooter(renderedHeightPx, vertical.stacked)) {
    element.createSpan({ cls: 'eqh-event-type', text: sessionFooterText(event) });
  }
  element.addEventListener('click', () => new SessionDetailsModal(app, event).open());
  return element;
}
