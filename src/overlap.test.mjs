import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutOverlappingEvents } from './overlap.ts';

const event = (id, startMinutes, endMinutes) => ({
  id,
  date: '2026-07-20',
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

test('overlapping sessions use different columns', () => {
  const placed = layoutOverlappingEvents([event('a', 540, 660), event('b', 570, 600)]);
  assert.deepEqual(placed.map((item) => [item.column, item.columnCount]), [[0, 2], [1, 2]]);
});

test('sessions touching at an endpoint do not overlap', () => {
  const placed = layoutOverlappingEvents([event('a', 540, 600), event('b', 600, 660)]);
  assert.ok(placed.every((item) => item.columnCount === 1));
});

test('an overlap group shares the maximum concurrent column count', () => {
  const placed = layoutOverlappingEvents([
    event('a', 540, 720), event('b', 570, 630), event('c', 600, 660),
  ]);
  assert.ok(placed.every((item) => item.columnCount === 3));
});
