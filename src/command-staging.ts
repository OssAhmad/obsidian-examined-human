import { moment, Notice, TFile } from 'obsidian';
import { chooseAdminEventStageTarget, confirmAdminEventStage } from './AdminEventStageModal.ts';
import { buildDailyNoteList, type DailyNoteListItem } from './daily-note-index.ts';
import type ExaminedHumanPlugin from './main.ts';

export interface StageCommandsOptions {
  plugin: ExaminedHumanPlugin;
  commands: string[];
  preferredTarget?: DailyNoteListItem | null;
}

export async function chooseUnimportedDailyNote(
  plugin: ExaminedHumanPlugin,
  preferredTarget: DailyNoteListItem | null | undefined,
): Promise<DailyNoteListItem | null> {
  if (preferredTarget && preferredTarget.status !== 'imported') return preferredTarget;
  const today = moment().format('YYYY-MM-DD');
  const index = await plugin.database.dailyNoteIndex(plugin.settings.databasePath);
  const candidates = (await buildDailyNoteList(
    plugin.app,
    index,
    today,
    plugin.knownForms(),
  )).filter((item) => item.status !== 'imported');
  if (candidates.length === 0) {
    new Notice('There are no unimported EH Daily Notes available to receive this command.');
    return null;
  }
  if (candidates.length === 1) return candidates[0];
  return chooseAdminEventStageTarget(plugin.app, candidates);
}

export async function stageAdminCommands(options: StageCommandsOptions): Promise<DailyNoteListItem | null> {
  const commands = options.commands.map((command) => command.trim()).filter(Boolean);
  if (commands.length === 0) throw new Error('No Admin Event commands were supplied.');
  const target = await chooseUnimportedDailyNote(options.plugin, options.preferredTarget);
  if (!target) return null;
  const file = options.plugin.app.vault.getAbstractFileByPath(target.filePath);
  if (!(file instanceof TFile)) throw new Error(`Daily Note not found: ${target.filePath}`);
  const preview = await options.plugin.nativeLogger.previewAdminEventStage({
    noteDate: target.date,
    fileName: target.fileName,
    filePath: target.filePath,
    sourceText: await options.plugin.app.vault.read(file),
    commands,
  });
  if (!await confirmAdminEventStage(options.plugin.app, preview)) return null;
  await options.plugin.nativeLogger.stageAdminEvent(preview);
  new Notice(`${commands.length === 1 ? 'Command staged' : `${commands.length} commands staged`} in ${target.fileName}.`, 8000);
  return target;
}
