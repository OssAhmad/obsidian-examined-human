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
  studied: number | null;
  worked: number | null;
  exercised: number | null;
  notes: string | null;
}

export interface DailyMealRecord {
  id: number;
  mealType: string | null;
  food: string;
  amountG: number | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  saltG: number | null;
  fiberG: number | null;
  cholesterolMg: number | null;
}

export interface DailyTransactionRecord {
  id: number;
  accountName: string;
  amount: number;
  engagement: string;
  description: string;
  currency: string;
  valuationAmount: number | null;
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
