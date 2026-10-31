import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveRows } from '../js/archive.js';

const now = Date.parse('2026-10-31T12:00:00Z');
const ev = (odds, extra = {}) => ({ id: 'e1', sport: 'football', leaguePath: 'soccer/fra.1', home: 'Nice', away: 'Rennes', start: now + 6 * 36e5, oddsSource: 'the-odds-api',
  sharpAt: now - 36e5, stakeAt: now - 2 * 36e5, fetchedAt: now - 6e4,
  markets: [{ name: 'Match Result', consensusFrom: 'Pinnacle', outcomes: [
    { name: 'Nice', odds, bestBook: 'Betfair', cons: 0.3737, pin: 2.6, stake: 2.75 }, { name: 'Draw', odds: 3.6, cons: 0.27, pin: 3.55 }, { name: 'Rennes', odds: 2.5, cons: 0.3563, pin: 2.7 }] },
  { name: 'Corners', outcomes: [{ name: 'Over 9.5', odds: 1.9 }, { name: 'Under 9.5', odds: 1.9 }] }], ...extra });

test('the odds archive keeps each price change once, with the reference, Pinnacle, Stake and read times', () => {
  const last = {};
  const [row, ...more] = archiveRows([ev(2.8)], last, now);
  assert.equal(more.length, 0, 'a market with no reference, no Pinnacle and no Stake price is not kept');
  assert.deepEqual(row.o[0], ['Nice', 2.8, 'Betfair', 0.3737, 2.6, 2.75]);
  assert.deepEqual([row.ref, row.sharpAt, row.stakeAt, row.priceAt, row.start, row.at], ['Pinnacle', now - 36e5, now - 2 * 36e5, now - 6e4, now + 6 * 36e5, now]);
  assert.deepEqual(archiveRows([ev(2.8)], last, now + 6e5), [], 'unchanged prices: nothing written');
  assert.equal(archiveRows([ev(2.75)], last, now + 12e5).length, 1, 'a moved price: one new row');
  // Started or live matches are not archived, and their entries leave the state file.
  assert.deepEqual(archiveRows([ev(2.7, { live: true })], last, now + 18e5), []);
  assert.deepEqual(last, {});
});
