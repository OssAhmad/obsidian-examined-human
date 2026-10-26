import '../test-support/plugin-module-hooks.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
const { Platform } = await import('obsidian');
const { DASHBOARDS, DASHBOARD_SIDEBAR_VIEW_TYPE, STOA_ICON, navigateToDashboard, opensDashboardInNewTab } = await import('./dashboard-navigation.ts');
const { DashboardSidebarView } = await import('./DashboardSidebarView.ts');
const { default: ExaminedHumanPlugin } = await import('./main.ts');
const { TimelineView } = await import('./TimelineView.ts');
const { DailyAssessmentView } = await import('./DailyAssessmentView.ts');
const { WeeklyAssessmentView } = await import('./WeeklyAssessmentView.ts');
const { EngagementDashboardView } = await import('./EngagementDashboardView.ts');
const { FinancialDashboardView } = await import('./FinancialDashboardView.ts');
const { NutritionDashboardView } = await import('./NutritionDashboardView.ts');
const { ExerciseDashboardView } = await import('./ExerciseDashboardView.ts');
const { MedicalDashboardView } = await import('./MedicalDashboardView.ts');
const { CommandCenterView } = await import('./CommandCenterView.ts');

function fixture(type = 'examined-human') {
  const events = new Map();
  let recent;
  const leaves = [];
  const makeLeaf = (type) => {
    const leaf = {
      state: { type }, changes: 0,
      getViewState() { return this.state; },
      async setViewState(state) { this.changes++; this.state = state; },
    };
    leaves.push(leaf);
    return leaf;
  };
  if (type) recent = makeLeaf(type);
  const workspace = {
    on(name, callback) { events.set(name, callback); return {}; },
    getMostRecentLeaf: () => recent,
    getLeaf(mode) { assert.equal(mode, 'tab'); return makeLeaf('empty'); },
    getLeavesOfType: type => leaves.filter(leaf => leaf.state.type === type),
    getRightLeaf(split) { assert.equal(split, false); return makeLeaf('empty'); },
    async revealLeaf(leaf) { recent = leaf; events.get('active-leaf-change')?.(); },
    rightSplit: { collapse() { this.collapsed = true; } },
  };
  return { workspace, leaves, events, current: () => recent };
}

test('sidebar dashboard IDs match every registered dashboard, including Medical', () => {
  const types = [TimelineView, DailyAssessmentView, WeeklyAssessmentView, EngagementDashboardView,
    FinancialDashboardView, NutritionDashboardView, ExerciseDashboardView, MedicalDashboardView, CommandCenterView];
  assert.deepEqual(DASHBOARDS.map(d => d.viewType), types.map(Type => new Type({ app: {} }, {}).getViewType()));
  assert.equal(new Set(DASHBOARDS.map(d => d.viewType)).size, types.length);
});

test('sidebar navigation reuses the main dashboard while sidebar focus does not matter', async () => {
  const { workspace, leaves, current } = fixture();
  const original = current();
  workspace.activeLeaf = { getViewState: () => ({ type: DASHBOARD_SIDEBAR_VIEW_TYPE }) };
  const selected = await navigateToDashboard(workspace, 'examined-human-financial-dashboard');
  assert.equal(selected, original);
  assert.equal(leaves.length, 1);
  assert.equal(current().state.type, 'examined-human-financial-dashboard');
  await navigateToDashboard(workspace, 'examined-human-financial-dashboard');
  assert.equal(original.changes, 1, 'selecting the visible dashboard must retain its current display');
});

test('normal navigation preserves notes, other plugins and pinned dashboards', async () => {
  for (const type of ['markdown', 'another-plugin', null, 'examined-human']) {
    const { workspace, leaves, current } = fixture(type);
    const original = current();
    if (type === 'examined-human') original.state.pinned = true;
    await navigateToDashboard(workspace, 'examined-human-records');
    assert.notEqual(current(), original);
    assert.equal(leaves.length, type ? 2 : 1);
    if (original) assert.equal(original.state.type, type);
  }
});

test('new-tab navigation always creates a tab, even when the requested dashboard is already visible', async () => {
  const { workspace, current, leaves } = fixture();
  const original = current();
  await navigateToDashboard(workspace, 'examined-human', true);
  assert.notEqual(current(), original);
  assert.equal(original.changes, 0);
  assert.equal(leaves.length, 2);
  for (const event of [
    { ctrlKey: true, metaKey: false, button: 0 },
    { ctrlKey: false, metaKey: true, button: 0 },
    { ctrlKey: false, metaKey: false, button: 1 },
  ]) assert.equal(opensDashboardInNewTab(event), true);
  assert.equal(opensDashboardInNewTab({ ctrlKey: false, metaKey: false, button: 0 }), false);
});

