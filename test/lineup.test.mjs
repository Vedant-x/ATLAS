import test from 'node:test';
import assert from 'node:assert/strict';
import { lineupOf } from '../js/fotmob.js';

const team = (n, f) => ({ formation: f, starters: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, shirtNumber: String(i + 1), positionId: i === 0 ? 11 : 30, verticalLayout: { x: 0.5, y: i === 0 ? 0.1 : 0.5 } })), subs: [{ name: 'S1' }] });

test('FotMob lineups keep formation, shirt numbers, the keeper and pitch positions', () => {
  const l = lineupOf({ lineupType: 'lastStarting11', homeTeam: team(11, '4-3-3'), awayTeam: team(11, '4-4-2') });
  assert.equal(l.type, 'lastStarting11');
  assert.equal(l.home.formation, '4-3-3');
  assert.equal(l.home.starters.length, 11);
  assert.ok(l.home.starters[0].gk && !l.home.starters[1].gk);
  assert.deepEqual(l.away.subs, ['S1']);
  assert.equal(lineupOf({ homeTeam: team(9), awayTeam: team(11) }), null); // incomplete XI ignored
});
