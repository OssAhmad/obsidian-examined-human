import '../../test-support/plugin-module-hooks.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
const { default: ExaminedHumanPlugin } = await import('../main.ts');
const { ExaminedHumanDatabase } = await import('../examined-human-database.ts');
const { DailyAssessmentView } = await import('../DailyAssessmentView.ts');

test('real plugin timers and file events detect changes without refreshing the reader', async () => {
  const timers = [];
  const events = new Map();
  const timeouts = new Map();
  globalThis.window = {
    requestAnimationFrame: (callback) => callback(),
    setInterval(callback, interval) { timers.push({ callback, interval }); return timers.length; },
    setTimeout(callback) { const id = timeouts.size + 1; timeouts.set(id, callback); return id; },
    clearTimeout(id) { timeouts.delete(id); },
  };
  const state = { bytes: new Uint8Array([1, 2, 3]), mtime: 1 };
  const leaves = [];
  const app = {
    workspace: { getLeavesOfType: (type) => type === 'examined-human-daily-assessment' ? leaves : [] },
    vault: {
      on(event, callback) { events.set(event, callback); return {}; },
      adapter: {
        async stat(path) { return path.endsWith('-wal') ? null : { size: state.bytes.length, mtime: state.mtime }; },
        async readBinary() { return state.bytes.slice().buffer; },
      },
    },
  };
  const plugin = new ExaminedHumanPlugin(app);
  plugin.manifest = { version: 'test' };
  plugin.loadSettings = async () => {};
  for (const method of ['registerView', 'addRibbonIcon', 'addCommand', 'addSettingTab', 'registerInterval', 'registerEvent', 'register']) plugin[method] = () => {};
  await plugin.onload();
  await plugin.sourceMonitor.check(true);
  const view = new DailyAssessmentView({ app }, plugin);
  view.selectedItem = { filePath: 'Journal/today.md' };
  view.startReadingUpdates();
  let renders = 0;
  view.refreshContent = async () => { renders++; view.contentEl.empty(); view.contentEl.createDiv({ text: 'report' }); };
  await view.refresh(); leaves.push({ view });
  const report = view.contentEl.children[0];
  const poll = timers.find(({ interval }) => interval === 10_000);
  const authoritative = timers.find(({ interval }) => interval === 600_000);
  assert.ok(poll); assert.ok(authoritative);
  poll.callback(); authoritative.callback();
  await plugin.sourceMonitor.check(true);
  assert.equal(renders, 1);
  assert.equal(view.containerEl.all().some((element) => element.className === 'examined-human-update-notice'), false);
  state.bytes = new Uint8Array([1, 2, 4]); state.mtime++;
  events.get('modify')({ path: plugin.settings.databasePath });
  for (const callback of timeouts.values()) callback(); timeouts.clear();
  poll.callback();
  await plugin.sourceMonitor.check();
  assert.equal(renders, 1, 'neither an event nor a poll may redraw');
  assert.equal(view.contentEl.children[0], report);
  assert.equal(view.containerEl.all().filter((element) => element.className === 'examined-human-update-notice').length, 1);
  await plugin.refreshViews();
  assert.equal(renders, 2, 'manual global refresh still redraws');
  await plugin.sourceMonitor.check(true);
  assert.equal(view.containerEl.all().some((element) => element.className === 'examined-human-update-notice'), false);
  events.get('modify')({ path: 'Journal/today.md' });
  assert.equal(renders, 2, 'editing the selected note preserves the report');
  assert.match(view.containerEl.text(), /Source note updated/);
});

test('read-only content signatures never read main-file bytes while the WAL has frames', async () => {
  let reads = 0;
  const db = new ExaminedHumanDatabase({ vault: { adapter: {
    stat: async () => ({ size: 100 }),
    readBinary: async () => { reads++; return new Uint8Array([1]).buffer; },
  } } });
  await assert.rejects(db.contentSignature('EH.db'), /WAL|checkpoint/);
  assert.equal(reads, 0);
});
