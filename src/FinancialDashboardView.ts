import { moment, WorkspaceLeaf } from 'obsidian';
import {
  createDashboardPanel,
  DashboardViewBase,
  formatDashboardAmount,
  formatDashboardDate,
  humanizeDashboardCode,
  renderDashboardBars,
  renderDashboardTrend,
  type DashboardTrendRecord,
} from './DashboardViewBase.ts';
import type EqhCalendarPlugin from './main.ts';
import type {
  FinancialCurrencyRecord,
  FinancialDailyRecord,
  FinancialDashboardQueryResult,
} from './eqh-query.ts';

export const EQH_FINANCIAL_DASHBOARD_VIEW_TYPE = 'eqh-financial-dashboard';

interface FlowBucket {
  key: string;
  label: string;
  ariaLabel: string;
  inflow: number;
  outflow: number;
}

function buildFlowBuckets(records: FinancialDailyRecord[]): FlowBucket[] {
  if (records.length === 0) return [];
  const first = moment(records[0].date, 'YYYY-MM-DD', true);
  const last = moment(records[records.length - 1].date, 'YYYY-MM-DD', true);
  const unit: 'day' | 'week' | 'month' = last.diff(first, 'days') <= 31
    ? 'day'
    : last.diff(first, 'days') <= 180 ? 'week' : 'month';
  const buckets = new Map<string, FlowBucket>();
  for (const record of records) {
    const date = moment(record.date, 'YYYY-MM-DD', true).startOf(unit);
    const key = date.format('YYYY-MM-DD');
    const bucket = buckets.get(key) ?? {
      key,
      label: unit === 'month' ? date.format('MMM YY') : date.format('MMM D'),
      ariaLabel: unit === 'week' ? `Week of ${date.format('MMMM D, YYYY')}` : date.format('MMMM D, YYYY'),
      inflow: 0,
      outflow: 0,
    };
    bucket.inflow += record.inflow;
    bucket.outflow += record.outflow;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].slice(-16);
}

export class FinancialDashboardView extends DashboardViewBase<FinancialDashboardQueryResult> {
  private selectedCurrency = 'all';

  constructor(leaf: WorkspaceLeaf, plugin: EqhCalendarPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return EQH_FINANCIAL_DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'EH Dashboards — Finance';
  }

  getIcon(): string {
    return 'landmark';
  }

  protected dashboardTitle(): string {
    return 'Finance';
  }

  protected loadDashboard(startDate: string | null, endDate: string): Promise<FinancialDashboardQueryResult> {
    return this.plugin.database.financialDashboard(this.plugin.settings.databasePath, startDate, endDate);
  }

  protected renderDashboard(result: FinancialDashboardQueryResult): void {
    const availableCurrencies = result.currencies.map((item) => item.currency);
    if (this.selectedCurrency !== 'all' && !availableCurrencies.includes(this.selectedCurrency)) {
      this.selectedCurrency = 'all';
    }
    this.renderToolbar(`${this.periodLabel()} · Recorded flow, not account balances`, (controls) => {
      const select = controls.createEl('select', {
        cls: 'dropdown',
        attr: { 'aria-label': 'Financial dashboard currency filter' },
      });
      const all = select.createEl('option', { value: 'all', text: 'All currencies' });
      all.selected = this.selectedCurrency === 'all';
      for (const currency of availableCurrencies) {
        const option = select.createEl('option', { value: currency, text: currency });
        option.selected = currency === this.selectedCurrency;
      }
      select.addEventListener('change', () => {
        this.selectedCurrency = select.value;
        this.contentEl.empty();
        this.renderDashboard(result);
      });
    });

    const currencies = this.filteredCurrencies(result.currencies);
    const currencyGrid = this.contentEl.createDiv({ cls: 'eqh-domain-currency-grid' });
    for (const currency of currencies) this.renderCurrencyCard(currencyGrid, currency);
    if (currencies.length === 0) {
      currencyGrid.createDiv({ cls: 'eqh-domain-empty', text: 'No transactions were recorded in this period.' });
    }

    const panels = this.contentEl.createDiv({ cls: 'eqh-domain-panel-grid' });
    for (const currency of currencies) this.renderFlowTrend(panels, result, currency.currency);
    this.renderEngagementSpending(panels, result);
    this.renderAccountFlow(panels, result);
    this.renderRecentTransactions(panels, result);
  }

  private filteredCurrencies(currencies: FinancialCurrencyRecord[]): FinancialCurrencyRecord[] {
    return this.selectedCurrency === 'all'
      ? currencies
      : currencies.filter((currency) => currency.currency === this.selectedCurrency);
  }

