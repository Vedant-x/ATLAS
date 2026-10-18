import test from 'node:test';
import assert from 'node:assert/strict';

test('price time: the quote\'s own time, else the feed read; never the build time', async () => {
  const { priceTime } = await import('../js/readiness.js');
  assert.equal(priceTime({ priceAt: 5, fetchedAt: 9, markets: [{}] }), 5);
  assert.equal(priceTime({ fetchedAt: 9, markets: [{}] }), 9);
  assert.equal(priceTime({ markets: [{}] }), null, 'no time: freshness unknown');
  assert.equal(priceTime({ fetchedAt: 9, markets: [] }), null, 'no price at all');
});
