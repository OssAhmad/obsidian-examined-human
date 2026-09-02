import type { Database, SqlValue } from 'sql.js';
import { assertValuationHistorySchema, lastInsertId, queryRows } from './database-utils.ts';

export interface ParsedValuationRate {
  ordinal: number;
  unitKey: string;
  unitLabel: string;
  value: number;
}

export interface ValuationRateSource {
  noteDate: string;
  fileName: string;
  filePath: string;
  sourceChecksum: string;
}

export function normalizeValuationUnit(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase();
}

export function parseValuationRateEntries(lines: string[], errors: string[]): ParsedValuationRate[] {
  const units = new Set<string>();
  return lines.map((line, index) => {
    const ordinal = index + 1;
    const parts = line.split('|').map((part) => part.trim());
    if (parts.length !== 2) {
      errors.push(`Invalid Valuation Rate #${ordinal} '${line}'; expected unit | positive value.`);
    }
    const unitLabel = parts[0] ?? '';
    const unitKey = normalizeValuationUnit(unitLabel);
    if (!unitKey || /[|\r\n]/.test(unitLabel)) errors.push(`Valuation Rate #${ordinal} unit is empty or invalid.`);
    if (units.has(unitKey)) errors.push(`Valuation Rates duplicate unit '${unitLabel}'. Use only one normalized unit per date.`);
    units.add(unitKey);
    const value = Number(parts[1]);
    if (!Number.isFinite(value) || value <= 0) errors.push(`Valuation Rate #${ordinal} value must be a positive number.`);
    return { ordinal, unitKey, unitLabel: unitLabel.trim().replace(/\s+/g, ' '), value };
  });
}

export function writeHistoricalValuationRates(
  db: Database,
  source: ValuationRateSource,
  rates: ParsedValuationRate[],
): number {
  if (rates.length === 0) return 0;
  assertValuationHistorySchema(db);
  if (queryRows(db, 'SELECT 1 FROM valuation_rate_sets WHERE rate_date = ? LIMIT 1', [source.noteDate]).length > 0) {
    throw new Error(`Valuation Rates for ${source.noteDate} are already finalized and cannot be replaced.`);
  }
  db.run(`INSERT INTO valuation_rate_sets (
    rate_date, source_file_name, source_file_path, source_checksum
  ) VALUES (?, ?, ?, ?)`, [source.noteDate, source.fileName, source.filePath, source.sourceChecksum] as SqlValue[]);
  const rateSetId = lastInsertId(db);
  for (const rate of rates) {
    db.run(`INSERT INTO valuation_rates (
      rate_set_id, source_ordinal, unit_key, unit_label, value
    ) VALUES (?, ?, ?, ?, ?)`, [rateSetId, rate.ordinal, rate.unitKey, rate.unitLabel, rate.value] as SqlValue[]);
  }
  return rates.length;
}
