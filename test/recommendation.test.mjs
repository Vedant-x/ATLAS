import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendation, lineOf, settlementRules, uncertainty } from '../js/recommendation.js';

const e = { id: 'e1', sport: 'football', league: 'EPL', home: 'Arsenal', away: 'Leeds', fetchedAt: 1000, priceAt: 900, bookmaker: 'best of 9 bookmakers', quoteType: 'best-available', markets: [{}] };
const b = { event: e, market: 'Total 2.5', pick: 'Over 2.5', odds: 1.8, p: 0.6, pRaw: 0.63, fair: 0.55, book: 'Pinnacle' };

test('one recommendation object: same pick, quote and model give the same id; any change gives a new one', () => {
  const a = recommendation(b, { modelVersion: 'm1', calibrationVersion: 'cal-10', calN: 100 });
  assert.equal(recommendation({ ...b }, { modelVersion: 'm1', calibrationVersion: 'cal-10', calN: 100, now: 5 }).recommendationId, a.recommendationId);
  assert.notEqual(recommendation({ ...b, odds: 1.85 }, { modelVersion: 'm1', calibrationVersion: 'cal-10' }).recommendationId, a.recommendationId, 'a new price is a new recommendation');
  assert.notEqual(recommendation(b, { modelVersion: 'm2', calibrationVersion: 'cal-10' }).recommendationId, a.recommendationId, 'a new model too');
  assert.equal(a.canonicalSelectionId, 'e1|total 2.5|over 2.5');
  assert.equal(a.line, 2.5);
  assert.equal(a.bookmaker, 'Pinnacle');
  assert.equal(a.quoteType, 'best-available');
  assert.equal(a.fetchedAt, 900, 'the quote time, not the fixture time');
  assert.equal(a.rawProbability, 0.63);
  assert.equal(a.calibratedProbability, 0.6);
  assert.equal(a.marketProbability, 0.55);
  assert.match(a.settlementRules, /pushes/);
  assert.ok(a.uncertaintyRange[0] < 0.6 && a.uncertaintyRange[1] > 0.6);
  // A model-only pick has no bookmaker and no quote id.
  const m = recommendation({ ...b, priced: false }, { modelVersion: 'm1' });
  assert.equal(m.bookmaker, null);
  assert.equal(m.quoteId, null);
  assert.equal(m.quoteType, 'model fair odds');
});

test('lines, settlement rules and uncertainty', () => {
  assert.equal(lineOf('Arsenal -1.5'), -1.5);
  assert.equal(lineOf('Haaland 2+ Shots'), 2);
  assert.equal(lineOf('Arsenal'), null);
  assert.match(settlementRules('Match Result', 'football'), /90 minutes/);
  assert.match(settlementRules('Player Points', 'basketball'), /DNP/);
  const narrow = uncertainty(0.6, 1000), wide = uncertainty(0.6, 20);
  assert.ok(narrow.range[1] - narrow.range[0] < wide.range[1] - wide.range[0]);
  assert.deepEqual(uncertainty(0.6, 0).range, [0.44999999999999996, 0.75]);
});

test('forecast revision: a new chance, bookmaker or quote time is a new forecast, the selection id stays', async () => {
  const { recommendation } = await import('../js/recommendation.js');
  const e = { id: 'e9', sport: 'hockey', league: 'NHL', markets: [{}], fetchedAt: 1000, priceAt: 900, bookmaker: 'Book A' };
  const b = { event: e, market: 'Winner', pick: 'Colorado Avalanche', odds: 1.44, p: 0.71, pRaw: 0.7, book: 'Book A' };
  const opt = { modelVersion: 'm1', calibrationVersion: 'cal-10-x' };
  const a = recommendation(b, opt);
  const lower = recommendation({ ...b, p: 0.65 }, opt);
  const otherBook = recommendation({ ...b, book: 'Book B' }, opt);
  const later = recommendation({ ...b, event: { ...e, priceAt: 2000 } }, opt);
  for (const x of [lower, otherBook, later]) {
    assert.equal(x.canonicalSelectionId, a.canonicalSelectionId);
    assert.notEqual(x.forecastId, a.forecastId);
  }
  assert.equal(recommendation(b, opt).forecastId, a.forecastId, 'the same forecast keeps its id');
  assert.equal(a.forecastGeneratedAt, 1000, 'generated at the data build, not at render time');
  assert.equal(a.publishedAt, null);
});
