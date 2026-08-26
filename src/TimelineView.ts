import { ItemView, moment, normalizePath, Notice, Platform, WorkspaceLeaf } from 'obsidian';
import { renderDismissibleWarning } from './dismissible-warning.ts';
import type EqhCalendarPlugin from './main.ts';
import type { CalendarDayState, CalendarEvent } from './events.ts';
import type { SessionQueryResult } from './eqh-query.ts';
import { layoutOverlappingEvents } from './overlap.ts';
import { createSessionElement } from './session-element.ts';
import { layoutVisualStack } from './visual-stack.ts';
import { DASHBOARD_WARNING_KEYS } from './warning-preferences.ts';

export const EQH_CALENDAR_VIEW_TYPE = 'eqh-calendar';

const INITIAL_DAYS_EACH_SIDE = 45;
const WINDOW_SHIFT_DAYS = 28;
const GUTTER_WIDTH = 68;
const HEADER_HEIGHT = 58;
const BASE_PX_PER_MINUTE = 1.15;
const ZOOM_LEVELS = [0.7, 0.85, 1, 1.25, 1.5, 2];
const FINGERPRINT_INTERVAL_MS = 10_000;

interface ViewportState {
  centerDate: string;
  scrollMinute: number;
}

interface RenderOptions {
  viewport?: ViewportState;
}

export class TimelineView extends ItemView {
  private rangeStart = moment().startOf('day').subtract(INITIAL_DAYS_EACH_SIDE, 'days');
  private rangeEnd = moment().startOf('day').add(INITIAL_DAYS_EACH_SIDE, 'days');
  private zoomIndex = 2;
  private scrollEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private warningEl: HTMLElement | null = null;
  private renderGeneration = 0;
  private shifting = false;
  private scrollTimer: number | null = null;
  private resizeTimer: number | null = null;
  private fingerprintTimer: number | null = null;
  private lastFingerprint: string | null = null;
  private warningNoticeShown = false;

  constructor(leaf: WorkspaceLeaf, private plugin: EqhCalendarPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return EQH_CALENDAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'EH Dashboards — Calendar';
  }

  getIcon(): string {
    return 'calendar-clock';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('eqh-calendar-view');
    await this.renderCalendar({
      viewport: {
        centerDate: moment().format('YYYY-MM-DD'),
        scrollMinute: this.plugin.settings.initialScrollHour * 60,
      },
    });

    this.registerEvent(this.app.vault.on('modify', (file) => {
      const configuredPath = this.plugin.settings.databasePath;
      try {
        if (normalizePath(file.path) === this.plugin.database.normalizeVaultPath(configuredPath)) void this.refresh();
      } catch {
        // The visible query error explains an invalid path; unrelated vault changes should remain safe.
      }
    }));

    try {
      this.lastFingerprint = await this.plugin.database.fingerprint(this.plugin.settings.databasePath);
    } catch {
      this.lastFingerprint = null;
    }
    this.fingerprintTimer = window.setInterval(() => { void this.checkDatabaseFingerprint(); }, FINGERPRINT_INTERVAL_MS);

    const viewWindow = this.contentEl.ownerDocument.defaultView;
    if (viewWindow) {
      this.registerDomEvent(viewWindow, 'resize', () => {
        if (!Platform.isMobile) return;
        if (this.resizeTimer != null) window.clearTimeout(this.resizeTimer);
        this.resizeTimer = window.setTimeout(() => { void this.refresh(); }, 150);
      });
    }
  }

  async onClose(): Promise<void> {
    if (this.scrollTimer != null) window.clearTimeout(this.scrollTimer);
    if (this.resizeTimer != null) window.clearTimeout(this.resizeTimer);
    if (this.fingerprintTimer != null) window.clearInterval(this.fingerprintTimer);
    this.contentEl.empty();
  }

  async refresh(): Promise<void> {
    await this.renderCalendar({ viewport: this.captureViewport() });
  }

  private get pxPerMinute(): number {
    return BASE_PX_PER_MINUTE * ZOOM_LEVELS[this.zoomIndex];
  }

  private get dayWidth(): number {
    if (Platform.isMobile) {
      return this.plugin.settings.mobileDayColumnWidth;
    }
    return this.plugin.settings.dayColumnWidth;
  }

