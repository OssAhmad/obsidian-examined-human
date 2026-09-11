export interface FinancialCurrencyRecord {
  currency: string;
  transactionCount: number;
  inflow: number;
  outflow: number;
  net: number;
}

export interface FinancialDailyRecord extends FinancialCurrencyRecord {
  date: string;
}

export interface FinancialEngagementRecord extends FinancialCurrencyRecord {
  engagementId: number;
  engagementName: string;
}

export interface FinancialAccountRecord extends FinancialCurrencyRecord {
  accountId: number;
  accountName: string;
  accountType: string | null;
  balance: number;
  openingBalance: number;
  reconciliationAdjustment: number;
  transferIn: number;
  transferOut: number;
  lastActivityDate: string | null;
  valuationRate: number | null;
  valuationRateDate: string | null;
  valuationAmount: number | null;
  valuationKind: 'reference' | 'observed' | 'missing';
}

export interface FinancialMissingValuationRecord {
  accountId: number;
  accountName: string;
  unit: string;
  balance: number;
}

export interface FinancialValuationSummary {
  label: string;
  referenceUnit: string;
  asOfDate: string;
  assetTotal: number;
  liabilityTotal: number;
  netWorth: number;
  valuedAccountCount: number;
  missingAccounts: FinancialMissingValuationRecord[];
}

export interface FinancialTransactionRecord {
  id: number;
  accountId: number;
  date: string;
  amount: number;
  currency: string;
  accountName: string;
  engagementName: string | null;
  description: string | null;
  kind: 'normal' | 'opening_balance' | 'reconciliation' | 'transfer';
  isTransfer: boolean;
}

export interface FinancialBalanceHistoryRecord {
  date: string;
  nativeBalance: number | null;
  valuationBalance: number | null;
  missingAccountCount: number;
}

export interface FinancialExplorerEngagementRecord {
  engagementId: number;
  engagementName: string;
  transactionCount: number;
  nativeCurrency: string | null;
  nativeInflow: number | null;
  nativeOutflow: number | null;
  nativeNet: number | null;
  valuationTransactionCount: number;
  valuationInflow: number;
  valuationOutflow: number;
  valuationNet: number;
  missingValuationTransactionCount: number;
}

export interface FinancialAccountExplorerRecord {
  accountId: number | null;
  accountName: string;
  nativeCurrency: string | null;
  nativeBalance: number | null;
  nativeInflow: number | null;
  nativeOutflow: number | null;
  nativeNet: number | null;
  valuationBalance: number | null;
  valuationInflow: number;
  valuationOutflow: number;
  valuationNet: number;
  missingCurrentValuationAccountCount: number;
  missingFlowValuationTransactionCount: number;
  balanceHistory: FinancialBalanceHistoryRecord[];
  engagements: FinancialExplorerEngagementRecord[];
}

export interface FinancialBudgetTargetRecord {
  id: number;
  currency: string;
  amount: number;
  engagementId: number | null;
  engagementName: string;
  actualAmount: number;
  variance: number;
}

export interface FinancialExpectedMovementRecord {
  id: number;
  dueDate: string;
  currency: string;
  amount: number;
  accountId: number | null;
  accountName: string;
  engagementId: number | null;
  engagementName: string;
  description: string | null;
  isMatched: boolean;
}

export interface ActiveBudgetPlanRecord {
  periodStart: string;
  periodEnd: string;
  sourceFileName: string;
  sourceFilePath: string;
  sourceChecksum: string;
  targets: FinancialBudgetTargetRecord[];
  expectedMovements: FinancialExpectedMovementRecord[];
}

export interface FinancialDashboardQueryResult {
  startDate: string | null;
  endDate: string;
  transactionCount: number;
  linkedTransactionCount: number;
  unresolvedTransactionCount: number;
  currencies: FinancialCurrencyRecord[];
  dailyFlow: FinancialDailyRecord[];
  engagements: FinancialEngagementRecord[];
  accounts: FinancialAccountRecord[];
  recentTransactions: FinancialTransactionRecord[];
  activeBudget: ActiveBudgetPlanRecord | null;
  valuation: FinancialValuationSummary;
  explorer: FinancialAccountExplorerRecord;
}

export interface FinancialValuationOptions {
  label: string;
  referenceUnit: string;
  selectedAccountId?: number | null;
}

export { queryFinancialDashboard } from '../examined-human-query.ts';
