import { Modal, Notice, moment, TFile, WorkspaceLeaf } from 'obsidian';
import {
  createDashboardPanel,
  createDashboardMetric,
  DashboardViewBase,
  formatDashboardAmount,
  formatDashboardDate,
  humanizeDashboardCode,
  renderDashboardLine,
  type DashboardLineRecord,
} from './DashboardViewBase.ts';
import type ExaminedHumanPlugin from './main.ts';
import { budgetNoteCandidates, readBudgetNote, type BudgetNoteListItem } from './budget-note-index.ts';
import { buildDailyNoteList, type DailyNoteListItem } from './daily-note-index.ts';
import { confirmWeeklyAction } from './WeeklyActionConfirmationModal.ts';
import type {
  FinancialAccountRecord,
  FinancialBalanceHistoryRecord,
  FinancialDashboardQueryResult,
  FinancialExplorerEngagementRecord,
} from './examined-human-query.ts';

export const EXAMINED_HUMAN_FINANCIAL_DASHBOARD_VIEW_TYPE = 'examined-human-financial-dashboard';

interface BalanceEntryInput { kind: 'opening' | 'reconciliation'; actualBalance: number; reason: string; }

type FinancialDisplayMode = 'native' | 'valuation';

function sampledBalanceHistory(records: FinancialBalanceHistoryRecord[]): FinancialBalanceHistoryRecord[] {
  if (records.length <= 120) return records;
  const step = records.length <= 730 ? 7 : 30;
  const sampled = [records[0]];
  for (let index = step; index < records.length - 1; index += step) sampled.push(records[index]);
  if (records.length > 1) sampled.push(records[records.length - 1]);
  return sampled;
}

function formattedEntryAmount(value: number): string { return value > 0 ? `+${value}` : String(value); }

function chooseBudgetNote(app: ExaminedHumanPlugin['app'], candidates: BudgetNoteListItem[]): Promise<BudgetNoteListItem | null> {
  return new Promise((resolve) => new BudgetNotePickerModal(app, candidates, resolve).open());
}

function chooseBalanceEntry(app: ExaminedHumanPlugin['app'], account: FinancialAccountRecord, kind: BalanceEntryInput['kind']): Promise<BalanceEntryInput | null> {
  return new Promise((resolve) => new BalanceEntryModal(app, account, kind, resolve).open());
}

function chooseDailyNote(app: ExaminedHumanPlugin['app'], targets: DailyNoteListItem[]): Promise<DailyNoteListItem | null> {
  return new Promise((resolve) => new FinanceDailyNotePickerModal(app, targets, resolve).open());
}

export class FinancialDashboardView extends DashboardViewBase<FinancialDashboardQueryResult> {
  private selectedAccountId: number | null = null;
  private displayMode: FinancialDisplayMode = 'valuation';

  constructor(leaf: WorkspaceLeaf, plugin: ExaminedHumanPlugin) { super(leaf, plugin); }
  getViewType(): string { return EXAMINED_HUMAN_FINANCIAL_DASHBOARD_VIEW_TYPE; }
  getDisplayText(): string { return 'Examined Human — Finance'; }
  getIcon(): string { return 'landmark'; }
  protected dashboardTitle(): string { return 'Finance'; }
  protected loadDashboard(startDate: string | null, endDate: string): Promise<FinancialDashboardQueryResult> {
    return this.plugin.database.financialDashboard(this.plugin.settings.databasePath, startDate, endDate, {
      label: this.plugin.settings.valuationUnitLabel,
      referenceUnit: this.plugin.settings.valuationReferenceUnit,
      selectedAccountId: this.selectedAccountId,
    });
  }

