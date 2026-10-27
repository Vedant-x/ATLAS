// The checks the 27 Oct 2026 review requires before any recommendation: times fail closed, the quote
// and the reference are read together, every return reproduces from its named chance, no qualifying
// candidate means no recommendation of any kind, a failed feed is never "no fixtures", and a thin
// record never reads as a reliable one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bestBets, valueBets, selectPicks, freshAt, comparable, FRESH, parlayOfDay } from '../js/track.js';
import { bankerSlips } from '../js/picks.js';
import { recordText, feedText, MIN_EVIDENCE } from '../js/honest.js';
import { withRef } from './support/ref.mjs';

const H = 36e5;
const now = Date.now();
// Arsenal at 1.40 against a fair chance of 0.73 (fair odds 1.37): a Best bet when the times are good.
const ev = (extra = {}) => ({ id: 'a', compId: '1', sport: 'football', leaguePath: 'soccer/eng.1', league: 'EPL', home: 'Arsenal', away: 'Leeds', start: now + 3 * H, live: false,
  sharpAt: now - H, fetchedAt: now - 6e4,
  markets: [{ name: 'Winner', consensusFrom: 'Pinnacle', outcomes: [{ name: 'Arsenal', odds: 1.4, cons: 0.73 }, { name: 'Leeds', odds: 3.2, cons: 0.27 }] }], ...extra });

test('1. a missing, zero, non-finite, future-dated or stale time never qualifies a bet', () => {
  assert.equal(bestBets([ev()]).length, 1, 'the control: good times qualify');
  for (const [why, extra] of [['no reference time', { sharpAt: undefined }], ['zero', { sharpAt: 0 }], ['NaN', { sharpAt: NaN }], ['an hour in the future', { sharpAt: now + H }],
    ['11 hours old', { sharpAt: now - 11 * H }], ['no quote time', { fetchedAt: undefined }], ['quote from tomorrow', { fetchedAt: now + 24 * H }]]) {
    assert.deepEqual(bestBets([ev(extra)]), [], why);
  }
  assert.equal(freshAt(now + 4 * 6e4), true, 'a few minutes of clock skew is allowed');
  assert.equal(freshAt(now + 6 * 6e4), false);
  assert.equal(freshAt('2026-10-27'), false, 'a string is not a time');
});

test('2. the quote and the reference must be read within the stated tolerance of each other', () => {
  // Reference read 7 hours before the quote (both within their own maximum ages): not comparable.
  const apart = ev({ sharpAt: now - 7.5 * H, fetchedAt: now - 0.5 * H });
  assert.equal(comparable({ event: apart, atStake: false }), false);
  assert.deepEqual(bestBets([apart]), []);
  assert.ok(FRESH.apart <= FRESH.reference);
  // Stake's price is judged on Stake's own read time, not the board's.
  const staleStake = ev({ stakeAt: now - 7 * H, sharpAt: now - 0.5 * H, markets: [{ name: 'Match Result', consensusFrom: 'Pinnacle', outcomes: [{ name: 'Arsenal', odds: 1.3, cons: 0.6, stake: 2 }, { name: 'Draw', odds: 4.5, cons: 0.22 }, { name: 'Leeds', odds: 5, cons: 0.18 }] }] });
  assert.ok(!valueBets([staleStake]).some((b) => b.atStake), 'a Stake read 6.5 hours apart from the line is not taken');
});

test('3. every return reproduces from its named chance and the price; the basis is named', () => {
  const [b] = bestBets([ev()]);
  assert.equal(b.selectionBasis, 'reference');
  assert.ok(Math.abs(b.referenceEV - (b.referenceProbability * b.odds - 1)) < 1e-9);
  assert.ok(Math.abs(b.modelEV - (b.modelProbability * b.odds - 1)) < 1e-9);
  assert.match(b.referenceMethod, /Pinnacle/);
  assert.ok(Number.isFinite(b.quoteAt) && Number.isFinite(b.referenceAt));
  const [rec] = selectPicks([ev()], now, 12, []).filter((p) => p.type === 'best');
  assert.equal(rec.refP, +b.referenceProbability.toFixed(4), 'the record keeps the same named fields');
  assert.equal(rec.refEV, +b.referenceEV.toFixed(4));
  assert.equal(rec.basis, 'reference');
  assert.equal(rec.priceAt, b.quoteAt, 'and the time of the quote taken');
  assert.equal(rec.uncertaintyRange, null);
});

test('4. no qualifying candidate means no recommendation of any kind: singles, slips or the parlay of the day', () => {
  // The same board with one bookmaker's prices only (no market reference): nothing qualifies.
  const board = Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, compId: String(i), sport: 'basketball', leaguePath: 'basketball/nba', league: 'NBA', home: `H${i}`, away: `A${i}`,
    start: now + (2 + (i % 8)) * H, live: false, fetchedAt: now - 6e4, markets: [{ name: 'Winner', outcomes: [{ name: `H${i}`, odds: [1.22, 1.3, 1.36, 1.45][i % 4] }, { name: `A${i}`, odds: [4.4, 3.6, 3.2, 2.8][i % 4] }] }] }));
  assert.deepEqual(selectPicks(board, now, 12, []).filter((p) => p.type !== 'probe'), [], 'nothing recorded');
  assert.deepEqual(bankerSlips(board, 2), []);
  assert.equal(parlayOfDay(board, { now }), null);
  // With references at exactly the fair odds the same board gives slips again (the control).
  assert.ok(bankerSlips(board.map((e) => withRef(e, now)), 2).length > 0);
  assert.deepEqual(bankerSlips(board, 2, { reference: false }).length > 0, true, 'research mode still builds them, never recommended');
});

test('5. a failed or paused feed never reads as "no fixtures"', () => {
  assert.equal(feedText({ known: true }), 'No fixtures in the next 4 days');
  assert.match(feedText({ failed: true, builtAgo: '12m ago' }), /^Feed temporarily unavailable; showing the last successful snapshot \(built 12m ago\)$/);
  assert.match(feedText({ paused: true }), /unavailable/);
  assert.equal(feedText({}), 'Loading fixtures…');
});

test('7. a thin record says it is too thin; it never shows a hit rate or ROI', () => {
  const one = recordText({ won: 1, lost: 0, hitRate: 1, profit: 0.37, roi: 0.37 });
  assert.equal(one, '1 settled pick (1–0): too few to judge yet');
  assert.doesNotMatch(one, /%|ROI/);
  const enough = recordText({ won: 20, lost: MIN_EVIDENCE - 20, hitRate: 0.67, profit: 1, roi: 0.033 });
  assert.match(enough, /hit rate .*ROI/);
});
