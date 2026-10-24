import test from 'node:test';
import assert from 'node:assert/strict';
import { LINEUPS_URL, parseLineups, applyLineups } from '../js/nbalineups.js';
import { rosterOf, applyRosters, parseBo3 } from '../js/esports.js';
import { wtaIds, wtaStats, nameKey, holdChance, matchModel } from '../js/tennisstats.js';

const H = 36e5;
// The NBA's daily lineups feed, as stats.nba.com serves it (24 Oct 2026).
const pl = (id, name, pos, status = 'Expected', roster = 'Active') => ({ personId: id, teamId: 1, firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' '), playerName: name, lineupStatus: status, position: pos, rosterStatus: roster, timestamp: '2026-10-24T08:11:11' });
const FEED = { games: [{ gameId: '0022600104', gameStatus: 1, gameStatusText: '6:00 pm ET',
  homeTeam: { teamId: 1610612766, teamAbbreviation: 'CHA', players: [pl(1642851, 'Kon Knueppel', 'SG'), pl(1641706, 'Brandon Miller', 'SF'), pl(1629632, 'Coby White', 'PG'), pl(1629675, 'Naz Reid', 'PF'), pl(1631217, 'Moussa Diabaté', 'C')] },
  awayTeam: { teamId: 1610612748, teamAbbreviation: 'MIA', players: [pl(202691, 'Klay Thompson', 'SG', 'Confirmed'), pl(203952, 'Andrew Wiggins', 'SF', 'Confirmed'), pl(1, 'Tyler Herro', 'PG', 'Confirmed'), pl(2, 'Nikola Jovic', 'PF', 'Confirmed'), pl(3, 'Bam Adebayo', 'C', 'Confirmed', 'Inactive')] } }] };

test('NBA starting lineups: the league\'s five per team, expected or confirmed, onto the game either way round', () => {
  assert.equal(LINEUPS_URL('2026-10-24'), 'https://stats.nba.com/js/data/leaders/00_daily_lineups_20261024.json');
  const g = parseLineups(FEED);
  assert.deepEqual([g[0].home.team, g[0].home.players.length, g[0].home.confirmed, g[0].away.confirmed], ['Charlotte Hornets', 5, false, true]);
  assert.deepEqual(g[0].away.players[4], { id: '3', name: 'Bam Adebayo', pos: 'C', confirmed: true, active: false });
  const now = Date.now();
  const e = { leaguePath: 'basketball/nba', home: 'Charlotte Hornets', away: 'Miami Heat', start: now + 5 * H };
  const flipped = { leaguePath: 'basketball/nba', home: 'Miami Heat', away: 'Charlotte Hornets', start: now + 5 * H };
  const old = { leaguePath: 'basketball/nba', home: 'Charlotte Hornets', away: 'Miami Heat', start: now - 30 * H };
  assert.equal(applyLineups([e, flipped, old], g, { at: 1, now }), 2);
  assert.equal(e.nbaLineups.home.abbr, 'CHA');
  assert.equal(flipped.nbaLineups.home.abbr, 'MIA', 'the board\'s home side gets its own five');
  assert.equal(old.nbaLineups, undefined);
});

test('esports rosters: players without coaches or the benched, best rating first; both sides\' averages', () => {
  const team = { players: [
    { nickname: 'arT', first_name: 'Andrei', last_name: 'Piovezan', status: 1, is_coach: false, six_month_avg_rating: 5.671639, country: { code: 'BR' } },
    { nickname: 'RiVAS', status: 2, is_coach: true, six_month_avg_rating: null },
    { nickname: 'dumau', status: 1, is_coach: false, six_month_avg_rating: 6.4 }, { nickname: 'latto', status: 1, is_coach: false, six_month_avg_rating: 6.1 },
    { nickname: 'n1ssim', status: 1, is_coach: false, six_month_avg_rating: 5.9 }, { nickname: 'saadzin', status: 1, is_coach: false, six_month_avg_rating: 5.2 },
    { nickname: 'old', status: 0, is_coach: false, six_month_avg_rating: 7 },
  ] };
  const r = rosterOf(team);
  assert.deepEqual(r.map((p) => p.nick), ['dumau', 'latto', 'n1ssim', 'arT', 'saadzin']);
  assert.deepEqual(r[3], { nick: 'arT', name: 'Andrei Piovezan', rating: 5.67, country: 'BR' });
  const e = {};
  assert.ok(applyRosters(e, r, r.slice(0, 2)));
  assert.equal(e.rosters.avg.home, +((6.4 + 6.1 + 5.9 + 5.67 + 5.2) / 5).toFixed(2));
  assert.equal(e.rosters.avg.away, null, 'two rated players are not a side');
  assert.equal(applyRosters({}, [], null), false);
  const ev = parseBo3([{ id: 1, slug: 'a-vs-b', discipline_id: 1, status: 'upcoming', start_date: new Date(Date.now() + H).toISOString(), tier: 'a', team1: { name: 'Legacy', slug: 'legacy-br' }, team2: { name: 'Nemiga', slug: 'nemiga' } }]);
  assert.deepEqual(ev[0].esports.teams, { home: 'legacy-br', away: 'nemiga' }, 'each series keeps both teams\' pages');
});

