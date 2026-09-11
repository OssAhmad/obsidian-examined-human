import assert from 'node:assert/strict';
import test from 'node:test';
import { inferDailyActivity, inferSleepHours, mergeTodayWithWeekly } from './daily-inference.ts';

const signal = (overrides = {}) => ({
  date: '2026-09-11', startMinutes: 60, endMinutes: 120,
  sessionType: '', engagementType: '', engagementName: 'Anything',
  ...overrides,
});

test('activity inference uses the confirmed session and engagement mappings', () => {
  assert.deepEqual(inferDailyActivity([
    signal({ engagementType: 'course' }),
    signal({ sessionType: 'work' }),
    signal({ engagementType: 'fitness' }),
  ]), { studied: 1, worked: 1, exercised: 1 });
  assert.deepEqual(inferDailyActivity([signal({ hasExerciseDetails: true })]).exercised, 1);
});

test('sleep combines split sessions across the 21:00 assessment boundary', () => {
  const hours = inferSleepHours('2026-09-11', [
    signal({ date: '2026-09-10', startMinutes: 22 * 60, endMinutes: 23 * 60 + 59, sessionType: 'sleep' }),
    signal({ startMinutes: 0, endMinutes: 7 * 60, engagementName: 'Sleep' }),
    signal({ startMinutes: 22 * 60, endMinutes: 23 * 60, engagementType: 'sleep' }),
  ]);
  assert.equal(hours, 9);
});

test('sleep inference merges overlaps instead of double-counting them', () => {
  assert.equal(inferSleepHours('2026-09-11', [
    signal({ startMinutes: 0, endMinutes: 7 * 60, sessionType: 'sleep' }),
    signal({ startMinutes: 6 * 60, endMinutes: 8 * 60, sessionType: 'sleep' }),
  ]), 8);
});

test('sleep inference honors a configurable whole-hour day boundary', () => {
  assert.equal(inferSleepHours('2026-09-11', [
    signal({ date: '2026-09-10', startMinutes: 17 * 60, endMinutes: 19 * 60, sessionType: 'sleep' }),
    signal({ startMinutes: 17 * 60, endMinutes: 19 * 60, engagementName: 'Sleep' }),
  ], 18), 2);
  assert.throws(() => inferSleepHours('2026-09-11', [], 18.5), /whole hour/);
});

test('today keeps non-conflicting weekly sessions and gives daily sessions overlap priority', () => {
  const event = (id, startMinutes, endMinutes, planningSource) => ({
    id, date: '2026-09-11', sessionType: '', engagementType: '', engagementName: id,
    title: id, kind: 'timed', startMinutes, endMinutes, durationMinutes: endMinutes - startMinutes,
    notes: null, sourceKind: 'planned', planningSource,
  });
  const merged = mergeTodayWithWeekly(
    [event('daily', 8 * 60, 10 * 60, 'daily-note')],
    [event('weekly-conflict', 9 * 60, 11 * 60, 'weekly-plan'), event('weekly-afternoon', 14 * 60, 15 * 60, 'weekly-plan')],
  );
  assert.deepEqual(merged.map((row) => row.id), ['daily', 'weekly-afternoon']);
});
