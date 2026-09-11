import type { Database, SqlValue } from 'sql.js';

export type SchemaContract = Record<string, string[]>;

export function queryRows(
  db: Database,
  sql: string,
  params: SqlValue[] = [],
): Record<string, SqlValue>[] {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const result: Record<string, SqlValue>[] = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally {
    statement.free();
  }
}

export function queryScalar(db: Database, sql: string): SqlValue | undefined {
  const result = queryRows(db, sql);
  return result.length === 0 ? undefined : Object.values(result[0])[0];
}

export function tableColumns(db: Database, table: string): Set<string> {
  return new Set(queryRows(db, `PRAGMA table_info("${table}")`).map((row) => String(row.name)));
}

export function hasTableColumns(db: Database, table: string, required: string[]): boolean {
  const existing = tableColumns(db, table);
  return required.every((column) => existing.has(column));
}

export function validateSchemaContract(
  db: Database,
  contract: SchemaContract,
  messages: {
    missingSource: (table: string) => string;
    missingColumns: (table: string, columns: string[]) => string;
  },
): void {
  for (const [table, required] of Object.entries(contract)) {
    const existing = tableColumns(db, table);
    if (existing.size === 0) throw new Error(messages.missingSource(table));
    const missing = required.filter((column) => !existing.has(column));
    if (missing.length > 0) throw new Error(messages.missingColumns(table, missing));
  }
}
