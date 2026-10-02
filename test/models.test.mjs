import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, poisson, normCdf, kelly } from '../js/models.js';

const ev = (sport, markets, extra = {}) => ({ id: 'x', sport, home: 'H', away: 'A', league: 'L', markets, ...extra });
const sum = (xs) => xs.reduce((a, o) => a + o.p, 0);
const close = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('maths helpers', () => {
  close([...Array(40).keys()].reduce((s, k) => s + poisson(k, 3.2), 0), 1, 1e-9);
  close(normCdf(0), 0.5, 1e-7); close(normCdf(1.96), 0.975, 1e-3);
  assert.equal(kelly(0.5, 1.8), 0); close(kelly(0.6, 2), 0.2, 1e-12);
});

test('football Poisson fit reproduces the priced result and total', () => {
  const a = analyse(ev('football', [
    { name: 'Match Result', outcomes: [{ name: 'H', odds: 1.8 }, { name: 'Draw', odds: 3.7 }, { name: 'A', odds: 4.6 }] },
    { name: 'Total 2.5', outcomes: [{ name: 'Over 2.5', odds: 1.85 }, { name: 'Under 2.5', odds: 1.95 }] }]));
  const res = a.groups[0].markets[0].outcomes;
  close(res[0].p - res[2].p, a.win.home - a.win.away, 0.01);
  const ou = a.groups.find((g) => g.group.startsWith('Total')).markets.find((m) => m.name.endsWith('2.5'));
  close(ou.outcomes[0].p, (1 / 1.85) / (1 / 1.85 + 1 / 1.95), 0.01);
  for (const g of a.groups) for (const m of g.markets) if (!m.overlap) close(sum(m.outcomes), 1, 1e-6);
  close(a.grid.cells.reduce((s, c) => s + c.p, 0), 0.97, 0.05);
  assert.ok(a.marketCount >= 25);
});

test('every market outcome carries a fair price of 1/p', () => {
  const a = analyse(ev('hockey', [{ name: 'Winner', outcomes: [{ name: 'H', odds: 1.7 }, { name: 'A', odds: 2.2 }] }]));
  for (const g of a.groups) for (const m of g.markets) for (const o of m.outcomes) close(o.fair * o.p, 1, 1e-9);
});

test('points model centres on the spread and its margin bands sum to 1', () => {
  const a = analyse(ev('basketball', [{ name: 'Winner', outcomes: [{ name: 'H', odds: 1.4 }, { name: 'A', odds: 3 }] }, { name: 'Spread', line: -7.5, outcomes: [{ name: 'H -7.5', odds: 1.91 }, { name: 'A +7.5', odds: 1.91 }] }]));
  close(a.params.margin, 7.5, 1e-9);
  close(sum(a.groups.find((g) => g.group === 'Winning margin').markets[0].outcomes), 1, 1e-9);
});

test('tennis set scores sum to 1 and favour the favourite', () => {
  const a = analyse(ev('tennis', [{ name: 'Winner', outcomes: [{ name: 'H', odds: 1.3 }, { name: 'A', odds: 3.5 }] }]));
  const sets = a.groups[0].markets[0].outcomes;
  close(sum(sets), 1, 1e-9);
  assert.ok(sets[0].p > sets[sets.length - 1].p);
});

test('events with no odds still get a labelled model line', () => {
  const withRec = analyse(ev('baseball', [], { stats: { homeRecord: '80-60', awayRecord: '60-80' } }));
  assert.equal(withRec.confidence, 'medium');
  assert.ok(withRec.win.home > 0.5);
  assert.ok(withRec.marketCount > 10);
  const bare = analyse(ev('cricket', []));
  assert.equal(bare.confidence, 'low');
  assert.match(bare.basis, /baseline/i);
});
