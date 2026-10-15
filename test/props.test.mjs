import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProps, boxStats, gradeProp, propLabel } from '../js/props.js';
import { gradePick, resultFromSummary, familyOf } from '../js/track.js';
import { bankers } from '../js/intel.js';

// Shapes as ESPN's propBets feed returns them (DraftKings, October 2026).
const ath = (id) => ({ $ref: `http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/athletes/${id}?lang=en&region=us` });
const nba = [
  { athlete: ath(4017837), type: { id: '218', name: 'Points Milestones' }, odds: { decimal: { value: '1.57' } }, current: { target: { value: 8, displayValue: '8+' } } },
  { athlete: ath(4017837), type: { id: '218', name: 'Points Milestones' }, odds: { decimal: { value: '1.01' } }, current: { target: { value: 3 } } },
  { athlete: ath(4396993), type: { id: '221', name: '3-Point Field Goals Milestones' }, odds: { decimal: { value: '1.75' } }, current: { target: { value: 2 } } },
  { team: { $ref: 'x/teams/11' }, type: { name: 'Team Total Points' }, odds: { decimal: { value: '1.83' } }, current: { target: { value: 116.5 } } },
  { athlete: ath(1), type: { name: 'Dunks Milestones' }, odds: { decimal: { value: '1.5' } }, current: { target: { value: 1 } } },
];
const soccer = [{ athlete: { $ref: 'x/soccer/leagues/eng.1/seasons/2026/athletes/30116' }, type: { name: 'Anytime Goalscorer' }, current: { over: { decimal: 2.1 } } }];
const who = (id) => ({ 4017837: { name: 'Ivica Zubac', side: 'home' }, 4396993: { name: 'Aaron Nesmith', side: 'away' }, 30116: { name: 'Bukayo Saka', side: 'away' } })[id] || null;

test('props: milestones and anytime scorers parse; ungradeable, team and silly-short lines are left out', () => {
  const p = parseProps(nba, 'basketball', who);
  assert.deepEqual(p.map(propLabel).sort(), ['Aaron Nesmith 2+ threes', 'Ivica Zubac 8+ points']);
  const z = p.find((x) => x.player === 'Ivica Zubac');
  assert.equal(z.target, 8); assert.equal(z.odds, 1.57);
  assert.ok(z.p < 1 / 1.57 && z.p > 0.58); // the price's chance less the margin
  const s = parseProps(soccer, 'soccer', who);
  assert.equal(propLabel(s[0]), 'Bukayo Saka to score'); assert.equal(s[0].target, 1);
});

test('props grade from the box score: over the line wins, under loses, sat out is void', () => {
  const sm = { header: { competitions: [{ status: { type: { completed: true } }, competitors: [{ homeAway: 'home', score: '110', winner: true }, { homeAway: 'away', score: '101' }] }] },
    boxscore: { players: [{ statistics: [{ keys: ['minutes', 'points', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'rebounds'], athletes: [
      { athlete: { id: '4017837' }, stats: ['30', '12', '0-0', '9'] }, { athlete: { id: '4396993' }, stats: ['25', '9', '1-6', '3'] }, { athlete: { id: '77' }, stats: [] }] }] }] } };
  const r = resultFromSummary(sm);
  const pick = (id, type, target) => ({ leaguePath: 'basketball/nba', market: 'Player x', pick: 'x', prop: { id, type, target } });
  assert.equal(gradePick(pick('4017837', 'Points', 8), r), 'won');
  assert.equal(gradePick(pick('4396993', '3-Point Field Goals', 2), r), 'lost');
  assert.equal(gradePick(pick('77', 'Points', 5), r), 'void');
  // Soccer anytime scorer from the key events (own goals don't count).
  const box = boxStats({ rosters: [{ roster: [{ athlete: { id: '5' }, starter: true }, { athlete: { id: '6' }, starter: true }, { athlete: { id: '8' }, starter: false }] }], keyEvents: [{ type: { text: 'Goal' }, scoringPlay: true, participants: [{ athlete: { id: '5' } }] }, { type: { text: 'Own Goal' }, participants: [{ athlete: { id: '6' } }] }] });
  assert.equal(gradeProp({ id: '5', type: 'Anytime Goalscorer', target: 1 }, 'soccer', box), 'won');
  assert.equal(gradeProp({ id: '6', type: 'Anytime Goalscorer', target: 1 }, 'soccer', box), 'lost');
  assert.equal(gradeProp({ id: '8', type: 'Anytime Goalscorer', target: 1 }, 'soccer', box), 'void'); // unused substitute
  assert.equal(gradeProp({ id: '9', type: 'Anytime Goalscorer', target: 1 }, 'soccer', box), null); // not in the squad list: unknown, retried
});

