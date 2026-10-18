import test from 'node:test';
import assert from 'node:assert/strict';
import { rate, annotate, ratingWin, keyOf, TRUST_GAMES } from '../js/ratings.js';
import { encode, decode, merge } from '../js/results.js';
import { winProbs } from '../js/models.js';

const D = 864e5, t0 = Date.parse('2026-08-01T12:00:00Z');
// A league where Strong beats everyone and Weak loses to everyone.
function season(lg = 'rugby/premiership', sport = 'rugby') {
  const teams = ['Strong', 'Mid1', 'Mid2', 'Weak'];
  const out = [];
  let i = 0;
  for (let round = 0; round < 8; round++) for (const [h, a] of [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]]) {
    const better = Math.min(h, a), hs = h === better ? 30 : 10, as = h === better ? 10 : 30;
    out.push({ id: `g${i++}`, lg, sport, t: t0 + (round * 6 + i) * D / 6, h: teams[h], a: teams[a], hid: String(h + 1), aid: String(a + 1), hs, as, w: hs > as ? 'home' : 'away' });
  }
  return out;
}

test('ratings: the stronger side rises, the record says how well they predicted', () => {
  const R = rate(season());
  const r = (id) => R.r.get(keyOf('rugby', 'rugby/premiership', id, '')).r;
  assert.ok(r('1') > r('2') && r('2') > r('4'), `Strong ${r('1')} > Mid1 ${r('2')} > Weak ${r('4')}`);
  assert.equal(R.r.get(keyOf('rugby', 'rugby/premiership', '1', '')).n, 24);
  assert.ok(R.quality.rugby.n > 0 && R.quality.rugby.brier < 0.25, 'better than a coin flip once trusted');
});

test('ratings onto upcoming matches: ratings, rest days, last meetings, form; and the model uses them', () => {
  const hist = season();
  const R = rate(hist);
  const last = hist.at(-1).t;
  const e = { id: 'u', sport: 'rugby', leaguePath: 'rugby/premiership', home: 'Strong', away: 'Weak', teamIds: { home: '1', away: '4' }, start: last + 3 * D, stats: {} };
  assert.equal(annotate([e], R), 1);
  assert.ok(e.atlas.home.r > e.atlas.away.r);
  assert.ok(e.stats.homeRest >= 2 && e.stats.homeRest <= 4);
  assert.equal(e.h2hRecent.length, 5);
  assert.deepEqual(e.stats.homeForm, ['W', 'W', 'W', 'W', 'W']);
  const w = winProbs(e);
  assert.equal(w.confidence, 'medium');
  assert.ok(w.home > 0.8, `rated favourite (${w.home.toFixed(2)})`);
});

test('ratings: soccer clubs rate across competitions; draws split off; too few results are not trusted', () => {
  const g = (i, lg, w) => ({ id: `s${i}`, lg, sport: 'football', t: t0 + i * D, h: 'A', a: 'B', hid: '10', aid: '20', hs: w === 'home' ? 2 : 0, as: w === 'home' ? 0 : 0, w });
  const R = rate([g(1, 'soccer/eng.1', 'home'), g(2, 'soccer/eng.fa', 'home'), g(3, 'soccer/eng.1', 'draw')]);
  assert.equal(R.r.get(keyOf('football', 'soccer/eng.fa', '10', 'A')).n, 3, 'league and cup are one rating');
  const w = ratingWin('football', 1600, 1500);
  assert.ok(w.draw > 0.15 && w.home > w.away);
  const e = { id: 'x', sport: 'football', leaguePath: 'soccer/eng.1', home: 'A', away: 'B', teamIds: { home: '10', away: '20' }, start: t0 + 10 * D, stats: {} };
  assert.equal(annotate([e], R), 0, `under ${TRUST_GAMES} results each: not used`);
});

test('ratings: tennis by player id and surface, doubles left out', () => {
  const m = (i, w, tour) => ({ id: `t${i}`, lg: 'tennis/atp', sport: 'tennis', t: t0 + i * D, h: 'Rafa', a: 'Roger', hid: '1', aid: '2', w, tour, draw: 'Singles' });
  const hist = [...Array.from({ length: 12 }, (_, i) => m(i, 'home', 'Roland Garros')), ...Array.from({ length: 12 }, (_, i) => m(20 + i, 'away', 'Wimbledon')), { ...m(40, 'home', 'Paris'), draw: 'Doubles' }];
  const R = rate(hist);
  const ev = (tour) => ({ id: tour, sport: 'tennis', leaguePath: 'tennis/atp', home: 'Rafa', away: 'Roger', start: t0 + 50 * D, tennis: { draw: 'Singles', tournament: tour, home: { id: '1' }, away: { id: '2' } } });
  const clay = ev('Roland Garros'), grass = ev('Wimbledon');
  annotate([clay, grass], R);
  assert.ok(clay.atlas.home.r > grass.atlas.home.r, 'Rafa rated higher on clay than on grass');
  assert.equal(R.r.get(keyOf('tennis', 'tennis/atp', '1', '')).n, 24, 'the doubles match is not counted');
});

test('results history: compact file round trip, merge keeps one row per game and 180 days', () => {
  const now = t0 + 200 * D;
  const old = [{ id: 'a', lg: 'x', sport: 'rugby', t: now - 190 * D, h: 'A', a: 'B', w: 'home' }, { id: 'b', lg: 'x', sport: 'rugby', t: now - 10 * D, h: 'A', a: 'B', hs: 1, as: 2, w: 'away' }];
  const merged = merge(decode(encode(old)), [{ ...old[1], hs: 3, as: 2, w: 'home' }], now);
  assert.equal(merged.length, 1, 'the 190-day-old game is dropped');
  assert.equal(merged[0].w, 'home', 'the newer copy wins');
  assert.deepEqual(decode({}), []);
});
