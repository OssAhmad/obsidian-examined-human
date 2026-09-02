import { App, normalizePath, TFile, TFolder } from 'obsidian';
import type { Database, SqlValue } from 'sql.js';
import { normalizeVaultDatabasePath } from '../database-path.ts';
import { hasUncheckpointedWal, UNCHECKPOINTED_WAL_MESSAGE } from '../database-source.ts';
import { getSqlJs } from '../sql-runtime.ts';
import createSchemaV1Sql from '../../migrations/000_create_schema_v1.sql';
import { arrayBufferFrom, sha256Bytes, sha256Text } from './checksum.ts';
import {
  type MealImportInput,
  type MealImportResult,
  assertMealImportSchema,
  writeMealInspection,
} from './meal-import.ts';
import { inspectMeals, type MealInspection, type NutritionThresholds } from './meals.ts';
import {
  inspectDailyNote,
  reconcileImportedMilestones,
  writeHistoricalDailyNote,
  type MilestoneReconciliationResult,
  type NativeDailyImportResult,
  type NativeDailyInspection,
  type NativeDailyNoteInput,
} from './daily-note.ts';
import {
  syncPlanningNotes,
  type NativePlanningNote,
  type PlanningSyncResult,
} from './planning.ts';
import {
  inspectWeeklyPlan,
  prepareWeeklyDailyNoteWrites,
  writeWeeklyPlan,
  type DailyNoteWriteInput,
  type NativeWeeklyNoteInput,
  type WeeklyImportResult,
  type WeeklyNoteWritePreview,
} from './weekly.ts';
import {
  backupDirectoryForDatabase,
  ensureStorageFolder,
  pluginBackupRetentionPlan,
  type StorageEntryType,
} from './backup-storage.ts';
import {
  shouldCreateDatabaseBackup,
  type DatabaseMutationDurability,
} from './mutation-policy.ts';
import {
  prepareAdminEventStage,
  type AdminEventStagePreview,
} from './admin-event-stage.ts';
import {
  previewSchemaV1Upgrade,
  upgradeV5ToOfficialSchemaV1,
  type SchemaV1UpgradePreview,
} from './schema-upgrade.ts';
import {
  inspectBudgetForm,
  writeBudgetForm,
  type BudgetImportResult,
  type NativeBudgetFormInput,
} from './budget.ts';
import {
  prepareFinanceEntryStage,
  type FinanceEntryStageInput,
  type FinanceEntryStagePreview,
} from './finance-entry-stage.ts';
import {
  prepareValuationRateStage,
  type ValuationRateStageInput,
  type ValuationRateStagePreview,
} from './valuation-rate-stage.ts';

export interface BackupMutationMetadata {
  backupPath: string | null;
  backupsPruned: number;
  backupRetentionWarning: string | null;
}

export function backupMutationOutput(metadata: BackupMutationMetadata): string[] {
  const lines = [metadata.backupPath
    ? `Backup: ${metadata.backupPath}`
    : 'Backup: not created for this ephemeral-only write.'];
  if (metadata.backupsPruned > 0) {
    lines.push(`Backup retention: removed ${metadata.backupsPruned} older plugin backup${metadata.backupsPruned === 1 ? '' : 's'}.`);
  }
  if (metadata.backupRetentionWarning) lines.push(`Backup retention warning: ${metadata.backupRetentionWarning}`);
  return lines;
}

export interface NativeMealImportRequest extends Omit<MealImportInput, 'sourceChecksum' | 'pluginVersion'> {
  databasePath: string;
  sourceText: string;
}

export interface NativeMealImportResult extends MealImportResult, BackupMutationMetadata {
  databasePath: string;
  sourceChecksum: string;
}

export interface NativeMealInspectionRequest {
  databasePath: string;
  sourceText: string;
  nutritionThresholds: NutritionThresholds;
}

export interface CreatedDatabaseResult {
  databasePath: string;
  byteLength: number;
  schemaVersion: 1;
}