  private async renderCalendar(options: RenderOptions = {}): Promise<void> {
    const generation = ++this.renderGeneration;
    const viewport = options.viewport ?? this.captureViewport();
    this.contentEl.empty();
    this.contentEl.addClass('eqh-calendar-view');
    this.renderHeader();

    const loading = this.contentEl.createDiv({ cls: 'eqh-loading', text: 'Loading EQH sessions…' });
    let result: SessionQueryResult;
    try {
      result = await this.plugin.database.sessionsBetween(
        this.plugin.settings.databasePath,
        this.rangeStart.format('YYYY-MM-DD'),
        this.rangeEnd.format('YYYY-MM-DD'),
        moment().format('YYYY-MM-DD'),
      );
    } catch (error) {
      if (generation !== this.renderGeneration) return;
      loading.remove();
      this.renderError(error);
      return;
    }
    if (generation !== this.renderGeneration) return;
    loading.remove();

    const eventsByDate = new Map<string, CalendarEvent[]>();
    for (const event of result.events) {
      const dayEvents = eventsByDate.get(event.date) ?? [];
      dayEvents.push(event);
      eventsByDate.set(event.date, dayEvents);
    }

    this.renderWarnings(result.issues.map((issue) => issue.message));
    this.renderGrid(eventsByDate, result.dayStates);
    if (this.statusEl) {
      const dayCount = this.rangeEnd.diff(this.rangeStart, 'days') + 1;
      const overdueCount = Object.values(result.dayStates).filter((state) => state.overdue).length;
      const overdueLabel = overdueCount > 0 ? ` · ${overdueCount} awaiting finalization` : '';
      this.statusEl.setText(`${result.events.length} sessions · ${dayCount} days loaded${overdueLabel}`);
    }

    window.requestAnimationFrame(() => {
      if (!this.scrollEl) return;
      const centerDate = viewport?.centerDate ?? moment().format('YYYY-MM-DD');
      const centerIndex = moment(centerDate, 'YYYY-MM-DD', true).diff(this.rangeStart, 'days');
      const desiredLeft = GUTTER_WIDTH + centerIndex * this.dayWidth - (this.scrollEl.clientWidth - this.dayWidth) / 2;
      this.scrollEl.scrollLeft = Math.max(0, desiredLeft);
      this.scrollEl.scrollTop = Math.max(0, (viewport?.scrollMinute ?? this.plugin.settings.initialScrollHour * 60) * this.pxPerMinute);
      this.shifting = false;
    });
  }

  private renderHeader(): void {
    const header = this.contentEl.createDiv({ cls: 'eqh-toolbar' });
    const identity = header.createDiv({ cls: 'eqh-toolbar-identity' });
    identity.createEl('h2', { text: 'EH Dashboards — Calendar' });
    this.statusEl = identity.createDiv({ cls: 'eqh-status', text: 'Loading…' });

    this.warningEl = header.createDiv({ cls: 'eqh-toolbar-warning-host eqh-hidden' });

    const actions = header.createDiv({ cls: 'eqh-toolbar-actions' });
    actions.createEl('button', { text: 'Today', cls: 'eqh-toolbar-button' })
      .addEventListener('click', () => { void this.goToToday(); });
    actions.createEl('button', { text: 'Refresh', cls: 'eqh-toolbar-button', attr: { 'aria-label': 'Refresh database' } })
      .addEventListener('click', () => { void this.plugin.refreshViews(); });
    actions.createEl('button', { text: '−', cls: 'eqh-toolbar-button eqh-zoom-button', attr: { 'aria-label': 'Zoom out' } })
      .addEventListener('click', () => { void this.changeZoom(-1); });
    actions.createEl('button', { text: '+', cls: 'eqh-toolbar-button eqh-zoom-button', attr: { 'aria-label': 'Zoom in' } })
      .addEventListener('click', () => { void this.changeZoom(1); });
  }

