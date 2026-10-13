import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseSlip, jointHistory, pairLift } from '../js/slipcheck.js';

// players.json-style logs: [date, opp, oppId, home, season, minutes, gameId, teamId, ...cols]
const log = (name, vals) => ({ n: name, s: 'basketball', t: 'Nuggets', c: ['points', 'assists'], o: 'minutes', g: vals.map(([ev, pts, ast]) => ['2026-10-01', 'BOS', '1', 1, 1, 30, ev, '7', pts, ast]) });
const logs = {
  // Jokic scores 25+ exactly in games where Murray has 5+ assists (g0-g9), and not otherwise.
  'nba|1': log('Jokic', Array.from({ length: 16 }, (_, i) => [`g${i}`, i < 8 ? 30 : 20, 0])),
  'nba|2': log('Murray', Array.from({ length: 16 }, (_, i) => [`g${i}`, 15, i < 8 ? 7 : 3])),
};
const leg = (k, extra) => ({ key: k, eventId: 'e1', odds: 1.9, p: 0.5, pick: k, market: 'Player points', ...extra });

test('slip check: two props that land together are measured from shared games', () => {
  const a = leg('Jokic 25+ points', { prop: { id: '1', league: 'nba', type: 'Points', target: 25 } });
  const b = leg('Murray 5+ assists', { prop: { id: '2', league: 'nba', type: 'Assists', target: 5 } });
  const j = jointHistory(a, b, logs);
  assert.deepEqual(j, { n: 16, ha: 8, hb: 8, both: 8 });
  const lift = pairLift(j);
  assert.ok(lift > 1.3, `strong positive dependence, shrunk (${lift})`);
  const r = analyseSlip([a, b], { logs });
  assert.equal(r.pairs[0].kind, 'measured');
  assert.ok(r.adjusted > r.product, 'the combined chance rises above the product');
  assert.ok(r.adjusted <= 0.5, 'never above the weaker leg');
  assert.equal(r.uncertain, false);
});

test('slip check: same-match legs that cannot be measured are flagged; nested lines; weakest leg; without each leg', () => {
  const win = leg('Nuggets', { market: 'Winner', p: 0.6, odds: 1.6 });
  const pts25 = leg('Jokic 25+ points', { p: 0.55, prop: { id: '1', league: 'nba', type: 'Points', target: 25 } });
  const pts30 = leg('Jokic 30+ points', { p: 0.3, odds: 3, prop: { id: '1', league: 'nba', type: 'Points', target: 30 } });
  const other = { ...leg('Arsenal', { market: 'Winner', p: 0.7, odds: 1.4 }), eventId: 'e2' };
  const r = analyseSlip([win, pts25, pts30, other], { logs });
  assert.ok(r.pairs.some((p) => p.kind === 'nested'), 'two lines of the same stat');
  assert.ok(r.pairs.some((p) => p.kind === 'unmeasured'), 'a team result and a prop from the same match');
  assert.equal(r.uncertain, true);
  assert.ok(r.limits.some((x) => /uncertain/.test(x)));
  assert.equal(r.weakest.pick, 'Jokic 30+ points');
  assert.equal(r.without.length, 4);
  assert.ok(Math.abs(r.without[3].odds - (1.6 * 1.9 * 3)) < 1e-9, 'odds without the Arsenal leg');
});

test('slip check: legs from different matches settle independently', () => {
  const r = analyseSlip([leg('A', {}), { ...leg('B', {}), eventId: 'e2' }], { logs });
  assert.equal(r.pairs.length, 0);
  assert.equal(r.adjusted, r.product);
  assert.equal(r.uncertain, false);
});