// The WTA's year figures for one player, as api.wtatennis.com serves them (fields used here).
const WTA_YEAR = { player: { id: 324166, fullName: 'Elena Rybakina' }, stats: {
  Aces: 414, Double_Faults: 184, MatchCount: 63, First_Serves_Played: 2589, First_Serves_Won: 1912, Second_Serves_Played: 1929, Second_Serves_Won: 990,
  First_Serve_Return_Chances: 2818, First_Return_Won: 961, Second_Return_Chances: 1864, Second_Return_Won: 1018,
  first_serve_percent: 57.3, first_serve_won_percent: 73.9, second_serve_won_percent: 51.3, service_games_won_percent: 82.1, return_games_won_percent: 32.1,
  return_points_won_percent: 42.3, breakpoint_saved_percent: 64.6, breakpoint_converted_percent: 44.2,
  AggregateData: { AverageServicePointsWonPercent: 53.728343, AverageReturnPointsWonPercent: 41.361464, AverageServiceGamesWonPercent: 58.914968, AverageReturnGamesWonPercent: 30.113057 },
} };

test('WTA serve and return: a player\'s season and the tour\'s averages; names to ids from the rankings', () => {
  const s = wtaStats(WTA_YEAR);
  assert.deepEqual([s.matches, s.firstIn, s.firstWon, s.secondWon, s.held, s.retPts, s.broke, s.bpSaved, s.aces, s.dfs], [63, 0.573, 0.739, 0.513, 0.821, 0.423, 0.321, 0.646, 6.6, 2.9]);
  assert.equal(s.servePts, +((1912 + 990) / (2589 + 1929)).toFixed(4));
  assert.equal(s.tour.retPts, 0.4136);
  assert.equal(wtaStats({ stats: { MatchCount: 0 } }), null);
  const ids = wtaIds([[{ player: { id: 324166, fullName: 'Elena Rybakina' }, ranking: 1 }], [{ player: { id: 2, firstName: 'Iga', lastName: 'Świątek' }, ranking: 2 }]]);
  assert.deepEqual(ids.get(nameKey('Elena Rybakina')), { id: '324166', rank: 1 });
  assert.equal(ids.get(nameKey('Iga Swiatek')).id, '2', 'accents aside');
});

test('the point-by-point model: holds, sets and the match from serve against return', () => {
  assert.equal(+holdChance(0.5).toFixed(3), 0.5);
  assert.equal(+holdChance(0.62).toFixed(3), 0.776, 'a 62% server holds about 78% of games');
  const even = { servePts: 0.6, retPts: 0.4, tour: { retPts: 0.4 } };
  assert.deepEqual([matchModel(even, even).set, matchModel(even, even).match], [0.5, 0.5]);
  const A = { servePts: 0.66, retPts: 0.42, tour: { retPts: 0.41 } }, B = { servePts: 0.6, retPts: 0.38, tour: { retPts: 0.41 } };
  const ab = matchModel(A, B), ba = matchModel(B, A);
  assert.equal(+(ab.match + ba.match).toFixed(3), 1, 'either way round, the same match');
  assert.ok(ab.match > 0.8 && ab.holdA > ab.holdB);
  assert.ok(matchModel(A, B, { bestOf: 5 }).match > ab.match, 'five sets favour the better player more');
  assert.equal(matchModel(A, null), null);
});

