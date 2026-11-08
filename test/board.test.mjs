// The full board (model 2026.11.5): the shortlist, every multiplier and the parlay of the day, under
// the lessons of the record: the market's chance, no price more than 3% under fair (5% with one
// bookmaker), singles from 1.30, Stake's price first, one pick per match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shortlist, BOARD, MULTI_TARGETS, multiPicks, calibration, pausedSegments, MODEL_VERSION } from '../js/track.js';
import { boardLeg, bankerSlips } from '../js/picks.js';
import { allLegs } from '../js/engine.js';

const H = 36e5;
const now = Date.now();
// Pinnacle's fair chance `cons` for the home side; the best price `odds`.
const ev = (id, odds, cons, extra = {}) => ({ id, compId: id, sport: 'football', leaguePath: 'soccer/eng.1', league: 'EPL', home: `H${id}`, away: `A${id}`, start: now + 3 * H, live: false,
  sharpAt: now - H, fetchedAt: now - 6e4, stakeAt: now - H,
  markets: [{ name: 'Winner', consensusFrom: 'Pinnacle', outcomes: [{ name: `H${id}`, odds, cons, ...(extra.stake ? { stake: extra.stake } : {}) }, { name: `A${id}`, odds: 1 / (1 - cons) * 0.97, cons: 1 - cons }] }], ...extra });

test('board legs: within 3% of fair, the market\'s chance, Stake first', () => {
  const legOf = (e) => allLegs([e]).find((l) => l.pick === `H${e.id}`);
  // 1.40 on a 70% favourite: 2% under fair (1.43). In, at the market's 70%.
  const a = boardLeg(legOf(ev('a', 1.4, 0.7)), now);
  assert.ok(a && Math.abs(a.marketP - 0.7) < 1e-9);
  // 1.35 on 70%: 5.5% under fair. Out.
  assert.equal(boardLeg(legOf(ev('b', 1.35, 0.7)), now), null);
  // Stake 1.39 is within 2% of the best 1.40: taken at Stake.
  const s = boardLeg(legOf(ev('c', 1.4, 0.7, { stake: 1.39 })), now);
  assert.equal(s.book, 'Stake');
  assert.equal(s.odds, 1.39);
  // A stale line is no reference.
  assert.equal(boardLeg(legOf(ev('d', 1.4, 0.7, { sharpAt: now - 11 * H })), now), null);
  // One bookmaker, no sharp line: in when its margin is 5% or less.
  const one = (h, a2) => allLegs([{ id: 'o', sport: 'football', home: 'X', away: 'Y', start: now + H, fetchedAt: now - 6e4, markets: [{ name: 'Winner', outcomes: [{ name: 'X', odds: h }, { name: 'Y', odds: a2 }] }] }])[0];
  assert.ok(boardLeg(one(1.52, 2.6), now), '4.3% margin');
  assert.equal(boardLeg(one(1.45, 2.45), now), null, '9% margin');
});

test('an old sharp line (12-24 h) is a second check on one-book picks and legs, not the reference', () => {
  // DraftKings 1.52 / 2.6 (4.3% margin) passes alone; Pinnacle's day-old line rates X at 62%.
  const e = (oldCons) => ({ id: `o${oldCons}`, compId: '9', sport: 'football', leaguePath: 'soccer/esp.1', league: 'LALIGA', home: 'X', away: 'Y', start: now + 3 * H, fetchedAt: now - 6e4, priceAt: now - 6e4, oldSharpAt: now - 15 * H,
    markets: [{ name: 'Winner', outcomes: [{ name: 'X', odds: 1.52, ...(oldCons ? { oldCons } : {}) }, { name: 'Y', odds: 2.6 }] }] });
  const leg = (ev) => allLegs([ev]).find((l) => l.pick === 'X');
  // 1.52 x 0.62 = 0.94: 6% under the old line's fair odds, outside the 5% band. Out, as a pick and as a leg.
  assert.equal(shortlist([e(0.62)], { now }).length, 0);
  assert.equal(boardLeg(leg(e(0.62)), now), null);
  // 1.52 x 0.64 = 0.97: within the band. In, judged on DraftKings' own price, the old line noted.
  const [b] = shortlist([e(0.64)], { now });
  assert.ok(b && b.oneBook, 'still a one-book pick');
  assert.equal(b.oldSharp, 0.64);
  assert.ok(boardLeg(leg(e(0.64)), now));
  // No old line: as before.
  assert.equal(shortlist([e(null)], { now }).length, 1);
});

