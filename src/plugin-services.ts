import type { App, TFile } from 'obsidian';
import type { ExaminedHumanDatabase } from './examined-human-database.ts';
import type { FormDiscoveryResult } from './form-discovery.ts';
import type { LoggerService } from './logger/service.ts';
import type { ExaminedHumanSettings } from './settings.ts';

/**
 * Stable service boundary supplied to views and staging workflows.
 *
 * Keeping this structural contract separate from the Obsidian Plugin subclass
 * lets consumers depend only on application capabilities rather than plugin
 * lifecycle and registration details.
 */
export interface ExaminedHumanPluginServices {
  readonly app: App;
  settings: ExaminedHumanSettings;
  readonly database: ExaminedHumanDatabase;
  readonly logger: LoggerService;
  saveSettings(): Promise<void>;
  refreshViews(): Promise<void>;
  knownForms(): FormDiscoveryResult['forms'];
  discoverFormsWithNotice(): Promise<void>;
  syncTodayPlanningFromDailyForm(): Promise<void>;
  markImportedEhFormFileIfComplete(file: TFile): Promise<boolean>;
}

export type DashboardServices = Pick<
  ExaminedHumanPluginServices,
  'database' | 'logger' | 'refreshViews' | 'saveSettings' | 'settings'
>;

export type NoteStagingServices = Pick<
  ExaminedHumanPluginServices,
  'app' | 'database' | 'knownForms' | 'logger' | 'settings'
>;

export type CommandServices = DashboardServices & NoteStagingServices;

export type FormWorkflowServices = DashboardServices & Pick<
  ExaminedHumanPluginServices,
  'app' | 'discoverFormsWithNotice' | 'knownForms' | 'markImportedEhFormFileIfComplete'
>;

export type TimelineServices = DashboardServices & Pick<
  ExaminedHumanPluginServices,
  'syncTodayPlanningFromDailyForm'
>;

export type FinancialDashboardServices = DashboardServices & Pick<
  ExaminedHumanPluginServices,
  'knownForms'
>;
