import { ItemView, moment, normalizePath, WorkspaceLeaf } from 'obsidian';
import type EqhCalendarPlugin from './main.ts';

const FINGERPRINT_INTERVAL_MS = 10_000;

export type DashboardRangeKey = '30d' | '90d' | '1y' | 'all';

export function dashboardRangeStart(range: DashboardRangeKey, endDate: string): string | null {
  const end = moment(endDate, 'YYYY-MM-DD', true);
  if (range === '30d') return end.clone().subtract(29, 'days').format('YYYY-MM-DD');
  if (range === '90d') return end.clone().subtract(89, 'days').format('YYYY-MM-DD');
  if (range === '1y') return end.clone().subtract(1, 'year').add(1, 'day').format('YYYY-MM-DD');
  return null;
}

export function formatDashboardDate(value: string | null): string {
  if (!value) return '—';
  const parsed = moment(value, 'YYYY-MM-DD', true);
  return parsed.isValid() ? parsed.format('MMM D, YYYY') : value;
}

export function formatDashboardDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function formatDashboardNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

export function formatDashboardAmount(value: number, currency: string): string {
  const maximumFractionDigits = value !== 0 && Math.abs(value) < 0.01 ? 8 : 2;
  return `${formatDashboardNumber(value, maximumFractionDigits)} ${currency}`;
}

export function formatDashboardPercent(value: number | null): string {
  return value == null ? '—' : `${formatDashboardNumber(value * 100, 1)}%`;
}