test('incomplete box scores never become results: missing player or missing stat stays unknown', () => {
  const box = boxStats({ boxscore: { players: [{ statistics: [{ name: 'skaters', keys: ['goals', 'assists'], athletes: [{ athlete: { id: '1' }, stats: ['1', '0'] }] }] }] } });
  assert.equal(gradeProp({ id: '1', type: 'Points', target: 1 }, 'hockey', box), 'won');
  assert.equal(gradeProp({ id: '1', type: 'Shots on Goal', target: 2 }, 'hockey', box), null); // shots missing from this box
  assert.equal(gradeProp({ id: '2', type: 'Points', target: 1 }, 'hockey', box), null); // player absent from the box
  assert.equal(gradeProp({ id: '1', type: 'Points', target: 1 }, 'hockey', boxStats({})), null); // no box score at all
});

test('props join the shortlist as their own bet type', () => {
  const e = { id: 'n1', sport: 'basketball', leaguePath: 'basketball/nba', home: 'Clippers', away: 'Pacers', start: Date.now() + 36e5, markets: [],
    props: parseProps(nba, 'basketball', who) };
  const b = bankers([e], { min: 0.55 });
  assert.ok(b.some((x) => x.pick === 'Ivica Zubac 8+ points' && x.market === 'Player points' && x.prop?.target === 8));
  assert.equal(familyOf('Player points'), 'prop');
});

test('player form: the last 10 games (no preseason) move a prop away from its price', async () => {
  const { gamelogRows, formFor, blendForm } = await import('../js/props.js');
  // ESPN game log shape: names, seasonTypes[].categories[].events[] { eventId, stats }, events{id:{gameDate}}.
  const names = ['minutes', 'points', 'totalRebounds', 'assists'];
  const games = Array.from({ length: 12 }, (_, i) => ({ eventId: `g${i}`, stats: ['30', String(i < 9 ? 12 : 4), '8', '2'] }));
  const g = { names, events: Object.fromEntries(games.map((x, i) => [x.eventId, { gameDate: new Date(Date.UTC(2026, 3, 30 - i)).toISOString() }])),
    seasonTypes: [{ displayName: '2026-27 Preseason', categories: [{ events: [{ eventId: 'pre', stats: ['10', '0', '0', '0'] }] }] }, { displayName: '2025-26 Regular Season', categories: [{ events: games }] }] };
  const rows = gamelogRows(g);
  assert.equal(rows.length, 10, 'last 10, preseason left out');
  const form = formFor('basketball', 'Points', 8, rows);
  assert.deepEqual(form, { n: 10, hits: 9, avg: 11.2 });
  const p = blendForm(0.6, form);
  assert.ok(p > 0.7 && p < 0.9, `a player clearing the line 9 of 10 rates above the price (${p})`);
  assert.ok(blendForm(0.6, formFor('basketball', 'Points', 13, rows)) < 0.35, 'one who never reached it rates well below');
  assert.equal(formFor('hockey', 'Goalkeeper Saves', 20, rows), null, 'no game-log column: the price alone');
});

