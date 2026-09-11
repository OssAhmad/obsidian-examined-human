import type { SqlValue } from 'sql.js';

export function nullableNumber(value: SqlValue | undefined): number | null {
  return value == null || value === '' ? null : Number(value);
}

export function nullableText(value: SqlValue | undefined): string | null {
  return value == null || String(value).trim() === '' ? null : String(value);
}
