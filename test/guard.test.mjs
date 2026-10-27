import test from 'node:test';
import assert from 'node:assert/strict';
import { calibration, blockedSegment, rankedBankers, probePicks } from '../js/track.js';

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

test('a blocked bet type is still measured: probes are recorded unseen, so the block can lift', () => {
  const cal = calibration([...spreads, ...winners]);
  const e = { id: 'x', compId: '1', sport: 'hockey', league: 'NHL', home: 'Leafs', away: 'Sabres', start: Date.now() + 36e5, sharpAt: Date.now() - 36e5, fetchedAt: Date.now() - 6e4, markets: [
    // The sharp market's fair chance (cons): probes follow the Best bets price rule (at least fair odds).
    { name: 'Spread', consensusFrom: 'Pinnacle', outcomes: [{ name: 'Leafs -1.5', odds: 1.6, line: -1.5, cons: 0.63 }, { name: 'Sabres +1.5', odds: 2.4, line: 1.5, cons: 0.37 }] },
    { name: 'Winner', consensusFrom: 'Pinnacle', outcomes: [{ name: 'Leafs', odds: 1.4, cons: 0.7 }, { name: 'Sabres', odds: 2.9, cons: 0.3 }] }] };
  const probes = probePicks([e], { cal });
  assert.ok(probes.length && probes.every((b) => b.market === 'Spread'), JSON.stringify(probes.map((b) => b.market)));
  assert.deepEqual(probePicks([e], { cal: null }), [], 'no calibration, nothing blocked, no probes');
});
