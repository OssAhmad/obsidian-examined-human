import { ItemView, moment, normalizePath, WorkspaceLeaf } from 'obsidian';
import type ExaminedHumanPlugin from './main.ts';

const FINGERPRINT_INTERVAL_MS = 10_000;

export type DashboardRangeKey = 'days' | 'all';

export function dashboardRangeStart(range: DashboardRangeKey, endDate: string, days: number): string | null {
  const end = moment(endDate, 'YYYY-MM-DD', true);
  if (range === 'days') return end.clone().subtract(Math.max(1, days) - 1, 'days').format('YYYY-MM-DD');
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
  const card = container.createDiv({ cls: `examined-human-domain-metric${tone ? ` is-${tone}` : ''}` });
  card.createDiv({ cls: 'examined-human-domain-metric-label', text: label });
  card.createDiv({ cls: 'examined-human-domain-metric-value', text: value });
  card.createDiv({ cls: 'examined-human-domain-metric-detail', text: detail });
  return card;
}

export function createDashboardPanel(
  container: HTMLElement,
  title: string,
  subtitle: string,
  wide = false,
): HTMLElement {
  const panel = container.createEl('section', { cls: `examined-human-domain-panel${wide ? ' is-wide' : ''}` });
  const header = panel.createDiv({ cls: 'examined-human-domain-panel-header' });
  header.createEl('h3', { text: title });
  header.createDiv({ cls: 'examined-human-domain-panel-subtitle', text: subtitle });
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
    container.createDiv({ cls: 'examined-human-domain-empty', text: 'No data was recorded in this period.' });
    return;
  }
  const max = Math.max(...records.map((record) => Math.abs(record.value)), 1);
  const list = container.createDiv({ cls: 'examined-human-domain-bars' });
  for (const record of records) {
    const row = list.createDiv({ cls: 'examined-human-domain-bar-row' });
    const heading = row.createDiv({ cls: 'examined-human-domain-bar-heading' });
    heading.createSpan({ text: record.label });
    heading.createEl('strong', { text: record.displayValue });
    const track = row.createDiv({ cls: 'examined-human-domain-bar-track' });
    const fill = track.createDiv({ cls: 'examined-human-domain-bar-fill' });
    fill.style.width = `${Math.max(2, (Math.abs(record.value) / max) * 100)}%`;
    if (record.detail) row.createDiv({ cls: 'examined-human-domain-bar-detail', text: record.detail });
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
    container.createDiv({ cls: 'examined-human-domain-empty', text: 'No trend data was recorded in this period.' });
    return;
  }
  const max = Math.max(...records.map((record) => record.value), 1);
  const chart = container.createEl('ol', { cls: 'examined-human-domain-trend' });
  for (const record of records) {
    const item = chart.createEl('li', {
      cls: 'examined-human-domain-trend-item',
      attr: { 'aria-label': `${record.ariaLabel}: ${record.displayValue}`, title: `${record.ariaLabel}: ${record.displayValue}` },
    });
    item.createDiv({
      cls: 'examined-human-domain-trend-value',
      text: record.displayValue,
      attr: { style: `--examined-human-domain-height:${Math.max(4, (record.value / max) * 100)}%` },
    });
    item.createDiv({ cls: 'examined-human-domain-trend-label', text: record.label });
  }
}

export abstract class DashboardViewBase<T> extends ItemView {
  protected result: T | null = null;
  protected selectedRange: DashboardRangeKey = 'days';
  protected startDate: string | null = null;
  protected endDate = '';
  private renderGeneration = 0;
  private fingerprintTimer: number | null = null;
  private lastFingerprint: string | null = null;

  constructor(leaf: WorkspaceLeaf, protected plugin: ExaminedHumanPlugin) {
    super(leaf);
  }

  protected abstract dashboardTitle(): string;
  protected abstract loadDashboard(startDate: string | null, endDate: string): Promise<T>;
  protected abstract renderDashboard(result: T): void;

  async onOpen(): Promise<void> {
    this.contentEl.addClass('examined-human-domain-view');
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
    this.startDate = dashboardRangeStart(this.selectedRange, this.endDate, this.plugin.settings.defaultDashboardDays);
    this.contentEl.empty();
    this.contentEl.addClass('examined-human-domain-view');
    this.contentEl.createDiv({ cls: 'examined-human-loading', text: `Loading ${this.dashboardTitle()}…` });
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
      const panel = this.contentEl.createDiv({ cls: 'examined-human-error' });
      panel.createEl('strong', { text: `${this.dashboardTitle()} could not load.` });
      panel.createDiv({ text: message });
      panel.createDiv({ text: `Configured database: ${this.plugin.settings.databasePath || '(not set)'}` });
    }
  }

  protected renderToolbar(subtitle: string, buildExtraControls?: (controls: HTMLElement) => void): void {
    const toolbar = this.contentEl.createDiv({ cls: 'examined-human-toolbar examined-human-domain-toolbar' });
    const identity = toolbar.createDiv({ cls: 'examined-human-toolbar-identity' });
    identity.createEl('h2', { text: `Examined Human — ${this.dashboardTitle()}` });
    identity.createDiv({ cls: 'examined-human-toolbar-status', text: subtitle });
    const controls = toolbar.createDiv({ cls: 'examined-human-domain-toolbar-controls' });
    const range = controls.createEl('select', {
      cls: 'dropdown',
      attr: { 'aria-label': `${this.dashboardTitle()} date range` },
    });
    const options: Array<[DashboardRangeKey, string]> = [
      ['days', `Last ${this.plugin.settings.defaultDashboardDays} days`],
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
    if (this.selectedRange === 'days') {
      const days = controls.createEl('input', {
        type: 'number',
        cls: 'examined-human-dashboard-days-input',
        attr: { min: '1', step: '1', inputmode: 'numeric', 'aria-label': 'Number of dashboard days' },
      });
      days.value = String(this.plugin.settings.defaultDashboardDays);
      days.addEventListener('change', () => {
        const parsed = Number(days.value);
        if (!Number.isSafeInteger(parsed) || parsed < 1) {
          days.value = String(this.plugin.settings.defaultDashboardDays);
          return;
        }
        this.plugin.settings.defaultDashboardDays = parsed;
        void this.plugin.saveSettings();
        void this.refresh();
      });
    }
    buildExtraControls?.(controls);
    controls.createEl('button', { cls: 'examined-human-toolbar-button', text: 'Refresh' })
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
