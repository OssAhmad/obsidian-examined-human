import '../test-support/plugin-module-hooks.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Modal, TFile, Notice } from '../test-support/obsidian-stub.mjs';
import { TestElement } from '../test-support/obsidian-dom.mjs';
import { replacementDatabase, replacementInput } from '../test-support/daily-reimport.mjs';
import { inspectDailyNote, writeHistoricalDailyNote } from './logger/daily-note.ts';

globalThis.createEl = (tag, options) => new TestElement(tag, options);
globalThis.createSpan = (options) => new TestElement('span', options);
globalThis.window = { requestAnimationFrame: (callback) => callback() };

const { default: ExaminedHumanPlugin } = await import('./main.ts');
const { DailyAssessmentView } = await import('./DailyAssessmentView.ts');
const { confirmDailyImport } = await import('./DailyImportConfirmationModal.ts');
const { buildDailyNoteList } = await import('./daily-note-index.ts');

function preview() {
  const db = replacementDatabase();
  const input = replacementInput();
  try {
    writeHistoricalDailyNote(db, input);
    return { ...inspectDailyNote(db, { ...input, replaceExisting: true }), databaseChecksum: 'reviewed-snapshot' };
  } finally { db.close(); }
}

async function openModal(action) {
  Modal.opened = null;
  const pending = action();
  for (let attempt = 0; !Modal.opened && attempt < 20; attempt++) await new Promise(setImmediate);
  assert.ok(Modal.opened, 'import surface must open a confirmation dialog');
  return { pending, modal: Modal.opened };
}

function confirmReplacement(modal) {
  const elements = modal.contentEl.all();
  const warning = elements.find((element) => element.className.includes('daily-replacement-warning'));
  assert.equal(warning.attributes.role, 'alert');
  assert.match(warning.text(), /2026-08-20 has already been imported/);
  assert.match(warning.text(), /complete replacement, not a merge/);
  assert.match(warning.text(), /Anything missing from this form will be removed/);
  assert.match(warning.text(), /another tool/);
  assert.match(warning.text(), /Sessions: 2/);
  const button = elements.find((element) => element.tag === 'button' && element.textContent === 'Delete and reimport 2026-08-20');
  assert.ok(button);
  assert.equal(button.disabled, true);
  button.trigger('click'); // Even a synthetic click cannot bypass acknowledgement.
  const checkbox = elements.find((element) => element.tag === 'input' && element.type === 'checkbox');
  checkbox.checked = true;
  checkbox.trigger('change');
  assert.equal(button.disabled, false);
  button.trigger('click');
}

test('active-file command and Daily Assessment both require the full replacement warning and acknowledgement', async () => {
  const inspection = preview();
  for (const surface of ['command', 'assessment']) {
    const input = replacementInput();
    const file = new TFile(input.filePath);
    const app = { vault: { getAbstractFileByPath: () => file, read: async () => input.sourceText } };
    const plugin = new ExaminedHumanPlugin(app);
    let writes = 0;
    plugin.logger = {
      async inspectDaily(request) { assert.equal(request.replaceExisting, true); return inspection; },
      async importHistoricalDaily(request) {
        assert.equal(request.expectedDatabaseChecksum, inspection.databaseChecksum);
        assert.equal(request.replaceExisting, true);
        writes++;
        return { replaced: true, sessionCount: 2, transactionCount: 1, exerciseCount: 1, foodRowCount: 1, milestoneCount: 1, adminEventCount: 0 };
      },
    };
    plugin.markImportedEhFormFileIfComplete = async () => true;
    plugin.removeImportedFormAfterImport = async () => 'disabled';
    plugin.refreshViews = async () => {};
    plugin.activeForm = async () => ({ file, sourceText: input.sourceText, form: { date: input.noteDate } });
    const view = new DailyAssessmentView({ app }, plugin);
    view.selectedItem = { date: input.noteDate, fileName: input.fileName, filePath: input.filePath, status: 'imported', temporalState: 'imported' };
    const action = () => surface === 'command' ? plugin.importActiveForm('daily') : view.handleImport();
    let opened = await openModal(action);
    assert.equal(writes, 0, 'preview cannot write');
    opened.modal.close();
    await opened.pending;
    assert.equal(writes, 0, 'closing cannot write');
    opened = await openModal(action);
    confirmReplacement(opened.modal);
    await opened.pending;
    assert.equal(writes, 1, surface);
    assert.ok(Notice.messages.includes('Day replaced successfully.'));
  }
});

test('invalid or future assessments cannot expose a destructive confirmation button', async () => {
  for (const blocked of ['invalid', 'future']) {
    const inspection = preview();
    if (blocked === 'invalid') { inspection.ready = false; inspection.errors = ['Invalid transaction']; }
    const { pending, modal } = await openModal(() => confirmDailyImport({}, {
      title: 'Review day', explanation: 'Review', confirmLabel: 'Import', inspection,
      sessionColors: {}, initialScrollHour: 8, valuationLabel: 'USD',
      canConfirm: blocked !== 'future', blockedReason: blocked === 'future' ? 'Future date' : undefined,
    }));
    assert.equal(modal.contentEl.all().some((element) => element.tag === 'button' && element.textContent.startsWith('Delete and reimport')), false);
    modal.close();
    assert.equal(await pending, false);
  }
});

test('Daily Assessment resolves a rediscovered replacement source and rejects ambiguous choices', async () => {
  const importedNotes = [{ date: '2026-08-20', fileName: 'old.md', filePath: 'old.md', importedAt: 'then' }];
  const descriptor = { kind: 'daily', date: '2026-08-20', fileName: 'new.md', filePath: 'Journal/new.md' };
  const items = await buildDailyNoteList({}, { importedNotes, noteSources: [] }, '2026-08-22', [descriptor]);
  assert.equal(items[0].status, 'imported');
  assert.equal(items[0].filePath, descriptor.filePath);
  await assert.rejects(buildDailyNoteList({}, { importedNotes, noteSources: [] }, '2026-08-22', [descriptor, { ...descriptor, filePath: 'duplicate.md' }]), /Two EH Daily Forms/);
});
