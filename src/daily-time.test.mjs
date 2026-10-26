import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyTimeTypeLabel } from './events.ts';
import { dailyTimeTotals } from './daily-time.ts';

const event = (sessionType = '', engagementType = '', engagementName = 'Example', durationMinutes = 30) => ({
  sessionType, engagementType, engagementName, durationMinutes,
});

test('daily time groups use the approved taxonomy aliases and keep distinct activities separate', () => {
  for (const [label, types] of Object.entries({
    Study: ['study', 'academia', 'academic', 'course', 'certification', 'exam'],
    Work: ['work', 'career', 'startup'], Exercise: ['exercise', 'fitness'], Social: ['social', 'relationship'],
    Writing: ['writing', 'authorship', 'article', 'book', 'speech'], Maintenance: ['maintenance', 'chore'],
    Reading: ['reading'], Research: ['research'], Thinking: ['thinking'], Practice: ['practice'],
    Leisure: ['leisure'], Meditation: ['meditation'], Sleep: ['sleep'],
  })) {
    for (const type of types) {
      assert.equal(dailyTimeTypeLabel(event(type)), label, type);
      assert.equal(dailyTimeTypeLabel(event('', type)), label, `fallback ${type}`);
    }
  }
});

test('explicit session types win, blank types fall back, and Sleep stays outside Maintenance', () => {
  assert.equal(dailyTimeTypeLabel(event(' RESEARCH ', 'career')), 'Research');
  assert.equal(dailyTimeTypeLabel(event(' ', ' CAREER ')), 'Work');
  assert.equal(dailyTimeTypeLabel(event('', 'maintenance', ' Sleep ')), 'Sleep');
  assert.equal(dailyTimeTypeLabel(event('sleep', 'maintenance')), 'Sleep');
  assert.equal(dailyTimeTypeLabel(event('work', 'maintenance', 'Sleep')), 'Sleep');
  assert.equal(dailyTimeTypeLabel(event('', 'maintenance', 'Sleep research')), 'Maintenance');
  assert.equal(dailyTimeTypeLabel(event('chor', 'maintenance')), 'Chor');
  assert.equal(dailyTimeTypeLabel(event('custom-type', 'career')), 'Custom-type');
  assert.equal(dailyTimeTypeLabel(event('constructor')), 'Constructor');
  assert.equal(dailyTimeTypeLabel(event()), 'Unspecified');
});

test('changing daily time grouping preserves every recorded minute and original event', () => {
  const events = [event('study', 'course', 'Course A', 60), event('', 'academia', 'Course B', 35),
    event('work', 'career', 'Job', 45), event('', 'career', 'Job', 30),
    event('chore', 'maintenance', 'Housekeeping', 20), event('', 'maintenance', 'Sleep', 480)];
  const before = structuredClone(events);
  assert.deepEqual(dailyTimeTotals(events, 'session-type'), [
    { label: 'Sleep', minutes: 480 }, { label: 'Study', minutes: 95 },
    { label: 'Work', minutes: 75 }, { label: 'Maintenance', minutes: 20 },
  ]);
  const byEngagement = dailyTimeTotals(events, 'engagement');
  assert.equal(byEngagement.find((row) => row.label === 'Job').minutes, 75);
  for (const mode of ['engagement', 'session-type']) {
    assert.equal(dailyTimeTotals(events, mode).reduce((sum, row) => sum + row.minutes, 0), 670);
  }
  assert.deepEqual(events, before);
  assert.deepEqual(dailyTimeTotals([], 'session-type'), []);
});
