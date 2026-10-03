import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPicks, addPicks, gradePick, resultFromSummary, summarize } from '../js/track.js';

const base = { home: 'Arsenal', away: 'Leeds' };

test('winner, totals and spreads are graded from the final score', () => {
  const r = { homeScore: '2', awayScore: '1' };
  assert.equal(gradePick({ ...base, market: 'Match Result', pick: 'Arsenal' }, r), 'won');
  assert.equal(gradePick({ ...base, market: 'Match Result', pick: 'Draw' }, r), 'lost');
  assert.equal(gradePick({ ...base, market: 'Match Result', pick: 'Draw' }, { homeScore: '1', awayScore: '1' }), 'won');
  assert.equal(gradePick({ ...base, market: 'Total 2.5', pick: 'Over 2.5' }, r), 'won');
  assert.equal(gradePick({ ...base, market: 'Total 3', pick: 'Under 3' }, r), 'push');
  assert.equal(gradePick({ ...base, market: 'Spread', pick: 'Arsenal -1.5' }, r), 'lost');
  assert.equal(gradePick({ ...base, market: 'Spread', pick: 'Leeds +1.5' }, r), 'won');
  assert.equal(gradePick({ ...base, market: 'Spread', pick: 'Arsenal -1' }, r), 'push');
  // Tennis / MMA: the winner flag decides.
  assert.equal(gradePick({ home: 'Sinner', away: 'Alcaraz', market: 'Winner', pick: 'Alcaraz' }, { homeScore: '2', awayScore: '1', winner: 'away' }), 'won');
});

test('ESPN summaries become results; postponed games are void', () => {
  const sm = (type, h, a) => ({ header: { competitions: [{ status: { type }, competitors: [{ homeAway: 'home', score: h.s, winner: h.w }, { homeAway: 'away', score: a.s, winner: a.w }] }] } });
  assert.deepEqual(resultFromSummary(sm({ completed: true, name: 'STATUS_FINAL' }, { s: '3', w: true }, { s: '0', w: false })), { done: true, homeScore: '3', awayScore: '0', winner: 'home' });
  assert.equal(resultFromSummary(sm({ completed: true, name: 'STATUS_FULL_TIME' }, { s: '1' }, { s: '1' })).winner, 'draw');
  assert.equal(resultFromSummary(sm({ completed: false, name: 'STATUS_IN_PROGRESS' }, { s: '1' }, { s: '0' })).done, false);
  assert.equal(resultFromSummary(sm({ completed: false, name: 'STATUS_POSTPONED' }, {}, {})).void, true);
});

test('picks are recorded once, at the first price, only before kick-off', () => {
  const now = Date.now();
  const ev = (id, start, odds) => ({ id, compId: id, leaguePath: 'soccer/eng.1', sport: 'football', league: 'EPL', home: 'A', away: 'B', start, live: false, stats: {}, markets: [{ name: 'Winner', outcomes: [{ name: 'A', odds }, { name: 'B', odds: 4.5 }] }] });
  const first = selectPicks([ev('1', now + 36e5, 1.35), ev('2', now - 60e3, 1.35), ev('3', now + 30 * 36e5, 1.35)], now);
  assert.deepEqual([...new Set(first.map((p) => p.eventId))], ['1']); // started and far-future games skipped
  const h1 = addPicks([], first);
  const h2 = addPicks(h1, selectPicks([ev('1', now + 36e5, 1.5)], now));
  assert.equal(h2.length, h1.length);
  assert.equal(h2[0].odds, 1.35);
});

test('summary: hit rate, flat-stake profit and calibration', () => {
  const h = [
    { status: 'won', odds: 1.5, p: 0.65, type: 'banker', sport: 'football', start: 1 },
    { status: 'won', odds: 1.4, p: 0.68, type: 'banker', sport: 'football', start: 2 },
    { status: 'lost', odds: 1.6, p: 0.62, type: 'value', sport: 'hockey', start: 3 },
    { status: 'push', odds: 1.9, p: 0.55, type: 'value', sport: 'hockey', start: 4 },
    { status: 'pending', odds: 1.3, p: 0.7, type: 'banker', sport: 'football', start: 5 },
  ];
  const s = summarize(h);
  assert.equal(s.all.won, 2); assert.equal(s.all.lost, 1); assert.equal(s.all.push, 1);
  assert.ok(Math.abs(s.all.hitRate - 2 / 3) < 1e-9);
  assert.equal(s.all.profit, -0.1); // +0.5 +0.4 -1
  assert.equal(s.pending.length, 1);
  assert.equal(s.buckets.find((b) => b.label === '60–70%').n, 3);
});
