import type { Database } from 'sql.js';
import upgradeV5ToSchemaV1Sql from '../../migrations/001_upgrade_v5_to_schema_v1.sql';
import financeFoundationSql from '../../migrations/002_add_finance_foundation_schema_v1.sql';
import valuationHistorySql from '../../migrations/003_add_valuation_history_schema_v1.sql';
import mutableBudgetSql from '../../migrations/004_make_budget_plans_mutable_schema_v1.sql';
import {
  applyV5ToOfficialSchemaV1,
  previewSchemaV1Upgrade,
  type SchemaV1UpgradePreview,
} from './schema-upgrade-core.ts';

export { previewSchemaV1Upgrade, type SchemaV1UpgradePreview };

export function upgradeV5ToOfficialSchemaV1(db: Database): SchemaV1UpgradePreview {
  return applyV5ToOfficialSchemaV1(db, upgradeV5ToSchemaV1Sql, financeFoundationSql, valuationHistorySql, mutableBudgetSql);
}
