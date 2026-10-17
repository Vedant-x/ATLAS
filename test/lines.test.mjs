import test from 'node:test';
import assert from 'node:assert/strict';
import { propLadder, propOver, overLine, impliedMean, countTail } from '../js/props.js';

const rows = [28, 22, 31, 25, 19, 27, 33, 24, 26, 21, 30, 23, 29, 25, 27, 20, 32, 26, 24, 28].map((v) => ({ points: v }));

test('lines are written the bookmakers\' way: N+ is over N-0.5', () => {
  assert.equal(overLine(1), 0.5);
  assert.equal(overLine(25), 24.5);
  assert.equal(propOver({ player: 'J', target: 2, label: 'hits' }), 'over 1.5 hits');
  assert.equal(propOver({ player: 'J', yes: true, label: 'goal' }), '');
});

test('the implied mean reproduces the price at the offered line', () => {
  const m = impliedMean(0.55, 1.2, 25);
  assert.ok(Math.abs(countTail(m, 1.2 * m, 25) - 0.55) < 0.005);
});

test('other lines: the offered line keeps its chance, higher lines are less likely, lower more likely', () => {
  const l = propLadder(0.55, 'basketball', 'Points', 25, rows);
  assert.equal(l.length, 7);
  const at = l.find((x) => x.offered);
  assert.equal(at.line, 24.5);
  for (let i = 1; i < l.length; i++) assert.ok(l[i].p <= l[i - 1].p, `monotone at ${l[i].line}`);
  assert.ok(l[0].p > at.p && l.at(-1).p < at.p);
  const one = propLadder(0.8, 'basketball', 'Points', 25, rows, { thresholds: [2] })[0];
  assert.equal(one.line, 1.5);
  assert.ok(one.p > 0.9, 'over 1.5 points for a 25-a-game scorer is near certain');
});