export interface SchemaV1UpgradeResult extends SchemaV1UpgradePreview, BackupMutationMetadata {
  databasePath: string;
}

export interface NativeBudgetRequest extends Omit<NativeBudgetFormInput, 'sourceChecksum'> {
  databasePath: string;
}

export interface NativeBudgetWriteResult extends BudgetImportResult, BackupMutationMetadata {
  databasePath: string;
  sourceChecksum: string;
}

export interface NativeDailyRequest extends Omit<NativeDailyNoteInput, 'sourceChecksum' | 'pluginVersion'> {
  databasePath: string;
}

export interface NativeDailyWriteResult extends NativeDailyImportResult, BackupMutationMetadata {
  databasePath: string;
  sourceChecksum: string;
}

export type NativePlanningNoteRequest = Omit<NativePlanningNote, 'sourceChecksum'>;

export interface NativePlanningRequest {
  databasePath: string;
  cutoffDate: string;
  notes: NativePlanningNoteRequest[];
}

export interface NativeWeeklyRequest extends Omit<NativeWeeklyNoteInput, 'sourceChecksum'> {
  databasePath: string;
}

export interface NativeWeeklyWriteResult extends WeeklyImportResult, BackupMutationMetadata {
  databasePath: string;
  sourceChecksum: string;
}

export interface WeeklyDailyNoteWriteRequest {
  databasePath: string;
  selector: string;
  todayDate: string;
  notes: Array<Omit<DailyNoteWriteInput, 'sourceChecksum'>>;
}

export interface AdminEventStageRequest {
  noteDate: string;
  fileName: string;
  filePath: string;
  sourceText: string;
  command?: string;
  commands?: string[];
}

export type FinanceEntryStageRequest = FinanceEntryStageInput;
export type ValuationRateStageRequest = ValuationRateStageInput;

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

function verifyIntegrity(db: Database): void {
  const quickCheck = String(rows(db, 'PRAGMA quick_check')[0]?.quick_check ?? 'missing result');
  if (quickCheck !== 'ok') throw new Error(`SQLite quick_check failed: ${quickCheck}`);
  const violations = rows(db, 'PRAGMA foreign_key_check');
  if (violations.length > 0) {
    throw new Error(`SQLite foreign_key_check reported ${violations.length} violation(s).`);
  }
}

function backupTimestamp(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, '');
}

export class NativeLoggerWriteService {
  private writeQueue: Promise<void> = Promise.resolve();
  private activeWrites = 0;

  constructor(
    private app: App,
    private pluginVersion: string,
    private backupRetentionLimit: () => number = () => 0,
  ) {}

  get isRunning(): boolean {
    return this.activeWrites > 0;
  }

