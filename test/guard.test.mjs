import test from 'node:test';
import assert from 'node:assert/strict';
import { calibration, blockedSegment, rankedBankers, SAFE, surestPicks } from '../js/track.js';

// 40 hockey spreads at 1.40 (price says ~68%) that landed only 20 times.
const spreads = Array.from({ length: 40 }, (_, i) => ({ type: 'banker', eventId: `h${i}`, sport: 'hockey', market: 'Spread', pick: `T${i} +1.5`, odds: 1.4, p: 0.7, status: i < 20 ? 'won' : 'lost' }));
// 40 hockey winners at 1.60 (~60%) that landed 25 times: in line with the price.
const winners = Array.from({ length: 40 }, (_, i) => ({ type: 'banker', eventId: `w${i}`, sport: 'hockey', market: 'Winner', pick: `W${i}`, odds: 1.6, p: 0.62, status: i < 25 ? 'won' : 'lost' }));

test('a bet type that fell clearly short of its prices is held back; one in line with them is not', () => {
  const cal = calibration([...spreads, ...winners]);
  assert.equal(blockedSegment(cal, 'hockey', 'Spread'), true, `z ${cal['hockey:spread'].z}`);
  assert.equal(blockedSegment(cal, 'hockey', 'Winner'), false);
  assert.equal(blockedSegment(cal, 'football', 'Spread'), false, 'another sport is unaffected');
  assert.equal(blockedSegment(calibration(spreads.slice(0, 20)), 'hockey', 'Spread'), false, 'too few results to judge');
});

test('the shortlist leaves held-back bet types out', () => {
  const cal = calibration([...spreads, ...winners]);
  const now = Date.now();
  const e = { id: 'x', compId: '1', sport: 'hockey', league: 'NHL', home: 'Leafs', away: 'Sabres', start: now + 36e5, markets: [
    { name: 'Spread', outcomes: [{ name: 'Leafs -1.5', odds: 2.4, line: -1.5 }, { name: 'Sabres +1.5', odds: 1.35, line: 1.5 }] },
    { name: 'Winner', outcomes: [{ name: 'Leafs', odds: 1.4 }, { name: 'Sabres', odds: 2.9 }] }] };
  const list = rankedBankers([e], { cal, min: 0.5, maxOdds: 1.8, limit: 10, mix: false });
  assert.ok(list.every((b) => b.market !== 'Spread'), JSON.stringify(list.map((b) => b.market)));
});

test('surest: 1.20-1.40 only, and never a pick ATLAS rates above the price', () => {
  assert.equal(SAFE.minOdds, 1.2);
  const now = Date.now();
  const mk = (id, odds, model) => ({ id, compId: id, sport: 'esports', league: 'L', home: `H${id}`, away: `A${id}`, start: now + 36e5,
    markets: [{ name: 'Winner', outcomes: [{ name: `H${id}`, odds, model }, { name: `A${id}`, odds: 4, model: 1 - model }] }] });
  const ev = [mk('1', 1.25, 0.76), mk('2', 1.3, 0.86), mk('3', 1.12, 0.9), mk('4', 1.35, 0.7)];
  const picks = surestPicks(ev, { limit: 10 }).map((b) => b.pick);
  assert.ok(picks.includes('H1') && picks.includes('H4'), JSON.stringify(picks));
  assert.ok(!picks.includes('H2'), 'ATLAS 86% against a 74% price: left out');
  assert.ok(!picks.includes('H3'), 'below 1.20: left out');
});