  protected renderDashboard(result: FinancialDashboardQueryResult): void {
    this.selectedAccountId = result.explorer.accountId;
    if (this.selectedAccountId == null) this.displayMode = 'valuation';
    const accounts = [...result.accounts].sort((left, right) => left.accountName.localeCompare(right.accountName));
    this.renderToolbar(`${this.periodLabel()} · Ledger balances through ${formatDashboardDate(result.endDate)}`, (controls) => {
      const asOf = controls.createEl('input', {
        type: 'date',
        cls: 'examined-human-dashboard-date-input',
        attr: { 'aria-label': 'Financial dashboard as-of date' },
      });
      asOf.value = result.endDate;
      asOf.addEventListener('change', () => {
        const candidate = asOf.value;
        if (!moment(candidate, 'YYYY-MM-DD', true).isValid()) {
          asOf.value = result.endDate;
          return;
        }
        this.endDateOverride = candidate;
        void this.refresh();
      });
      const accountSelect = controls.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Financial account' } });
      accountSelect.createEl('option', { value: 'all', text: 'All accounts' }).selected = this.selectedAccountId == null;
      for (const account of accounts) {
        accountSelect.createEl('option', { value: String(account.accountId), text: account.accountName }).selected = account.accountId === this.selectedAccountId;
      }
      accountSelect.addEventListener('change', () => {
        this.selectedAccountId = accountSelect.value === 'all' ? null : Number(accountSelect.value);
        if (this.selectedAccountId == null) this.displayMode = 'valuation';
        void this.refresh();
      });
      const displaySelect = controls.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Financial amount display unit' } });
      const nativeOption = displaySelect.createEl('option', {
        value: 'native',
        text: result.explorer.nativeCurrency ? `Native · ${result.explorer.nativeCurrency}` : 'Native units',
      });
      nativeOption.disabled = this.selectedAccountId == null;
      nativeOption.selected = this.displayMode === 'native' && this.selectedAccountId != null;
      displaySelect.createEl('option', { value: 'valuation', text: `Valuation · ${result.valuation.label}` }).selected = this.displayMode === 'valuation';
      displaySelect.addEventListener('change', () => {
        this.displayMode = displaySelect.value === 'native' && this.selectedAccountId != null ? 'native' : 'valuation';
        this.contentEl.empty();
        this.renderDashboard(result);
      });
      controls.createEl('button', { cls: 'examined-human-toolbar-button', text: 'Import Budget Form' })
        .addEventListener('click', () => { void this.importBudgetForm(); });
    });

    const panels = this.contentEl.createDiv({ cls: 'examined-human-domain-panel-grid examined-human-finance-stack' });
    this.renderValuation(panels, result);
    this.renderAccountExplorer(panels, result);
    this.renderBudget(panels, result);
    this.renderRecentTransactions(panels, result);
  }

  private renderBudget(container: HTMLElement, result: FinancialDashboardQueryResult): void {
    const panel = createDashboardPanel(container, 'Budget for selected date', 'The imported Budget Form whose period contains the selected date. Reimport the same period to update it.', true);
    const plan = result.activeBudget;
    if (!plan) {
      panel.createDiv({ cls: 'examined-human-domain-empty', text: 'No Budget Form has been imported yet. Keep one anywhere in the vault, then use Import Budget Form.' });
      return;
    }
    panel.createEl('p', { text: `${formatDashboardDate(plan.periodStart)} – ${formatDashboardDate(plan.periodEnd)} · ${plan.sourceFileName}` });
    const targets = plan.targets;
    const targetList = panel.createDiv({ cls: 'examined-human-domain-bars' });
    if (targets.length === 0) targetList.createDiv({ cls: 'examined-human-domain-empty', text: 'No budget targets for the selected currency.' });
    for (const target of targets) {
      const row = targetList.createDiv({ cls: 'examined-human-domain-bar-row' });
      const heading = row.createDiv({ cls: 'examined-human-domain-bar-heading' });
      heading.createSpan({ text: target.engagementName });
      heading.createEl('strong', { text: formatDashboardAmount(target.amount, target.currency) });
      row.createDiv({ cls: `examined-human-domain-bar-detail ${target.actualAmount >= 0 ? 'is-positive' : 'is-negative'}`,
        text: `Actual ${formatDashboardAmount(target.actualAmount, target.currency)} · variance ${formatDashboardAmount(target.variance, target.currency)}` });
    }
    const expected = plan.expectedMovements;
    if (expected.length > 0) {
      const details = panel.createEl('details');
      details.createEl('summary', { text: `Expected movements (${expected.filter((movement) => !movement.isMatched).length} unmatched)` });
      const table = details.createEl('table', { cls: 'examined-human-domain-table' });
      const head = table.createEl('thead').createEl('tr');
      for (const label of ['Due', 'Account', 'Engagement', 'Description', 'Expected', 'Status']) head.createEl('th', { text: label });
      const body = table.createEl('tbody');
      for (const movement of expected) {
        const row = body.createEl('tr');
        row.createEl('td', { text: formatDashboardDate(movement.dueDate) }); row.createEl('td', { text: movement.accountName });
        row.createEl('td', { text: movement.engagementName }); row.createEl('td', { text: movement.description ?? '—' });
        row.createEl('td', { cls: movement.amount >= 0 ? 'is-positive' : 'is-negative', text: formatDashboardAmount(movement.amount, movement.currency) });
        row.createEl('td', { text: movement.isMatched ? 'Matched' : 'Expected' });
      }
    }
  }