  private renderWarnings(messages: string[]): void {
    if (!this.warningEl || messages.length === 0) return;
    const chorMessages = messages.filter((message) => message.includes('"chor"'));
    const label = chorMessages.length > 0 && chorMessages.length === messages.length
      ? `${chorMessages.length} “chor” session${chorMessages.length === 1 ? '' : 's'} — fix the type in EQH.db`
      : `${messages.length} calendar warning${messages.length === 1 ? '' : 's'}`;
    const warning = renderDismissibleWarning(
      this.warningEl,
      this.plugin,
      DASHBOARD_WARNING_KEYS.calendarDataQuality,
      label,
      'eqh-toolbar-warning',
    );
    if (!warning) return;
    this.warningEl.removeClass('eqh-hidden');
    warning.setAttribute('title', messages.join('\n'));

    if (chorMessages.length > 0 && !this.warningNoticeShown) {
      this.warningNoticeShown = true;
      new Notice(`EH Dashboards found ${chorMessages.length} session${chorMessages.length === 1 ? '' : 's'} with type "chor". Correct the data in EQH.db.`, 10000);
    }
  }

  private renderGrid(
    eventsByDate: Map<string, CalendarEvent[]>,
    dayStates: Record<string, CalendarDayState>,
  ): void {
    const days: moment.Moment[] = [];
    for (let day = this.rangeStart.clone(); day.isSameOrBefore(this.rangeEnd, 'day'); day.add(1, 'day'))
      days.push(day.clone());

    const scroll = this.contentEl.createDiv({ cls: 'eqh-scroll' });
    this.scrollEl = scroll;
    const grid = scroll.createDiv({ cls: 'eqh-grid' });
    grid.style.setProperty('--eqh-day-width', `${this.dayWidth}px`);
    grid.style.setProperty('--eqh-px-per-minute', `${this.pxPerMinute}px`);
    grid.style.gridTemplateColumns = `${GUTTER_WIDTH}px repeat(${days.length}, ${this.dayWidth}px)`;
    grid.style.gridTemplateRows = `${HEADER_HEIGHT}px ${1440 * this.pxPerMinute}px`;

    const corner = grid.createDiv({ cls: 'eqh-grid-corner' });
    corner.setText('Time');

    const today = moment().format('YYYY-MM-DD');
    for (let index = 0; index < days.length; index++) {
      const day = days[index];
      const date = day.format('YYYY-MM-DD');
      const relation = date === today ? 'today' : date < today ? 'past' : 'future';
      const dayState = dayStates[date];
      const dayHeader = grid.createDiv({
        cls: [
          'eqh-day-header',
          `eqh-day-header--${relation}`,
          dayState?.overdue ? 'eqh-day-header--awaiting' : '',
        ].filter(Boolean).join(' '),
      });
      dayHeader.style.setProperty('--eqh-grid-column', String(index + 2));
      if (dayState) {
        dayHeader.setAttribute(
          'title',
          dayState.message
            || (dayState.overdue
              ? 'This journal note is awaiting historical finalization.'
              : 'This date is sourced from a planned journal note.'),
        );
      }
      dayHeader.createDiv({ cls: 'eqh-day-weekday', text: day.format('ddd') });
      dayHeader.createDiv({ cls: 'eqh-day-date', text: day.format('MMM D') });
    }

    const hourGutter = grid.createDiv({ cls: 'eqh-hour-gutter' });
    for (let hour = 0; hour < 24; hour++) {
      const label = hourGutter.createDiv({ cls: 'eqh-hour-label', text: `${String(hour).padStart(2, '0')}:00` });
      label.style.top = `${hour * 60 * this.pxPerMinute}px`;
    }

    for (let index = 0; index < days.length; index++) {
      const day = days[index];
      const date = day.format('YYYY-MM-DD');
      const relation = date === today ? 'today' : date < today ? 'past' : 'future';
      const column = grid.createDiv({
        cls: [
          'eqh-day-column',
          `eqh-day-column--${relation}`,
          dayStates[date]?.overdue ? 'eqh-day-column--awaiting' : '',
        ].filter(Boolean).join(' '),
      });
      column.style.setProperty('--eqh-grid-column', String(index + 2));
      column.dataset.date = date;
      column.style.backgroundSize = `100% ${60 * this.pxPerMinute}px, 100% ${30 * this.pxPerMinute}px`;

      const events = eventsByDate.get(date) ?? [];
      const visualPositions = layoutVisualStack(events, this.pxPerMinute);
      for (const positioned of layoutOverlappingEvents(events)) {
        const vertical = visualPositions.get(positioned.event.id) ?? {
          startMinutes: positioned.event.startMinutes,
          durationMinutes: positioned.event.endMinutes - positioned.event.startMinutes,
          stacked: false,
        };
        const eventElement = createSessionElement(
          this.app,
          positioned.event,
          positioned.column,
          positioned.columnCount,
          vertical,
          this.pxPerMinute,
          this.plugin.settings.sessionColors,
        );
        column.appendChild(eventElement);
      }

      if (relation === 'today') {
        const now = moment();
        const nowLine = column.createDiv({ cls: 'eqh-now-line' });
        nowLine.style.top = `${(now.hours() * 60 + now.minutes()) * this.pxPerMinute}px`;
      }
    }

    scroll.addEventListener('scroll', () => this.scheduleEdgeCheck(), { passive: true });
  }

