import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPicks, modelChance, modelRecord } from '../js/modelpicks.js';
import { coverage } from '../js/coverage.js';
import { summarize, calibration } from '../js/track.js';

const now = Date.parse('2026-10-18T06:00:00Z');
const ev = (id, o = {}) => ({ id, sport: 'football', league: 'Eredivisie', leaguePath: 'soccer/ned.1', home: `${id} H`, away: `${id} A`, start: now + 5 * 36e5, compId: id, ...o });

test('model picks: unpriced matches with real evidence only, at fair odds, trusted cautiously', () => {
  const strong = ev('elo', { stats: { homeElo: 1900, awayElo: 1450 } });
  const bare = ev('bare'); // home advantage only: never a pick
  const priced = ev('priced', { stats: { homeElo: 1900, awayElo: 1450 }, markets: [{ name: 'Match Result', outcomes: [{ name: 'priced H', odds: 1.3 }, { name: 'Draw', odds: 5 }, { name: 'priced A', odds: 9 }] }] });
  const later = ev('later', { stats: { homeElo: 1900, awayElo: 1450 }, start: now + 60 * 36e5 });
  const picks = modelPicks([strong, bare, priced, later], { now, hours: 48 });
  assert.deepEqual(picks.map((x) => x.event.id), ['elo']);
  const [x] = picks;
  assert.equal(x.pick, 'elo H');
  assert.equal(x.market, 'Match Result');
  assert.ok(x.p < x.pRaw, 'pulled toward 50/50 before the sport has a record');
  assert.equal(x.fairOdds, +(1 / x.p).toFixed(2));
  assert.match(x.basis, /ClubElo/);
});

test('model chance: a sport with 30+ settled model picks uses its own record', () => {
  const hist = Array.from({ length: 40 }, (_, i) => ({ type: 'model', sport: 'tennis', p: 0.7, status: i < 24 ? 'won' : 'lost' }));
  const r = modelRecord(hist);
  assert.equal(r.tennis.n, 40);
  assert.equal(+modelChance(0.7, 'tennis', r).toFixed(3), +(0.7 * (24 / 28)).toFixed(3));
  assert.ok(Math.abs(modelChance(0.7, 'cricket', r) - 0.65) < 1e-9, 'no record yet: pulled a quarter of the way to 50/50');
});

test('model picks keep their own record: no profit, no effect on priced calibration', () => {
  const m = (status) => ({ type: 'model', sport: 'tennis', eventId: `t${status}`, market: 'Winner', pick: 'X', home: 'X', away: 'Y', odds: 1.4, p: 0.7, shown: 0.65, status });
  const s = summarize([m('won'), m('lost'), m('won')]);
  assert.equal(s.model.won, 2);
  assert.equal(s.all.won + s.all.lost, 0, 'not in the priced record');
  assert.equal(s.outside.won + s.outside.lost, 0);
  assert.deepEqual(calibration([m('won'), m('lost')]), {});
});

test('coverage: what each sport has, field by field', () => {
  const c = coverage([
    ev('a', { markets: [{ name: 'Winner', outcomes: [] }], fetchedAt: now - 10 * 6e4, absences: { home: [], away: [], lineup: { type: 'confirmed' } } }),
    ev('b', { fetchedAt: now - 10 * 6e4, stats: { homeElo: 1800, awayElo: 1600 } }),
    ev('t', { sport: 'tennis', fetchedAt: now - 5 * 36e5 }),
  ], { now });
  assert.equal(c.football.n, 2);
  assert.equal(c.football.fields.prices.state, 'partial');
  assert.equal(c.football.fields.news.state, 'partial');
  assert.equal(c.football.fields.model.note, '1 of 1 rated');
  assert.equal(c.tennis.fields.prices.state, 'unavailable');
  assert.equal(c.tennis.fields.updated.state, 'stale');
});
