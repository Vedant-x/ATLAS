import test from 'node:test';
import assert from 'node:assert/strict';
import { devig, buildSlips } from '../js/engine.js';
import { applyModel, bankers } from '../js/intel.js';

const start = Date.parse('2026-10-02T14:00:00Z');
const ev = (id, home, away, outcomes) => ({ id, sport: 'football', league: 'Premier League', home, away, start, live: false, stats: {}, markets: [{ name: outcomes.length === 3 ? 'Match Result' : 'Winner', outcomes }] });

test('de-vig probabilities sum to 1 and slips stay one leg per event', () => {
  const { outcomes } = devig({ name: 'Match Result', outcomes: [{ name: 'Arsenal', odds: 1.22 }, { name: 'Draw', odds: 6.5 }, { name: 'Ipswich Town', odds: 12 }] });
  assert.ok(Math.abs(outcomes.reduce((a, o) => a + o.fair, 0) - 1) < 1e-9);
  const events = Array.from({ length: 6 }, (_, i) => ev(`e${i}`, `Home ${i}`, `Away ${i}`, [{ name: `Home ${i}`, odds: 1.4 + i / 10 }, { name: `Away ${i}`, odds: 2.8 }]));
  for (const s of buildSlips(events, 3, { maxLegs: 3, tolerance: 0.1 })) assert.equal(new Set(s.legs.map((l) => l.eventId)).size, s.legs.length);
});

test('bankers only list picks at 70%+ model probability', () => {
  const events = applyModel([ev('a', 'Arsenal', 'Ipswich Town', [{ name: 'Arsenal', odds: 1.22 }, { name: 'Draw', odds: 6.5 }, { name: 'Ipswich Town', odds: 12 }])]);
  const b = bankers(events);
  assert.equal(b[0].pick, 'Arsenal');
  assert.ok(b.every((x) => x.p >= 0.7));
});