test('prop history: hit rates over 5/10/20 games, season, opponent and venue; last 10 for the chart', async () => {
  const { gamelogRows, propHistory, propChance, blendForm, formFor } = await import('../js/props.js');
  const names = ['points'];
  // 20 games, newest first: 30, 10, 30, 10, … ; odd games at home vs team 7.
  const games = Array.from({ length: 20 }, (_, i) => ({ eventId: `g${i}`, stats: [String(i % 2 ? 10 : 30)] }));
  const g = { names, events: Object.fromEntries(games.map((x, i) => [x.eventId, { gameDate: new Date(Date.UTC(2026, 3, 30 - i)).toISOString(), atVs: i % 2 ? 'vs' : '@', opponent: { id: i % 2 ? '7' : '9', abbreviation: i % 2 ? 'BOS' : 'NYK' } }])),
    seasonTypes: [{ displayName: '2025-26 Regular Season', categories: [{ events: games }] }] };
  const rows = gamelogRows(g, 20);
  assert.equal(rows.length, 20);
  assert.equal(rows[0]._oppAbbr, 'NYK');
  assert.equal(rows[1]._home, true);
  const h = propHistory('basketball', 'Points', 25, rows, { opp: '7', home: true });
  assert.deepEqual(h.l5, [3, 5]);
  assert.deepEqual(h.l10, [5, 10]);
  assert.deepEqual(h.l20, [10, 20]);
  assert.deepEqual(h.vs, [0, 10], 'against team 7 he never reached 25');
  assert.deepEqual(h.venue, [0, 10], 'nor at home');
  assert.equal(h.last.length, 10);
  assert.deepEqual(h.last[0], [30, 'NYK', 0]);
  // At home (where he scores 10) the chance is well below the away chance.
  const atHome = propChance(0.5, 'basketball', 'Points', 25, rows, { home: true }).p;
  const away = propChance(0.5, 'basketball', 'Points', 25, rows, { home: false }).p;
  assert.ok(atHome < away, `venue matters (${atHome} vs ${away})`);
});

test('prop chance: a steady player near the line is not over-read; a hot streak moves the price', async () => {
  const { propChance } = await import('../js/props.js');
  const mk = (vals) => vals.map((v) => ({ points: v }));
  // Always 24-26 around a line of 25: hit rate 50%, the price 50%: stays near 50%.
  const steady = propChance(0.5, 'basketball', 'Points', 25, mk([26, 24, 26, 24, 25, 24, 26, 24, 26, 24])).p;
  assert.ok(steady > 0.4 && steady < 0.62, `steady ${steady}`);
  // Cleared 30 in each of the last 10, priced at 45%: well above the price but not certain.
  const hot = propChance(0.45, 'basketball', 'Points', 25, mk([34, 31, 36, 30, 33, 35, 32, 31, 38, 30]));
  assert.ok(hot.p > 0.65 && hot.p < 0.95, `hot ${hot.p}`);
  // No log: the price.
  assert.equal(propChance(0.6, 'basketball', 'Points', 25, []).p, 0.6);
  // Yards use the normal curve without underflow.
  const yds = propChance(0.5, 'football', 'Passing Yards', 250, Array.from({ length: 10 }, () => ({ passingYards: 300 }))).p;
  assert.ok(yds > 0.6, `yards ${yds}`);
});

