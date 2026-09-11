import type { SessionQueryResult } from './calendar.ts';

export interface ImportedDailyNoteRecord {
  date: string;
  fileName: string;
  filePath: string;
  importedAt: string | null;
}

export interface DailyNoteSourceRecord {
  date: string;
  lifecycleState: string;
  parseStatus: string;
  lastError: string | null;
}

export interface MealImportComponentRecord {
  lifecycleState: 'ephemeral' | 'finalized';
  sourceFilePath: string;
  sourceChecksum: string;
  pluginVersion: string;
  rowCount: number;
  importedAt: string;
  updatedAt: string;
}

export interface DailyNoteIndexQueryResult {
  importedNotes: ImportedDailyNoteRecord[];
  noteSources: DailyNoteSourceRecord[];
}

export interface DailyMetricsRecord {
  mood: number | null;
  energy: number | null;
  stress: number | null;
  weightKg: number | null;
  sleepHours: number | null;
  calories: number | null;
  proteinG: number | null;
  fasted: number | null;
  dieted: number | null;
}

export interface DailyMealRecord {
  id: number;
  food: string;
  calories: number | null;
  proteinG: number | null;
}

export interface DailyTransactionRecord {
  id: number;
  accountName: string;
  amount: number;
  engagement: string;
  description: string;
}

export interface DailyAssessmentQueryResult {
  sessionResult: SessionQueryResult;
  metrics: DailyMetricsRecord | null;
  meals: DailyMealRecord[];
  transactions: DailyTransactionRecord[];
  imported: boolean;
  importedAt: string | null;
  sourceState: DailyNoteSourceRecord | null;
  mealImport: MealImportComponentRecord | null;
}

export { queryDailyAssessment, queryDailyNoteIndex } from '../examined-human-query.ts';