  private renderCurrencyCard(container: HTMLElement, record: FinancialCurrencyRecord): void {
    const card = container.createEl('section', { cls: 'eqh-domain-currency-card' });
    const header = card.createDiv({ cls: 'eqh-domain-currency-heading' });
    header.createEl('h3', { text: record.currency });
    header.createSpan({ text: `${record.transactionCount} transactions` });
    const values = card.createDiv({ cls: 'eqh-domain-currency-values' });
    const inflow = values.createDiv();
    inflow.createSpan({ text: 'Inflow' });
    inflow.createEl('strong', { text: formatDashboardAmount(record.inflow, record.currency) });
    const outflow = values.createDiv();
    outflow.createSpan({ text: 'Outflow' });
    outflow.createEl('strong', { text: formatDashboardAmount(record.outflow, record.currency) });
    const net = values.createDiv({ cls: record.net >= 0 ? 'is-positive' : 'is-negative' });
    net.createSpan({ text: 'Net flow' });
    net.createEl('strong', { text: formatDashboardAmount(record.net, record.currency) });
  }

  private renderFlowTrend(container: HTMLElement, result: FinancialDashboardQueryResult, currency: string): void {
    const records = result.dailyFlow.filter((record) => record.currency === currency);
    const buckets = buildFlowBuckets(records);
    const panel = createDashboardPanel(container, `${currency} cash flow`, 'Outflow bars; inflow remains in the exact summary card');
    const trend: DashboardTrendRecord[] = buckets.map((bucket) => ({
      label: bucket.label,
      value: bucket.outflow,
      displayValue: formatDashboardAmount(bucket.outflow, currency),
      ariaLabel: `${bucket.ariaLabel}, ${formatDashboardAmount(bucket.outflow, currency)} outflow and ${formatDashboardAmount(bucket.inflow, currency)} inflow`,
    }));
    renderDashboardTrend(panel, trend);
  }

  private renderEngagementSpending(container: HTMLElement, result: FinancialDashboardQueryResult): void {
    const records = result.engagements
      .filter((record) => this.selectedCurrency === 'all' || record.currency === this.selectedCurrency)
      .sort((a, b) => b.outflow - a.outflow)
      .slice(0, 12);
    const panel = createDashboardPanel(container, 'Engagement outflow', 'Only transactions with a resolved engagement owner');
    renderDashboardBars(panel, records.map((record) => ({
      label: record.engagementName,
      value: record.outflow,
      displayValue: formatDashboardAmount(record.outflow, record.currency),
      detail: `${record.transactionCount} transactions · net ${formatDashboardAmount(record.net, record.currency)}`,
    })));
  }

  private renderAccountFlow(container: HTMLElement, result: FinancialDashboardQueryResult): void {
    const records = result.accounts
      .filter((record) => this.selectedCurrency === 'all' || record.currency === this.selectedCurrency)
      .sort((left, right) => (
        right.transactionCount - left.transactionCount
        || left.accountName.localeCompare(right.accountName)
      ))
      .slice(0, 12);
    const panel = createDashboardPanel(container, 'Most used accounts', 'Transaction frequency in the selected period; this is not an account balance');
    renderDashboardBars(panel, records.map((record) => ({
      label: record.accountName,
      value: record.transactionCount,
      displayValue: `${record.transactionCount} transaction${record.transactionCount === 1 ? '' : 's'}`,
      detail: `${record.currency} · ${humanizeDashboardCode(record.accountType)} · net ${formatDashboardAmount(record.net, record.currency)}`,
    })));
  }

  private renderRecentTransactions(container: HTMLElement, result: FinancialDashboardQueryResult): void {
    const records = result.recentTransactions
      .filter((record) => this.selectedCurrency === 'all' || record.currency === this.selectedCurrency);
    const panel = createDashboardPanel(container, 'Recent transactions', 'Newest recorded activity in the selected period', true);
    if (records.length === 0) {
      panel.createDiv({ cls: 'eqh-domain-empty', text: 'No transactions were recorded in this period.' });
      return;
    }
    const table = panel.createEl('table', { cls: 'eqh-domain-table' });
    const head = table.createEl('thead').createEl('tr');
    for (const label of ['Date', 'Account', 'Engagement', 'Description', 'Amount']) head.createEl('th', { text: label });
    const body = table.createEl('tbody');
    for (const record of records) {
      const row = body.createEl('tr');
      row.createEl('td', { text: formatDashboardDate(record.date) });
      row.createEl('td', { text: record.accountName });
      row.createEl('td', { text: record.engagementName ?? 'Unresolved' });
      row.createEl('td', { text: record.description ?? '—' });
      row.createEl('td', {
        cls: record.amount >= 0 ? 'is-positive' : 'is-negative',
        text: formatDashboardAmount(record.amount, record.currency),
      });
    }
  }
}