  private renderError(error: unknown): void {
    const panel = this.contentEl.createDiv({ cls: 'eqh-error-panel' });
    panel.createEl('h3', { text: 'Could not open EQH database' });
    panel.createDiv({ text: error instanceof Error ? error.message : String(error) });
    panel.createEl('code', { text: this.plugin.settings.databasePath || '(no path configured)' });
    panel.createEl('p', { text: 'Set the vault-relative database path in Settings → Community plugins → EH Dashboards, then use Test connection.' });
  }

  private captureViewport(): ViewportState | undefined {
    if (!this.scrollEl) return undefined;
    const centerPixel = this.scrollEl.scrollLeft + this.scrollEl.clientWidth / 2 - GUTTER_WIDTH;
    const dayIndex = Math.max(0, Math.floor(centerPixel / this.dayWidth));
    return {
      centerDate: this.rangeStart.clone().add(dayIndex, 'days').format('YYYY-MM-DD'),
      scrollMinute: this.scrollEl.scrollTop / this.pxPerMinute,
    };
  }

  private async goToToday(): Promise<void> {
    const today = moment().startOf('day');
    this.rangeStart = today.clone().subtract(INITIAL_DAYS_EACH_SIDE, 'days');
    this.rangeEnd = today.clone().add(INITIAL_DAYS_EACH_SIDE, 'days');
    await this.renderCalendar({
      viewport: {
        centerDate: today.format('YYYY-MM-DD'),
        scrollMinute: this.plugin.settings.initialScrollHour * 60,
      },
    });
  }

  private async changeZoom(direction: number): Promise<void> {
    const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, this.zoomIndex + direction));
    if (next === this.zoomIndex) return;
    const viewport = this.captureViewport();
    this.zoomIndex = next;
    await this.renderCalendar({ viewport });
  }

  private scheduleEdgeCheck(): void {
    if (this.shifting || !this.scrollEl) return;
    if (this.scrollTimer != null) window.clearTimeout(this.scrollTimer);
    this.scrollTimer = window.setTimeout(() => { void this.shiftWindowAtEdge(); }, 100);
  }

  private async shiftWindowAtEdge(): Promise<void> {
    if (this.shifting || !this.scrollEl) return;
    const threshold = this.dayWidth * 3;
    const nearLeft = this.scrollEl.scrollLeft < threshold;
    const nearRight = this.scrollEl.scrollLeft + this.scrollEl.clientWidth > this.scrollEl.scrollWidth - threshold;
    if (!nearLeft && !nearRight) return;

    this.shifting = true;
    const viewport = this.captureViewport();
    const direction = nearLeft ? -1 : 1;
    this.rangeStart.add(direction * WINDOW_SHIFT_DAYS, 'days');
    this.rangeEnd.add(direction * WINDOW_SHIFT_DAYS, 'days');
    await this.renderCalendar({ viewport });
  }

  private async checkDatabaseFingerprint(): Promise<void> {
    try {
      const fingerprint = await this.plugin.database.fingerprint(this.plugin.settings.databasePath);
      if (this.lastFingerprint != null && fingerprint !== this.lastFingerprint) await this.refresh();
      this.lastFingerprint = fingerprint;
    } catch {
      // The visible error state or the next successful poll will explain/recover.
    }
  }
}
