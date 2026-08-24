import type { Database, SqlValue } from 'sql.js';

export interface ResolvedEntity {
  id: number;
  name: string;
}

export interface ResolvedTaxonomy {
  id: number;
  code: string;
}

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

export function lastInsertId(db: Database): number {
  return Number(queryRows(db, 'SELECT last_insert_rowid() AS id')[0]?.id);
}

export function requireIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date.`);
  }
}

export function addIsoDays(value: string, days: number): string {
  requireIsoDate(value, 'Date');
  const parsed = new Date(`${value}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function assertSchemaV5(db: Database): void {
  const version = Number(queryRows(db, 'PRAGMA user_version')[0]?.user_version ?? 0);
  if (version !== 5) throw new Error(`Native EH import requires schema v5; this database reports v${version}.`);
}

export function resolveTaxonomy(db: Database, table: string, value: string): ResolvedTaxonomy | null {
  if (!['session_types', 'engagement_types', 'engagement_statuses'].includes(table)) {
    throw new Error(`Unsupported taxonomy table: ${table}`);
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const row = queryRows(db, `
    SELECT id, code FROM ${table}
    WHERE code = ? COLLATE NOCASE AND is_active = 1
    LIMIT 1
  `, [normalized])[0];
  return row ? { id: Number(row.id), code: String(row.code) } : null;
}

export function taxonomyCodes(db: Database, table: string): string[] {
  if (!['session_types', 'engagement_types', 'engagement_statuses'].includes(table)) {
    throw new Error(`Unsupported taxonomy table: ${table}`);
  }
  return queryRows(db, `SELECT code FROM ${table} WHERE is_active = 1 ORDER BY sort_order, code`)
    .map((row) => String(row.code));
}

export function resolveEntity(
  db: Database,
  value: string,
  table: 'engagements' | 'exercises' | 'accounts',
): ResolvedEntity | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const aliases = {
    engagements: ['engagement_aliases', 'engagement_id'],
    exercises: ['exercise_aliases', 'exercise_id'],
    accounts: ['account_aliases', 'account_id'],
  } as const;
  const [aliasTable, foreignKey] = aliases[table];
  const result = queryRows(db, `
    SELECT DISTINCT entity.id, entity.name
    FROM ${table} AS entity
    LEFT JOIN ${aliasTable} AS alias ON alias.${foreignKey} = entity.id
    WHERE entity.name = ? COLLATE NOCASE OR alias.alias = ? COLLATE NOCASE
  `, [normalized, normalized]);
  if (result.length > 1) throw new Error(`Ambiguous ${table.slice(0, -1)}: ${normalized}`);
  return result[0] ? { id: Number(result[0].id), name: String(result[0].name) } : null;
}

export function ensureAlias(
  db: Database,
  table: 'engagements' | 'exercises' | 'accounts',
  entity: ResolvedEntity,
  aliasValue: string,
): boolean {
  const alias = aliasValue.trim();
  if (!alias) return false;
  const aliases = {
    engagements: ['engagement_aliases', 'engagement_id'],
    exercises: ['exercise_aliases', 'exercise_id'],
    accounts: ['account_aliases', 'account_id'],
  } as const;
  const [aliasTable, foreignKey] = aliases[table];
  const existing = queryRows(db, `
    SELECT alias.${foreignKey} AS entity_id, entity.name
    FROM ${aliasTable} AS alias
    JOIN ${table} AS entity ON entity.id = alias.${foreignKey}
    WHERE alias.alias = ? COLLATE NOCASE
  `, [alias])[0];
  if (existing) {
    if (Number(existing.entity_id) === entity.id) return false;
    throw new Error(`Alias '${alias}' already belongs to '${String(existing.name)}'; cannot assign it to '${entity.name}'.`);
  }
  db.run(`INSERT INTO ${aliasTable} (${foreignKey}, alias) VALUES (?, ?)`, [entity.id, alias]);
  return true;
}

export function parseAliases(value: string): string[] {
  return value.trim().replace(/^\[/, '').replace(/\]$/, '')
    .split(',').map((item) => item.trim()).filter(Boolean);
}

export function normalizedChecksumText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
