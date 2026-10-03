import test from 'node:test';
import assert from 'node:assert/strict';
import { liveWin, remaining, parseScore } from '../js/live.js';

const soccer = (score, clock, displayClock) => ({ id: 's', sport: 'football', league: 'EPL', home: 'A', away: 'B', live: true, score, clock, displayClock, start: Date.now() - 36e5, stats: {},
  markets: [{ name: 'Match Result', outcomes: [{ name: 'A', odds: 2.4 }, { name: 'Draw', odds: 3.3 }, { name: 'B', odds: 3.1 }] }] });

test('time left is read from each sport clock', () => {
  assert.equal(parseScore('2 – 1').join(), '2,1');
  assert.ok(Math.abs(remaining(soccer('0 – 0', "67'", "67'")) - 23 / 90) < 1e-9);
  assert.equal(remaining(soccer('0 – 0', 'HT')), 0.5);
  assert.ok(Math.abs(remaining({ sport: 'basketball', league: 'NBA', period: 3, displayClock: '6:00', clock: '6:00 - 3rd' }) - 18 / 48) < 1e-9);
  assert.ok(Math.abs(remaining({ sport: 'baseball', period: 7, clock: 'Bot 7th' }) - 5 / 18) < 1e-9);
});

test('a late lead makes the leader a heavy favourite; a level game early stays near pre-match', () => {
  const late = liveWin(soccer('1 – 0', "85'", "85'"));
  assert.ok(late.home > 0.85, `home ${late.home}`);
  assert.ok(Math.abs(late.home + late.draw + late.away - 1) < 1e-9);
  const early = liveWin(soccer('0 – 0', "2'", "2'"));
  assert.ok(early.home > 0.33 && early.home < 0.45, `home ${early.home}`);
  const nba = liveWin({ id: 'n', sport: 'basketball', league: 'NBA', home: 'H', away: 'V', live: true, score: '90 – 100', period: 4, displayClock: '2:00', clock: '2:00 - 4th', stats: {}, markets: [{ name: 'Winner', outcomes: [{ name: 'H', odds: 1.5 }, { name: 'V', odds: 2.7 }] }] });
  assert.ok(nba.away > 0.95, `away ${nba.away}`);
  assert.equal(liveWin({ ...soccer('1 – 0', "50'"), live: false }), null);
});
