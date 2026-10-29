import type { Database, SqlValue } from 'sql.js';
import {
  assertFinanceFoundationSchema,
  assertOptionalSessionTypeSchema,
  assertSchemaV1,
  assertValuationHistorySchema,
  hasFinanceFoundationSchema,
  hasOptionalSessionTypeSchema,
  hasRetiredSingleBudgetSchema,
  hasValuationHistorySchema,
} from './database-utils.ts';
import { assertMealImportSchema } from './meal-import.ts';
import { assertMedicalSchema, hasMedicalFoundation, hasMedicalSchema } from '../read-models/medical.ts';
import { hasTableColumns } from '../read-models/sql.ts';

export interface SchemaV1UpgradePreview {
  currentSchemaVersion: number;
  targetSchemaVersion: 1;
  migrationEntryCount: number;
  needsFoodDictionary: boolean;
  needsFinanceFoundation: boolean;
  needsValuationHistory: boolean;
  needsMutableBudgets: boolean;
  needsOptionalSessionTypes: boolean;
  needsMedicalFoundation: boolean;
  needsSingleOwnerMedical: boolean;
  needed: boolean;
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
  const medical = {
    needsMedicalFoundation: !hasMedicalFoundation(db),
    needsSingleOwnerMedical: hasTableColumns(db, 'reports', ['person_id']),
  };
  if (currentSchemaVersion === 5) {
    return {
      currentSchemaVersion,
      targetSchemaVersion: 1,
      migrationEntryCount,
      needsFoodDictionary: true,
      needsFinanceFoundation: true,
      needsValuationHistory: true,
      needsMutableBudgets: true,
      needsOptionalSessionTypes: true,
      ...medical,
      needed: true,
    };
  }
  if (currentSchemaVersion === 1) {
    return {
      currentSchemaVersion,
      targetSchemaVersion: 1,
      migrationEntryCount,
      needsFoodDictionary: false,
      needsFinanceFoundation: !hasFinanceFoundationSchema(db) && !hasRetiredSingleBudgetSchema(db),
      needsValuationHistory: !hasValuationHistorySchema(db),
      needsMutableBudgets: !hasFinanceFoundationSchema(db),
      needsOptionalSessionTypes: !hasOptionalSessionTypeSchema(db),
      ...medical,
      needed: !hasFinanceFoundationSchema(db) || !hasValuationHistorySchema(db)
        || !hasOptionalSessionTypeSchema(db) || !hasMedicalSchema(db),
    };
  }
  {
    throw new Error(
      `This update supports official Schema v1 and the retired v5 database; this database reports v${currentSchemaVersion}.`,
    );
  }
}

export function applyV5ToOfficialSchemaV1(
  db: Database,
  foodUpgradeSql: string,
  financeUpgradeSql: string,
  valuationUpgradeSql: string,
  mutableBudgetUpgradeSql: string,
  optionalSessionTypeUpgradeSql: string,
  medicalUpgradeSql: string,
  singleOwnerSql: string,
): SchemaV1UpgradePreview {
  const preview = previewSchemaV1Upgrade(db);
  if (preview.needsFoodDictionary) db.run(foodUpgradeSql);
  if (preview.needsFinanceFoundation) db.run(financeUpgradeSql);
  if (preview.needsValuationHistory) db.run(valuationUpgradeSql);
  if (preview.needsMutableBudgets) db.run(mutableBudgetUpgradeSql);
  if (preview.needsOptionalSessionTypes) db.run(optionalSessionTypeUpgradeSql);
  if (preview.needsMedicalFoundation) db.run(medicalUpgradeSql);
  if (preview.needsSingleOwnerMedical) {
    const known = new Set(['id', 'person_id', 'report_timestamp', 'report_type', 'provider', 'title', 'relative_path']);
    if (rows(db, 'PRAGMA table_info(reports)').some(column => !known.has(String(column.name)))) {
      throw new Error('The reports table contains additional columns. Update was stopped to preserve them.');
    }
    const objects = rows(db, "SELECT sql FROM sqlite_master WHERE tbl_name='reports' AND type IN ('index','trigger') AND sql IS NOT NULL AND name<>'idx_reports_timestamp'");
    const sequence = Number(rows(db, "SELECT seq FROM sqlite_sequence WHERE name='reports'")[0]?.seq ?? 0);
    db.run(singleOwnerSql);
    for (const object of objects) db.run(String(object.sql));
    db.run("UPDATE sqlite_sequence SET seq=MAX(seq, ?) WHERE name='reports'", [sequence]);
  }
  assertSchemaV1(db);
  assertMealImportSchema(db);
  assertFinanceFoundationSchema(db);
  assertValuationHistorySchema(db);
  assertOptionalSessionTypeSchema(db);
  assertMedicalSchema(db);
  return preview;
}
