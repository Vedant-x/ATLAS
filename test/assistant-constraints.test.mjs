import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrain } from '../js/assistant/brain.js';

// A stub knowledge layer whose picks honour the options the brain passes (as knowledge.js does).
const now = Date.now();
// Midnight in IST (the default zone), d days from today.
const IST = 330 * 6e4;
const day = (d) => Math.floor((now + IST) / 864e5) * 864e5 - IST + d * 864e5;
const ev = (id, sport, leaguePath, start) => ({ id, sport, leaguePath, league: leaguePath.split('/').pop().toUpperCase(), home: `${id} Home`, away: `${id} Away`, start });
const E = [ev('nba1', 'basketball', 'basketball/nba', now + 2 * 36e5), ev('epl1', 'football', 'soccer/eng.1', now + 3 * 36e5), ev('nhl1', 'hockey', 'hockey/nhl', day(1) + 20 * 36e5)];
const C = [
  { e: E[0], market: 'Winner', pick: 'NBA fav', odds: 1.5, p: 0.7, ev: 0.05, priced: true },
  { e: E[1], market: 'Winner', pick: 'EPL fav', odds: 1.85, p: 0.52, ev: -0.038, priced: true },
  { e: E[2], market: 'Winner', pick: 'NHL fav', odds: 1.6, p: 0.6, ev: -0.04, priced: true },
];
const calls = [];
const K = {
  norm: (s) => String(s).toLowerCase(), currentEvent: () => null, currentScope: () => ({}),
  sportIn: (q) => (/nba|basketball/.test(q) ? 'basketball' : /nhl|hockey/.test(q) ? 'hockey' : null),
  leagueIn: (q) => (/\bnba\b/.test(q) ? 'basketball/nba' : /\bnhl\b/.test(q) ? 'hockey/nhl' : null),
  eventsIn: () => [], filterEvents: ({ league } = {}) => E.filter((e) => !league || e.leaguePath === league), eventById: (id) => E.find((e) => e.id === id),
  picks: (o) => {
    calls.push(['picks', o]);
    return C.filter((x) => (!o.league || x.e.leaguePath === o.league) && (!o.sport || x.e.sport === o.sport)
      && !(o.exclude?.leagues || []).includes(x.e.leaguePath) && !(o.exclude?.sports || []).includes(x.e.sport)
      && (o.minOdds == null || x.odds >= o.minOdds) && (o.maxOdds == null || x.odds <= o.maxOdds)
      && (!o.from || x.e.start >= o.from) && (!o.to || x.e.start < o.to) && (o.mode !== 'value' || x.ev > 0)
      && !(o.skip || []).includes(`${x.e.id}|${x.market}|${x.pick}`)).slice(0, o.limit);
  },
  candidates: (list) => C.filter((x) => list.includes(x.e)),
  caseOf: () => ({ pro: [], con: ['Away side in form'], invalid: ['A late scratch'] }),
  readinessOf: () => ({ label: 'Ready to assess', missing: [], uncovered: [], checks: [] }),
  matchSummary: (e) => ({ winProbability: { home: 0.6, away: 0.4 }, basis: 'Bookmaker price', recommended: [], starters: [] }),
  slips: (t, today, opts) => { calls.push(['slips', t, opts]); const ok = E.filter((e) => !opts?.filter || opts.filter(e)); return ok.length ? [{ odds: t, p: 0.3, legs: ok.map((e) => ({ pick: `${e.id} fav`, market: 'Winner', match: e.home, odds: 1.5, p: 0.6, eventId: e.id })) }] : []; },
};

test('assistant keeps the minimum odds asked for', async () => {
  const b = createBrain(K);
  const a = await b.answer('Give me one bet with odds at least 1.80');
  assert.equal(calls.at(-1)[1].minOdds, 1.8);
  assert.equal(calls.at(-1)[1].limit, 1);
  assert.deepEqual(a.cards.map((c) => c.pick), ['EPL fav']);
  assert.ok(a.chips.includes('Odds ≥ 1.80'));
});

test('assistant: tomorrow means tomorrow', async () => {
  const a = await createBrain(K).answer('Best bets tomorrow');
  const o = calls.at(-1)[1];
  assert.equal(o.from, day(1));
  assert.equal(o.to, day(2));
  assert.deepEqual(a.cards.map((c) => c.pick), ['NHL fav']);
});

test('tomorrow is tomorrow in the chosen time zone, not the browser\'s', async () => {
  const { parseConstraints } = await import('../js/assistant/constraints.js');
  // 20:00 UTC on 18 Oct is already 19 Oct (01:30) in IST.
  const t = Date.parse('2026-10-18T20:00:00Z');
  const ist = parseConstraints('best bets tomorrow', K, t, 'IST'), gmt = parseConstraints('best bets tomorrow', K, t, 'GMT');
  assert.equal(new Date(ist.from).toISOString(), '2026-10-19T18:30:00.000Z'); // 20 Oct 00:00 IST
  assert.equal(new Date(gmt.from).toISOString(), '2026-10-19T00:00:00.000Z'); // 19 Oct 00:00 GMT
  assert.equal(ist.to - ist.from, 864e5);
});

test('assistant: excluding NBA never returns NBA', async () => {
  const a = await createBrain(K).answer('Best bets excluding NBA');
  assert.ok(a.cards.length > 0);
  assert.ok(a.cards.every((c) => c.e.leaguePath !== 'basketball/nba'), a.cards.map((c) => c.pick).join());
  assert.ok(a.chips.some((t) => /^Not NBA$/i.test(t)));
});

test('assistant: an NBA-only slip only uses NBA', async () => {
  const a = await createBrain(K).answer('Give me an NBA-only 3x slip');
  const [, t, opts] = calls.at(-1);
  assert.equal(t, 3);
  assert.ok(opts.filter(E[0]) && !opts.filter(E[1]) && !opts.filter(E[2]));
  assert.ok(a.cards.every((c) => c.leg.eventId === 'nba1'));
});

