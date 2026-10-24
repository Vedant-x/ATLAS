import test from 'node:test';
import assert from 'node:assert/strict';
import { breaker, carryStatus } from '../js/breaker.js';

test('breaker: a source failing 3 builds in a row is tried once every 6 hours until it works', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  assert.equal(breaker(null, { now }).skip, false); // never seen
  assert.equal(breaker({ ok: true }, { now }).skip, false);
  assert.equal(breaker({ ok: false, failStreak: 2, lastAttemptAt: now - 6e4 }, { now }).skip, false); // not yet 3
  const b = breaker({ ok: false, failStreak: 3, lastAttemptAt: now - 36e5 }, { now });
  assert.equal(b.skip, true);
  assert.equal(b.next, now + 5 * 36e5);
  assert.equal(breaker({ ok: false, failStreak: 9, lastAttemptAt: now - 7 * 36e5 }, { now }).skip, false); // due a retry
});

test('source status carried across builds: streaks, last success, and a pause that keeps the last real try', () => {
  const t0 = Date.parse('2026-10-23T12:00:00Z');
  const a = carryStatus({ ok: false, at: t0, note: '502' }, { ok: true, at: t0 - 36e5, lastSuccessAt: t0 - 36e5 });
  assert.deepEqual([a.failStreak, a.lastSuccessAt, a.lastAttemptAt, a.status], [1, t0 - 36e5, t0, 'failed']);
  const b = carryStatus({ ok: false, at: t0 + 1, skipped: true }, { ...a, failStreak: 4 });
  assert.deepEqual([b.failStreak, b.lastAttemptAt, b.status], [4, t0, 'paused']);
  assert.equal(a.downSince, t0);
  assert.equal(b.downSince, t0, 'down since the first failed build');
  const c = carryStatus({ ok: true, at: t0 + 2, count: 10 }, b);
  assert.deepEqual([c.failStreak, c.lastSuccessAt, c.status, c.downSince], [0, t0 + 2, 'ok', null]);
});
