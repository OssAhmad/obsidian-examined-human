import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNKNOWN_TYPE_COLOR,
  colorForSession,
  formatExerciseNumber,
  formatMinutesAsClock,
  parseDatabaseTime,
  sessionFooterText,
  shouldShowSessionTypeFooter,
  titleForEngagement,
} from './events.ts';

const event = (sessionType) => ({
  id: '1', date: '2026-07-20', sessionType, engagementName: 'MIT Differential Equations',
  engagementType: 'academic', title: titleForEngagement('MIT Differential Equations'),
  kind: 'timed', startMinutes: 575, endMinutes: 659, durationMinutes: 84, notes: null,
});

test('database times accept an unpadded hour', () => {
  assert.equal(parseDatabaseTime('9:35'), 575);
  assert.equal(parseDatabaseTime('09:35:00'), 575);
  assert.equal(parseDatabaseTime('24:00'), null);
});

test('duration is formatted as hh:mm', () => {
  assert.equal(formatMinutesAsClock(84), '01:24');
  assert.equal(formatMinutesAsClock(5), '00:05');
});

test('exercise measurements preserve whole and decimal values', () => {
  assert.equal(formatExerciseNumber(80), '80');
  assert.equal(formatExerciseNumber(12.5), '12.5');
});

test('event titles use the canonical engagement name', () => {
  assert.equal(titleForEngagement('MIT Differential Equations'), 'MIT Differential Equations');
});

test('session type footer appears only on sufficiently tall non-stacked cards', () => {
  assert.equal(shouldShowSessionTypeFooter(44, false), true);
  assert.equal(shouldShowSessionTypeFooter(43.9, false), false);
  assert.equal(shouldShowSessionTypeFooter(80, true), false);
});

test('session footer includes milestone counts only when milestones exist', () => {
  assert.equal(sessionFooterText(event('study')), 'study');
  assert.equal(sessionFooterText({ ...event('study'), milestoneDetails: [{
    name: 'Problem Set 3', date: '2026-07-20', notes: null, measurements: [],
  }] }), 'study, 1 milestone');
  assert.equal(sessionFooterText({ ...event('study'), milestoneDetails: [
    { name: 'Problem Set 3', date: '2026-07-20', notes: null, measurements: [] },
    { name: 'Exam 1', date: '2026-07-20', notes: null, measurements: [] },
  ] }), 'study, 2 milestones');
});

test('chor stays distinct and gray', () => {
  assert.equal(colorForSession(event('chor'), { chor: '#ff0000' }), UNKNOWN_TYPE_COLOR);
  assert.notEqual(colorForSession(event('chore'), { chore: '#123456' }), UNKNOWN_TYPE_COLOR);
});
