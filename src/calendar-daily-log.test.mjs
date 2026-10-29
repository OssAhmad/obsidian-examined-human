import '../test-support/plugin-module-hooks.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TestElement } from '../test-support/obsidian-dom.mjs';
import { TFile, moment, Modal } from '../test-support/obsidian-stub.mjs';
const { DailyAssessmentView, DAILY_LOG_VIEW_TYPE } = await import('./DailyAssessmentView.ts');
const { TimelineView } = await import('./TimelineView.ts');
const { DailyLogModal } = await import('./DailyLogModal.ts');
const { default: ExaminedHumanPlugin } = await import('./main.ts');

globalThis.window = { requestAnimationFrame: callback => callback() };
globalThis.createEl = (tag, options) => new TestElement(tag, options);
globalThis.createSpan = options => new TestElement('span', options);

function fixture(pending = false, blocked = false) {
  const requested = [];
  const listeners = new Set();
  const file = new TFile('Journal/2001-10-24.md');
  const health = { medicationState: 'none', symptomsState: 'recorded', intakes: [],
    occurrences: [{ time: '10:30', name: 'Headache', notes: 'Daily symptom', symptomId: 1 }] };
  const inspection = { date: '2001-10-24', imported: false, ready: !blocked,
    errors: blocked ? ['Unknown symptom: Example'] : [], warnings: [],
    preview: { daily_metrics: { notes: 'Pending daily note' }, sessions: [], meals: [], transactions: [], exercises: [], health } };
  const services = {
    settings: { databasePath: 'EH.db', sessionColors: {}, dayColumnWidth: 180, initialScrollHour: 7, valuationUnitLabel: 'USD' },
    knownForms: () => pending ? [{ kind: 'daily', date: '2001-10-24', filePath: file.path, fileName: '2001-10-24.md' }] : [],
    watchSourceUpdates: listener => { listeners.add(listener); return () => listeners.delete(listener); }, async refreshViews() {},
    database: {
      async dailyNoteIndex() { return { importedNotes: [], noteSources: [] }; },
      async dailyAssessment(_path, date) {
        requested.push(date);
        return { imported: !pending, sessionResult: { events: [], issues: [] }, metrics: { notes: 'Canonical daily note' },
          meals: [], transactions: [], health, mealImport: null };
      },
    },
    logger: new Proxy({}, { get(_object, name) {
      if (name === 'inspectMeals') return async () => ({ ready: true });
      if (name === 'inspectDaily') return async () => inspection;
      throw new Error(`Read-only log accessed mutation service: ${String(name)}`);
    } }),
  };
  const app = { vault: { getAbstractFileByPath: path => pending && path === file.path ? file : null, async read() { return 'source'; } } };
  const view = new DailyAssessmentView({ app }, services, true);
  return { view, requested, services, app, listeners };
}

test('calendar Daily Log keeps the requested old date and shared report, including health, without mutation controls', async () => {
  for (const pending of [false, true]) {
    const { view, requested } = fixture(pending);
    await view.setState({ date: '2001-10-24' });
    assert.deepEqual(requested, ['2001-10-24']);
    assert.equal(view.getViewType(), DAILY_LOG_VIEW_TYPE);
    assert.deepEqual(view.getState(), { date: '2001-10-24' });
    assert.match(view.contentEl.text(), /Medication: none; Symptoms: recorded/);
    assert.match(view.contentEl.text(), /Headache.*Daily symptom/);
    assert.match(view.contentEl.text(), pending ? /Pending daily note/ : /Canonical daily note/);
    assert.match(view.contentEl.text(), /For imports, please visit the Daily Assessment dashboard/);
    assert.doesNotMatch(view.contentEl.text(), /Import readiness|Native Meals|complete replacement/);
    const buttons = view.contentEl.all().filter(el => el.tag === 'button').map(el => el.textContent);
    assert.ok(!buttons.some(label => /import|replace|resolve|discover/i.test(label)));
    await view.handleImport(); await view.handleNativeMealImport();
    const original = view.contentEl.children[0];
    view.markDataUpdated(); assert.equal(view.contentEl.children[0], original);
    await view.onClose();
  }
});

test('blocked pending calendar logs show validation and guidance without correction or import actions', async () => {
  const { view } = fixture(true, true);
  await view.setState({ date: '2001-10-24' });
  assert.match(view.contentEl.text(), /Unknown symptom: Example/);
  assert.match(view.contentEl.text(), /For imports, please visit/);
  assert.ok(!view.contentEl.all().some(el => el.tag === 'button' && /import|resolve/i.test(el.textContent)));
});