export function humanizeDashboardCode(value: string | null): string {
  if (!value) return 'Unspecified';
  return value.split('_').join(' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function createDashboardMetric(
  container: HTMLElement,
  label: string,
  value: string,
  detail: string,
  tone?: 'positive' | 'negative' | 'warning',
): HTMLElement {
  const card = container.createDiv({ cls: `eqh-domain-metric${tone ? ` is-${tone}` : ''}` });
  card.createDiv({ cls: 'eqh-domain-metric-label', text: label });
  card.createDiv({ cls: 'eqh-domain-metric-value', text: value });
  card.createDiv({ cls: 'eqh-domain-metric-detail', text: detail });
  return card;
}

export function createDashboardPanel(
  container: HTMLElement,
  title: string,
  subtitle: string,
  wide = false,
): HTMLElement {
  const panel = container.createEl('section', { cls: `eqh-domain-panel${wide ? ' is-wide' : ''}` });
  const header = panel.createDiv({ cls: 'eqh-domain-panel-header' });
  header.createEl('h3', { text: title });
  header.createDiv({ cls: 'eqh-domain-panel-subtitle', text: subtitle });
  return panel;
}

export interface DashboardBarRecord {
  label: string;
  value: number;
  displayValue: string;
  detail?: string;
}

export function renderDashboardBars(container: HTMLElement, records: DashboardBarRecord[]): void {
  if (records.length === 0) {
    container.createDiv({ cls: 'eqh-domain-empty', text: 'No data was recorded in this period.' });
    return;
  }
  const max = Math.max(...records.map((record) => Math.abs(record.value)), 1);
  const list = container.createDiv({ cls: 'eqh-domain-bars' });
  for (const record of records) {
    const row = list.createDiv({ cls: 'eqh-domain-bar-row' });
    const heading = row.createDiv({ cls: 'eqh-domain-bar-heading' });
    heading.createSpan({ text: record.label });
    heading.createEl('strong', { text: record.displayValue });
    const track = row.createDiv({ cls: 'eqh-domain-bar-track' });
    const fill = track.createDiv({ cls: 'eqh-domain-bar-fill' });
    fill.style.width = `${Math.max(2, (Math.abs(record.value) / max) * 100)}%`;
    if (record.detail) row.createDiv({ cls: 'eqh-domain-bar-detail', text: record.detail });
  }
}

export interface DashboardTrendRecord {
  label: string;
  value: number;
  displayValue: string;
  ariaLabel: string;
}

export function renderDashboardTrend(container: HTMLElement, records: DashboardTrendRecord[]): void {
  if (records.length === 0) {
    container.createDiv({ cls: 'eqh-domain-empty', text: 'No trend data was recorded in this period.' });
    return;
  }
  const max = Math.max(...records.map((record) => record.value), 1);
  const chart = container.createEl('ol', { cls: 'eqh-domain-trend' });
  for (const record of records) {
    const item = chart.createEl('li', {
      cls: 'eqh-domain-trend-item',
      attr: { 'aria-label': `${record.ariaLabel}: ${record.displayValue}`, title: `${record.ariaLabel}: ${record.displayValue}` },
    });
    item.createDiv({
      cls: 'eqh-domain-trend-value',
      text: record.displayValue,
      attr: { style: `--eqh-domain-height:${Math.max(4, (record.value / max) * 100)}%` },
    });
    item.createDiv({ cls: 'eqh-domain-trend-label', text: record.label });
  }
}

export abstract class DashboardViewBase<T> extends ItemView {
  protected result: T | null = null;
  protected selectedRange: DashboardRangeKey = '90d';
  protected startDate: string | null = null;
  protected endDate = '';
  private renderGeneration = 0;
  private fingerprintTimer: number | null = null;
  private lastFingerprint: string | null = null;

  constructor(leaf: WorkspaceLeaf, protected plugin: EqhCalendarPlugin) {
    super(leaf);
  }

  protected abstract dashboardTitle(): string;
  protected abstract loadDashboard(startDate: string | null, endDate: string): Promise<T>;
  protected abstract renderDashboard(result: T): void;

  async onOpen(): Promise<void> {
    this.contentEl.addClass('eqh-domain-view');
    await this.refresh();
    this.registerEvent(this.app.vault.on('modify', (file) => {
      try {
        const databaseChanged = normalizePath(file.path)
          === this.plugin.database.normalizeVaultPath(this.plugin.settings.databasePath);
        if (databaseChanged && !this.plugin.nativeLogger.isRunning) void this.refresh();
      } catch {
        // The dashboard renders invalid path and database errors in its own view.
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
    this.contentEl.empty();
  }

  async refresh(): Promise<void> {
    const generation = ++this.renderGeneration;
    this.endDate = moment().format('YYYY-MM-DD');
    this.startDate = dashboardRangeStart(this.selectedRange, this.endDate);
    this.contentEl.empty();
    this.contentEl.addClass('eqh-domain-view');
    this.contentEl.createDiv({ cls: 'eqh-loading', text: `Loading ${this.dashboardTitle()}…` });
    try {
      const result = await this.loadDashboard(this.startDate, this.endDate);
      if (generation !== this.renderGeneration) return;
      this.result = result;
      this.contentEl.empty();
      this.renderDashboard(result);
    } catch (error) {
      if (generation !== this.renderGeneration) return;
      this.result = null;
      this.contentEl.empty();
      this.renderToolbar('Source-backed personal analytics');
      const message = error instanceof Error ? error.message : String(error);
      const panel = this.contentEl.createDiv({ cls: 'eqh-error' });
      panel.createEl('strong', { text: `${this.dashboardTitle()} could not load.` });
      panel.createDiv({ text: message });
      panel.createDiv({ text: `Configured database: ${this.plugin.settings.databasePath || '(not set)'}` });
    }
  }

  protected renderToolbar(subtitle: string, buildExtraControls?: (controls: HTMLElement) => void): void {
    const toolbar = this.contentEl.createDiv({ cls: 'eqh-toolbar eqh-domain-toolbar' });
    const identity = toolbar.createDiv({ cls: 'eqh-toolbar-identity' });
    identity.createEl('h2', { text: `EH Dashboards — ${this.dashboardTitle()}` });
    identity.createDiv({ cls: 'eqh-toolbar-status', text: subtitle });
    const controls = toolbar.createDiv({ cls: 'eqh-domain-toolbar-controls' });
    const range = controls.createEl('select', {
      cls: 'dropdown',
      attr: { 'aria-label': `${this.dashboardTitle()} date range` },
    });
    const options: Array<[DashboardRangeKey, string]> = [
      ['30d', 'Last 30 days'],
      ['90d', 'Last 90 days'],
      ['1y', 'Last year'],
      ['all', 'All time'],
    ];
    for (const [value, label] of options) {
      const option = range.createEl('option', { value, text: label });
      option.selected = value === this.selectedRange;
    }
    range.addEventListener('change', () => {
      this.selectedRange = range.value as DashboardRangeKey;
      void this.refresh();
    });
    buildExtraControls?.(controls);
    controls.createEl('button', { cls: 'eqh-toolbar-button', text: 'Refresh' })
      .addEventListener('click', () => { void this.plugin.refreshViews(); });
  }

  protected periodLabel(): string {
    if (this.startDate == null) return `All recorded history through ${formatDashboardDate(this.endDate)}`;
    return `${formatDashboardDate(this.startDate)} – ${formatDashboardDate(this.endDate)}`;
  }

  private async checkDatabaseFingerprint(): Promise<void> {
    try {
      const fingerprint = await this.plugin.database.fingerprint(this.plugin.settings.databasePath);
      if (this.lastFingerprint !== null && fingerprint !== this.lastFingerprint && !this.plugin.nativeLogger.isRunning) {
        this.lastFingerprint = fingerprint;
        await this.refresh();
      } else {
        this.lastFingerprint = fingerprint;
      }
    } catch {
      // A transient replacement or unavailable path can recover on the next poll.
    }
  }
}
