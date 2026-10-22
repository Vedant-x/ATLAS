import test from 'node:test';
import assert from 'node:assert/strict';
import { carryOpen, drifting, moveOf } from '../js/movement.js';
import { valueBets, rankedBankers, selectPicks, summarize, VALUE } from '../js/track.js';

const H = 36e5;
const mk = (outcomes, extra = {}) => ({ name: 'Match Result', consensusFrom: 'Pinnacle', outcomes, ...extra });
const event = (id, markets, extra = {}) => ({ id, sport: 'football', leaguePath: 'soccer/eng.1', compId: id, home: 'Home', away: 'Away', start: Date.now() + 5 * H, live: false, markets, oddsSource: 'the-odds-api', ...extra });

test('price memory: the first price seen is kept build to build; a new source or a moved line starts afresh', () => {
  const prev = [event('a', [mk([{ name: 'Home', odds: 1.9, open: 2.0 }, { name: 'Away', odds: 2.0 }]), { name: 'Total 2.5', outcomes: [{ name: 'Over 2.5', odds: 1.8 }] }])];
  const now = [event('a', [mk([{ name: 'Home', odds: 1.7 }, { name: 'Away', odds: 2.3 }]), { name: 'Total 3.5', outcomes: [{ name: 'Over 3.5', odds: 2.4 }] }])];
  assert.equal(carryOpen(now, prev), 2);
  assert.deepEqual(now[0].markets[0].outcomes.map((o) => o.open), [2.0, 2.0]); // first ever, then last build's price
  assert.equal(now[0].markets[1].outcomes[0].open, 2.4); // the line moved: a new market
  const other = [event('a', [mk([{ name: 'Home', odds: 1.7 }])], { oddsSource: null })];
  carryOpen(other, prev);
  assert.equal(other[0].markets[0].outcomes[0].open, 1.7); // one bookmaker now, many before: not a move
  assert.ok(drifting(2.07, 2.0) && !drifting(2.05, 2.0) && !drifting(1.8, 2.0));
  assert.equal(+moveOf(1.8, 2.0).toFixed(2), -0.1);
});

test('value bets: best price 2%+ above Pinnacle fair odds (3% from a median), never drifting, biggest edge first', () => {
  const evs = [
    event('v1', [mk([{ name: 'Home', odds: 1.8, cons: 0.58, book: 'Unibet' }, { name: 'Draw', odds: 4.1, cons: 0.24 }, { name: 'Away', odds: 5.4, cons: 0.18 }])]),
    event('v2', [mk([{ name: 'Home', odds: 2.2, cons: 0.48, book: 'Betway' }, { name: 'Draw', odds: 3.3, cons: 0.28 }, { name: 'Away', odds: 4.2, cons: 0.24 }])]),
    // 1.55 x 0.70 = +8.5%, but the price was 1.42 when first seen: drifting.
    event('v3', [mk([{ name: 'Home', odds: 1.55, cons: 0.7, open: 1.42 }, { name: 'Draw', odds: 4.6, cons: 0.19 }, { name: 'Away', odds: 9.5, cons: 0.11 }])]),
    // A median of books needs 3%: +2.5% is not enough.
    event('v4', [mk([{ name: 'Home', odds: 2.05, cons: 0.5 }, { name: 'Away', odds: 1.9, cons: 0.5 }], { name: 'Winner', consensusFrom: 'median of 6+ books' })]),
    // One bookmaker (no consensus): never a value bet, whatever the model says.
    event('v5', [{ name: 'Winner', outcomes: [{ name: 'Home', odds: 2.5, model: 0.9 }, { name: 'Away', odds: 1.5 }] }]),
  ];
  const v = valueBets(evs, { limit: 10 });
  assert.deepEqual(v.map((b) => `${b.event.id} ${b.pick}`), ['v2 Home', 'v1 Home']);
  assert.equal(+v[0].edge.toFixed(3), 0.056); // 2.2 x 0.48 - 1
  assert.equal(v[1].takeAt, +((1 + VALUE.min) / 0.58).toFixed(2)); // worth it at 1.76+ anywhere
  assert.equal(v[1].p, 0.58); // the market's chance, not the model's
});

test('drift guard: a favourite whose price has drifted 3%+ leaves the shortlist', () => {
  const evs = [event('d1', [{ name: 'Winner', outcomes: [{ name: 'Home', odds: 1.5, open: 1.4 }, { name: 'Away', odds: 2.6 }] }]), event('d2', [{ name: 'Winner', outcomes: [{ name: 'Home', odds: 1.5, open: 1.52 }, { name: 'Away', odds: 2.6 }] }])];
  assert.deepEqual(rankedBankers(evs, { min: 0.55, minOdds: 1.2, maxOdds: 2.5 }).map((b) => b.event.id), ['d2']);
});

test('value bets are recorded as their own type and counted apart from the shortlist', () => {
  const now = Date.now();
  const picks = selectPicks([event('r1', [mk([{ name: 'Home', odds: 2.2, cons: 0.48, book: 'Betway', open: 2.15 }, { name: 'Draw', odds: 3.3, cons: 0.28 }, { name: 'Away', odds: 4.2, cons: 0.24 }])])], now, 12, []);
  const edge = picks.filter((p) => p.type === 'edge');
  assert.equal(edge.length, 1);
  assert.equal(edge[0].key, 'edge|r1|Match Result|Home');
  assert.equal(edge[0].bestBook, 'Betway');
  assert.equal(edge[0].open, 2.15);
  const s = summarize([{ ...edge[0], status: 'won' }, { ...edge[0], key: 'edge|x', status: 'lost' }]);
  assert.equal(s.edge.won + s.edge.lost, 2);
  assert.equal(s.outside.won + s.outside.lost, 0);
});