  private renderValuation(container: HTMLElement, result: FinancialDashboardQueryResult): void {
    const valuation = result.valuation;
    const panel = createDashboardPanel(
      container,
      'Valuation',
      `As of ${formatDashboardDate(valuation.asOfDate)} · reference asset class: ${valuation.referenceUnit}`,
      true,
    );
    const grid = panel.createDiv({ cls: 'examined-human-domain-metrics examined-human-finance-summary' });
    createDashboardMetric(grid, `Net worth · ${valuation.label}`, formatDashboardAmount(valuation.netWorth, valuation.label), `${valuation.valuedAccountCount} valued account${valuation.valuedAccountCount === 1 ? '' : 's'}`, valuation.netWorth >= 0 ? 'positive' : 'negative');
    createDashboardMetric(grid, 'Assets', formatDashboardAmount(valuation.assetTotal, valuation.label), 'Positive valued balances', 'positive');
    createDashboardMetric(grid, 'Liabilities', formatDashboardAmount(valuation.liabilityTotal, valuation.label), 'Negative valued balances', 'negative');
    if (valuation.missingAccounts.length === 0) return;
    const missing = panel.createEl('details', { cls: 'examined-human-daily-dry-run-details' });
    missing.createEl('summary', { text: `${valuation.missingAccounts.length} account${valuation.missingAccounts.length === 1 ? '' : 's'} excluded: missing valuation rate` });
    for (const account of valuation.missingAccounts) {
      missing.createDiv({ text: `${account.accountName} · ${formatDashboardAmount(account.balance, account.unit)}` });
    }
  }

