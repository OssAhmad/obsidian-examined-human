import '../test-support/plugin-module-hooks.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TestElement } from '../test-support/obsidian-dom.mjs';
import { Modal } from '../test-support/obsidian-stub.mjs';
const { renderDailyAssessmentReport } = await import('./DailyAssessmentReport.ts');
const { confirmDailyImport } = await import('./DailyImportConfirmationModal.ts');

globalThis.createEl = (tag, options) => new TestElement(tag, options);
globalThis.createSpan = (options) => new TestElement('span', options);
globalThis.window = { requestAnimationFrame: (callback) => callback() };

const options = { sessionColors: {}, initialScrollHour: 7, valuationLabel: 'USD' };
const sessions = [
  { ordinal: 1, start_time: '09:00', end_time: '10:00', duration_minutes: 60, session_type: 'study', engagement_type: 'course', engagement: 'Course A', notes: '' },
  { ordinal: 2, start_time: '10:00', end_time: '10:30', duration_minutes: 30, session_type: '', engagement_type: 'academia', engagement: 'Course B', notes: '' },
];

function switchChart(root) {
  const selector = root.all().find((element) => element.attributes['aria-label'] === 'Group daily time by');
  assert.ok(selector);
  assert.equal(selector.value, 'engagement');
  selector.value = 'session-type'; selector.trigger('change');
  const chart = root.all().find((element) => element.className === 'examined-human-daily-engagement-chart');
  assert.match(root.text(), /Time by session type/);
  assert.equal(chart.children.length, 1);
  assert.match(chart.text(), /Study/);
  assert.match(chart.text(), /01:30/);
  selector.value = 'engagement'; selector.trigger('change');
  assert.match(root.text(), /Time by engagement/);
  assert.equal(chart.children.length, 2);
}

test('assessment chart switches in place and exposes selection state without redrawing the report', () => {
  const root = new TestElement();
  const events = sessions.map((row) => ({ id: String(row.ordinal), date: '2026-08-20',
    sessionType: row.session_type, engagementType: row.engagement_type, engagementName: row.engagement,
    title: row.engagement, kind: 'timed', startMinutes: 540 + (row.ordinal - 1) * 60,
    endMinutes: row.ordinal === 1 ? 600 : 630, durationMinutes: row.duration_minutes, notes: null }));
  const choices = [];
  renderDailyAssessmentReport({}, root, { date: '2026-08-20', imported: true, ready: false,
    errors: [], warnings: [], completeness: null, metrics: null, events, foods: [], transactions: [], exercises: [] },
  { ...options, onTimeGroupingChange: (choice) => choices.push(choice) });
  const metrics = root.children[0];
  root.scrollTop = 900;
  switchChart(root);
  assert.equal(root.children[0], metrics);
  assert.equal(root.scrollTop, 900);
  assert.deepEqual(choices, ['session-type', 'engagement']);
});

test('active-file import preview exposes the same working time selector', async () => {
  const pending = confirmDailyImport({}, { ...options, title: 'Import assessment', explanation: 'Review',
    confirmLabel: 'Import', inspection: { date: '2026-08-20', imported: false, replacement: null, ready: true,
      errors: [], warnings: [], preview: { daily_metrics: {}, sessions, meals: [], transactions: [], exercises: [] } } });
  switchChart(Modal.opened.contentEl);
  Modal.opened.close();
  assert.equal(await pending, false);
});

test('report keeps the timeline beside an ordered detail column without changing report content', () => {
  const root = new TestElement();
  renderDailyAssessmentReport({}, root, { date: '2026-08-20', imported: true, ready: false,
    errors: [], warnings: [], completeness: null, metrics: { notes: 'Daily reflection' },
    events: [], foods: [], transactions: [], exercises: [],
    health: { medicationState: 'none', symptomsState: 'none', intakes: [], occurrences: [] } }, options);
  const layout = root.children.find((element) => element.className === 'examined-human-daily-report-layout');
  const columns = layout.children[0];
  assert.equal(columns.className, 'examined-human-daily-report-columns');
  assert.equal(columns.children.length, 2);
  assert.match(columns.children[0].text(), /Day timeline/);
  const details = columns.children[1];
  assert.equal(details.className, 'examined-human-daily-report-details');
  assert.deepEqual(details.children.map((panel) => panel.all().find((element) => element.tag === 'h3').textContent),
    ['Time by engagement', 'Foods consumed', 'Finance', 'Exercise details', 'Medication and symptoms', 'Notes']);
  assert.match(details.text(), /Daily reflection/);
  assert.match(details.text(), /Medication: none; Symptoms: none/);
});
