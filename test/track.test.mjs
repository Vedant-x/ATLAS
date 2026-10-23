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

test('ESPN summaries become results; postponed games wait, cancelled games are void', () => {
  const sm = (type, h, a) => ({ header: { competitions: [{ status: { type }, competitors: [{ homeAway: 'home', score: h.s, winner: h.w }, { homeAway: 'away', score: a.s, winner: a.w }] }] } });
  assert.deepEqual(resultFromSummary(sm({ completed: true, name: 'STATUS_FINAL' }, { s: '3', w: true }, { s: '0', w: false })), { done: true, homeScore: '3', awayScore: '0', winner: 'home' });
  assert.equal(resultFromSummary(sm({ completed: true, name: 'STATUS_FULL_TIME' }, { s: '1' }, { s: '1' })).winner, 'draw');
  assert.equal(resultFromSummary(sm({ completed: false, name: 'STATUS_IN_PROGRESS' }, { s: '1' }, { s: '0' })).done, false);
  assert.equal(resultFromSummary(sm({ completed: false, name: 'STATUS_POSTPONED' }, {}, {})).postponed, true);
  assert.equal(resultFromSummary(sm({ completed: false, name: 'STATUS_CANCELED' }, {}, {})).void, true);
});

test('picks are recorded once, at the first price, only before kick-off', () => {
  const now = Date.now();
  const ev = (id, start, odds) => ({ id, compId: id, leaguePath: 'soccer/eng.1', sport: 'football', league: 'EPL', home: 'A', away: 'B', start, live: false, stats: {}, markets: [{ name: 'Winner', outcomes: [{ name: 'A', odds }, { name: 'B', odds: 3.2 }] }] });
  const first = selectPicks([ev('1', now + 36e5, 1.35), ev('2', now - 60e3, 1.35), ev('3', now + 30 * 36e5, 1.35)], now);
  assert.deepEqual([...new Set(first.map((p) => p.eventId))], ['1']); // started and far-future games skipped
  const h1 = addPicks([], first);
  const h2 = addPicks(h1, selectPicks([ev('1', now + 36e5, 1.5)], now));
  assert.equal(h2.length, h1.length);
  assert.equal(h2[0].odds, 1.35);
});

test('summary: the live lists (Best bets, Value bets) are the headline; retired lists keep their final record', () => {
  const h = [
    { status: 'won', odds: 1.5, p: 0.65, type: 'best', sport: 'football', start: 1 },
    { status: 'won', odds: 1.4, p: 0.68, type: 'best', sport: 'football', start: 2 },
    { status: 'lost', odds: 1.6, p: 0.62, type: 'edge', sport: 'hockey', start: 3 },
    { status: 'push', odds: 1.7, p: 0.61, type: 'best', sport: 'hockey', start: 4 },
    { status: 'pending', odds: 1.3, p: 0.7, type: 'best', sport: 'football', start: 5 },
    // Retired: a shortlist banker and a surest pick, counted in their own final records only.
    { status: 'won', odds: 1.45, p: 0.7, type: 'banker', sport: 'football', start: 6 },
    { status: 'lost', odds: 1.3, p: 0.75, type: 'safe', sport: 'football', start: 7 },
    { status: 'pending', odds: 1.45, p: 0.7, type: 'banker', sport: 'football', start: 8 },
    // Unseen probes are never in any list.
    { status: 'lost', odds: 1.5, p: 0.66, type: 'probe', sport: 'hockey', start: 9 },
  ];
  const s = summarize(h);
  assert.equal(s.live.won, 2); assert.equal(s.live.lost, 1); assert.equal(s.live.push, 1);
  assert.ok(Math.abs(s.live.hitRate - 2 / 3) < 1e-9);
  assert.equal(s.live.profit, -0.1); // +0.5 +0.4 -1
  assert.equal(s.pending.length, 1, 'pending: live lists only');
  assert.equal(s.buckets.find((b) => b.label === '60–70%').n, 3);
  assert.deepEqual(s.retired.map((r) => [r.name.split(' (')[0], r.won, r.lost]), [['Shortlist bankers', 1, 0], ['Surest', 0, 1]]);
  assert.equal(s.outside.won + s.outside.lost, 0);
});

test('official picks: Best bets (1.20 to 2.50) and Value bets only; nothing from the retired lists', async () => {
  const { selectPicks } = await import('../js/track.js');
  const now = Date.parse('2026-10-07T08:00:00Z');
  const ev = (id, a, b) => ({ id, compId: id, sport: 'basketball', league: 'NBA', home: `H${id}`, away: `A${id}`, start: now + 36e5, markets: [{ name: 'Winner', outcomes: [{ name: `H${id}`, odds: a }, { name: `A${id}`, odds: b }] }] });
  const picks = selectPicks([ev('1', 1.35, 3.3), ev('2', 1.25, 4.1), ev('3', 1.62, 2.35), ev('4', 1.9, 1.95)], now, 12, []).filter((p) => p.type !== 'multi');
  assert.ok(picks.length > 0);
  assert.ok(picks.every((p) => (p.type === 'best' && p.odds >= 1.2 && p.odds <= 2.5) || p.type === 'edge'), JSON.stringify(picks.map((p) => [p.type, p.odds])));
  assert.equal(new Set(picks.map((p) => p.key)).size, picks.length, 'one record per list');
});

