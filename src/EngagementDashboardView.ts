import { ItemView, moment, normalizePath, WorkspaceLeaf } from 'obsidian';
import { renderDismissibleWarning } from './dismissible-warning.ts';
import { engagementMatchesSearch } from './engagement-search.ts';
import type EqhCalendarPlugin from './main.ts';
import type {
  EngagementActivityRecord,
  EngagementDashboardQueryResult,
  EngagementDashboardSummaryRecord,
} from './eqh-query.ts';
import { DASHBOARD_WARNING_KEYS } from './warning-preferences.ts';

export const EQH_ENGAGEMENT_DASHBOARD_VIEW_TYPE = 'eqh-engagement-dashboard';

const FINGERPRINT_INTERVAL_MS = 10_000;
const MAX_ACTIVITY_BUCKETS = 16;

type RangeKey = '30d' | '90d' | '1y' | 'all';

interface ActivityBucket {
  key: string;
  label: string;
  ariaLabel: string;
  minutes: number;
}

function humanizeCode(value: string): string {
  if (!value || value === 'unspecified') return 'Unspecified';
  return value.split('_').join(' ').replace(/\b[a-z]/g, (letter: string) => letter.toUpperCase());
}

function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const parsed = moment(value, 'YYYY-MM-DD', true);
  return parsed.isValid() ? parsed.format('MMM D, YYYY') : value;
}

function formatTimeRange(startTime: string | null, endTime: string | null): string {
  if (!startTime && !endTime) return '—';
  return `${startTime ?? '—'}–${endTime ?? '—'}`;
}

function formatAmount(value: number, currency: string): string {
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  return `${formatted} ${currency}`;
}

function rangeStart(range: RangeKey, endDate: string): string | null {
  const end = moment(endDate, 'YYYY-MM-DD', true);
  if (range === '30d') return end.clone().subtract(29, 'days').format('YYYY-MM-DD');
  if (range === '90d') return end.clone().subtract(89, 'days').format('YYYY-MM-DD');
  if (range === '1y') return end.clone().subtract(1, 'year').add(1, 'day').format('YYYY-MM-DD');
  return null;
}

function rangeLabel(range: RangeKey, startDate: string | null, endDate: string): string {
  if (range === 'all') return `All logged history through ${formatDate(endDate)}`;
  return `${formatDate(startDate)} – ${formatDate(endDate)}`;
}

function buildActivityBuckets(
  activity: EngagementActivityRecord[],
  startDate: string | null,
  endDate: string,
  firstSessionDate: string | null,
): { buckets: ActivityBucket[]; subtitle: string } {
  const start = moment(startDate ?? firstSessionDate ?? endDate, 'YYYY-MM-DD', true);
  const end = moment(endDate, 'YYYY-MM-DD', true);
  if (!start.isValid() || !end.isValid() || start.isAfter(end)) return { buckets: [], subtitle: '' };

  const spanDays = end.diff(start, 'days') + 1;
  const unit: 'day' | 'week' | 'month' = spanDays <= 31 ? 'day' : spanDays <= 180 ? 'week' : 'month';
  const totals = new Map<string, number>();
  for (const record of activity) {
    const date = moment(record.date, 'YYYY-MM-DD', true);
    if (!date.isValid()) continue;
    const key = date.startOf(unit).format('YYYY-MM-DD');
    totals.set(key, (totals.get(key) ?? 0) + record.totalMinutes);
  }

  const cursor = start.clone().startOf(unit);
  const finalBucket = end.clone().startOf(unit);
  const buckets: ActivityBucket[] = [];
  while (!cursor.isAfter(finalBucket)) {
    const key = cursor.format('YYYY-MM-DD');
    const label = unit === 'month' ? cursor.format('MMM YY') : cursor.format('MMM D');
    const ariaLabel = unit === 'day'
      ? cursor.format('MMMM D, YYYY')
      : unit === 'week'
        ? `Week of ${cursor.format('MMMM D, YYYY')}`
        : cursor.format('MMMM YYYY');
    buckets.push({ key, label, ariaLabel, minutes: totals.get(key) ?? 0 });
    cursor.add(1, unit);
  }

  const visible = buckets.length > MAX_ACTIVITY_BUCKETS
    ? buckets.slice(-MAX_ACTIVITY_BUCKETS)
    : buckets;
  const unitLabel = unit === 'day' ? 'daily' : unit === 'week' ? 'weekly' : 'monthly';
  const subtitle = buckets.length > MAX_ACTIVITY_BUCKETS
    ? `Latest ${MAX_ACTIVITY_BUCKETS} ${unitLabel} buckets in the selected period`
    : `${humanizeCode(unit)} activity in the selected period`;
  return { buckets: visible, subtitle };
}

