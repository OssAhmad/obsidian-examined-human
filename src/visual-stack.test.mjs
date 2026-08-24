import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutVisualStack } from './visual-stack.ts';

const event = (id, startMinutes, endMinutes) => ({
  id,
  date: '2026-07-12',
  sessionType: 'study',
  engagementName: id,
  engagementType: 'academic',
  title: id,
  kind: 'timed',
  startMinutes,
  endMinutes,
  durationMinutes: endMinutes - startMinutes,
  notes: null,
});

test('close short sessions form a readable stack within ten minutes of real endpoints', () => {
  const events = [event('anki', 1208, 1220), event('duo-1', 1220, 1225), event('duo-2', 1225, 1230)];
  const positions = layoutVisualStack(events, 1.15);
  let previousEnd = -1;

  for (const item of events) {
    const position = positions.get(item.id);
    assert.equal(position.stacked, true);
    assert.ok(Math.abs(position.startMinutes - item.startMinutes) <= 10);
    assert.ok(Math.abs(position.startMinutes + position.durationMinutes - item.endMinutes) <= 10);
    assert.ok(position.startMinutes > previousEnd);
    previousEnd = position.startMinutes + position.durationMinutes;
  }
});

test('an impossibly dense cluster falls back to exact top positions', () => {
  const events = Array.from({ length: 8 }, (_, index) => event(String(index), 600 + index * 5, 605 + index * 5));
  const positions = layoutVisualStack(events, 1.15);

  for (const item of events) {
    const position = positions.get(item.id);
    assert.equal(position.stacked, false);
    assert.equal(position.startMinutes, item.startMinutes);
  }
});

test('ordinary sessions retain exact vertical positioning', () => {
  const events = [event('a', 540, 600), event('b', 630, 690)];
  const positions = layoutVisualStack(events, 1.15);

  assert.deepEqual([...positions.values()], [
    { startMinutes: 540, durationMinutes: 60, stacked: false },
    { startMinutes: 630, durationMinutes: 60, stacked: false },
  ]);
});

test('real temporal overlaps keep the existing exact-top fallback', () => {
  const events = [event('a', 540, 600), event('b', 570, 575)];
  const positions = layoutVisualStack(events, 1.15);

  assert.equal(positions.get('a').stacked, false);
  assert.equal(positions.get('b').stacked, false);
  assert.equal(positions.get('b').startMinutes, 570);
});
