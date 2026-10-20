import assert from 'node:assert/strict';
import test from 'node:test';
import { SourceMonitor } from './source-monitor.ts';

function harness() {
  const state = { fingerprint: 'mtime1', signature: 'bytes1', day: '2026-08-22', reads: 0, notices: [], failure: null };
  const monitor = new SourceMonitor({
    fingerprint: async () => state.fingerprint,
    signature: async () => { state.reads++; if (state.failure) throw new Error(state.failure); return state.signature; },
    day: () => state.day,
    changed: (message) => state.notices.push(message),
  });
  return { monitor, state };
}

test('polling, metadata-only changes, and unchanged authoritative reloads never notify or redraw', async () => {
  const { monitor, state } = harness();
  await monitor.check();
  await monitor.check();
  assert.equal(state.reads, 1);
  state.fingerprint = 'mtime2';
  await monitor.check();
  await monitor.check(true);
  assert.equal(state.reads, 3);
  assert.deepEqual(state.notices, []);
});

test('file events and overlapping polls observe one content change once', async () => {
  const { monitor, state } = harness();
  await monitor.check();
  state.fingerprint = 'mtime2'; state.signature = 'bytes2';
  await Promise.all([monitor.check(true), monitor.check(), monitor.check(true)]);
  await monitor.check();
  await monitor.check(true);
  assert.deepEqual(state.notices, ['Updated data available']);
});

test('ten-minute authoritative check catches changed bytes even when metadata is preserved', async () => {
  const { monitor, state } = harness();
  await monitor.check();
  state.signature = 'external bytes with unchanged mtime';
  await monitor.check();
  assert.equal(state.notices.length, 0);
  await monitor.check(true);
  assert.equal(state.notices.length, 1);
  state.day = '2026-08-23';
  await monitor.check();
  assert.equal(state.notices.length, 2, 'date-relative dashboards notice midnight');
});

test('manual refresh acknowledges only its snapshot; subsequent external changes still notify', async () => {
  const { monitor, state } = harness();
  await monitor.check();
  state.fingerprint = 'mtime2'; state.signature = 'bytes2';
  await monitor.acknowledge();
  await monitor.check(true);
  assert.equal(state.notices.length, 0);
  state.signature = 'bytes3';
  await monitor.check(true);
  assert.equal(state.notices.length, 1);
});

test('WAL/unavailable source changes notify once and recovery remains detectable', async () => {
  const { monitor, state } = harness();
  await monitor.check();
  state.failure = 'WAL contains frames'; state.fingerprint = 'wal changed';
  await monitor.check(true);
  await monitor.check(true);
  assert.deepEqual(state.notices, ['Database unavailable or awaiting a WAL checkpoint']);
  state.failure = null; state.signature = 'checkpointed bytes'; state.fingerprint = 'checkpointed';
  await monitor.check();
  assert.equal(state.notices.length, 2);
});
