import test from 'node:test';
import assert from 'node:assert/strict';
import { coherentBets, sideOf, directionOf, bankerSlips } from '../js/picks.js';
import { analyse } from '../js/models.js';

const now = Date.parse('2026-10-05T08:00:00Z');
const soccer = { id: 's1', sport: 'football', home: 'Arsenal', away: 'Leeds United', start: now + 36e5, markets: [
  { name: 'Match Result', outcomes: [{ name: 'Arsenal', odds: 1.45 }, { name: 'Draw', odds: 4.6 }, { name: 'Leeds United', odds: 7.5 }] },
  { name: 'Total 2.5', outcomes: [{ name: 'Over 2.5', odds: 1.62 }, { name: 'Under 2.5', odds: 2.3 }] },
], stats: {} };

test('picks know which side and direction they back', () => {
  assert.equal(sideOf(soccer, 'Match Result', 'Leeds United'), 'away');
  assert.equal(sideOf(soccer, 'Double chance', 'Arsenal or draw'), 'home-or-draw');
  assert.equal(sideOf(soccer, 'Leeds United wins a set', 'No'), 'home');
  assert.equal(directionOf('Total 2.5', 'Under 2.5'), 'under');
  assert.equal(directionOf('Both teams to score', 'Yes'), 'over');
  assert.equal(directionOf('Match Result', 'Arsenal'), null);
});

test('match bets never back both sides or both goal directions, and stay short', () => {
  const a = analyse(soccer);
  const { lean, picks } = coherentBets(soccer, a);
  assert.equal(lean, 'home');
  assert.ok(picks.length >= 1 && picks.length <= 3);
  const sides = picks.map((p) => sideOf(soccer, p.market, p.pick)).filter(Boolean);
  assert.ok(sides.every((s) => s === 'home' || s === 'home-or-draw'), JSON.stringify(picks.map((p) => p.pick)));
  const dirs = new Set(picks.map((p) => directionOf(p.market, p.pick)).filter(Boolean));
  assert.ok(dirs.size <= 1, 'one goals direction');
  assert.ok(picks.filter((p) => directionOf(p.market, p.pick)).length <= 2);
});

const ev = (i, h, a) => ({ id: `e${i}`, compId: String(i), sport: 'basketball', home: `H${i}`, away: `A${i}`, start: now + 36e5, markets: [{ name: 'Winner', outcomes: [{ name: `H${i}`, odds: h }, { name: `A${i}`, odds: a }] }] });
const board = Array.from({ length: 120 }, (_, i) => ev(i, [1.12, 1.18, 1.22, 1.28, 1.35, 1.5, 2.1, 2.6][i % 8], [7, 5.2, 4.4, 3.8, 3.2, 2.6, 1.75, 1.5][i % 8]));

test('big targets are built from many short favourites, not long shots', () => {
  const [s] = bankerSlips(board, 1000, { count: 1, tolerance: 0.15 });
  assert.ok(s, 'a 1000x slip exists');
  assert.ok(s.odds >= 850 && s.odds <= 1150, `odds ${s.odds}`);
  assert.ok(s.legs.length >= 20, `${s.legs.length} legs`);
  assert.ok(s.legs.every((l) => l.odds <= 1.45));
  assert.equal(new Set(s.legs.map((l) => l.eventId)).size, s.legs.length, 'one leg per match');
});

test('2x slips use short legs and distinct slips use different matches', () => {
  const list = bankerSlips(board, 2, { count: 3 });
  assert.ok(list.length >= 2);
  for (const s of list) { assert.ok(s.odds >= 1.84 && s.odds <= 2.16); assert.ok(s.legs.every((l) => l.odds <= 1.7)); }
  const ids = list.flatMap((s) => s.legs.map((l) => l.eventId));
  assert.equal(new Set(ids).size, ids.length);
});
