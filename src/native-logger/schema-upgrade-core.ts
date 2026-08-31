import type { Database, SqlValue } from 'sql.js';
import { assertSchemaV1 } from './database-utils.ts';
import { assertMealImportSchema } from './meal-import.ts';

export interface SchemaV1UpgradePreview {
  currentSchemaVersion: number;
  targetSchemaVersion: 1;
  migrationEntryCount: number;
}

function rows(db: Database, sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
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

export function previewSchemaV1Upgrade(db: Database): SchemaV1UpgradePreview {
  const currentSchemaVersion = Number(rows(db, 'PRAGMA user_version')[0]?.user_version ?? 0);
  const migrationEntryCount = Number(rows(db, 'SELECT COUNT(*) AS count FROM schema_migrations')[0]?.count ?? 0);
  if (currentSchemaVersion !== 5) {
    throw new Error(
      currentSchemaVersion === 1
        ? 'This database already uses official Data Schema v1.'
        : `This one-time upgrade supports only the retired pre-Schema-v1 database; this database reports v${currentSchemaVersion}.`,
    );
  }
  return { currentSchemaVersion, targetSchemaVersion: 1, migrationEntryCount };
}

export function applyV5ToOfficialSchemaV1(
  db: Database,
  upgradeSql: string,
): SchemaV1UpgradePreview {
  const preview = previewSchemaV1Upgrade(db);
  db.run(upgradeSql);
  assertSchemaV1(db);
  assertMealImportSchema(db);
  return preview;
}
