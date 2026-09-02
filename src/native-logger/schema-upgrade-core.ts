import type { Database, SqlValue } from 'sql.js';
import {
  assertFinanceFoundationSchema,
  assertSchemaV1,
  assertValuationHistorySchema,
  hasFinanceFoundationSchema,
  hasRetiredSingleBudgetSchema,
  hasValuationHistorySchema,
} from './database-utils.ts';
import { assertMealImportSchema } from './meal-import.ts';

export interface SchemaV1UpgradePreview {
  currentSchemaVersion: number;
  targetSchemaVersion: 1;
  migrationEntryCount: number;
  needsFoodDictionary: boolean;
  needsFinanceFoundation: boolean;
  needsValuationHistory: boolean;
  needsMutableBudgets: boolean;
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
  if (currentSchemaVersion === 5) {
    return {
      currentSchemaVersion,
      targetSchemaVersion: 1,
      migrationEntryCount,
      needsFoodDictionary: true,
      needsFinanceFoundation: true,
      needsValuationHistory: true,
      needsMutableBudgets: true,
    };
  }
  if (currentSchemaVersion === 1 && (!hasFinanceFoundationSchema(db) || !hasValuationHistorySchema(db))) {
    return {
      currentSchemaVersion,
      targetSchemaVersion: 1,
      migrationEntryCount,
      needsFoodDictionary: false,
      needsFinanceFoundation: !hasFinanceFoundationSchema(db) && !hasRetiredSingleBudgetSchema(db),
      needsValuationHistory: !hasValuationHistorySchema(db),
      needsMutableBudgets: !hasFinanceFoundationSchema(db),
    };
  }
  {
    throw new Error(
      currentSchemaVersion === 1
        ? 'This database already includes the current official Data Schema v1 finance, valuation, and mutable budget foundations.'
        : `This one-time upgrade supports only the retired pre-Schema-v1 database; this database reports v${currentSchemaVersion}.`,
    );
  }
}

export function applyV5ToOfficialSchemaV1(
  db: Database,
  foodUpgradeSql: string,
  financeUpgradeSql: string,
  valuationUpgradeSql: string,
  mutableBudgetUpgradeSql: string,
): SchemaV1UpgradePreview {
  const preview = previewSchemaV1Upgrade(db);
  if (preview.needsFoodDictionary) db.run(foodUpgradeSql);
  if (preview.needsFinanceFoundation) db.run(financeUpgradeSql);
  if (preview.needsValuationHistory) db.run(valuationUpgradeSql);
  if (preview.needsMutableBudgets) db.run(mutableBudgetUpgradeSql);
  assertSchemaV1(db);
  assertMealImportSchema(db);
  assertFinanceFoundationSchema(db);
  assertValuationHistorySchema(db);
  return preview;
}