export class EngagementDashboardView extends ItemView {
  private result: EngagementDashboardQueryResult | null = null;
  private selectedEngagementId: number | null = null;
  private selectedRange: RangeKey = 'all';
  private searchQuery = '';
  private statusFilter = 'all';
  private typeFilter = 'all';
  private renderGeneration = 0;
  private filterSelectionTimer: number | null = null;
  private fingerprintTimer: number | null = null;
  private lastFingerprint: string | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: EqhCalendarPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return EQH_ENGAGEMENT_DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'EH Dashboards — Engagements';
  }

  getIcon(): string {
    return 'target';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('eqh-engagement-view');
    await this.refresh();
    this.registerEvent(this.app.vault.on('modify', (file) => {
      try {
        const databaseChanged = normalizePath(file.path)
          === this.plugin.database.normalizeVaultPath(this.plugin.settings.databasePath);
        if (databaseChanged && !this.plugin.nativeLogger.isRunning) void this.refresh();
      } catch {
        // Invalid database paths are explained by the visible query error.
      }
    }));
    try {
      this.lastFingerprint = await this.plugin.database.fingerprint(this.plugin.settings.databasePath);
    } catch {
      this.lastFingerprint = null;
    }
    this.fingerprintTimer = window.setInterval(() => { void this.checkDatabaseFingerprint(); }, FINGERPRINT_INTERVAL_MS);
  }

  async onClose(): Promise<void> {
    if (this.fingerprintTimer != null) window.clearInterval(this.fingerprintTimer);
    if (this.filterSelectionTimer != null) window.clearTimeout(this.filterSelectionTimer);
    this.contentEl.empty();
  }

  async refresh(): Promise<void> {
    const generation = ++this.renderGeneration;
    this.contentEl.empty();
    this.contentEl.addClass('eqh-engagement-view');
    this.contentEl.createDiv({ cls: 'eqh-loading', text: 'Loading Engagement Dashboard…' });
    try {
      const endDate = moment().format('YYYY-MM-DD');
      const startDate = rangeStart(this.selectedRange, endDate);
      const result = await this.plugin.database.engagementDashboard(
        this.plugin.settings.databasePath,
        this.selectedEngagementId,
        startDate,
        endDate,
      );
      if (generation !== this.renderGeneration) return;
      this.result = result;
      this.selectedEngagementId = result.selectedEngagement?.id ?? null;
      this.renderDashboard();
    } catch (error) {
      if (generation !== this.renderGeneration) return;
      this.result = null;
      this.contentEl.empty();
      this.renderHeader();
      this.renderError(error);
    }
  }

  private renderDashboard(): void {
    this.contentEl.empty();
    this.contentEl.addClass('eqh-engagement-view');
    this.renderHeader();
    if (!this.result || this.result.engagements.length === 0) {
      this.contentEl.createDiv({
        cls: 'eqh-engagement-empty',
        text: 'No engagements were found in the configured database.',
      });
      return;
    }

    const layout = this.contentEl.createDiv({ cls: 'eqh-engagement-layout' });
    this.renderSidebar(layout);
    const main = layout.createEl('main', { cls: 'eqh-engagement-main' });
    const selected = this.result.selectedEngagement;
    if (!selected) {
      main.createDiv({ cls: 'eqh-engagement-empty', text: 'Select an engagement to inspect it.' });
      return;
    }
    this.renderIdentity(main, selected);
    this.renderSummary(main, selected);
    this.renderDataCoverage(main);
    this.renderCharts(main, selected);
    this.renderTransactions(main);
    this.renderMilestones(main);
    this.renderRecentSessions(main);
  }

  private renderHeader(): void {
    const result = this.result;
    const header = this.contentEl.createDiv({ cls: 'eqh-toolbar eqh-engagement-toolbar' });
    const identity = header.createDiv({ cls: 'eqh-toolbar-identity' });
    identity.createEl('h2', { text: 'EH Dashboards — Engagements' });
    const activeInRange = result?.engagements.filter((engagement) => engagement.sessionCount > 0).length ?? 0;
    const totalMinutes = result?.engagements.reduce((sum, engagement) => sum + engagement.totalMinutes, 0) ?? 0;
    identity.createDiv({
      cls: 'eqh-toolbar-status',
      text: result
        ? `${result.engagements.length} engagements · ${activeInRange} with activity · ${formatDuration(totalMinutes)} logged`
        : 'Time, milestones, and linked money by engagement',
    });

    const controls = header.createDiv({ cls: 'eqh-engagement-toolbar-controls' });
    const rangeSelect = controls.createEl('select', {
      cls: 'dropdown eqh-engagement-range',
      attr: { 'aria-label': 'Engagement dashboard date range' },
    });
    const options: Array<[RangeKey, string]> = [
      ['30d', 'Last 30 days'],
      ['90d', 'Last 90 days'],
      ['1y', 'Last year'],
      ['all', 'All time'],
    ];
    for (const [value, text] of options) {
      const option = rangeSelect.createEl('option', { text, value });
      option.selected = value === this.selectedRange;
    }
    rangeSelect.addEventListener('change', () => {
      this.selectedRange = rangeSelect.value as RangeKey;
      void this.refresh();
    });
    controls.createEl('button', { text: 'Refresh', cls: 'eqh-toolbar-button' })
      .addEventListener('click', () => { void this.plugin.refreshViews(); });
  }

  private renderSidebar(container: HTMLElement): void {
    if (!this.result) return;
    const sidebar = container.createEl('aside', {
      cls: 'eqh-engagement-sidebar',
      attr: { 'aria-label': 'Engagement navigator' },
    });
    const filters = sidebar.createDiv({ cls: 'eqh-engagement-filters' });
    const search = filters.createEl('input', {
      type: 'search',
      value: this.searchQuery,
      cls: 'eqh-engagement-search',
      attr: { 'aria-label': 'Search engagements', placeholder: 'Search engagements…' },
    });
    const statusSelect = filters.createEl('select', {
      cls: 'dropdown',
      attr: { 'aria-label': 'Filter by engagement status' },
    });
    this.addFilterOptions(statusSelect, 'All statuses', this.result.engagements.map((item) => item.status), this.statusFilter);
    const typeSelect = filters.createEl('select', {
      cls: 'dropdown',
      attr: { 'aria-label': 'Filter by engagement type' },
    });
    this.addFilterOptions(typeSelect, 'All types', this.result.engagements.map((item) => item.type), this.typeFilter);
    const list = sidebar.createDiv({ cls: 'eqh-engagement-list' });
    const rerenderList = (): void => this.renderEngagementList(list);
    search.addEventListener('input', () => {
      this.searchQuery = search.value;
      rerenderList();
      this.queueFilterSelectionSync();
    });
    statusSelect.addEventListener('change', () => {
      this.statusFilter = statusSelect.value;
      rerenderList();
      this.queueFilterSelectionSync();
    });
    typeSelect.addEventListener('change', () => {
      this.typeFilter = typeSelect.value;
      rerenderList();
      this.queueFilterSelectionSync();
    });
    this.renderEngagementList(list);
  }

  private addFilterOptions(select: HTMLSelectElement, allLabel: string, values: string[], selected: string): void {
    const all = select.createEl('option', { text: allLabel, value: 'all' });
    all.selected = selected === 'all';
    for (const value of [...new Set(values)].sort((a, b) => a.localeCompare(b))) {
      const option = select.createEl('option', { text: humanizeCode(value), value });
      option.selected = selected === value;
    }
  }

  private renderEngagementList(container: HTMLElement): void {
    if (!this.result) return;
    container.empty();
    const filtered = this.filteredEngagements();
    if (filtered.length === 0) {
      container.createDiv({ cls: 'eqh-engagement-empty-inline', text: 'No engagements match these filters.' });
      return;
    }
    for (const engagement of filtered) {
      const button = container.createEl('button', {
        cls: `eqh-engagement-list-item${engagement.id === this.selectedEngagementId ? ' is-selected' : ''}`,
        attr: {
          'aria-label': `${engagement.name}, ${humanizeCode(engagement.status)}, ${humanizeCode(engagement.type)}, ${formatDuration(engagement.totalMinutes)} logged`,
        },
      });
      const heading = button.createDiv({ cls: 'eqh-engagement-list-heading' });
      heading.createSpan({ text: engagement.name });
      heading.createEl('strong', { text: formatDuration(engagement.totalMinutes) });
      button.createDiv({
        cls: 'eqh-engagement-list-meta',
        text: `${humanizeCode(engagement.status)} · ${humanizeCode(engagement.type)} · ${engagement.sessionCount} sessions`,
      });
      button.addEventListener('click', () => {
        if (engagement.id === this.selectedEngagementId) return;
        this.selectedEngagementId = engagement.id;
        void this.refresh();
      });
    }
  }

  private filteredEngagements(): EngagementDashboardSummaryRecord[] {
    if (!this.result) return [];
    const needle = this.searchQuery.trim().toLocaleLowerCase();
    return this.result.engagements.filter((engagement) => (
      engagementMatchesSearch(engagement.name, engagement.aliases, needle)
      && (this.statusFilter === 'all' || engagement.status === this.statusFilter)
      && (this.typeFilter === 'all' || engagement.type === this.typeFilter)
    ));
  }

  private queueFilterSelectionSync(): void {
    if (this.filterSelectionTimer != null) window.clearTimeout(this.filterSelectionTimer);
    this.filterSelectionTimer = window.setTimeout(() => {
      this.filterSelectionTimer = null;
      const firstVisible = this.filteredEngagements()[0];
      if (!firstVisible || firstVisible.id === this.selectedEngagementId) return;
      this.selectedEngagementId = firstVisible.id;
      void this.refresh();
    }, 150);
  }

  private renderIdentity(container: HTMLElement, engagement: EngagementDashboardSummaryRecord): void {
    if (!this.result) return;
    const section = container.createEl('section', { cls: 'eqh-engagement-identity' });
    const titleRow = section.createDiv({ cls: 'eqh-engagement-title-row' });
    titleRow.createEl('h3', { text: engagement.name });
    const badges = titleRow.createDiv({ cls: 'eqh-engagement-badges' });
    badges.createSpan({ cls: `eqh-engagement-badge is-${engagement.status}`, text: humanizeCode(engagement.status) });
    badges.createSpan({ cls: 'eqh-engagement-badge', text: humanizeCode(engagement.type) });
    section.createDiv({
      cls: 'eqh-engagement-period',
      text: rangeLabel(this.selectedRange, this.result.startDate, this.result.endDate),
    });
    const dates = section.createDiv({ cls: 'eqh-engagement-dates' });
    for (const [label, value] of [
      ['Started', engagement.startDate],
      ['Target', engagement.targetDate],
      ['Completed', engagement.completionDate],
    ] as Array<[string, string | null]>) {
      const item = dates.createDiv({ cls: 'eqh-engagement-date' });
      item.createSpan({ text: label });
      item.createEl('strong', { text: formatDate(value) });
    }
    if (engagement.notes) {
      section.createDiv({ cls: 'eqh-engagement-notes', text: engagement.notes });
    }
  }

  private renderSummary(container: HTMLElement, engagement: EngagementDashboardSummaryRecord): void {
    const grid = container.createEl('section', {
      cls: 'eqh-engagement-summary',
      attr: { 'aria-label': 'Engagement summary' },
    });
    const cards: Array<[string, string, string]> = [
      ['Logged time', formatDuration(engagement.totalMinutes), 'Selected period'],
      ['Sessions', String(engagement.sessionCount), 'Selected period'],
      ['Milestones', String(engagement.milestoneCount), 'Lifetime'],
      ['Last activity', formatDate(engagement.lastSessionDate), 'Selected period'],
    ];
    for (const [label, value, context] of cards) {
      const card = grid.createDiv({ cls: 'eqh-engagement-summary-card' });
      card.createDiv({ cls: 'eqh-engagement-eyebrow', text: label });
      card.createDiv({ cls: 'eqh-engagement-summary-value', text: value });
      card.createDiv({ cls: 'eqh-engagement-card-context', text: context });
    }
  }

  private renderDataCoverage(container: HTMLElement): void {
    if (!this.result || this.result.unassignedTransactionCount === 0) return;
    renderDismissibleWarning(
      container,
      this.plugin,
      DASHBOARD_WARNING_KEYS.engagementUnresolvedTransactions,
      `${this.result.unassignedTransactionCount} legacy or unresolved transaction rows in this period are excluded because they do not identify an engagement.`,
      'eqh-engagement-coverage-warning',
    );
  }

  private renderCharts(container: HTMLElement, engagement: EngagementDashboardSummaryRecord): void {
    if (!this.result) return;
    const grid = container.createDiv({ cls: 'eqh-engagement-chart-grid' });
    const activitySection = grid.createEl('section', { cls: 'eqh-engagement-panel' });
    activitySection.createEl('h3', { text: 'Activity trend' });
    const activity = buildActivityBuckets(
      this.result.dailyActivity,
      this.result.startDate,
      this.result.endDate,
      engagement.firstSessionDate,
    );
    activitySection.createDiv({ cls: 'eqh-engagement-panel-subtitle', text: activity.subtitle });
    if (activity.buckets.every((bucket) => bucket.minutes === 0)) {
      activitySection.createDiv({ cls: 'eqh-engagement-empty-inline', text: 'No sessions in this period.' });
    } else {
      const maxMinutes = Math.max(...activity.buckets.map((bucket) => bucket.minutes), 1);
      const scroller = activitySection.createDiv({ cls: 'eqh-engagement-activity-scroll' });
      const chart = scroller.createDiv({ cls: 'eqh-engagement-activity-chart' });
      for (const bucket of activity.buckets) {
        const column = chart.createDiv({
          cls: 'eqh-engagement-activity-column',
          attr: { 'aria-label': `${bucket.ariaLabel}: ${formatDuration(bucket.minutes)}` },
        });
        column.createDiv({ cls: 'eqh-engagement-activity-value', text: bucket.minutes > 0 ? formatDuration(bucket.minutes) : '—' });
        const stage = column.createDiv({ cls: 'eqh-engagement-activity-stage' });
        const bar = stage.createDiv({ cls: 'eqh-engagement-activity-bar' });
        bar.style.setProperty('--eqh-activity-height', `${Math.max(bucket.minutes > 0 ? 4 : 0, (bucket.minutes / maxMinutes) * 100)}%`);
        column.createDiv({ cls: 'eqh-engagement-activity-label', text: bucket.label });
      }
    }

    const mixSection = grid.createEl('section', { cls: 'eqh-engagement-panel' });
    mixSection.createEl('h3', { text: 'Session type mix' });
    mixSection.createDiv({ cls: 'eqh-engagement-panel-subtitle', text: 'Logged time by canonical session type' });
    if (this.result.sessionTypes.length === 0) {
      mixSection.createDiv({ cls: 'eqh-engagement-empty-inline', text: 'No session types in this period.' });
    } else {
      const maxMinutes = Math.max(...this.result.sessionTypes.map((item) => item.totalMinutes), 1);
      const chart = mixSection.createDiv({ cls: 'eqh-engagement-type-chart' });
      for (const item of this.result.sessionTypes) {
        const row = chart.createDiv({ cls: 'eqh-engagement-type-row' });
        const labels = row.createDiv({ cls: 'eqh-engagement-type-labels' });
        labels.createSpan({ text: humanizeCode(item.sessionType) });
        labels.createEl('strong', { text: `${formatDuration(item.totalMinutes)} · ${item.sessionCount}` });
        const track = row.createDiv({ cls: 'eqh-engagement-type-track' });
        const bar = track.createDiv({ cls: 'eqh-engagement-type-bar' });
        bar.style.setProperty('--eqh-type-width', `${Math.max(3, (item.totalMinutes / maxMinutes) * 100)}%`);
      }
    }
  }

  private renderTransactions(container: HTMLElement): void {
    if (!this.result) return;
    const section = container.createEl('section', { cls: 'eqh-engagement-panel' });
    const heading = section.createDiv({ cls: 'eqh-engagement-section-heading' });
    heading.createEl('h3', { text: 'Linked money by currency' });
    heading.createSpan({ text: 'Currencies are never converted or combined', cls: 'eqh-engagement-panel-subtitle' });
    if (this.result.transactionTotals.length === 0) {
      section.createDiv({
        cls: 'eqh-engagement-empty-inline',
        text: 'No engagement-linked transactions were recorded in this period.',
      });
      return;
    }
    const grid = section.createDiv({ cls: 'eqh-engagement-money-grid' });
    for (const total of this.result.transactionTotals) {
      const card = grid.createDiv({ cls: 'eqh-engagement-money-card' });
      card.createDiv({ cls: 'eqh-engagement-eyebrow', text: total.currency });
      card.createDiv({ cls: 'eqh-engagement-money-net', text: formatAmount(total.net, total.currency) });
      const details = card.createDiv({ cls: 'eqh-engagement-money-details' });
      details.createSpan({ text: `In ${formatAmount(total.inflow, total.currency)}` });
      details.createSpan({ text: `Out ${formatAmount(total.outflow, total.currency)}` });
      details.createSpan({ text: `${total.transactionCount} transactions` });
    }
    const ledger = section.createDiv({ cls: 'eqh-engagement-transaction-ledger' });
    const ledgerHeading = ledger.createDiv({ cls: 'eqh-engagement-section-heading' });
    ledgerHeading.createEl('h4', { text: 'Transactions' });
    ledgerHeading.createSpan({
      cls: 'eqh-engagement-panel-subtitle',
      text: `All ${this.result.transactions.length} linked transaction${this.result.transactions.length === 1 ? '' : 's'} in the selected period`,
    });
    const wrapper = ledger.createDiv({ cls: 'eqh-engagement-table-wrap' });
    const table = wrapper.createEl('table', { cls: 'eqh-engagement-detail-table eqh-engagement-transaction-table' });
    const header = table.createEl('thead').createEl('tr');
    for (const label of ['Date', 'Account', 'Description', 'Amount']) header.createEl('th', { text: label });
    const body = table.createEl('tbody');
    for (const transaction of this.result.transactions) {
      const row = body.createEl('tr');
      row.createEl('td', { text: formatDate(transaction.date), attr: { 'data-label': 'Date' } });
      row.createEl('td', { text: transaction.accountName, attr: { 'data-label': 'Account' } });
      row.createEl('td', {
        text: transaction.description ?? '—',
        attr: { 'data-label': 'Description' },
      });
      row.createEl('td', {
        cls: transaction.amount >= 0 ? 'is-positive' : 'is-negative',
        text: formatAmount(transaction.amount, transaction.currency),
        attr: { 'data-label': 'Amount' },
      });
    }
  }

  private renderMilestones(container: HTMLElement): void {
    if (!this.result) return;
    const section = container.createEl('section', { cls: 'eqh-engagement-panel' });
    const heading = section.createDiv({ cls: 'eqh-engagement-section-heading' });
    heading.createEl('h3', { text: 'Milestones' });
    heading.createSpan({ text: 'Lifetime achievements and their owner sessions', cls: 'eqh-engagement-panel-subtitle' });
    if (this.result.milestones.length === 0) {
      section.createDiv({ cls: 'eqh-engagement-empty-inline', text: 'No milestones are recorded.' });
      return;
    }
    const list = section.createDiv({ cls: 'eqh-engagement-milestone-list' });
    for (const milestone of this.result.milestones) {
      const item = list.createDiv({ cls: 'eqh-engagement-milestone' });
      const title = item.createDiv({ cls: 'eqh-engagement-milestone-title' });
      title.createEl('h4', { text: milestone.name });
      title.createSpan({ text: formatDate(milestone.date ?? milestone.ownerSessionDate) });
      item.createDiv({
        cls: `eqh-engagement-owner${milestone.ownerSessionId == null ? ' is-unlinked' : ''}`,
        text: milestone.ownerSessionId == null
          ? 'Legacy milestone without an owner session'
          : `Owner session · ${formatDate(milestone.ownerSessionDate)} · ${formatTimeRange(milestone.ownerStartTime, milestone.ownerEndTime)}`,
      });
      if (milestone.measurements.length > 0) {
        const measurements = item.createDiv({ cls: 'eqh-engagement-measurements' });
        for (const measurement of milestone.measurements) {
          measurements.createSpan({
            text: `${humanizeCode(measurement.metricName)}: ${measurement.metricValue}`,
            attr: { title: measurement.measurementDate ? `Measured ${formatDate(measurement.measurementDate)}` : '' },
          });
        }
      }
      if (milestone.notes) item.createDiv({ cls: 'eqh-engagement-item-notes', text: milestone.notes });
    }
  }

  private renderRecentSessions(container: HTMLElement): void {
    if (!this.result) return;
    const section = container.createEl('section', { cls: 'eqh-engagement-panel' });
    const heading = section.createDiv({ cls: 'eqh-engagement-section-heading' });
    heading.createEl('h3', { text: 'Recent sessions' });
    heading.createSpan({ text: 'Latest 12 in the selected period', cls: 'eqh-engagement-panel-subtitle' });
    if (this.result.recentSessions.length === 0) {
      section.createDiv({ cls: 'eqh-engagement-empty-inline', text: 'No sessions were logged in this period.' });
      return;
    }
    const wrapper = section.createDiv({ cls: 'eqh-engagement-table-wrap' });
    const table = wrapper.createEl('table', { cls: 'eqh-engagement-detail-table eqh-engagement-session-table' });
    const header = table.createEl('thead').createEl('tr');
    for (const label of ['Date', 'Time', 'Type', 'Duration', 'Notes']) header.createEl('th', { text: label });
    const body = table.createEl('tbody');
    for (const session of this.result.recentSessions) {
      const row = body.createEl('tr');
      row.createEl('td', { text: formatDate(session.date), attr: { 'data-label': 'Date' } });
      row.createEl('td', { text: formatTimeRange(session.startTime, session.endTime), attr: { 'data-label': 'Time' } });
      row.createEl('td', { text: humanizeCode(session.sessionType), attr: { 'data-label': 'Type' } });
      row.createEl('td', { text: formatDuration(session.durationMinutes), attr: { 'data-label': 'Duration' } });
      row.createEl('td', { text: session.notes ?? '—', attr: { 'data-label': 'Notes' } });
    }
  }

  private renderError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const section = this.contentEl.createDiv({ cls: 'eqh-error eqh-engagement-error' });
    section.createEl('h3', { text: 'Could not load the Engagement Dashboard' });
    section.createEl('p', { text: message });
    section.createEl('p', {
      text: `Check the vault-relative database path in EH Dashboards settings: ${this.plugin.settings.databasePath}`,
    });
  }

  private async checkDatabaseFingerprint(): Promise<void> {
    if (this.plugin.nativeLogger.isRunning) return;
    try {
      const next = await this.plugin.database.fingerprint(this.plugin.settings.databasePath);
      if (this.lastFingerprint !== null && next !== this.lastFingerprint) await this.refresh();
      this.lastFingerprint = next;
    } catch {
      // A transient replacement or invalid path can recover on the next poll.
    }
  }
}