  private renderAccountExplorer(container: HTMLElement, result: FinancialDashboardQueryResult): void {
    const explorer = result.explorer;
    const valued = this.displayMode === 'valuation' || explorer.accountId == null;
    const unit = valued ? result.valuation.label : explorer.nativeCurrency!;
    const balance = valued ? explorer.valuationBalance : explorer.nativeBalance;
    const inflow = valued ? explorer.valuationInflow : explorer.nativeInflow;
    const outflow = valued ? explorer.valuationOutflow : explorer.nativeOutflow;
    const panel = createDashboardPanel(
      container,
      explorer.accountId == null ? 'All accounts' : explorer.accountName,
      `${this.periodLabel()} · ${valued ? `valued in ${result.valuation.label}` : `shown in ${unit}`}`,
      true,
    );
    const metrics = panel.createDiv({ cls: 'examined-human-domain-metrics examined-human-finance-explorer-metrics' });
    createDashboardMetric(metrics, 'Balance now', balance == null ? 'Missing valuation rate' : formatDashboardAmount(balance, unit), `As of ${formatDashboardDate(result.endDate)}`, balance == null ? 'warning' : balance >= 0 ? 'positive' : 'negative');
    createDashboardMetric(metrics, 'Inflow', formatDashboardAmount(inflow ?? 0, unit), this.periodLabel(), 'positive');
    createDashboardMetric(metrics, 'Outflow', formatDashboardAmount(outflow ?? 0, unit), this.periodLabel(), 'negative');

    if (valued && (explorer.missingCurrentValuationAccountCount > 0 || explorer.missingFlowValuationTransactionCount > 0)) {
      panel.createDiv({
        cls: 'examined-human-domain-warning examined-human-finance-inline-warning',
        text: `${explorer.missingCurrentValuationAccountCount} current account balance${explorer.missingCurrentValuationAccountCount === 1 ? '' : 's'} and ${explorer.missingFlowValuationTransactionCount} period transaction${explorer.missingFlowValuationTransactionCount === 1 ? '' : 's'} are omitted from converted values because no point-in-time valuation rate exists.`,
      });
    }

    const selectedAccount = result.accounts.find((account) => account.accountId === explorer.accountId);
    if (selectedAccount) {
      const actions = panel.createDiv({ cls: 'examined-human-modal-actions examined-human-finance-account-actions' });
      actions.createEl('button', { text: 'Set opening balance' }).addEventListener('click', () => { void this.stageBalanceEntry(selectedAccount, 'opening'); });
      actions.createEl('button', { text: 'Reconcile balance' }).addEventListener('click', () => { void this.stageBalanceEntry(selectedAccount, 'reconciliation'); });
    }

    const historySection = panel.createDiv({ cls: 'examined-human-finance-section' });
    historySection.createEl('h4', { text: explorer.accountId == null ? 'Net worth over time' : 'Account balance over time' });
    const sampled = sampledBalanceHistory(explorer.balanceHistory);
    const lineRecords: DashboardLineRecord[] = sampled.map((record) => {
      const value = valued ? record.valuationBalance : record.nativeBalance;
      return {
        label: moment(record.date, 'YYYY-MM-DD', true).format(sampled.length > 120 ? 'MMM YYYY' : 'MMM D'),
        value,
        displayValue: value == null ? 'Missing valuation rate' : formatDashboardAmount(value, unit),
        ariaLabel: formatDashboardDate(record.date),
      };
    });
    renderDashboardLine(historySection, lineRecords, `${explorer.accountName} balance history in ${unit}`);
    if (explorer.balanceHistory.length > sampled.length) {
      historySection.createDiv({ cls: 'examined-human-domain-bar-detail', text: `Exact daily calculations retained; ${explorer.balanceHistory.length} days sampled to ${sampled.length} chart points for readability.` });
    }

    const engagementSection = panel.createDiv({ cls: 'examined-human-finance-section' });
    engagementSection.createEl('h4', { text: 'Money by engagement' });
    this.renderEngagementFlows(engagementSection, explorer.engagements, valued, unit);
  }

