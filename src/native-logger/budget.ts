import type { Database } from 'sql.js';
import {
  assertFinanceFoundationSchema,
  queryRows,
  requireIsoDate,
  resolveEntity,
  type ResolvedEntity,
} from './database-utils.ts';
import { normalizeValuationUnit } from './valuation-rates.ts';

export interface NativeBudgetFormInput {
  fileName: string;
  filePath: string;
  sourceText: string;
  sourceChecksum: string;
}

export interface ParsedBudgetTarget {
  ordinal: number;
  currency: string;
  amount: number;
  engagement: ResolvedEntity;
  engagementRaw: string;
}

export interface ParsedExpectedFinancialMovement {
  ordinal: number;
  dueDate: string;
  currency: string;
  amount: number;
  account: ResolvedEntity;
  engagement: ResolvedEntity;
  engagementRaw: string;
  description: string | null;
}

export interface ParsedBudgetForm {
  periodStart: string;
  periodEnd: string;
  targets: ParsedBudgetTarget[];
  expectedMovements: ParsedExpectedFinancialMovement[];
}

export interface BudgetImportResult {
  periodStart: string;
  periodEnd: string;
  targetCount: number;
  expectedMovementCount: number;
  updatedExistingBudget: boolean;
}

const BUDGET_FORM_HEADING = /^####\s+EH\s+Budget\s+Form\s*$/im;

export function hasBudgetForm(sourceText: string): boolean {
  return BUDGET_FORM_HEADING.test(sourceText);
}

function formBody(sourceText: string): string {
  const form = BUDGET_FORM_HEADING.exec(sourceText);
  if (!form || form.index == null) throw new Error('This note does not contain an EH Budget Form heading.');
  const after = sourceText.slice(form.index + form[0].length);
  const end = /^####\s+END\s*$/im.exec(after);
  if (!end) throw new Error('The EH Budget Form has no matching #### END marker.');
  return after.slice(0, end.index);
}

function labeledValue(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escaped}:\\s*(.*?)\\s*$`, 'im').exec(text);
  const value = match?.[1].trim();
  if (!value) throw new Error(`EH Budget Form requires '${label}: YYYY-MM-DD'.`);
  return value;
}

function sections(body: string): Map<string, string> {
  const headings = [...body.matchAll(/^#####(?!#)\s+(.+?)\s*$/gm)];
  const result = new Map<string, string>();
  headings.forEach((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index ?? body.length : body.length;
    result.set(heading[1].trim().toLowerCase(), body.slice(start, end));
  });
  return result;
}

function entries(section: string | undefined, label: string): string[] {
  if (!section) return [];
  const marker = /^ENTRIES:[ \t]*$/im.exec(section);
  if (!marker) throw new Error(`${label} has no ENTRIES marker.`);
  return section.slice(marker.index + marker[0].length).split(/\r?\n/)
    .map((line) => line.trim()).filter(Boolean);
}

function fields(line: string, expected: number, label: string): string[] {
  const parts = line.split('|').map((part) => part.trim());
  if (parts.length !== expected) throw new Error(`Invalid ${label} '${line}'; expected ${expected} pipe-separated fields.`);
  return parts;
}

function currency(value: string, label: string): string {
  const normalized = normalizeValuationUnit(value);
  if (!normalized || /[|\r\n]/.test(normalized)) throw new Error(`${label} currency is empty or invalid.`);
  return normalized;
}

function signedAmount(value: string, label: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) throw new Error(`${label} amount must be a non-zero number.`);
  return amount;
}

function daysInclusive(start: string, end: string): number {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  return Math.round((endTime - startTime) / 86_400_000) + 1;
}

function accountCurrency(db: Database, accountId: number): string | null {
  const row = queryRows(db, 'SELECT currency FROM accounts WHERE id = ?', [accountId])[0];
  const value = row?.currency == null ? '' : normalizeValuationUnit(String(row.currency));
  return value || null;
}

export function parseBudgetForm(db: Database, input: NativeBudgetFormInput): ParsedBudgetForm {
  assertFinanceFoundationSchema(db);
  const body = formBody(input.sourceText);
  const periodStart = labeledValue(body, 'period start');
  const periodEnd = labeledValue(body, 'period end');
  requireIsoDate(periodStart, 'Budget period start');
  requireIsoDate(periodEnd, 'Budget period end');
  if (daysInclusive(periodStart, periodEnd) < 4) throw new Error('Budget periods must contain at least four calendar days.');
  const sectionMap = sections(body);
  const targets = entries(sectionMap.get('budget targets'), 'Budget Targets').map((line, index) => {
    const [rawCurrency, rawAmount, rawEngagement] = fields(line, 3, 'Budget Target');
    const engagement = resolveEntity(db, rawEngagement, 'engagements');
    if (!engagement) throw new Error(`Unknown engagement in Budget Target #${index + 1}: '${rawEngagement}'.`);
    return {
      ordinal: index + 1,
      currency: currency(rawCurrency, `Budget Target #${index + 1}`),
      amount: signedAmount(rawAmount, `Budget Target #${index + 1}`),
      engagement,
      engagementRaw: rawEngagement,
    };
  });
  const expectedMovements = entries(sectionMap.get('expected movements'), 'Expected Movements').map((line, index) => {
    const [rawDate, rawCurrency, rawAmount, rawAccount, rawEngagement, rawDescription] = fields(line, 6, 'Expected Movement');
    requireIsoDate(rawDate, `Expected Movement #${index + 1} date`);
    const account = resolveEntity(db, rawAccount, 'accounts');
    if (!account) throw new Error(`Unknown account in Expected Movement #${index + 1}: '${rawAccount}'.`);
    const engagement = resolveEntity(db, rawEngagement, 'engagements');
    if (!engagement) throw new Error(`Unknown engagement in Expected Movement #${index + 1}: '${rawEngagement}'.`);
    const movementCurrency = currency(rawCurrency, `Expected Movement #${index + 1}`);
    const configuredCurrency = accountCurrency(db, account.id);
    if (configuredCurrency && configuredCurrency !== movementCurrency) {
      throw new Error(`Expected Movement #${index + 1} uses ${movementCurrency}, but ${account.name} is configured as ${configuredCurrency}.`);
    }
    if (rawDate < periodStart || rawDate > periodEnd) {
      throw new Error(`Expected Movement #${index + 1} date ${rawDate} is outside the budget period.`);
    }
    return {
      ordinal: index + 1,
      dueDate: rawDate,
      currency: movementCurrency,
      amount: signedAmount(rawAmount, `Expected Movement #${index + 1}`),
      account,
      engagement,
      engagementRaw: rawEngagement,
      description: rawDescription || null,
    };
  });
  return { periodStart, periodEnd, targets, expectedMovements };
}

