import test from 'node:test';
import assert from 'node:assert/strict';
import { calibration, calibrated, familyOf, settleMulti, multiPicks, summarize } from '../js/track.js';

const pick = (market, status, p = 0.62, extra = {}) => ({ market, status, p, odds: 1.6, type: 'banker', sport: 'football', start: 1, ...extra });

test('market families learn from results: weak totals need more, strong winners get a small lift', () => {
  const h = [...Array(12).fill(0).map((_, i) => pick('Total 2.5', i < 6 ? 'won' : 'lost')), ...Array(10).fill(0).map((_, i) => pick('Winner', i < 9 ? 'won' : 'lost', 0.65))];
  const c = calibration(h);
  assert.equal(familyOf('Total 220.5'), 'total');
  assert.ok(c.total.factor < 0.95, `total factor ${c.total.factor}`);
  assert.ok(c.winner.factor > 1 && c.winner.factor <= 1.05);
  assert.ok(calibrated(0.62, 'Total 2.5', c) < 0.6);
  assert.equal(calibrated(0.62, 'Spread', c), 0.62); // no history: unchanged
});

test('multiplier slips: lost on any loss, won when all settle, pushes drop out', () => {
  const legs = (...st) => st.map((s, i) => ({ status: s, odds: 1.5 + i * 0.1 }));
  assert.equal(settleMulti({ legs: legs('won', 'lost', 'pending') }).status, 'lost');
  assert.equal(settleMulti({ legs: legs('won', 'pending') }).status, 'pending');
  assert.deepEqual(settleMulti({ legs: legs('won', 'void', 'won') }), { status: 'won', odds: 2.55 });
  assert.equal(settleMulti({ legs: legs('void', 'void') }).status, 'void');
});

test('daily multiplier picks lock one slip per target with gradeable legs', () => {
  const now = Date.parse('2026-10-05T08:00:00Z');
  const ev = (i, h, a) => ({ id: `e${i}`, compId: String(i), leaguePath: 'basketball/nba', sport: 'basketball', home: `H${i}`, away: `A${i}`, start: now + (2 + i) * 36e5, markets: [{ name: 'Winner', outcomes: [{ name: `H${i}`, odds: h }, { name: `A${i}`, odds: a }] }] });
  const events = [ev(1, 1.42, 2.9), ev(2, 1.4, 3), ev(3, 1.45, 2.8), ev(4, 2.0, 1.8), ev(5, 1.7, 2.15), ev(6, 1.25, 4)];
  const m = multiPicks(events, now);
  assert.ok(m.length >= 2);
  for (const s of m) {
    assert.equal(s.type, 'multi');
    assert.match(s.key, /^multi\|2026-10-05\|\dx$/);
    assert.ok(Math.abs(s.odds / s.target - 1) <= 0.11);
    assert.ok(s.legs.every((l) => l.compId && l.status === 'pending'));
  }
  const st = summarize([...m.map((x, i) => ({ ...x, status: i ? 'lost' : 'won' })), pick('Winner', 'won')]);
  assert.equal(st.all.won, 1); // singles only
  assert.equal(st.multi.won + st.multi.lost, m.length);
  assert.ok(st.byType.some((r) => r.key === 'multi'));
});