test('cricket players: the XIs from ESPN\'s rosters once named, else the squads; roles, styles, captain and keeper', async () => {
  const { squadsOf, CRICKET_SUMMARY } = await import('../js/cricket.js');
  assert.equal(CRICKET_SUMMARY('23028', '1557530'), 'https://site.web.api.espn.com/apis/site/v2/sports/cricket/23028/summary?event=1557530');
  const p = (name, role, bat, bowl, extra = {}) => ({ captain: false, starter: true, athlete: { id: '1', displayName: name, style: [{ description: bat, type: 'batting' }, ...(bowl ? [{ description: bowl, type: 'bowling' }] : [])], position: { name: role } }, position: { name: role }, ...extra });
  const e = { home: 'Tasmania', away: 'Victoria' };
  // As ESPN serves a match under way: rosters with the XIs (the away side listed first here).
  const sm = { rosters: [
    { homeAway: 'away', team: { displayName: 'Victoria' }, roster: [p('Will Sutherland', 'Allrounder', 'Right-hand bat', 'Right-arm fast-medium', { captain: true })] },
    { homeAway: 'home', team: { displayName: 'Tasmania' }, roster: [p('Mitchell Owen', 'Allrounder', 'Right-hand bat', 'Right-arm medium'), p('Matthew Wade', 'Wicketkeeper batter', 'Left-hand bat')] },
  ], squads: [] };
  const sq = squadsOf(sm, e);
  assert.equal(sq.xi, true);
  assert.deepEqual(sq.home.map((x) => [x.name, x.role, x.keeper]), [['Mitchell Owen', 'Allrounder', false], ['Matthew Wade', 'Wicketkeeper batter', true]]);
  assert.deepEqual(sq.away[0], { name: 'Will Sutherland', role: 'Allrounder', bat: 'Right-hand bat', bowl: 'Right-arm fast-medium', captain: true, keeper: false });
  // Before the toss: no rosters; the squads where ESPN lists them; nothing where it lists none.
  const pre = squadsOf({ rosters: [{ team: { displayName: 'Tasmania' }, roster: [] }], squads: [{ team: { displayName: 'Tasmania' }, athletes: [{ displayName: 'Beau Webster', position: { name: 'Allrounder' }, style: [] }] }] }, e);
  assert.deepEqual([pre.xi, pre.home[0].name, pre.away.length], [false, 'Beau Webster', 0]);
  assert.equal(squadsOf({ rosters: [], squads: [{ team: { displayName: 'Gambia' }, athletes: [] }] }, { home: 'Gambia', away: 'Zambia' }), null);
});

test('ATP serve and return: a player\'s figures from the season\'s match file (TML-Database columns), the tour\'s averages', async () => {
  const { atpTable, matchModel, TML } = await import('../js/tennisstats.js');
  assert.equal(TML('2025.csv'), 'https://raw.githubusercontent.com/Tennismylife/TML-Database/master/2025.csv');
  const head = 'tourney_id,tourney_name,surface,draw_size,tourney_level,indoor,tourney_date,match_num,winner_id,winner_seed,winner_entry,winner_name,winner_hand,winner_ht,winner_ioc,winner_age,winner_rank,winner_rank_points,loser_id,loser_seed,loser_entry,loser_name,loser_hand,loser_ht,loser_ioc,loser_age,loser_rank,loser_rank_points,score,best_of,round,minutes,w_ace,w_df,w_svpt,w_1stIn,w_1stWon,w_2ndWon,w_SvGms,w_bpSaved,w_bpFaced,l_ace,l_df,l_svpt,l_1stIn,l_1stWon,l_2ndWon,l_SvGms,l_bpSaved,l_bpFaced';
  const row = (w, l, ws, ls) => `2025-1,Event,Hard,32,A,O,20250101,1,W,,,${w},R,,,,,,L,,,${l},R,,,,,,6-4 6-4,3,R32,90,${ws},${ls}`;
  // Sinner: 6 matches, each 10 aces, 2 DFs, 80 serve points (50 first in, 40 won; 18 of 30 second won), 12 games, broken once in 3.
  const S = '10,2,80,50,40,18,12,2,3', O = '3,4,70,42,28,14,11,1,4';
  const csv = [head, ...Array.from({ length: 6 }, (_, i) => row('Jannik Sinner', `Opp ${i}`, S, O)), row('Jannik Sinner', 'Opp 7', ',,,,,,,,', O), row('Alex Smith', 'Jannik Sinner', '', '')].join('\n');
  const t = atpTable([csv]);
  const s = t.players['jannik sinner'];
  assert.equal(s.matches, 6, 'a match without statistics is left out');
  assert.deepEqual([s.firstIn, s.firstWon, s.secondWon, s.servePts, s.aces, s.dfs], [0.625, 0.8, 0.6, 0.725, 10, 2]);
  assert.equal(s.held, +(1 - 1 / 12).toFixed(4));
  assert.equal(s.retPts, +((70 - 28 - 14) / 70).toFixed(4));
  assert.equal(s.broke, +(3 / 11).toFixed(4));
  assert.equal(s.period, '2025 season (latest ATP match data)');
  assert.equal(t.players['opp 0'], undefined, 'fewer than 5 matches: no figures');
  assert.ok(t.tour.servePts > 0.5 && t.tour.retPts < 0.5);
  assert.ok(matchModel(s, { ...s, servePts: 0.6, retPts: 0.33 }).match > 0.5);
});
