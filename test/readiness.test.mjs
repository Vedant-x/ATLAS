import test from 'node:test';
import assert from 'node:assert/strict';

test('price time: the quote\'s own time, else the feed read; never the build time', async () => {
  const { priceTime } = await import('../js/readiness.js');
  assert.equal(priceTime({ priceAt: 5, fetchedAt: 9, markets: [{}] }), 5);
  assert.equal(priceTime({ fetchedAt: 9, markets: [{}] }), 9);
  assert.equal(priceTime({ markets: [{}] }), null, 'no time: freshness unknown');
  assert.equal(priceTime({ fetchedAt: 9, markets: [] }), null, 'no price at all');
});

test('freshness limits tighten as the start nears and for fast-moving markets', async () => {
  const { priceLimit, readiness } = await import('../js/readiness.js');
  const H = 36e5;
  assert.equal(priceLimit('football', 48 * H), 360);
  assert.equal(priceLimit('football', 3 * H), 60);
  assert.equal(priceLimit('football', 0.5 * H), 20);
  assert.equal(priceLimit('tennis', 3 * H), 30);
  // A 90-minute-old price: fine two days out, stale 30 minutes before kick-off.
  const now = Date.parse('2026-10-18T12:00:00Z');
  const e = (start) => ({ sport: 'football', leaguePath: 'soccer/eng.1', start, markets: [{}], priceAt: now - 90 * 6e4 });
  assert.notEqual(readiness(e(now + 48 * H), { now }).state, 'stale');
  assert.equal(readiness(e(now + 0.5 * H), { now }).state, 'stale');
});
