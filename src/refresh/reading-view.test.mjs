import '../../test-support/plugin-module-hooks.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
const { ReadingView } = await import('./reading-view.ts');
const { TimelineView } = await import('../TimelineView.ts');
const { DailyAssessmentView } = await import('../DailyAssessmentView.ts');
const { WeeklyAssessmentView } = await import('../WeeklyAssessmentView.ts');
const { EngagementDashboardView } = await import('../EngagementDashboardView.ts');
const { FinancialDashboardView } = await import('../FinancialDashboardView.ts');
const { NutritionDashboardView } = await import('../NutritionDashboardView.ts');
const { ExerciseDashboardView } = await import('../ExerciseDashboardView.ts');
const { CommandCenterView } = await import('../CommandCenterView.ts');

let frames = [];
globalThis.window = { requestAnimationFrame: (callback) => { frames.push(callback); } };
function flushFrames() { const pending = frames; frames = []; pending.forEach((callback) => callback()); }

function fixture(Type = ReadingView) {
  const listeners = new Set();
  let refreshes = 0;
  let view;
  const services = {
    settings: { dayColumnWidth: 180, initialScrollHour: 7 }, knownForms: () => [],
    watchSourceUpdates(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async refreshViews() { refreshes++; await view.refresh(); },
  };
  view = new Type({ app: {} }, services);
  view.context = 'same-day';
  view.scrollContext = () => view.context;
  let renders = 0;
  view.refreshContent = async () => {
    renders++;
    view.contentEl.empty();
    view.sidebar = view.contentEl.createDiv({ cls: 'sidebar' });
    view.main = view.contentEl.createDiv({ cls: 'main' });
    view.timeline = view.main.createDiv({ cls: 'timeline' });
    for (const element of [view.sidebar, view.main, view.timeline]) {
      element.scrollHeight = 2000; element.clientHeight = 400;
    }
    window.requestAnimationFrame(() => { view.timeline.scrollTop = 420; });
  };
  return { view, listeners, services, renders: () => renders, refreshes: () => refreshes };
}

test('all EH views retain their rendered page on background updates and preserve nested scroll on refresh', async () => {
  for (const Type of [DailyAssessmentView, WeeklyAssessmentView, EngagementDashboardView, FinancialDashboardView,
    NutritionDashboardView, ExerciseDashboardView, CommandCenterView, TimelineView]) {
    const { view, listeners, renders, refreshes } = fixture(Type);
    view.startReadingUpdates();
    await view.refresh(); flushFrames();
    view.contentEl.scrollTop = 75; view.main.scrollTop = 930; view.sidebar.scrollTop = 180;
    view.timeline.scrollTop = 0; view.timeline.scrollLeft = 63;
    const oldMain = view.main;
    const before = renders();
    for (const listener of listeners) { listener('Updated data available'); listener('Updated data available'); }
    assert.equal(renders(), before, Type.name);
    assert.equal(view.main, oldMain);
    assert.equal(view.main.scrollTop, 930);
    assert.equal(view.containerEl.all().filter((element) => element.className === 'examined-human-update-notice').length, 1);
    const button = view.containerEl.all().find((element) => element.tag === 'button');
    button.trigger('click');
    await view.refresh(); flushFrames();
    assert.equal(refreshes(), 1);
    assert.equal(view.contentEl.scrollTop, 75);
    assert.equal(view.main.scrollTop, 930);
    assert.equal(view.sidebar.scrollTop, 180);
    assert.equal(view.timeline.scrollTop, 0, 'midnight must survive the timeline initialization frame');
    assert.equal(view.timeline.scrollLeft, 63);
    assert.equal(view.containerEl.all().some((element) => element.className === 'examined-human-update-notice'), false);
    view.stopReadingUpdates();
    assert.equal(listeners.size, 0);
  }
});

test('overlapping identical redraws coalesce; navigating during a pending redraw renders the latest context', async () => {
  const { view } = fixture();
  view.getViewType = () => 'test';
  let release;
  let loads = 0;
  view.refreshContent = async () => { loads++; if (loads === 1) await new Promise((resolve) => { release = resolve; }); };
  const first = view.refresh();
  assert.equal(view.refresh(), first);
  view.context = 'different-day';
  assert.equal(view.refresh(), first);
  release();
  await first;
  assert.equal(loads, 2);
  flushFrames();
});

test('updates arriving during a redraw stay visible and late frames cannot move a different day', async () => {
  const { view } = fixture();
  view.getViewType = () => 'test';
  await view.refresh(); flushFrames();
  view.main.scrollTop = 900;
  const render = view.refreshContent;
  view.refreshContent = async () => { await render(); view.markDataUpdated(); };
  await view.refresh();
  assert.ok(view.containerEl.all().some((element) => element.className === 'examined-human-update-notice'));
  view.context = 'new-day';
  view.main.scrollTop = 12;
  flushFrames();
  assert.equal(view.main.scrollTop, 12);
});

test('Calendar restores fractional horizontal offsets and ignores obsolete animation frames', async () => {
  const services = {
    settings: { dayColumnWidth: 180, initialScrollHour: 7 },
    syncTodayPlanningFromDailyForm: async () => {}, knownForms: () => [],
    database: { sessionsBetween: async () => ({ events: [], dayStates: {}, issues: [] }) },
  };
  const view = new TimelineView({ app: {} }, services);
  view.renderHeader = () => {};
  view.renderWarnings = () => {};
  view.renderGrid = () => {
    view.scrollEl = view.contentEl.createDiv({ cls: 'examined-human-scroll' });
    view.scrollEl.clientWidth = 800;
  };
  await view.renderCalendar(); flushFrames();
  view.scrollEl.scrollLeft = 1234.5;
  view.scrollEl.scrollTop = 513.25;
  const viewport = view.captureViewport();
  await view.renderCalendar({ viewport }); flushFrames();
  assert.ok(Math.abs(view.scrollEl.scrollLeft - 1234.5) < 0.001);
  assert.ok(Math.abs(view.scrollEl.scrollTop - 513.25) < 0.001);
  await view.renderCalendar({ viewport });
  view.rangeStart.subtract(28, 'days'); view.rangeEnd.subtract(28, 'days');
  await view.renderCalendar({ viewport });
  const [obsolete, current] = frames; frames = [];
  obsolete();
  assert.equal(view.scrollEl.scrollLeft, 0, 'old frame must not touch a newer grid');
  current();
  assert.ok(Math.abs(view.scrollEl.scrollLeft - (1234.5 + 28 * 180)) < 0.001);
});
