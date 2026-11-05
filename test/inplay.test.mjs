import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRates, liveChance, liveBets, shareLeft } from '../js/inplay.js';

const now = Date.parse('2026-11-05T20:00:00Z');
const soccer = (score, clock, extra = {}) => ({ id: 'f1', sport: 'football', leaguePath: 'soccer/eng.1', home: 'Arsenal', away: 'Leeds', start: now - 36e5, live: true, score, displayClock: clock, priceAt: now - 3 * 36e5,
  markets: [{ name: 'Match Result', outcomes: [{ name: 'Arsenal', odds: 1.6, cons: 0.6 }, { name: 'Draw', odds: 4.2, cons: 0.23 }, { name: 'Leeds', odds: 6, cons: 0.17 }] }], ...extra });

test('football goal rates reproduce the pre-match 1X2', () => {
  const f = fitRates(0.6, 0.23, 0.17);
  assert.ok(f.err < 1e-4, String(f.err));
  assert.ok(f.lh > f.la);
});

test('football: the live chance follows the score and the clock', () => {
  const k0 = liveChance(soccer('0 – 0', "1'"));
  assert.ok(Math.abs(k0.home - 0.6) < 0.02, 'at kick-off, the pre-match chance');
  const ahead = liveChance(soccer('1 – 0', "80'"));
  assert.ok(ahead.home > 0.85 && ahead.home < 0.97, String(ahead.home));
  const behind = liveChance(soccer('0 – 1', "80'"));
  assert.ok(behind.away > 0.75, String(behind.away));
  assert.equal(shareLeft(soccer('0 – 0', 'HT')), 0.5);
  // A price read after kick-off already holds the score: no prior, no chance.
  assert.equal(liveChance(soccer('1 – 0', "80'", { priceAt: now - 6e5 })), null);
  assert.equal(liveChance({ ...soccer('1 – 0', "80'"), live: false }), null);
});

test('basketball: margin, time left and the pre-match favourite', () => {
  const nba = (score, period, clock) => ({ id: 'b1', sport: 'basketball', leaguePath: 'basketball/nba', home: 'Celtics', away: 'Nets', start: now - 36e5, live: true, score, period, displayClock: clock, priceAt: now - 3 * 36e5,
    markets: [{ name: 'Winner', outcomes: [{ name: 'Celtics', odds: 1.4, cons: 0.7 }, { name: 'Nets', odds: 3.2, cons: 0.3 }] }] });
  assert.ok(Math.abs(liveChance(nba('0 – 0', 1, '12:00')).home - 0.7) < 0.01);
  assert.ok(liveChance(nba('100 – 90', 4, '2:00')).home > 0.97);
  assert.ok(liveChance(nba('80 – 84', 3, '0:00')).away > 0.4);
  assert.equal(shareLeft(nba('0 – 0', 4, '6:00')), 0.125);
});

test('Best current, live part: the likeliest result between 60% and 97%, with its fair odds', () => {
  const list = liveBets([soccer('1 – 0', "70'"), soccer('0 – 0', "5'", { id: 'f2' }), soccer('3 – 0', "88'", { id: 'f3' })]);
  assert.deepEqual(list.map((b) => b.event.id), ['f1'], '60% at 5 minutes is out (just under), 3-0 at 88 is near certain');
  assert.equal(list[0].pick, 'Arsenal');
  assert.equal(list[0].fairOdds, +(1 / list[0].p).toFixed(2));
});
