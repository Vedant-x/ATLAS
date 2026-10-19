import test from 'node:test';
import assert from 'node:assert/strict';
import { whyLine, pickSide } from '../js/why.js';

const ev = (o = {}) => ({ id: 'm1', sport: 'football', home: 'Arsenal', away: 'Leeds', stats: {}, ...o });

test('the pick side comes from the team name at the start of the pick', () => {
  assert.equal(pickSide(ev(), 'Arsenal'), 'home');
  assert.equal(pickSide(ev(), 'Leeds +1.5'), 'away');
  assert.equal(pickSide(ev(), 'Over 2.5'), null);
});

test('why line: the facts that back the side', () => {
  const e = ev({ stats: { homeForm: ['W', 'D', 'W', 'W', 'W'], awayForm: ['L', 'L', 'D', 'W', 'L'] }, absences: { home: [], away: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] } });
  const line = whyLine({ event: e, pick: 'Arsenal', p: 0.69, fair: 0.64 });
  assert.equal(line, 'Arsenal unbeaten in 5 · Leeds without 3 players');
});

test('why line is empty when nothing clearly backs a side', () => {
  assert.equal(whyLine({ event: ev(), pick: 'Over 2.5', p: 0.62, fair: 0.6 }), '');
  assert.equal(whyLine({ event: ev({ stats: { homeForm: ['W', 'L', 'W', 'L'], awayForm: ['L', 'W', 'L', 'W'] } }), pick: 'Arsenal', p: 0.7 }), '');
});

test('baseball: a clearly better starter is named', () => {
  const e = ev({ sport: 'baseball', home: 'Yankees', away: 'Rays', probables: [{ side: 'home', report: { season: { era: 2.9 } } }, { side: 'away', report: { season: { era: 4.4 } } }] });
  assert.match(whyLine({ event: e, pick: 'Yankees', p: 0.6, fair: 0.58 }), /starter ERA 2\.90 v 4\.40/);
});
