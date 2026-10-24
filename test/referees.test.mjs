import test from 'node:test';
import assert from 'node:assert/strict';
import { FD_RESULTS, seasonCodes, refKey, parseResults, refereeTable, refereeFor, refereeLine } from '../js/referees.js';
import { refereeOf } from '../js/fotmob.js';

// A football-data.co.uk results file, as its columns run (Referee, then shots, fouls, corners, cards).
const CSV = `\uFEFFDiv,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HTR,Referee,HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR,B365H
E0,16/08/2026,15:00,Arsenal,Chelsea,2,1,H,1,0,H,M Oliver,14,9,6,3,10,12,5,4,2,3,0,0,1.9
E0,17/08/2026,15:00,Spurs,Everton,0,0,D,0,0,D,M Oliver,10,8,3,2,11,9,6,3,1,1,0,1,2.0
E0,18/08/2026,15:00,Leeds,Wolves,1,2,A,0,1,A,A Taylor,12,13,4,5,13,14,7,6,3,2,0,0,2.4
E0,19/08/2026,15:00,Fulham,Brentford,1,1,D,0,0,D,,9,9,2,2,10,10,4,4,1,1,0,0,2.5
`;

test('referees: season codes, and one key for "Michael Oliver" and "M Oliver"', () => {
  assert.deepEqual(seasonCodes(Date.UTC(2026, 9, 24)), ['2627', '2526']);
  assert.deepEqual(seasonCodes(Date.UTC(2027, 2, 1)), ['2627', '2526'], 'March is still the 2026-27 season');
  assert.equal(FD_RESULTS('2627', 'E0'), 'https://www.football-data.co.uk/mmz4281/2627/E0.csv');
  assert.equal(refKey('Michael Oliver'), refKey('M Oliver'));
  assert.equal(refKey('Anthony Taylor'), 'a taylor');
  assert.equal(refKey('José María Sánchez Martínez'), 'j martinez');
  assert.notEqual(refKey('Michael Oliver'), refKey('Anthony Oliver'));
});

test('referees: each referee\'s cards, fouls and home wins per game against the league\'s; a match\'s line', () => {
  const rows = parseResults(CSV);
  assert.equal(rows.length, 3, 'a match with no referee named is left out');
  const t = refereeTable(rows);
  assert.deepEqual(t.league, { games: 3, yellow: 4, red: 0.333, fouls: 23, homeWin: 0.333 });
  assert.deepEqual(t.refs['m oliver'], { name: 'M Oliver', games: 2, yellow: 3.5, red: 0.5, fouls: 21, homeWin: 0.5 });
  const r = refereeFor('Michael Oliver', t);
  assert.equal(r.name, 'Michael Oliver', 'the name as the match source gives it');
  assert.equal(refereeLine(r), '3.5 yellow cards a game over 2 games (league 4.0), 0.50 red (league 0.33), 21 fouls (league 23), home side won 50% (league 33%)');
  assert.deepEqual(refereeFor('Unknown Person', t), { name: 'Unknown Person' }, 'named, with no record');
  assert.equal(refereeLine({ name: 'x' }), null);
  assert.equal(refereeFor(null, t), null);
  assert.deepEqual(parseResults('Div,Date,HomeTeam,AwayTeam,FTR,HY,AY\nD1,1/1/26,A,B,H,1,1'), [], 'a file with no Referee column');
  assert.equal(refereeTable([]), null);
});

test('FotMob: the referee from a match\'s facts, whichever form it takes', () => {
  assert.equal(refereeOf({ content: { matchFacts: { infoBox: { Referee: { text: 'Michael Oliver', country: 'England' } } } } }), 'Michael Oliver');
  assert.equal(refereeOf({ content: { matchFacts: { infoBox: { Referee: 'Anthony Taylor' } } } }), 'Anthony Taylor');
  assert.equal(refereeOf({ content: { matchFacts: { infoBox: {} } } }), null);
  assert.equal(refereeOf(null), null);
});
