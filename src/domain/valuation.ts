export function normalizeValuationUnit(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase();
}
