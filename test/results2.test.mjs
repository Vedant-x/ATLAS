import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, findResult, secondReader, secondSourceFor, easternDate, nbaGameId, nbaPropResult, propPlayer } from '../js/results2.js';
import { applyRead, independentlyConfirmed } from '../js/settle.js';

const T = Date.parse('2026-10-17T23:00:00Z');
const nhl = { games: [
  { startTimeUTC: '2026-10-17T23:00:00Z', gameState: 'OFF', gameScheduleState: 'OK', homeTeam: { name: { default: 'Mammoth' }, placeName: { default: 'Utah' }, score: 2 }, awayTeam: { name: { default: 'Oilers' }, placeName: { default: 'Edmonton' }, score: 6 } },
  { startTimeUTC: '2026-10-18T02:00:00Z', gameState: 'LIVE', homeTeam: { name: { default: 'Kings' }, score: 1 }, awayTeam: { name: { default: 'Sharks' }, score: 0 } },
] };
const pick = (o) => ({ leaguePath: 'hockey/nhl', home: 'Utah Mammoth', away: 'Edmonton Oilers', start: T, market: 'Winner', pick: 'Edmonton Oilers', ...o });

test('second source: which leagues have one; US dates in Eastern time', () => {
  assert.equal(secondSourceFor('hockey/nhl').name, 'NHL API');
  assert.equal(secondSourceFor('soccer/eng.1').name, 'FotMob');
  assert.equal(secondSourceFor('football/nfl'), null);
  assert.equal(easternDate(Date.parse('2026-10-18T02:30:00Z')), '2026-10-17'); // 10:30pm ET on the 17th
});

test('second source: the same game, oriented to the pick; nothing when unclear or not final', () => {
  const games = parse.nhl(nhl);
  assert.deepEqual(findResult(pick(), games), { done: true, homeScore: 2, awayScore: 6, winner: 'away' });
  // The source lists the teams the other way round: scores are swapped back.
  assert.deepEqual(findResult(pick({ home: 'Edmonton Oilers', away: 'Utah Mammoth' }), games), { done: true, homeScore: 6, awayScore: 2, winner: 'home' });
  assert.equal(findResult(pick({ start: T + 5 * 36e5 }), games), null, 'start too far apart');
  assert.equal(findResult(pick({ home: 'Los Angeles Kings', away: 'San Jose Sharks', start: Date.parse('2026-10-18T02:00:00Z') }), games), null, 'not final yet');
  assert.equal(findResult(pick({ away: 'Calgary Flames' }), games), null, 'one team only');
});

test('second source: a derby of look-alike names is not used (both orientations fit)', () => {
  const j = { leagues: [{ matches: [{ home: { name: 'Man United', longName: 'Manchester United', score: 1 }, away: { name: 'Man City', longName: 'Manchester City', score: 2 }, status: { utcTime: '2026-10-17T23:00:00Z', finished: true, reason: { short: 'FT' } } }] }] };
  assert.equal(findResult({ home: 'Manchester United', away: 'Manchester City', start: T }, parse.fotmob(j), { soccer: true }), null);
});

test('second source: FotMob only after 90 minutes; MLB postponed games are not results', () => {
  const m = (short) => ({ leagues: [{ matches: [{ home: { name: 'Bayern', longName: 'Bayern München', score: 3 }, away: { name: 'Dortmund', longName: 'Borussia Dortmund', score: 1 }, status: { utcTime: '2026-10-17T23:00:00Z', finished: true, reason: { short } } }] }] });
  const p = { home: 'Bayern Munich', away: 'Borussia Dortmund', start: T };
  assert.equal(findResult(p, parse.fotmob(m('FT')), { soccer: true }).homeScore, 3);
  assert.equal(findResult(p, parse.fotmob(m('AET')), { soccer: true }), null);
  const mlb = (code) => ({ dates: [{ games: [{ gameDate: '2026-10-17T23:00:00Z', status: { codedGameState: code }, teams: { home: { team: { name: 'Cleveland Guardians' }, score: 4 }, away: { team: { name: 'Tampa Bay Rays' }, score: 3 } } }] }] });
  const q = { home: 'Cleveland Guardians', away: 'Tampa Bay Rays', start: T };
  assert.equal(findResult(q, parse.mlb(mlb('F'))).winner, 'home');
  assert.equal(findResult(q, parse.mlb(mlb('D'))), null);
});

test('second source reader: one fetch per address, props left to ESPN, failures reported', async () => {
  let calls = 0;
  const read = secondReader(async (url) => { calls++; if (/nba/.test(url)) throw new Error('down'); return nhl; });
  assert.equal((await read(pick())).result.winner, 'away');
  await read(pick({ market: 'Total 5.5' }));
  assert.equal(calls, 1);
  assert.equal(await read(pick({ prop: { id: '1' } })), null);
  assert.equal((await read({ leaguePath: 'basketball/nba', home: 'a', away: 'b', start: T })).failed, true);
});