  private renderEngagementFlows(container: HTMLElement, records: FinancialExplorerEngagementRecord[], valued: boolean, unit: string): void {
    const visible = records.filter((record) => {
      const inflow = valued ? record.valuationInflow : record.nativeInflow ?? 0;
      const outflow = valued ? record.valuationOutflow : record.nativeOutflow ?? 0;
      return inflow !== 0 || outflow !== 0;
    }).slice(0, 16);
    if (visible.length === 0) {
      container.createDiv({ cls: 'examined-human-domain-empty', text: 'No resolved personal cash flow was recorded for this selection.' });
      return;
    }
    const maximum = Math.max(...visible.flatMap((record) => [
      valued ? record.valuationInflow : record.nativeInflow ?? 0,
      valued ? record.valuationOutflow : record.nativeOutflow ?? 0,
    ]), 1);
    const list = container.createDiv({ cls: 'examined-human-finance-engagements' });
    for (const record of visible) {
      const inflow = valued ? record.valuationInflow : record.nativeInflow ?? 0;
      const outflow = valued ? record.valuationOutflow : record.nativeOutflow ?? 0;
      const row = list.createDiv({ cls: 'examined-human-finance-engagement-row' });
      row.createDiv({ cls: 'examined-human-finance-engagement-name', text: record.engagementName });
      const inLine = row.createDiv({ cls: 'examined-human-finance-flow-line is-inflow' });
      inLine.createSpan({ text: 'In' });
      const inTrack = inLine.createDiv({ cls: 'examined-human-finance-flow-track' });
      inTrack.createDiv({ cls: 'examined-human-finance-flow-fill', attr: { style: `width:${(inflow / maximum) * 100}%` } });
      inLine.createEl('strong', { text: formatDashboardAmount(inflow, unit) });
      const outLine = row.createDiv({ cls: 'examined-human-finance-flow-line is-outflow' });
      outLine.createSpan({ text: 'Out' });
      const outTrack = outLine.createDiv({ cls: 'examined-human-finance-flow-track' });
      outTrack.createDiv({ cls: 'examined-human-finance-flow-fill', attr: { style: `width:${(outflow / maximum) * 100}%` } });
      outLine.createEl('strong', { text: formatDashboardAmount(outflow, unit) });
    }
    if (records.length > visible.length) container.createDiv({ cls: 'examined-human-domain-bar-detail', text: `Showing the 16 most active engagements of ${records.length}.` });
  }

  private renderRecentTransactions(container: HTMLElement, result: FinancialDashboardQueryResult): void {
    const records = result.recentTransactions;
    const selectedAccount = result.accounts.find((account) => account.accountId === this.selectedAccountId);
    const panel = createDashboardPanel(container, selectedAccount ? `${selectedAccount.accountName} activity` : 'Recent transactions',
      selectedAccount ? `${selectedAccount.currency} · newest recorded activity` : 'Newest recorded activity in the selected period', true);
    if (records.length === 0) { panel.createDiv({ cls: 'examined-human-domain-empty', text: 'No transactions were recorded in this period.' }); return; }
    const table = panel.createEl('table', { cls: 'examined-human-domain-table' });
    const head = table.createEl('thead').createEl('tr');
    for (const label of ['Date', 'Account', 'Engagement', 'Description', 'Kind', 'Amount']) head.createEl('th', { text: label });
    const body = table.createEl('tbody');
    for (const record of records) {
      const row = body.createEl('tr');
      row.createEl('td', { text: formatDashboardDate(record.date) }); row.createEl('td', { text: record.accountName });
      row.createEl('td', { text: record.engagementName ?? 'Unresolved legacy row' }); row.createEl('td', { text: record.description ?? '—' });
      row.createEl('td', { text: humanizeDashboardCode(record.kind) });
      row.createEl('td', { cls: record.amount >= 0 ? 'is-positive' : 'is-negative', text: formatDashboardAmount(record.amount, record.currency) });
    }
  }

  private async importBudgetForm(): Promise<void> {
    try {
      const choice = await chooseBudgetNote(this.app, budgetNoteCandidates(this.app)); if (!choice) return;
      const candidate = await readBudgetNote(this.app, choice);
      const request = { databasePath: this.plugin.settings.databasePath, fileName: candidate.fileName, filePath: candidate.filePath, sourceText: candidate.sourceText };
      const preview = await this.plugin.nativeLogger.inspectBudget(request);
      const confirmed = await confirmWeeklyAction(this.app, {
        title: 'Import Budget Form', explanation: preview.updatedExistingBudget ? 'This updates the stored budget with the same start and end dates. The note remains untouched in your vault.' : 'This adds a dated Budget Form to the database.',
        confirmLabel: preview.updatedExistingBudget ? 'Update budget' : 'Import budget',
        dryRunOutput: `Source: ${candidate.filePath}\nPeriod: ${preview.periodStart} through ${preview.periodEnd}\nBudget targets: ${preview.targetCount}\nExpected movements: ${preview.expectedMovementCount}`,
        warning: 'Nothing has changed yet. Expected movements are planning records only and never create transactions or reminders.',
      });
      if (!confirmed) return;
      const result = await this.plugin.nativeLogger.importBudget(request);
      new Notice(`Imported Budget Form for ${result.periodStart} through ${result.periodEnd}. ${result.backupPath ? `Backup: ${result.backupPath}` : ''}`, 10_000);
      await this.plugin.refreshViews();
    } catch (error) { new Notice(`Budget Form was not imported: ${error instanceof Error ? error.message : String(error)}`, 12_000); }
  }

