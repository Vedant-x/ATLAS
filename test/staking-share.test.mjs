import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestStake, overExposed } from '../js/staking.js';
import { encodeSlip, decodeSlip } from '../js/share.js';

test('stake: quarter Kelly, capped, and nothing without an edge', () => {
  // p 0.6 at 2.0: Kelly 20%, quarter 5%, capped at 2% of 1000.
  assert.deepEqual(suggestStake(1000, 0.6, 2.0), { amount: 20, frac: 0.02, cap: 0.02, edge: true, capped: true });
  // p 0.52 at 2.0: Kelly 4%, quarter 1%.
  assert.equal(suggestStake(1000, 0.52, 2.0).amount, 10);
  // A likely pick at too short a price: no stake.
  assert.equal(suggestStake(1000, 0.71, 1.31).edge, false);
  assert.equal(suggestStake(1000, 0.71, 1.31).amount, 0);
  // Multis cap at 1%.
  assert.equal(suggestStake(1000, 0.3, 5, { legs: 3 }).amount, 10);
  // No bankroll, no suggestion.
  assert.equal(suggestStake(0, 0.6, 2).amount, 0);
  assert.equal(overExposed(100, 6), true);
  assert.equal(overExposed(100, 5), false);
});

const legs = [
  { key: 'e1|Winner|Arsenal', eventId: 'e1', sport: 'football', match: 'Arsenal vs Leeds', market: 'Winner', pick: 'Arsenal', odds: 1.45, p: 0.7123456, derived: false },
  { key: 'e2|fair|Total|Over 220.5', eventId: 'e2', sport: 'basketball', match: 'Suns vs Nuggets — é', market: 'Total', pick: 'Over 220.5', odds: 1.9, p: 0.55, derived: true },
];

test('share link round-trips the legs (including non-ASCII text)', () => {
  const code = encodeSlip(legs);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const back = decodeSlip(code);
  assert.equal(back.length, 2);
  assert.equal(back[0].p, 0.7123);
  assert.equal(back[1].match, 'Suns vs Nuggets — é');
  assert.equal(back[1].derived, true);
});

test('share link: bad input decodes to nothing, bad legs are dropped', () => {
  assert.deepEqual(decodeSlip('not base64!'), []);
  assert.deepEqual(decodeSlip(''), []);
  assert.deepEqual(decodeSlip(Buffer.from('{"a":1}').toString('base64url')), []);
  const evil = Buffer.from(JSON.stringify([['k', 'e', 'football', 'm', 'Winner', 'X', 0.5, 0.5, 0], ['k2', 'e', 'football', 'm', 'Winner', 'Y', 2, 1.5, 0], ['k3', 'e', 'football', 'm', 'Winner', 'Z', 2, 0.5, 0]])).toString('base64url');
  assert.deepEqual(decodeSlip(evil).map((l) => l.pick), ['Z']);
});