test('confirmation by a different source is recorded as independent', () => {
  const p = pick({ status: 'pending', key: 'k' });
  const audit = [];
  applyRead(p, { status: 'won', score: '2-6' }, { now: T + 4 * 36e5, source: 'ESPN summary', audit });
  assert.equal(independentlyConfirmed(p), false);
  applyRead(p, { status: 'won', score: '2-6' }, { now: T + 8 * 36e5, source: 'NHL API', audit });
  assert.equal(p.confirmedBy, 'NHL API');
  assert.equal(independentlyConfirmed(p), true);
  // A second read of the same source confirms, but not independently.
  const q = pick({ status: 'won', gradedAt: T, settledBy: 'ESPN summary' });
  applyRead(q, { status: 'won' }, { now: T + 4 * 36e5, source: 'ESPN summary', audit });
  assert.equal(independentlyConfirmed(q), false);
  // Records from before settledBy existed were graded from ESPN.
  assert.equal(independentlyConfirmed({ status: 'won', confirmedAt: 1, confirmedBy: 'NHL API', leaguePath: 'hockey/nhl' }), true);
});

test('the second source disagreeing opens a dispute that settles only when both agree', () => {
  const p = pick({ status: 'won', gradedAt: T, settledBy: 'ESPN summary', key: 'k' });
  const audit = [];
  applyRead(p, { status: 'lost' }, { now: T + 4 * 36e5, source: 'NHL API', audit });
  assert.equal(p.status, 'disputed');
  applyRead(p, { status: 'won' }, { now: T + 5 * 36e5, source: 'ESPN summary', audit }); // ESPN still says won
  applyRead(p, { status: 'lost' }, { now: T + 5 * 36e5, source: 'NHL API', audit }); // NHL still says lost
  assert.equal(p.status, 'disputed');
  applyRead(p, { status: 'lost' }, { now: T + 6 * 36e5, source: 'ESPN summary', audit }); // ESPN corrected
  assert.equal(p.status, 'lost');
  assert.ok(audit.length >= 2);
});


test('second source: OpenDota games grouped into a best-of-3 series', () => {
  assert.equal(secondSourceFor('atlas/dota2').name, 'OpenDota');
  const s = (t) => Math.floor(T / 1000) + t;
  const rows = [
    { match_id: 1, series_id: 9, series_type: 1, start_time: s(0), radiant_win: true, radiant_name: 'Yellow Submarine', dire_name: 'CyberHero' },
    { match_id: 2, series_id: 9, series_type: 1, start_time: s(3000), radiant_win: true, radiant_name: 'CyberHero', dire_name: 'Yellow Submarine' },
    { match_id: 3, series_id: 9, series_type: 1, start_time: s(6000), radiant_win: false, radiant_name: 'CyberHero', dire_name: 'Yellow Submarine' },
  ];
  const p = { home: 'Yellow Submarine', away: 'CyberHero', start: T, market: 'Winner', pick: 'Yellow Submarine' };
  assert.deepEqual(findResult(p, parse.opendota({ rows })), { done: true, homeScore: 2, awayScore: 1, winner: 'home' });
  assert.equal(findResult(p, parse.opendota({ rows: rows.slice(0, 2) })), null, 'series not over after 1-1');
});

test('NBA props are confirmed from the NBA\'s own box score: game from the schedule, player by name', () => {
  const start = Date.parse('2026-10-22T23:30:00Z');
  const schedule = { leagueSchedule: { gameDates: [{ games: [
    { gameId: '0022600011', gameDateTimeUTC: '2026-10-22T23:30:00Z', homeTeam: { teamCity: 'Boston', teamName: 'Celtics' }, awayTeam: { teamCity: 'New York', teamName: 'Knicks' } },
    { gameId: '0022600012', gameDateTimeUTC: '2026-10-22T23:30:00Z', homeTeam: { teamCity: 'Miami', teamName: 'Heat' }, awayTeam: { teamCity: 'Chicago', teamName: 'Bulls' } },
  ] }] } };
  const p = { leaguePath: 'basketball/nba', home: 'Boston Celtics', away: 'New York Knicks', start, pick: 'Josh Hart over 6.5 rebounds', prop: { id: '3062679', type: 'Rebounds', target: 7 } };
  assert.equal(nbaGameId(p, schedule), '0022600011');
  assert.equal(propPlayer(p), 'Josh Hart');
  assert.equal(propPlayer({ pick: 'Josh Hart 7+ rebounds' }), 'Josh Hart'); // older labels
  const box = (players) => ({ game: { gameStatus: 3, homeTeam: { players: [] }, awayTeam: { players } } });
  const hart = (reb, extra = {}) => ({ name: 'Josh Hart', played: '1', status: 'ACTIVE', statistics: { reboundsTotal: reb, points: 10, assists: 4 }, ...extra });
  assert.equal(nbaPropResult(p, box([hart(9)])), 'won');
  assert.equal(nbaPropResult(p, box([hart(6)])), 'lost');
  assert.equal(nbaPropResult(p, box([hart(0, { played: '0', status: 'INACTIVE', notPlayingReason: 'INACTIVE_INJURY' })])), 'dnp');
  assert.equal(nbaPropResult(p, box([hart(9), { ...hart(2), name: 'Josh Hart' }])), null, 'two players by that name: not clear');
  assert.equal(nbaPropResult(p, { game: { gameStatus: 2, homeTeam: { players: [] }, awayTeam: { players: [hart(9)] } } }), null, 'not final yet');
  assert.equal(nbaPropResult({ ...p, pick: 'Tim Hardaway Jr. over 6.5 rebounds' }, box([{ ...hart(8), name: 'Tim Hardaway Jr.' }])), 'won');
});