export function inspectBudgetForm(db: Database, input: NativeBudgetFormInput): BudgetImportResult {
  const parsed = parseBudgetForm(db, input);
  assertBudgetDoesNotOverlap(db, parsed.periodStart, parsed.periodEnd);
  return {
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    targetCount: parsed.targets.length,
    expectedMovementCount: parsed.expectedMovements.length,
    updatedExistingBudget: queryRows(db, `
      SELECT 1 FROM budget_plans WHERE period_start = ? AND period_end = ? LIMIT 1
    `, [parsed.periodStart, parsed.periodEnd])[0] != null,
  };
}

function assertBudgetDoesNotOverlap(db: Database, periodStart: string, periodEnd: string): void {
  const conflict = queryRows(db, `
    SELECT period_start, period_end, source_file_path
    FROM budget_plans
    WHERE NOT (period_end < ? OR period_start > ?)
      AND NOT (period_start = ? AND period_end = ?)
    ORDER BY period_start
    LIMIT 1
  `, [periodStart, periodEnd, periodStart, periodEnd])[0];
  if (conflict) {
    throw new Error(
      `Budget period ${periodStart} to ${periodEnd} overlaps the existing budget `
      + `${String(conflict.period_start)} to ${String(conflict.period_end)} in ${String(conflict.source_file_path)}.`,
    );
  }
}

export function writeBudgetForm(db: Database, input: NativeBudgetFormInput): BudgetImportResult {
  const parsed = parseBudgetForm(db, input);
  assertBudgetDoesNotOverlap(db, parsed.periodStart, parsed.periodEnd);
  const existing = queryRows(db, `
    SELECT id FROM budget_plans WHERE period_start = ? AND period_end = ? LIMIT 1
  `, [parsed.periodStart, parsed.periodEnd])[0];
  const updatedExistingBudget = existing != null;
  const existingBudgetPlanId = updatedExistingBudget ? Number(existing.id) : null;
  if (existingBudgetPlanId != null) {
    db.run('DELETE FROM budget_targets WHERE budget_plan_id = ?', [existingBudgetPlanId]);
    db.run('DELETE FROM expected_financial_movements WHERE budget_plan_id = ?', [existingBudgetPlanId]);
    db.run(`UPDATE budget_plans
      SET source_file_name = ?, source_file_path = ?, source_checksum = ?, imported_at = CURRENT_TIMESTAMP
      WHERE id = ?`, [input.fileName, input.filePath, input.sourceChecksum, existingBudgetPlanId]);
  } else {
    db.run(`INSERT INTO budget_plans (
      period_start, period_end, source_file_name, source_file_path, source_checksum
    ) VALUES (?, ?, ?, ?, ?)`, [
      parsed.periodStart, parsed.periodEnd, input.fileName, input.filePath, input.sourceChecksum,
    ]);
  }
  const budgetPlanId = existingBudgetPlanId ?? Number(queryRows(db, 'SELECT last_insert_rowid() AS id')[0]?.id);
  for (const target of parsed.targets) {
    db.run(`INSERT INTO budget_targets (
      budget_plan_id, source_ordinal, currency, amount, engagement_id, engagement_raw
    ) VALUES (?, ?, ?, ?, ?, ?)`, [
      budgetPlanId, target.ordinal, target.currency, target.amount, target.engagement.id, target.engagementRaw,
    ]);
  }
  for (const movement of parsed.expectedMovements) {
    db.run(`INSERT INTO expected_financial_movements (
      budget_plan_id, source_ordinal, due_date, currency, amount, account_id,
      engagement_id, engagement_raw, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      budgetPlanId, movement.ordinal, movement.dueDate, movement.currency, movement.amount, movement.account.id,
      movement.engagement.id, movement.engagementRaw, movement.description,
    ]);
  }
  return {
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    targetCount: parsed.targets.length,
    expectedMovementCount: parsed.expectedMovements.length,
    updatedExistingBudget,
  };
}
