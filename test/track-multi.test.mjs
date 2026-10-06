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

test('graded multiplier legs feed the market calibration too', () => {
  const legs = Array.from({ length: 12 }, (_, i) => ({ market: 'Total 2.5', p: 0.72, status: i < 6 ? 'won' : 'lost', odds: 1.3 }));
  const c = calibration([{ type: 'multi', status: 'lost', legs }]);
  assert.equal(c.total.n, 12);
  assert.ok(c.total.factor < 0.85, `leg losses lower totals: ${c.total.factor}`);
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
  const events = Array.from({ length: 30 }, (_, i) => ev(i + 1, [1.18, 1.22, 1.25, 1.3, 1.35, 1.4][i % 6], [5.5, 4.6, 4.1, 3.6, 3.2, 2.95][i % 6]));
  const m = multiPicks(events, now);
  assert.ok(m.length >= 2);
  for (const s of m) {
    assert.equal(s.type, 'multi');
    assert.match(s.key, /^multi\|2026-10-05\|\d+x$/);
    assert.ok(s.odds / s.target - 1 <= 0.16 && s.odds / s.target - 1 >= -0.08, `${s.target}x at ${s.odds}`); // thin boards fall back to a wider band
    assert.ok(s.legs.every((l) => l.odds <= 1.7), 'banker legs only');
    assert.ok(s.legs.every((l) => l.compId && l.status === 'pending'));
  }
  const st = summarize([...m.map((x, i) => ({ ...x, status: i ? 'lost' : 'won' })), pick('Winner', 'won')]);
  assert.equal(st.all.won, 1); // singles only
  assert.equal(st.multi.won + st.multi.lost, m.length);
  assert.ok(!st.byType.some((r) => r.key === 'multi'), 'multipliers stay out of the main record');
  assert.ok(st.recent.every((h) => h.type !== 'multi'));
  for (const s of m) {
    const own = st.byTarget.find((r) => r.target === s.target);
    assert.equal(own.won + own.lost, 1, `${s.target}x has its own record`);
    assert.equal(own.slips[0].key, s.key);
  }
  assert.equal(st.mega.won + st.mega.lost, m.filter((x) => x.target >= 100).length);
});
