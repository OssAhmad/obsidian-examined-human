import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDailyNote as inspectDailyNoteCompatibility } from '../native-logger/daily-note.ts';
import { inspectDailyNote } from './daily-note.ts';
import { syncPlanningNotes as syncPlanningNotesCompatibility } from '../native-logger/planning.ts';
import { syncPlanningNotes } from './planning.ts';
import { validateAdminCommandArguments as validateCompatibilityCommand } from '../native-logger/admin/command-registry.ts';
import { validateAdminCommandArguments } from './admin/command-registry.ts';

test('deprecated native-logger modules reexport the logger implementations', () => {
  assert.equal(inspectDailyNoteCompatibility, inspectDailyNote);
  assert.equal(syncPlanningNotesCompatibility, syncPlanningNotes);
  assert.equal(validateCompatibilityCommand, validateAdminCommandArguments);
});