  createDatabase(databasePathSetting: string): Promise<CreatedDatabaseResult> {
    return this.enqueue(async () => {
      const databasePath = normalizeVaultDatabasePath(databasePathSetting);
      if (!databasePath.toLowerCase().endsWith('.db')) {
        throw new Error('The database path must end in .db.');
      }
      if (this.app.vault.getAbstractFileByPath(databasePath)) {
        throw new Error(`Refusing to overwrite an existing vault file: ${databasePath}`);
      }
      const slash = databasePath.lastIndexOf('/');
      if (slash >= 0) await this.ensureFolder(databasePath.slice(0, slash));

      const SQL = await getSqlJs();
      const db = new SQL.Database();
      let bytes: Uint8Array;
      try {
        db.run(createSchemaV1Sql);
        db.run('PRAGMA foreign_keys = ON');
        assertMealImportSchema(db);
        verifyIntegrity(db);
        bytes = db.export();
      } finally {
        db.close();
      }

      const file = await this.app.vault.createBinary(databasePath, arrayBufferFrom(bytes));
      try {
        await this.verifyWrittenDatabase(file, bytes);
      } catch (error) {
        await this.app.fileManager.trashFile(file);
        throw new Error(
          `The new database failed verification and was removed. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return { databasePath, byteLength: bytes.byteLength, schemaVersion: 1 };
    });
  }

  inspectSchemaV1Upgrade(databasePathSetting: string): Promise<SchemaV1UpgradePreview> {
    return this.inspectDatabase(databasePathSetting, previewSchemaV1Upgrade);
  }

  upgradeToOfficialSchemaV1(databasePathSetting: string): Promise<SchemaV1UpgradeResult> {
    return this.enqueue(async () => {
      const mutation = await this.mutateDatabase(
        databasePathSetting,
        'schema-v1-upgrade',
        upgradeV5ToOfficialSchemaV1,
      );
      return {
        ...mutation.value,
        databasePath: mutation.databasePath,
        backupPath: mutation.backupPath,
        backupsPruned: mutation.backupsPruned,
        backupRetentionWarning: mutation.backupRetentionWarning,
      };
    });
  }

  async inspectBudget(request: NativeBudgetRequest): Promise<BudgetImportResult> {
    const input = await this.budgetInput(request);
    return this.inspectDatabase(request.databasePath, (db) => inspectBudgetForm(db, input));
  }

  importBudget(request: NativeBudgetRequest): Promise<NativeBudgetWriteResult> {
    return this.enqueue(async () => {
      const input = await this.budgetInput(request);
      const mutation = await this.mutateDatabase(
        request.databasePath,
        'budget-plan',
        (db) => writeBudgetForm(db, input),
      );
      return {
        ...mutation.value,
        databasePath: mutation.databasePath,
        sourceChecksum: input.sourceChecksum,
        backupPath: mutation.backupPath,
        backupsPruned: mutation.backupsPruned,
        backupRetentionWarning: mutation.backupRetentionWarning,
      };
    });
  }

  importMeals(request: NativeMealImportRequest): Promise<NativeMealImportResult> {
    return this.enqueue(async () => {
      const databasePath = normalizeVaultDatabasePath(request.databasePath);
      const databaseFile = this.requireFile(databasePath, 'Examined Human database');
      await this.assertNoUncheckpointedWal(databasePath);
      const originalBytes = new Uint8Array(await this.app.vault.readBinary(databaseFile));
      const originalChecksum = await sha256Bytes(originalBytes);
      const sourceChecksum = await sha256Text(request.sourceText);
      const SQL = await getSqlJs();
      const db = new SQL.Database(originalBytes);
      let result: MealImportResult;
      try {
        db.run('PRAGMA foreign_keys = ON');
        db.run('BEGIN IMMEDIATE');
        try {
          result = writeMealInspection(db, {
            ...request,
            sourceChecksum,
            pluginVersion: this.pluginVersion,
          });
          verifyIntegrity(db);
          db.run('COMMIT');
        } catch (error) {
          try {
            db.run('ROLLBACK');
          } catch {
            // Preserve the original transaction error.
          }
          throw error;
        }
        verifyIntegrity(db);
        const stagedBytes = db.export();
        await this.assertNoUncheckpointedWal(databasePath);
        const currentBytes = new Uint8Array(await this.app.vault.readBinary(databaseFile));
        const currentChecksum = await sha256Bytes(currentBytes);
        if (currentChecksum !== originalChecksum) {
          throw new Error('EH.db changed during validation. Refresh and retry; no data was written.');
        }

        const durability: DatabaseMutationDurability = result.lifecycleState === 'ephemeral'
          ? 'ephemeral'
          : 'durable';
        const backupPath = shouldCreateDatabaseBackup(durability)
          ? await this.createBackup(databasePath, originalBytes)
          : null;
        await this.app.vault.modifyBinary(databaseFile, arrayBufferFrom(stagedBytes));
        try {
          await this.verifyWrittenDatabase(databaseFile, stagedBytes);
        } catch (error) {
          await this.app.vault.modifyBinary(databaseFile, arrayBufferFrom(originalBytes));
          throw new Error(
            `The staged database failed post-write verification and the original was restored. ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const retention = backupPath
          ? await this.pruneBackups(databasePath, backupPath)
          : { backupsPruned: 0, backupRetentionWarning: null };
        return {
          ...result,
          backupPath,
          ...retention,
          databasePath,
          sourceChecksum,
        };
      } finally {
        db.close();
      }
    });
  }

  inspectMeals(request: NativeMealInspectionRequest): Promise<MealInspection> {
    return this.inspectDatabase(
      request.databasePath,
      (db) => inspectMeals(db, request.sourceText, request.nutritionThresholds),
    );
  }

  async inspectDaily(request: NativeDailyRequest): Promise<NativeDailyInspection> {
    const input = await this.dailyInput(request);
    return this.inspectDatabase(request.databasePath, (db) => inspectDailyNote(db, input));
  }

  importHistoricalDaily(request: NativeDailyRequest): Promise<NativeDailyWriteResult> {
    return this.enqueue(async () => {
      const input = await this.dailyInput(request);
      const mutation = await this.mutateDatabase(
        request.databasePath,
        'daily-import',
        (db) => writeHistoricalDailyNote(db, input),
      );
      return {
        ...mutation.value,
        backupPath: mutation.backupPath,
        backupsPruned: mutation.backupsPruned,
        backupRetentionWarning: mutation.backupRetentionWarning,
        databasePath: mutation.databasePath,
        sourceChecksum: input.sourceChecksum,
      };
    });
  }

  reconcileMilestones(
    request: NativeDailyRequest,
  ): Promise<MilestoneReconciliationResult & BackupMutationMetadata> {
    return this.enqueue(async () => {
      const input = await this.dailyInput(request);
      const mutation = await this.mutateDatabase(
        request.databasePath,
        'milestones',
        (db) => reconcileImportedMilestones(db, input),
      );
      return {
        ...mutation.value,
        backupPath: mutation.backupPath,
        backupsPruned: mutation.backupsPruned,
        backupRetentionWarning: mutation.backupRetentionWarning,
      };
    });
  }

  async previewPlanning(request: NativePlanningRequest): Promise<PlanningSyncResult> {
    const notes = await this.planningInputs(request.notes);
    return this.inspectDatabase(
      request.databasePath,
      (db) => syncPlanningNotes(db, notes, request.cutoffDate),
    );
  }

  syncPlanning(request: NativePlanningRequest): Promise<PlanningSyncResult & BackupMutationMetadata> {
    return this.enqueue(async () => {
      const notes = await this.planningInputs(request.notes);
      const mutation = await this.mutateDatabase(
        request.databasePath,
        'planning-sync',
        (db) => syncPlanningNotes(db, notes, request.cutoffDate),
        'ephemeral',
      );
      return {
        ...mutation.value,
        backupPath: mutation.backupPath,
        backupsPruned: mutation.backupsPruned,
        backupRetentionWarning: mutation.backupRetentionWarning,
      };
    });
  }

  async inspectWeekly(request: NativeWeeklyRequest): Promise<WeeklyImportResult> {
    const input = await this.weeklyInput(request);
    return this.inspectDatabase(request.databasePath, (db) => inspectWeeklyPlan(db, input));
  }

  importWeekly(request: NativeWeeklyRequest): Promise<NativeWeeklyWriteResult> {
    return this.enqueue(async () => {
      const input = await this.weeklyInput(request);
      const mutation = await this.mutateDatabase(
        request.databasePath,
        'weekly-import',
        (db) => writeWeeklyPlan(db, input),
      );
      return {
        ...mutation.value,
        backupPath: mutation.backupPath,
        backupsPruned: mutation.backupsPruned,
        backupRetentionWarning: mutation.backupRetentionWarning,
        databasePath: mutation.databasePath,
        sourceChecksum: input.sourceChecksum,
      };
    });
  }

  async previewWeeklyDailyNoteWrites(
    request: WeeklyDailyNoteWriteRequest,
  ): Promise<WeeklyNoteWritePreview> {
    const notes = await this.dailyWriteInputs(request.notes);
    return this.inspectDatabase(
      request.databasePath,
      (db) => prepareWeeklyDailyNoteWrites(db, request.selector, request.todayDate, notes),
    );
  }

  writeWeeklyDailyNotes(request: WeeklyDailyNoteWriteRequest): Promise<WeeklyNoteWritePreview> {
    return this.enqueue(async () => {
      const preview = await this.previewWeeklyDailyNoteWrites(request);
      const writable = preview.notes.filter((note) => note.updatedText != null);
      const originals = new Map<string, string>();
      for (const note of writable) {
        const file = this.requireFile(note.filePath, 'Daily Note');
        const current = await this.app.vault.read(file);
        if (await sha256Text(current) !== note.sourceChecksum) {
          throw new Error(`${note.fileName} changed during preview. Refresh and retry; no notes were written.`);
        }
        originals.set(note.filePath, current);
      }
      const modified: TFile[] = [];
      try {
        for (const note of writable) {
          const file = this.requireFile(note.filePath, 'Daily Note');
          await this.app.vault.modify(file, note.updatedText!);
          modified.push(file);
        }
      } catch (error) {
        for (const file of modified.reverse()) {
          const original = originals.get(file.path);
          if (original != null) await this.app.vault.modify(file, original);
        }
        throw new Error(
          `Weekly-plan note write failed; modified notes were restored. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return preview;
    });
  }

  async previewAdminEventStage(request: AdminEventStageRequest): Promise<AdminEventStagePreview> {
    return prepareAdminEventStage({
      ...request,
      sourceChecksum: await sha256Text(request.sourceText),
    });
  }

  stageAdminEvent(preview: AdminEventStagePreview): Promise<AdminEventStagePreview> {
    return this.enqueue(async () => {
      const file = this.requireFile(preview.filePath, 'Daily Note');
      const current = await this.app.vault.read(file);
      if (await sha256Text(current) !== preview.sourceChecksum) {
        throw new Error(`${preview.fileName} changed during preview. Refresh and retry; no note was written.`);
      }
      await this.app.vault.modify(file, preview.updatedText);
      return preview;
    });
  }

  previewFinanceEntryStage(request: FinanceEntryStageRequest): Promise<FinanceEntryStagePreview> {
    return prepareFinanceEntryStage(request);
  }

  stageFinanceEntry(preview: FinanceEntryStagePreview): Promise<FinanceEntryStagePreview> {
    return this.enqueue(async () => {
      const file = this.requireFile(preview.filePath, 'Daily Note');
      const current = await this.app.vault.read(file);
      if (await sha256Text(current) !== preview.sourceChecksum) {
        throw new Error(`${preview.fileName} changed during preview. Refresh and retry; no note was written.`);
      }
      await this.app.vault.modify(file, preview.updatedText);
      return preview;
    });
  }

  previewValuationRateStage(request: ValuationRateStageRequest): Promise<ValuationRateStagePreview> {
    return prepareValuationRateStage(request);
  }

  stageValuationRates(preview: ValuationRateStagePreview): Promise<ValuationRateStagePreview> {
    return this.enqueue(async () => {
      const file = this.requireFile(preview.filePath, 'Daily Note');
      const current = await this.app.vault.read(file);
      if (await sha256Text(current) !== preview.sourceChecksum) {
        throw new Error(`${preview.fileName} changed during preview. Refresh and retry; no note was written.`);
      }
      await this.app.vault.modify(file, preview.updatedText);
      return preview;
    });
  }

  private async dailyInput(request: NativeDailyRequest): Promise<NativeDailyNoteInput> {
    return {
      ...request,
      sourceChecksum: await sha256Text(request.sourceText),
      pluginVersion: this.pluginVersion,
    };
  }

  private async weeklyInput(request: NativeWeeklyRequest): Promise<NativeWeeklyNoteInput> {
    return { ...request, sourceChecksum: await sha256Text(request.sourceText) };
  }

  private async budgetInput(request: NativeBudgetRequest): Promise<NativeBudgetFormInput> {
    return { ...request, sourceChecksum: await sha256Text(request.sourceText) };
  }

  private async planningInputs(notes: NativePlanningNoteRequest[]): Promise<NativePlanningNote[]> {
    return Promise.all(notes.map(async (note) => ({
      ...note,
      sourceChecksum: await sha256Text(note.sourceText),
    })));
  }

  private async dailyWriteInputs(
    notes: Array<Omit<DailyNoteWriteInput, 'sourceChecksum'>>,
  ): Promise<DailyNoteWriteInput[]> {
    return Promise.all(notes.map(async (note) => ({
      ...note,
      sourceChecksum: await sha256Text(note.sourceText),
    })));
  }

  private async inspectDatabase<T>(
    databasePathSetting: string,
    operation: (db: Database) => T,
  ): Promise<T> {
    const databasePath = normalizeVaultDatabasePath(databasePathSetting);
    const file = this.requireFile(databasePath, 'Examined Human database');
    await this.assertNoUncheckpointedWal(databasePath);
    const bytes = new Uint8Array(await this.app.vault.readBinary(file));
    const SQL = await getSqlJs();
    const db = new SQL.Database(bytes);
    try {
      db.run('PRAGMA foreign_keys = ON');
      return operation(db);
    } finally {
      db.close();
    }
  }

  private async mutateDatabase<T>(
    databasePathSetting: string,
    backupLabel: string,
    operation: (db: Database) => T,
    durability: DatabaseMutationDurability = 'durable',
  ): Promise<{ value: T; backupPath: string | null; databasePath: string; backupsPruned: number; backupRetentionWarning: string | null }> {
    const databasePath = normalizeVaultDatabasePath(databasePathSetting);
    const databaseFile = this.requireFile(databasePath, 'Examined Human database');
    await this.assertNoUncheckpointedWal(databasePath);
    const originalBytes = new Uint8Array(await this.app.vault.readBinary(databaseFile));
    const originalChecksum = await sha256Bytes(originalBytes);
    const SQL = await getSqlJs();
    const db = new SQL.Database(originalBytes);
    try {
      db.run('PRAGMA foreign_keys = ON');
      db.run('BEGIN IMMEDIATE');
      let value: T;
      try {
        value = operation(db);
        verifyIntegrity(db);
        db.run('COMMIT');
      } catch (error) {
        try {
          db.run('ROLLBACK');
        } catch {
          // Preserve the original transaction error.
        }
        throw error;
      }
      verifyIntegrity(db);
      const stagedBytes = db.export();
      await this.assertNoUncheckpointedWal(databasePath);
      const currentBytes = new Uint8Array(await this.app.vault.readBinary(databaseFile));
      if (await sha256Bytes(currentBytes) !== originalChecksum) {
        throw new Error('EH.db changed during validation. Refresh and retry; no data was written.');
      }
      const backupPath = shouldCreateDatabaseBackup(durability)
        ? await this.createBackup(databasePath, originalBytes, backupLabel)
        : null;
      await this.app.vault.modifyBinary(databaseFile, arrayBufferFrom(stagedBytes));
      try {
        await this.verifyWrittenDatabase(databaseFile, stagedBytes);
      } catch (error) {
        await this.app.vault.modifyBinary(databaseFile, arrayBufferFrom(originalBytes));
        throw new Error(
          `The staged database failed post-write verification and the original was restored. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const retention = backupPath
        ? await this.pruneBackups(databasePath, backupPath)
        : { backupsPruned: 0, backupRetentionWarning: null };
      return { value, backupPath, databasePath, ...retention };
    } finally {
      db.close();
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(async () => {
      this.activeWrites += 1;
      try {
        return await operation();
      } finally {
        this.activeWrites -= 1;
      }
    });
    this.writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async assertNoUncheckpointedWal(databasePath: string): Promise<void> {
    const walStats = await this.app.vault.adapter.stat(`${databasePath}-wal`);
    if (hasUncheckpointedWal(walStats?.size)) throw new Error(UNCHECKPOINTED_WAL_MESSAGE);
  }

  private requireFile(path: string, label: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`${label} was not found inside the vault: ${path}`);
    return file;
  }

  private async createBackup(databasePath: string, bytes: Uint8Array, label = 'meals'): Promise<string> {
    const slash = databasePath.lastIndexOf('/');
    const fileName = slash >= 0 ? databasePath.slice(slash + 1) : databasePath;
    const dot = fileName.lastIndexOf('.');
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const extension = dot > 0 ? fileName.slice(dot) : '.db';
    const backupDirectory = normalizePath(backupDirectoryForDatabase(databasePath));
    await this.ensureFolder(backupDirectory);
    const backupPath = normalizePath(
      `${backupDirectory}/${stem}.before-${label}-${backupTimestamp()}${extension}`,
    );
    if (await this.app.vault.adapter.exists(backupPath)) {
      throw new Error(`Refusing to overwrite an existing database backup: ${backupPath}`);
    }
    await this.app.vault.adapter.writeBinary(backupPath, arrayBufferFrom(bytes));
    return backupPath;
  }

  private async pruneBackups(
    databasePath: string,
    protectedPath: string,
  ): Promise<{ backupsPruned: number; backupRetentionWarning: string | null }> {
    const configured = this.backupRetentionLimit();
    const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : 0;
    if (limit === 0) return { backupsPruned: 0, backupRetentionWarning: null };
    let backupsPruned = 0;
    try {
      const backupDirectory = normalizePath(backupDirectoryForDatabase(databasePath));
      const listing = await this.app.vault.adapter.list(backupDirectory);
      const removals = pluginBackupRetentionPlan(databasePath, listing.files, limit, protectedPath);
      for (const path of removals) {
        const stat = await this.app.vault.adapter.stat(path);
        if (stat?.type !== 'file') continue;
        await this.app.vault.adapter.remove(path);
        backupsPruned += 1;
      }
      return { backupsPruned, backupRetentionWarning: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        backupsPruned,
        backupRetentionWarning: `The database write succeeded, but backup retention cleanup did not finish: ${message}`,
      };
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    await ensureStorageFolder({
      indexedType: (candidate): StorageEntryType | null => {
        const existing = this.app.vault.getAbstractFileByPath(candidate);
        if (!existing) return null;
        return existing instanceof TFolder ? 'folder' : 'file';
      },
      persistedType: async (candidate): Promise<StorageEntryType | null> => {
        const stat = await this.app.vault.adapter.stat(candidate);
        return stat?.type ?? null;
      },
      createFolder: async (candidate): Promise<void> => {
        await this.app.vault.createFolder(candidate);
      },
    }, path);
  }

  private async verifyWrittenDatabase(file: TFile, expectedBytes: Uint8Array): Promise<void> {
    const writtenBytes = new Uint8Array(await this.app.vault.readBinary(file));
    const [writtenChecksum, expectedChecksum] = await Promise.all([
      sha256Bytes(writtenBytes),
      sha256Bytes(expectedBytes),
    ]);
    if (writtenChecksum !== expectedChecksum) throw new Error('The database bytes do not match the staged write.');
    const SQL = await getSqlJs();
    const verification = new SQL.Database(writtenBytes);
    try {
      verification.run('PRAGMA foreign_keys = ON');
      verifyIntegrity(verification);
    } finally {
      verification.close();
    }
  }
}
