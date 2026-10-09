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
