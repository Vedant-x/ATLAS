import test from 'node:test';
import assert from 'node:assert/strict';
import { calibration, calibrated, familyOf, settleMulti, multiPicks, summarize, rankedBankers, slipWindow, updateClosing } from '../js/track.js';
import { bankerSlips } from '../js/picks.js';

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

test('one chance per pick: ranked bankers carry the calibrated chance, the raw estimate and the market chance', () => {
  const e = { id: 'x', sport: 'football', home: 'A', away: 'B', start: 1, markets: [{ name: 'Total 2.5', outcomes: [{ name: 'Over 2.5', odds: 1.3 }, { name: 'Under 2.5', odds: 3.4 }] }] };
  const cal = { total: { factor: 0.9 } };
  const [b] = rankedBankers([e], { cal, min: 0.6 });
  assert.ok(Math.abs(b.p - b.pRaw * 0.9) < 1e-9, 'shown chance is the calibrated one');
  assert.ok(Math.abs(b.ev - (b.p * b.odds - 1)) < 1e-9, 'edge uses the same chance');
  assert.ok(b.fair > 0.7 && b.fair < 0.75);
});

test('unresolved legs keep a slip unresolved; it is never counted', () => {
  assert.equal(settleMulti({ legs: [{ status: 'won', odds: 1.2 }, { status: 'unresolved', odds: 1.3 }] }).status, 'unresolved');
  const st = summarize([{ type: 'banker', status: 'unresolved', p: 0.7, odds: 1.4, market: 'Winner', sport: 'x' }, { type: 'banker', status: 'won', p: 0.7, odds: 1.4, market: 'Winner', sport: 'x' }]);
  assert.equal(st.all.won + st.all.lost, 1);
  assert.equal(st.unresolved, 1);
});

test('slips never relax the minimum odds and never use two legs with the same team', () => {
  const now = Date.parse('2026-10-05T08:00:00Z');
  const ev = (i, home, away, h) => ({ id: `e${i}`, sport: 'basketball', home, away, start: now + 36e5, markets: [{ name: 'Winner', outcomes: [{ name: home, odds: h }, { name: away, odds: 1 / (1.04 - 1 / h) }] }] });
  const events = [ev(1, 'Lakers', 'Kings', 1.25), ev(2, 'Lakers', 'Suns', 1.25), ...Array.from({ length: 20 }, (_, i) => ev(i + 3, `T${i}`, `U${i}`, [1.12, 1.25, 1.35][i % 3]))];
  for (const s of bankerSlips(events, 3, { count: 3, minOdds: 1.2 })) {
    assert.ok(s.legs.every((l) => l.odds >= 1.2), 'min odds kept');
    const teams = s.legs.flatMap((l) => l.match.split(' vs '));
    assert.equal(new Set(teams).size, teams.length, 'no shared team');
  }
  assert.deepEqual(bankerSlips(events, 3, { minOdds: 3 }), [], 'impossible rule gives no slip instead of a relaxed one');
});

test('slip window: under 10x the next 12 hours, 10x and bigger the next 7 days', () => {
  const now = Date.parse('2026-10-06T08:00:00Z');
  const at = (h) => ({ id: `e${h}`, start: now + h * 36e5 });
  const evs = [at(-1), at(2), at(20), at(100), at(170)];
  assert.deepEqual(slipWindow(evs, 5, now).map((e) => e.id), ['e2']);
  assert.deepEqual(slipWindow(evs, 10, now).map((e) => e.id), ['e2', 'e20', 'e100']);
  assert.deepEqual(slipWindow(evs, 1000, now).map((e) => e.id), ['e2', 'e20', 'e100']);
});

test('closing line: pending picks keep the latest pre-start price; summary compares it with the saved price', () => {
  const now = Date.parse('2026-10-06T08:00:00Z');
  const ev = { id: 'm1', start: now + 36e5, markets: [{ name: 'Winner', outcomes: [{ name: 'A', odds: 1.5 }, { name: 'B', odds: 2.6 }] }] };
  const h = [{ key: 'k', type: 'banker', status: 'pending', eventId: 'm1', market: 'Winner', pick: 'A', odds: 1.6, start: now + 36e5 },
    { key: 'k2', type: 'banker', status: 'pending', eventId: 'm1', market: 'Winner', pick: 'A', odds: 1.6, start: now - 36e5 }];
  assert.equal(updateClosing(h, [ev], now), 1);
  assert.equal(h[0].close, 1.5);
  assert.equal(h[1].close, undefined, 'started matches keep the last price saved before kick-off');
  const won = Array.from({ length: 10 }, (_, i) => ({ key: `w${i}`, type: 'banker', status: 'won', odds: 1.6, close: 1.5, p: 0.7, market: 'Winner', sport: 'football' }));
  const s = summarize(won);
  assert.equal(s.all.clvN, 10);
  assert.ok(Math.abs(s.all.clv - (1.6 / 1.5 - 1)) < 1e-9);
  assert.equal(s.all.beatClose, 1);
});
