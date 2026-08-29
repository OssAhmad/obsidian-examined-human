import { App } from 'obsidian';
import type { Database } from 'sql.js';
import { normalizeVaultDatabasePath } from './database-path.ts';
import { hasUncheckpointedWal, UNCHECKPOINTED_WAL_MESSAGE } from './database-source.ts';
import type {
  DailyAssessmentQueryResult,
  DailyNoteIndexQueryResult,
  DatabaseInspection,
  EngagementDashboardQueryResult,
  ExerciseDashboardQueryResult,
  FinancialDashboardQueryResult,
  NutritionDashboardQueryResult,
  SessionQueryResult,
  WeeklyAssessmentQueryResult,
  WeeklyPlanIndexQueryResult,
} from './examined-human-query.ts';
import {
  inspectDatabase,
  queryDailyAssessment,
  queryDailyNoteIndex,
  queryEngagementDashboard,
  queryExerciseDashboard,
  queryFinancialDashboard,
  queryNutritionDashboard,
  querySessions,
  queryWeeklyAssessment,
  queryWeeklyPlanIndex,
} from './examined-human-query.ts';
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
  ): Promise<DailyAssessmentQueryResult> {
    return this.withDatabase(databasePath, (db) => queryDailyAssessment(db, date, todayDate));
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
  ): Promise<FinancialDashboardQueryResult> {
    return this.withDatabase(databasePath, (db) => queryFinancialDashboard(db, startDate, endDate));
  }

  async nutritionDashboard(
    databasePath: string,
    startDate: string | null,
    endDate: string,
  ): Promise<NutritionDashboardQueryResult> {
    return this.withDatabase(databasePath, (db) => queryNutritionDashboard(db, startDate, endDate));
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