test('settlement: legs of a slip that already lost keep being graded', async () => {
  const { duePicks } = await import('../js/track.js');
  const now = Date.parse('2026-10-18T00:00:00Z'), old = now - 2 * 864e5;
  const leg = (id, status) => ({ eventId: id, market: 'Winner', pick: id, status, start: old, leaguePath: 'soccer/eng.1', compId: id });
  const history = [
    { type: 'multi', status: 'lost', start: old, legs: [leg('a', 'lost'), leg('b', 'pending'), leg('c', 'won')] },
    { type: 'multi', status: 'pending', start: old, legs: [leg('d', 'pending')] },
    { type: 'banker', status: 'pending', start: old, eventId: 'e', market: 'Winner', pick: 'e' },
    { type: 'banker', status: 'pending', start: now, eventId: 'f', market: 'Winner', pick: 'f' }, // not over yet
  ];
  assert.deepEqual(duePicks(history, now).map((x) => x.eventId).sort(), ['b', 'd', 'e']);
});

test('calibration: a settled copy of a pick counts even when an earlier copy is still pending', async () => {
  const { calibration, observations } = await import('../js/track.js');
  const single = (status, p = 0.7) => ({ type: 'banker', eventId: 'x1', market: 'Winner', pick: 'Arsenal', sport: 'football', odds: 1.5, p, status });
  // The reviewer's case: first copy pending, later copy won. Before, neither counted.
  const cal = calibration([single('pending', 0.7), { type: 'multi', status: 'lost', legs: [{ ...single('won', 0.75) }] }]);
  assert.equal(cal.winner?.n, 1);
  assert.equal(cal.winner.won, 1);
  assert.equal(cal.winner.exp, 0.7, 'the forecast is the first record\'s');
  // Copies that disagree are left out and reported.
  const o = observations([single('won'), single('lost')]);
  assert.equal(o.list.length, 0);
  assert.deepEqual(o.conflicts, ['x1|winner|arsenal']);
});

test('best bets: likeliest first, and only at a price at least the market\'s fair odds', async () => {
  const { bestBets } = await import('../js/track.js');
  const now = Date.parse('2026-10-07T08:00:00Z');
  // Many bookmakers: best price and consensus chance (oddsapi.js) on each outcome.
  const ev = (id, sport, odds, cons, oddsB, consB) => ({ id, compId: id, sport, league: 'L', leaguePath: `${sport}/l`, home: `H${id}`, away: `A${id}`, start: now + 36e5,
    markets: [{ name: 'Winner', outcomes: [{ name: `H${id}`, odds, cons, book: 'fanduel' }, { name: `A${id}`, odds: oddsB, cons: consB, book: 'pinnacle' }] }] });
  const list = bestBets([
    ev('1', 'basketball', 1.27, 0.80, 4.2, 0.20), // 1.27 x 0.80 = 1.016: longer than fair, likeliest
    ev('2', 'hockey', 1.55, 0.66, 2.5, 0.34), // 1.55 x 0.66 = 1.023: longer than fair
    ev('3', 'baseball', 1.40, 0.68, 3.0, 0.32), // 1.40 x 0.68 = 0.952: shorter than fair, left out
  ]);
  assert.deepEqual(list.map((b) => b.event.id), ['1', '2']);
  assert.ok(list[0].p >= list[1].p);
  assert.equal(list[0].book, 'fanduel');
});

test('parlay of the day: a day runs 12:00 to 12:00 in the chosen zone; one slip at 1.70 to 2.00', async () => {
  const { potdDay, parlayOfDay, selectPicks } = await import('../js/track.js');
  // 13:00 IST on 18 Oct is the 18 Oct day; 11:00 IST on 19 Oct is still the 18 Oct day.
  const ist = (d, h) => Date.parse(`2026-10-${d}T${String(h).padStart(2, '0')}:00:00+05:30`);
  assert.equal(potdDay(ist(18, 13), 'IST').key, '2026-10-18');
  assert.equal(potdDay(ist(19, 11), 'IST').key, '2026-10-18');
  assert.equal(potdDay(ist(19, 12), 'IST').key, '2026-10-19');
  assert.equal(potdDay(ist(18, 13), 'IST').end, ist(19, 12));
  assert.equal(potdDay(Date.parse('2026-10-18T11:30:00Z'), 'GMT').key, '2026-10-17');
  const now = ist(18, 13);
  const ev = (id, h, a, start) => ({ id, compId: id, sport: 'basketball', league: 'L', leaguePath: 'basketball/l', home: `H${id}`, away: `A${id}`, start, markets: [{ name: 'Winner', outcomes: [{ name: `H${id}`, odds: h }, { name: `A${id}`, odds: a }] }] });
  const board = [ev('1', 1.25, 4.2, now + 2 * 36e5), ev('2', 1.3, 3.7, now + 3 * 36e5), ev('3', 1.22, 4.6, now + 4 * 36e5), ev('4', 1.28, 3.9, now + 5 * 36e5), ev('5', 1.2, 4.8, now + 30 * 36e5)];
  const slip = parlayOfDay(board, { now, zone: 'IST' });
  assert.ok(slip, 'a slip from the day\'s matches');
  assert.ok(slip.odds >= 1.7 && slip.odds <= 2.0, String(slip.odds));
  assert.ok(slip.legs.every((l) => l.eventId !== '5'), 'nothing after the day ends');
  const recorded = selectPicks(board, now, 12, []).filter((h) => h.target === 'potd');
  assert.deepEqual(recorded.map((h) => h.key).sort(), ['multi|2026-10-17|potd-GMT', 'multi|2026-10-18|potd-IST']); // 13:00 IST is 07:30 GMT: still the 17 Oct GMT day
});