test('calendar date headings are accessible buttons that open the exact date', async () => {
  const opened = [];
  const view = new TimelineView({ app: {} }, { settings: { dayColumnWidth: 180 }, async openDailyLog(date) { opened.push(date); } });
  view.rangeStart = moment('2001-10-24'); view.rangeEnd = moment('2001-10-24');
  view.renderGrid(new Map(), {});
  const header = view.contentEl.all().find(el => el.className.includes('examined-human-day-header'));
  assert.equal(header.tag, 'button');
  assert.equal(header.attributes['aria-label'], 'Open daily log for 2001-10-24');
  header.trigger('click');
  assert.deepEqual(opened, ['2001-10-24']);
});

test('calendar Daily Log opens a pop-up without accessing workspace tabs', async () => {
  const { app, services, requested } = fixture();
  app.workspace = new Proxy({}, { get() { throw new Error('Opening a Daily Log must not access tabs'); } });
  const plugin = new ExaminedHumanPlugin(app);
  Object.assign(plugin, services);
  await plugin.openDailyLog('2001-10-24');
  const first = Modal.opened;
  assert.ok(first instanceof DailyLogModal);
  assert.match(first.contentEl.text(), /Daily Log.*2001-10-24/);
  assert.match(first.contentEl.text(), /Headache/);
  await plugin.openDailyLog('2001-10-25');
  assert.notEqual(Modal.opened, first);
  assert.equal(first.contentEl.children.length, 0);
  assert.deepEqual(requested, ['2001-10-24', '2001-10-25']);
  plugin.onunload();
  assert.equal(Modal.opened.contentEl.children.length, 0);
});

test('Daily Log pop-ups use pending previews and guidance without import or correction controls', async () => {
  for (const blocked of [false, true]) {
    const { app, services, listeners } = fixture(true, blocked);
    const modal = new DailyLogModal(app, services, '2001-10-24');
    modal.open(); await modal.refresh();
    assert.match(modal.contentEl.text(), blocked ? /Unknown symptom: Example/ : /Pending daily note/);
    assert.match(modal.contentEl.text(), /For imports, please visit the Daily Assessment dashboard/);
    assert.ok(!modal.contentEl.all().some(el => el.tag === 'button' && /import|replace|resolve|discover/i.test(el.textContent)));
    assert.equal(listeners.size, 1);
    modal.close(); assert.equal(listeners.size, 0);
  }
});

test('pop-up updates do not redraw the report; explicit refresh preserves nested and outer scroll', async () => {
  const { app, services, listeners, requested } = fixture();
  const modal = new DailyLogModal(app, services, '2001-10-24');
  services.refreshViews = async () => modal.refresh();
  modal.open(); await modal.refresh();
  const report = modal.contentEl.all().find(el => el.className === 'examined-human-daily-report-layout');
  const foods = modal.contentEl.all().find(el => el.className === 'examined-human-daily-report-full-width');
  modal.contentEl.scrollTop = 600; foods.scrollLeft = 50;
  for (const listener of listeners) listener('Updated data available');
  assert.ok(modal.contentEl.all().includes(report));
  assert.match(modal.contentEl.text(), /Updated data available/);
  modal.contentEl.all().find(el => el.tag === 'button' && el.textContent === 'Refresh').trigger('click');
  await modal.refresh();
  assert.equal(requested.length, 2);
  assert.equal(modal.contentEl.scrollTop, 600);
  assert.equal(modal.contentEl.all().find(el => el.className === 'examined-human-daily-report-full-width').scrollLeft, 50);
  assert.doesNotMatch(modal.contentEl.text(), /Updated data available/);
  modal.close();
});

test('closing a loading pop-up releases its watcher and prevents a late render', async () => {
  const { app, services, listeners } = fixture();
  const read = services.database.dailyAssessment;
  let release;
  services.database.dailyAssessment = async (...args) => {
    await new Promise(resolve => { release = resolve; });
    return read(...args);
  };
  const modal = new DailyLogModal(app, services, '2001-10-24');
  modal.open(); const pending = modal.refresh();
  modal.close(); release(); await pending;
  assert.equal(listeners.size, 0);
  assert.equal(modal.contentEl.children.length, 0);
});