test('assistant: positive edge only is never substituted', async () => {
  const a = await createBrain(K).answer('Give me positive edge bets only tomorrow');
  assert.equal(a.cards, undefined, 'no cards: nothing qualifies tomorrow');
  assert.match(a.text, /No pick has a positive estimated return/);
  assert.doesNotMatch(a.text, /Best value/);
});

test('assistant remembers the list: "the second one", "explain the risk", "what about tomorrow?"', async () => {
  const b = createBrain(K);
  await b.answer('best bets this week');
  assert.ok(b.memory().list.length >= 2);
  const second = b.memory().list[1];
  const r = await b.answer('what about the second one?');
  assert.match(r.text, new RegExp(second.e.home));
  const risk = await b.answer('explain the risk');
  assert.match(risk.text, new RegExp(`Risk: ${second.pick}`));
  assert.match(risk.text, /Away side in form/);
  const t = await b.answer('what about tomorrow?');
  assert.equal(calls.at(-1)[1].from, day(1), 'tomorrow, with the earlier constraints kept');
  assert.deepEqual(t.cards.map((c) => c.pick), ['NHL fav']);
});

test('assistant: a slip keeps every chip it shows (league, max odds, positive return only)', async () => {
  const a = await createBrain(K).answer('NBA-only 3x slip with odds at most 1.50 and positive edge only');
  const [, t, opts] = calls.filter((c) => c[0] === 'slips').at(-1);
  assert.equal(t, 3);
  assert.equal(opts.maxOdds, 1.5);
  assert.equal(opts.positiveOnly, true);
  assert.equal(opts.filter(E[1]), false, 'EPL is out');
  assert.equal(opts.filter(E[0]), true);
  // The stub's legs (1.50 at 60%) lose on average: the slip is dropped, never shown.
  assert.match(a.text, /No 3x slip can be built/);
  for (const chip of ['Odds ≤ 1.50', 'Positive return only', '3x']) assert.ok(a.chips.includes(chip), chip);
});

test('answer check: a real number stuck to the wrong pick is flagged', async () => {
  const { verifyAnswer } = await import('../js/assistant/verify.js');
  const A = { pick: 'Team A', e: { home: 'Team A', away: 'Rivals A' } }, B = { pick: 'Team B', e: { home: 'Team B', away: 'Rivals B' } };
  const context = { tags: { P1: A, P2: B }, text: 'PICKS:\n  - [P1] Team A · Winner · odds 1.50 · ATLAS 80%\n  - [P2] Team B · Winner · odds 2.50 · ATLAS 40%' };
  const wrong = verifyAnswer('Team B has 80% chance at 1.50.', context);
  assert.deepEqual(wrong.misplaced.map((m) => m.number), ['80%', '1.50']);
  assert.match(wrong.text, /belongs to another pick/);
  const right = verifyAnswer('[P2] has 40% at 2.50. [P1] is 80% at 1.50.', context);
  assert.deepEqual(right.misplaced, []);
  assert.deepEqual(right.unverified, []);
  assert.deepEqual(verifyAnswer('Team A is 91% to win.', context).unverified, ['91%']);
});

test('answer check binds every number to its pick: swaps, pronouns, two picks in one sentence, units', async () => {
  const { verifyAnswer } = await import('../js/assistant/verify.js');
  const A = { pick: 'Arsenal', market: 'Winner', odds: 1.5, p: 0.8, ev: 0.2, e: { home: 'Arsenal', away: 'Leeds' } };
  const B = { pick: 'Chelsea', market: 'Winner', odds: 2.5, p: 0.4, ev: 0, e: { home: 'Chelsea', away: 'Spurs' } };
  const context = { tags: { P1: A, P2: B }, text: [
    'MATCH: [Arsenal vs Leeds](#/match/1) · Premier League · Sat 15:00',
    '  Pre-match estimated win chance: Arsenal 80%, draw 12%, Leeds 8% (price)',
    'PICKS (balanced, constraints applied):',
    '  - [P1] Arsenal · Winner · odds 1.50 · ATLAS 80% · break-even 67% · return +20.0%',
    '  - [P2] Chelsea · Winner · odds 2.50 · ATLAS 40% · break-even 40% · return +0.0%',
  ].join('\n') };
  const flagged = (a) => verifyAnswer(a, context).misplaced.map((m) => m.number);
  // Correct claims pass, in any phrasing.
  assert.deepEqual(flagged('[P1] is 80% at 1.50 and [P2] is 40% at 2.50.'), []);
  assert.deepEqual(flagged('Arsenal are 80% to beat Leeds (8%). It pays 1.5.'), []);
  // Two picks in one sentence with the numbers swapped.
  assert.deepEqual(flagged('[P1] and [P2] are 40% and 80%.'), ['40%', '80%']);
  assert.deepEqual(flagged('[P1] and [P2] are 80% and 40%.'), []);
  assert.deepEqual(flagged('Chelsea at 1.50 and Arsenal at 2.50 are the picks.'), ['1.50', '2.50']);
  // The opponent's number from the match line given to the pick.
  assert.deepEqual(flagged('Arsenal only have an 8% chance.'), ['8%']);
  // A pronoun carries the previous sentence's pick.
  assert.deepEqual(flagged('Look at Chelsea. It is 80% to win.'), ['80%']);
  // A percentage never matches a price or a time.
  assert.deepEqual(verifyAnswer('Arsenal are 15% to win.', context).unverified, ['15%']);
  assert.deepEqual(verifyAnswer('Arsenal are 80 percent to win at 1.50.', context).misplaced, []);
});