test('existing command entry points open fresh tabs and mobile navigation closes the drawer', async () => {
  const { workspace, leaves } = fixture();
  const plugin = new ExaminedHumanPlugin({ workspace });
  const methods = ['activateView', 'activateDailyAssessmentView', 'activateWeeklyAssessmentView',
    'activateEngagementDashboardView', 'activateFinancialDashboardView', 'activateNutritionDashboardView',
    'activateExerciseDashboardView', 'activateMedicalDashboardView', 'activateCommandCenterView'];
  for (const [index, method] of methods.entries()) {
    await plugin[method]();
    assert.equal(leaves.length, index + 2);
    assert.equal(leaves.at(-1).state.type, DASHBOARDS[index].viewType);
  }
  Platform.isMobile = true;
  try {
    await plugin.openDashboard('examined-human');
    assert.equal(workspace.rightSplit.collapsed, true);
  } finally { Platform.isMobile = false; }
});

test('sidebar creation is idempotent and ribbon activation reveals the Stoic-icon panel', async () => {
  const { workspace, leaves, current } = fixture();
  const original = current();
  const plugin = new ExaminedHumanPlugin({ workspace });
  await plugin.ensureDashboardSidebar();
  assert.equal(current(), original, 'installing the sidebar must not steal focus');
  await plugin.activateDashboardSidebar();
  assert.equal(current().state.type, DASHBOARD_SIDEBAR_VIEW_TYPE);
  assert.equal(leaves.length, 2);
  assert.equal(new DashboardSidebarView({ app: {} }, {}).getIcon(), STOA_ICON);
});

test('overlapping sidebar creation and rapid dashboard selections do not create duplicate tabs', async () => {
  const { workspace, leaves, current } = fixture();
  const plugin = new ExaminedHumanPlugin({ workspace });
  let finishCreation;
  workspace.getRightLeaf = () => {
    const leaf = { state: { type: 'empty' }, getViewState() { return this.state; },
      async setViewState(state) { await new Promise(resolve => { finishCreation = resolve; }); this.state = state; } };
    leaves.push(leaf);
    return leaf;
  };
  const first = plugin.ensureDashboardSidebar();
  const second = plugin.ensureDashboardSidebar();
  assert.equal(first, second);
  finishCreation();
  await first;
  const original = current();
  await Promise.all([
    plugin.openDashboard('examined-human-records'),
    plugin.openDashboard('examined-human-financial-dashboard'),
    plugin.openDashboard('examined-human-daily-assessment'),
  ]);
  assert.equal(current(), original);
  assert.equal(current().state.type, 'examined-human-daily-assessment');
  assert.equal(leaves.length, 2);
});

test('sidebar keeps navigation usable on a missing database and offers a separate-tab action on every row', async () => {
  globalThis.window = { requestAnimationFrame: callback => callback() };
  const { workspace } = fixture();
  const opened = [];
  const services = {
    settings: { databasePath: 'missing.db' },
    database: { async dashboardOverview() { throw new Error('missing'); } },
    watchSourceUpdates() { return () => {}; },
    async refreshViews() {},
    async openDashboard(...args) { opened.push(args); },
  };
  const view = new DashboardSidebarView({ app: { workspace } }, services);
  view.registerEvent = () => {};
  await view.onOpen();
  assert.match(view.contentEl.text(), /Activity summary unavailable/);
  const buttons = view.contentEl.all().filter(el => el.tag === 'button');
  const separate = buttons.filter(el => el.className === 'eh-navigation-new-tab');
  assert.equal(separate.length, DASHBOARDS.length);
  separate[0].trigger('click');
  assert.deepEqual(opened.pop(), ['examined-human', true]);
  const calendar = view.dashboardButtons.get('examined-human');
  assert.equal(calendar.attributes['aria-current'], 'page');
  calendar.trigger('click', { ctrlKey: false, metaKey: false, button: 0 });
  assert.deepEqual(opened.pop(), ['examined-human', false]);
  calendar.trigger('click', { ctrlKey: true, metaKey: false, button: 0 });
  assert.deepEqual(opened.pop(), ['examined-human', true]);
  await view.onClose();
});

test('sidebar summary uses recorded data, formatted as hh:mm, and background updates retain its content', async () => {
  globalThis.window = { requestAnimationFrame: callback => callback() };
  const { workspace } = fixture();
  let updated;
  const services = {
    settings: { databasePath: 'EH.db' },
    database: { async dashboardOverview() { return { totalMinutes: 150, sessionCount: 3, engagementCount: 2, recordedDays: 1 }; } },
    watchSourceUpdates(callback) { updated = callback; return () => { updated = null; }; },
    async refreshViews() {}, async openDashboard() {},
  };
  const view = new DashboardSidebarView({ app: { workspace } }, services);
  view.registerEvent = () => {};
  await view.onOpen();
  assert.match(view.contentEl.text(), /02:30/);
  assert.match(view.contentEl.text(), /3 sessions across 2 engagements/);
  const previous = view.contentEl.children[0];
  updated('Updated data available');
  assert.equal(view.contentEl.children[0], previous);
  assert.match(view.containerEl.text(), /Updated data available/);
  await view.onClose();
  assert.equal(updated, null);
});
