import test from 'node:test';
import assert from 'node:assert/strict';
import { readiness } from '../js/readiness.js';
import { snapshot, diff } from '../js/changelog.js';

const now = Date.parse('2026-10-06T08:00:00Z');
const market = (h = 1.6, a = 2.4) => [{ name: 'Winner', outcomes: [{ name: 'Yankees', odds: h }, { name: 'Rays', odds: a }] }];
const mlb = (o = {}) => ({ id: 'b1', sport: 'baseball', home: 'Yankees', away: 'Rays', start: now + 3 * 36e5, markets: market(), probables: [], ...o });

test('readiness is a status, not a chance: waiting for starters, then ready', () => {
  const r1 = readiness(mlb(), { now, priceAt: now - 5 * 6e4 });
  assert.equal(r1.state, 'waiting');
  assert.match(r1.label, /starting pitchers/i);
  const r2 = readiness(mlb({ probables: [{ side: 'home', name: 'Cole' }, { side: 'away', name: 'Rasmussen' }] }), { now, priceAt: now - 5 * 6e4 });
  assert.notEqual(r2.state, 'waiting');
  assert.ok(['ready', 'limited'].includes(r2.state));
});

test('readiness flags stale prices, conflicts and uncovered needs', () => {
  const ok = { probables: [{ side: 'home', name: 'Cole' }, { side: 'away', name: 'Rasmussen' }] };
  assert.equal(readiness(mlb(ok), { now, priceAt: now - 3 * 36e5 }).state, 'stale');
  assert.equal(readiness(mlb({ ...ok, absences: { home: [{ name: 'Cole' }], away: [] } }), { now, priceAt: now }).state, 'conflict');
  const hockey = readiness({ id: 'h', sport: 'hockey', home: 'A', away: 'B', start: now + 36e5, markets: market() }, { now, priceAt: now });
  assert.equal(hockey.state, 'limited');
  assert.ok(hockey.uncovered.includes('Starting goalies'));
  const soccer = readiness({ id: 's', sport: 'football', home: 'A', away: 'B', start: now + 36e5, markets: market(), absences: { home: [], away: [], lineup: { type: 'predicted', home: { starters: [] }, away: { starters: [] } } } }, { now, priceAt: now });
  assert.equal(soccer.state, 'waiting');
  assert.match(soccer.label, /starting xis/i);
});

test('timeline: starters per side, confirmed XIs vs predicted, price moves, nothing on first sight', () => {
  const xi = (names) => ({ starters: names.map((name) => ({ name })) });
  const s0 = { id: 's', sport: 'football', home: 'Arsenal', away: 'Leeds', start: now + 36e5, markets: market(1.5, 2.8), absences: { home: [], away: [], lineup: { type: 'predicted', home: xi(['Raya', 'Saka']), away: xi(['Perri']) } } };
  assert.deepEqual(diff(s0, null, snapshot(s0), now), []);
  const s1 = { ...s0, markets: market(1.35, 3.3), absences: { home: [{ name: 'Saka' }], away: [], lineup: { type: 'confirmed', home: xi(['Raya', 'Nwaneri']), away: xi(['Perri']) } } };
  const c = diff(s1, snapshot(s0), snapshot(s1), now);
  const kinds = c.map((x) => x.kind);
  assert.ok(kinds.includes('lineup') && kinds.includes('injury') && kinds.includes('price'), kinds.join());
  assert.match(c.find((x) => x.kind === 'lineup').text, /Nwaneri in/);
  assert.equal(c.find((x) => x.kind === 'lineup').forecast, 'not-modelled', 'lineups are not in the number: say so');
  assert.equal(c.find((x) => x.kind === 'price').forecast, 'updated');
  const b0 = mlb({ probables: [{ side: 'home', name: 'Cole' }] });
  const b1 = mlb({ probables: [{ side: 'home', name: 'Schlittler' }, { side: 'away', name: 'Rasmussen' }] });
  const t = diff(b1, snapshot(b0), snapshot(b1), now).map((x) => x.text);
  assert.ok(t.includes('Yankees starter change: Schlittler replaces Cole'));
  assert.ok(t.includes('Rays starter announced: Rasmussen'));
});

test('bet lists can be ordered by start time, soonest or latest first, or kept in ranked order', async () => {
  const { orderByTime: orderBets } = await import('../js/engine.js');
  const list = [{ id: 'a', event: { start: 30 } }, { id: 'b', event: { start: 10 } }, { id: 'c', event: { start: 20 } }];
  assert.deepEqual(orderBets(list, 'rank').map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(orderBets(list, 'asc').map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(orderBets(list, 'desc').map((x) => x.id), ['a', 'c', 'b']);
  assert.deepEqual(orderBets([{ id: 'x', start: 5 }, { id: 'y', start: 1 }], 'asc').map((x) => x.id), ['y', 'x'], 'slip legs carry their own start');
});