test('the shortlist: odds 1.30 to 2.20, likeliest first by the market\'s chance, one per match', () => {
  const list = shortlist([ev('1', 1.4, 0.7), ev('2', 1.25, 0.79), ev('3', 1.6, 0.61), ev('4', 1.35, 0.7), ev('5', 2.0, 0.5)], { now });
  assert.deepEqual(list.map((b) => b.event.id), ['1', '3', '5'], '1.25 is under 1.30; 1.35 on 70% is 5.5% under fair');
  assert.ok(list.every((b) => b.odds >= BOARD.minOdds && b.odds <= BOARD.maxOdds));
  assert.equal(list[0].p, 0.7, 'the chance shown is the market\'s');
  assert.ok(list[0].referenceEV < 0 && list[0].referenceEV >= BOARD.gap, 'and the cards show how far under fair');
});

test('every multiplier from 2x to 1000x builds from board legs and is recorded', () => {
  assert.deepEqual(MULTI_TARGETS, [2, 3, 4, 5, 10, 20, 100, 1000]);
  const board = Array.from({ length: 40 }, (_, i) => ev(`m${i}`, [1.3, 1.45, 1.6, 1.8][i % 4], [0.76, 0.68, 0.62, 0.55][i % 4], { start: now + (2 + (i % 9)) * H, home: `T${i}a`, away: `T${i}b` }))
    .map((e) => ({ ...e, markets: [{ ...e.markets[0], outcomes: [{ ...e.markets[0].outcomes[0], name: e.home }, { ...e.markets[0].outcomes[1], name: e.away }] }] }));
  for (const t of [2, 3, 5, 10, 20]) {
    const [s] = bankerSlips(board, t, { count: 1, minOdds: BOARD.legMinOdds, now });
    assert.ok(s, `${t}x`);
    assert.ok(s.odds >= t * 0.9 && s.odds <= t * 1.2, `${t}x at ${s.odds}`);
    assert.ok(s.legs.every((l) => l.odds * l.referenceProbability - 1 >= BOARD.gap - 1e-9), 'every leg within 3% of fair');
    assert.equal(new Set(s.legs.map((l) => l.eventId)).size, s.legs.length, 'one leg per match');
  }
  const rec = multiPicks(board, now, []);
  assert.ok(rec.some((r) => r.target === 2) && rec.some((r) => r.target === 10), rec.map((r) => r.target).join(','));
  assert.ok(rec.every((r) => r.model === MODEL_VERSION));
});

test('Current bets never runs dry: the likeliest results at any price fill in, each showing its distance from fair', async () => {
  const { likeliest } = await import('../js/track.js');
  // One bookmaker at a 7% margin: no board pick, but a likeliest result.
  const one = { id: 'l1', compId: 'l1', sport: 'football', leaguePath: 'soccer/eng.1', home: 'X', away: 'Y', start: now + 2 * H, fetchedAt: now - 6e4,
    markets: [{ name: 'Winner', outcomes: [{ name: 'X', odds: 1.45, }, { name: 'Y', odds: 2.55 }] }] };
  assert.deepEqual(shortlist([one], { now }), []);
  const [b] = likeliest([one], { now });
  assert.equal(b.pick, 'X');
  assert.ok(b.referenceEV < BOARD.gapOneBook, 'shown as under fair');
  assert.deepEqual(likeliest([{ ...one, start: now - H }], { now }), [], 'never a match that has started');
});

test('the self-check: a bet type landing clearly below its prices over 25+ results is paused and listed', () => {
  // 30 hockey winners at 1.40 (71% implied) that landed 12 times; 30 soccer winners on their prices.
  const pick = (sport, i, won) => ({ sport, market: 'Winner', p: 0.7, odds: 1.4, status: won ? 'won' : 'lost', start: now - (40 - i) * H, type: 'short' });
  const history = [...Array.from({ length: 30 }, (_, i) => pick('hockey', i, i < 12)), ...Array.from({ length: 30 }, (_, i) => pick('football', i, i < 21))];
  const paused = pausedSegments(calibration(history));
  assert.deepEqual(paused.map((x) => `${x.sport}:${x.family}`), ['hockey:winner']);
  assert.equal(paused[0].n, 30);
  assert.ok(paused[0].hit < paused[0].implied && paused[0].z <= -2);
  assert.deepEqual(pausedSegments(calibration(history.filter((h) => h.sport === 'football'))), [], 'nothing paused on its prices');
});
