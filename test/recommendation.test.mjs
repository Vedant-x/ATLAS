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
  assert.equal(a.quoteAt, 900, 'the quote time, not the fixture time');
  assert.equal(a.fetchedAt, 1000, 'when ATLAS read the feed, kept apart');
  assert.equal(a.sourceUpdatedAt, null, 'this feed gives no quote time of its own');
  assert.equal(a.rawProbability, 0.63);
  assert.equal(a.calibratedProbability, 0.6);
  assert.equal(a.marketProbability, 0.55);
  assert.match(a.settlementRules, /pushes/);
  assert.equal(a.uncertaintyRange, null, 'no fixture-level range until a method is validated');
  assert.match(a.uncertaintyMethod, /not validated/);
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
  // A cohort hit-rate interval is not a range for one match: none is given, only the support count.
  assert.equal(uncertainty(0.6, 1000).range, null);
  assert.match(uncertainty(0.6, 0).method, /no settled forecasts/);
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

test('quote provenance: a pick taken at Stake carries Stake\'s read time and bookmaker, and the named fields', () => {
  const ev = { id: 'e2', sport: 'football', league: 'EPL', fetchedAt: 5000, priceAt: null, stakeAt: 4000, sharpAt: 3500, bookmaker: 'DraftKings', quoteType: 'bookmaker', markets: [{}] };
  const pick = { event: ev, market: 'Match Result', pick: 'Draw', odds: 4.7, p: 0.2353, pRaw: 0.25, fair: 0.2353, book: 'Stake', atStake: true,
    modelProbability: 0.25, modelEV: 0.25 * 4.7 - 1, referenceProbability: 0.2353, referenceEV: 0.2353 * 4.7 - 1, selectionBasis: 'reference', referenceMethod: 'Pinnacle, margin removed', referenceAt: 3500 };
  const r = recommendation(pick, { modelVersion: 'm' });
  assert.deepEqual([r.bookmaker, r.quoteAt, r.fetchedAt, r.referenceAt], ['Stake', 4000, 4000, 3500]);
  assert.match(r.quoteId, /\|Stake\|.*#4000$/);
  assert.equal(+(r.referenceProbability * r.quotedOdds - 1).toFixed(6), +r.referenceEV.toFixed(6), 'each return reproduces from its named chance and the price');
  assert.equal(+(r.modelProbability * r.quotedOdds - 1).toFixed(6), +r.modelEV.toFixed(6));
  assert.equal(r.selectionBasis, 'reference');
});