  private async stageBalanceEntry(account: FinancialAccountRecord, kind: BalanceEntryInput['kind']): Promise<void> {
    try {
      const entry = await chooseBalanceEntry(this.app, account, kind); if (!entry) return;
      const amount = kind === 'opening' ? entry.actualBalance : entry.actualBalance - account.balance;
      if (!Number.isFinite(amount)) throw new Error('The balance adjustment is not a finite number.');
      if (kind === 'reconciliation' && amount === 0) { new Notice('The recorded and observed balances already match; no reconciliation entry was staged.'); return; }
      const today = moment().format('YYYY-MM-DD');
      const index = await this.plugin.database.dailyNoteIndex(this.plugin.settings.databasePath);
      const targets = (await buildDailyNoteList(this.app, index, today, this.plugin.knownForms())).filter((note) => note.status !== 'imported' && note.date >= today);
      if (targets.length === 0) throw new Error('Create an unimported current or future Daily Note before staging this entry.');
      const target = await chooseDailyNote(this.app, targets); if (!target) return;
      const file = this.app.vault.getAbstractFileByPath(target.filePath);
      if (!(file instanceof TFile)) throw new Error(`Daily Note was not found: ${target.filePath}`);
      const sourceText = await this.app.vault.read(file);
      const marker = kind === 'opening' ? '[EH opening balance]' : '[EH reconciliation]';
      const description = entry.reason ? `${marker} ${entry.reason}` : marker;
      const line = `${formattedEntryAmount(amount)} | ${account.accountName} | Finance | ${description}`;
      const preview = await this.plugin.nativeLogger.previewFinanceEntryStage({ noteDate: target.date, fileName: target.fileName, filePath: target.filePath, sourceText, line });
      const confirmed = await confirmWeeklyAction(this.app, {
        title: kind === 'opening' ? 'Stage opening balance' : 'Stage reconciliation',
        explanation: `This writes one normal Transaction line into ${target.fileName}; the database changes only when that Daily Note is imported.`,
        confirmLabel: 'Stage transaction line', dryRunOutput: preview.line,
        warning: 'Nothing has been changed yet. The Daily Note importer will validate the account and Finance engagement later.',
      });
      if (!confirmed) return;
      await this.plugin.nativeLogger.stageFinanceEntry(preview);
      new Notice(`Staged ${kind === 'opening' ? 'opening balance' : 'reconciliation'} in ${target.fileName}. Import that Daily Note to update the ledger.`, 10_000);
    } catch (error) { new Notice(`Financial entry was not staged: ${error instanceof Error ? error.message : String(error)}`, 12_000); }
  }
}