test('teammates: games with and without him from his own log; his absence moves the forecast', async () => {
  const { propChance, splitByTeammate, withoutTeammate } = await import('../js/props.js');
  const mk = (list) => list.map(([ev, pts, team = '7']) => { const r = { points: pts }; Object.defineProperties(r, { _ev: { value: ev }, _team: { value: team }, _season: { value: true }, _home: { value: null } }); return r; });
  // Player: 12 games; the star teammate missed g3, g6, g9, g11 (he scores 30 then, 20 otherwise).
  const out = new Set(['g3', 'g6', 'g9', 'g11']);
  const rows = mk(Array.from({ length: 12 }, (_, i) => [`g${i}`, out.has(`g${i}`) ? 30 : 20]));
  const star = mk(Array.from({ length: 12 }, (_, i) => [`g${i}`, 25]).filter(([ev]) => !out.has(ev)));
  const sp = splitByTeammate(rows, star);
  assert.equal(sp.with.length, 8);
  assert.equal(sp.without.length, 4);
  // A teammate never on his team (another team id) places no game as "without".
  assert.equal(splitByTeammate(rows, mk([['x1', 10, '99']])).without.length, 0);
  const w = withoutTeammate('basketball', 'Points', 25, rows, star);
  assert.deepEqual(w.without, [4, 4]);
  assert.equal(w.fresh, true, 'he played most of the last 10: his absence is news');
  // A teammate out for the last 5 games: already in the recent form, not applied again.
  const longOut = mk(Array.from({ length: 12 }, (_, i) => [`g${i}`, 25]).filter((_, i) => i >= 5));
  assert.equal(withoutTeammate('basketball', 'Points', 25, rows, longOut).fresh, false);
  assert.ok(w.scale > 1.1 && w.scale <= 1.35, `scale ${w.scale}`);
  const base = propChance(0.4, 'basketball', 'Points', 25, rows).p;
  const adj = propChance(0.4, 'basketball', 'Points', 25, rows, { scale: w.scale, without: w.without }).p;
  assert.ok(adj > base + 0.05, `without the star he is more likely to reach 25 (${base} → ${adj})`);
  assert.equal(withoutTeammate('basketball', 'Points', 25, rows, mk(Array.from({ length: 12 }, (_, i) => [`g${i}`, 25]))), null, 'never missed a game: no estimate');
});

test('prop alerts: re-rated with the reason, lines pulled, injury status changes', async () => {
  const { snapshot, diff } = await import('../js/changelog.js');
  const base = { id: 'e1', home: 'Nuggets', away: 'Celtics', start: Date.now() + 36e5, markets: [] };
  const pr = (id, player, p, why) => ({ id, player, type: 'Points', label: 'points', target: 25, p, ...(why ? { why } : {}) });
  const before = snapshot({ ...base, props: [pr('1', 'Nikola Jokic', 0.58), pr('2', 'Jamal Murray', 0.5)], injuries: { home: [{ name: 'Jamal Murray', status: 'Questionable' }], away: [] } });
  const now = snapshot({ ...base, props: [pr('1', 'Nikola Jokic', 0.66, 'without Jamal Murray (out)')], injuries: { home: [{ name: 'Jamal Murray', status: 'Out' }], away: [] } });
  const ch = diff(base, before, now);
  const t = ch.map((c) => c.text);
  assert.ok(t.includes('Nikola Jokic 25+ points: ATLAS 58% → 66% (without Jamal Murray (out))'), t.join(' | '));
  assert.ok(t.some((x) => /^Lines pulled for Jamal Murray/.test(x)));
  const inj = ch.find((c) => c.kind === 'injury');
  assert.equal(inj.text, 'Jamal Murray: Questionable → Out');
  assert.equal(inj.forecast, 'updated', 'a teammate prop moved with it');
  // Old snapshots without props or injuries: nothing invented.
  assert.equal(diff(base, { ...before, props: undefined, inj: undefined, propPlayers: undefined }, now).filter((c) => c.kind === 'prop' || c.kind === 'injury').length, 0);
});

test('game log: hockey time on ice "18:32" reads as 18.5 minutes', async () => {
  const { gamelogRows, OPPORTUNITY } = await import('../js/props.js');
  const g = { names: ['goals', 'timeOnIcePerGame'], events: { a: { gameDate: '2026-10-10T23:00Z' } }, seasonTypes: [{ displayName: '2026-27 Regular Season', categories: [{ events: [{ eventId: 'a', stats: ['1', '18:32'] }] }] }] };
  const [r] = gamelogRows(g, 5);
  assert.equal(r.timeOnIcePerGame, 18.5);
  assert.equal(r[OPPORTUNITY.hockey], 18.5);
});
