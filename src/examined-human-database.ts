import { App } from 'obsidian';
import type { Database } from 'sql.js';
import { normalizeVaultDatabasePath } from './database-path.ts';
import { hasUncheckpointedWal, UNCHECKPOINTED_WAL_MESSAGE } from './database-source.ts';
import type {
  CommandCatalog,
  FoodLibraryRecord,
} from './read-models/command-catalog.ts';
import { queryCommandCatalog, queryFoodLibrary } from './read-models/command-catalog.ts';
import type { SessionQueryResult } from './read-models/calendar.ts';
import { querySessions } from './read-models/calendar.ts';
import type { DailyAssessmentQueryResult, DailyNoteIndexQueryResult } from './read-models/daily.ts';
import { queryDailyAssessment, queryDailyNoteIndex } from './read-models/daily.ts';
import type { DatabaseInspection } from './read-models/database-inspection.ts';
import { inspectDatabase } from './read-models/database-inspection.ts';
import type { EngagementDashboardQueryResult } from './read-models/engagement.ts';
import { queryEngagementDashboard } from './read-models/engagement.ts';
import type { ExerciseDashboardQueryResult } from './read-models/exercise.ts';
import { queryExerciseDashboard } from './read-models/exercise.ts';
import type { FinancialDashboardQueryResult, FinancialValuationOptions } from './read-models/finance.ts';
import { queryFinancialDashboard } from './read-models/finance.ts';
import type { NutritionDashboardQueryResult } from './read-models/nutrition.ts';
import { queryNutritionDashboard } from './read-models/nutrition.ts';
import type { WeeklyAssessmentQueryResult, WeeklyPlanIndexQueryResult } from './read-models/weekly.ts';
import {
  queryWeeklyAssessment,
  queryWeeklyPlanIndex,
} from './read-models/weekly.ts';
import { getSqlJs } from './sql-runtime.ts';

export class ExaminedHumanDatabase {
  constructor(private app: App) {}

  normalizeVaultPath(databasePath: string): string {
    return normalizeVaultDatabasePath(databasePath);
  }

  async inspect(databasePath: string): Promise<DatabaseInspection> {
    return this.withDatabase(databasePath, inspectDatabase);
  }

  async sessionsBetween(
    databasePath: string,
    startDate: string,
    endDate: string,
    todayDate: string,
    includePlanning = true,
  ): Promise<SessionQueryResult> {
    return this.withDatabase(
      databasePath,
      (db) => querySessions(db, startDate, endDate, todayDate, includePlanning),
    );
  }

  async weeklyAssessment(databasePath: string, requestedDate: string): Promise<WeeklyAssessmentQueryResult | null> {
    return this.withDatabase(databasePath, (db) => queryWeeklyAssessment(db, requestedDate));
  }

  async weeklyPlanIndex(databasePath: string): Promise<WeeklyPlanIndexQueryResult> {
    return this.withDatabase(databasePath, queryWeeklyPlanIndex);
  }

  async dailyNoteIndex(databasePath: string): Promise<DailyNoteIndexQueryResult> {
    return this.withDatabase(databasePath, queryDailyNoteIndex);
  }

  async dailyAssessment(
    databasePath: string,
    date: string,
    todayDate: string,
    valuationOptions: FinancialValuationOptions = { label: 'EHM', referenceUnit: 'USD' },
  ): Promise<DailyAssessmentQueryResult> {
    return this.withDatabase(databasePath, (db) => queryDailyAssessment(db, date, todayDate, valuationOptions));
  }

  async engagementDashboard(
    databasePath: string,
    engagementId: number | null,
    startDate: string | null,
    endDate: string,
  ): Promise<EngagementDashboardQueryResult> {
    return this.withDatabase(
      databasePath,
      (db) => queryEngagementDashboard(db, engagementId, startDate, endDate),
    );
  }

  async financialDashboard(
    databasePath: string,
    startDate: string | null,
    endDate: string,
    valuationOptions: FinancialValuationOptions,
  ): Promise<FinancialDashboardQueryResult> {
    return this.withDatabase(databasePath, (db) => queryFinancialDashboard(db, startDate, endDate, valuationOptions));
  }

  async nutritionDashboard(
    databasePath: string,
    startDate: string | null,
    endDate: string,
  ): Promise<NutritionDashboardQueryResult> {
    return this.withDatabase(databasePath, (db) => queryNutritionDashboard(db, startDate, endDate));
  }

  async foodLibrary(databasePath: string): Promise<FoodLibraryRecord[]> {
    return this.withDatabase(databasePath, queryFoodLibrary);
  }

  async commandCatalog(databasePath: string): Promise<CommandCatalog> {
    return this.withDatabase(databasePath, queryCommandCatalog);
  }

  async exerciseDashboard(
    databasePath: string,
    startDate: string | null,
    endDate: string,
  ): Promise<ExerciseDashboardQueryResult> {
    return this.withDatabase(databasePath, (db) => queryExerciseDashboard(db, startDate, endDate));
  }

  async fingerprint(databasePath: string): Promise<string> {
    const normalizedPath = this.normalizeVaultPath(databasePath);
    const [stats, walStats] = await Promise.all([
      this.app.vault.adapter.stat(normalizedPath),
      this.app.vault.adapter.stat(`${normalizedPath}-wal`),
    ]);
    if (!stats) return 'missing';
    const walFingerprint = walStats ? `${walStats.size}:${walStats.mtime}` : 'none';
    return `${stats.size}:${stats.mtime}:wal:${walFingerprint}`;
  }

  private async readBytes(databasePath: string): Promise<Uint8Array> {
    const normalizedPath = this.normalizeVaultPath(databasePath);
    const walStats = await this.app.vault.adapter.stat(`${normalizedPath}-wal`);
    if (hasUncheckpointedWal(walStats?.size)) throw new Error(UNCHECKPOINTED_WAL_MESSAGE);
    return new Uint8Array(await this.app.vault.adapter.readBinary(normalizedPath));
  }

  private async withDatabase<T>(databasePath: string, operation: (db: Database) => T): Promise<T> {
    const SQL = await getSqlJs();
    const bytes = await this.readBytes(databasePath);
    const db = new SQL.Database(bytes);
    try {
      db.run('PRAGMA query_only = ON');
      return operation(db);
    } finally {
      db.close();
    }
  }
}