class BudgetNotePickerModal extends Modal {
  constructor(app: ExaminedHumanPlugin['app'], private candidates: BudgetNoteListItem[], private resolveChoice: (candidate: BudgetNoteListItem | null) => void) { super(app); }
  onOpen(): void {
    this.contentEl.createEl('h2', { text: 'Choose EH Budget Form' });
    if (this.candidates.length === 0) { this.contentEl.createEl('p', { text: 'This vault has no Markdown notes.' }); this.contentEl.createEl('button', { text: 'Close' }).addEventListener('click', () => { this.resolveChoice(null); this.close(); }); return; }
    this.contentEl.createEl('p', { text: 'Type part of a filename or path. Only the note you choose is read and checked for an EH Budget Form.' });
    const select = this.contentEl.createEl('select');
    const query = this.contentEl.createEl('input', { type: 'text', placeholder: 'Example: 2026-09-05 or September budget' });
    const renderCandidates = (): void => {
      const needle = query.value.trim().toLocaleLowerCase();
      const matches = this.candidates.filter((candidate) => candidate.filePath.toLocaleLowerCase().includes(needle)).slice(0, 100);
      select.empty();
      for (const candidate of matches) select.createEl('option', { value: candidate.filePath, text: candidate.filePath });
    };
    query.addEventListener('input', renderCandidates);
    renderCandidates();
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => { this.resolveChoice(null); this.close(); });
    actions.createEl('button', { cls: 'mod-cta', text: 'Preview budget' }).addEventListener('click', () => { this.resolveChoice(this.candidates.find((candidate) => candidate.filePath === select.value) ?? null); this.close(); });
  }
  onClose(): void { this.contentEl.empty(); }
}

class BalanceEntryModal extends Modal {
  private actualInput!: HTMLInputElement;
  private reasonInput!: HTMLInputElement;
  constructor(app: ExaminedHumanPlugin['app'], private account: FinancialAccountRecord, private kind: BalanceEntryInput['kind'], private resolveChoice: (entry: BalanceEntryInput | null) => void) { super(app); }
  onOpen(): void {
    const isOpening = this.kind === 'opening';
    this.contentEl.createEl('h2', { text: isOpening ? `Set opening balance — ${this.account.accountName}` : `Reconcile — ${this.account.accountName}` });
    this.contentEl.createEl('p', { text: isOpening ? 'Use this once to establish the account balance before you began logging transactions. It stages a marked normal transaction.' : `Recorded ledger balance: ${formatDashboardAmount(this.account.balance, this.account.currency)}. Enter the balance you actually observe; the difference becomes a marked normal transaction.` });
    this.actualInput = this.contentEl.createEl('input', { type: 'number', attr: { step: 'any', inputmode: 'decimal', 'aria-label': 'Observed account balance' } });
    this.actualInput.placeholder = `Observed balance (${this.account.currency})`;
    this.reasonInput = this.contentEl.createEl('input', { type: 'text', attr: { 'aria-label': 'Optional reconciliation reason' } }); this.reasonInput.placeholder = isOpening ? 'Optional context' : 'Optional reason';
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => { this.resolveChoice(null); this.close(); });
    actions.createEl('button', { cls: 'mod-cta', text: 'Choose Daily Note' }).addEventListener('click', () => { const actualBalance = Number(this.actualInput.value); if (!Number.isFinite(actualBalance)) { new Notice('Enter a valid observed balance.'); return; } this.resolveChoice({ kind: this.kind, actualBalance, reason: this.reasonInput.value.trim() }); this.close(); });
  }
  onClose(): void { this.contentEl.empty(); }
}

class FinanceDailyNotePickerModal extends Modal {
  constructor(app: ExaminedHumanPlugin['app'], private targets: DailyNoteListItem[], private resolveChoice: (target: DailyNoteListItem | null) => void) { super(app); }
  onOpen(): void {
    this.contentEl.createEl('h2', { text: 'Choose current or future Daily Note' });
    this.contentEl.createEl('p', { text: 'The adjustment will become a normal Transaction line. It will affect the database only when this unimported note is validated and imported.' });
    const select = this.contentEl.createEl('select');
    for (const target of this.targets) select.createEl('option', { value: target.filePath, text: `${target.date} · ${target.fileName}` });
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => { this.resolveChoice(null); this.close(); });
    actions.createEl('button', { cls: 'mod-cta', text: 'Continue' }).addEventListener('click', () => { this.resolveChoice(this.targets.find((target) => target.filePath === select.value) ?? null); this.close(); });
  }
  onClose(): void { this.contentEl.empty(); }
}
