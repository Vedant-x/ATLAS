import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLive, liveCenterHtml } from '../js/livecenter.js';

const header = (home, away) => ({ competitions: [{ status: { type: { detail: 'Top 5th' } }, competitors: [{ homeAway: 'home', team: { id: '1' }, ...home }, { homeAway: 'away', team: { id: '2' }, ...away }] }] });

test('baseball: line score with hits/errors, count, bases and players', () => {
  const sm = {
    header: header({ score: '3', hits: 7, errors: 0, linescores: [{ displayValue: '1' }, { displayValue: '0' }, { displayValue: '2' }] }, { score: '1', hits: 4, errors: 1, linescores: [{ displayValue: '0' }, { displayValue: '1' }, { displayValue: '0' }, { displayValue: '0' }] }),
    situation: { balls: 2, strikes: 1, outs: 2, onFirst: true, onThird: true, batter: { athlete: { displayName: 'Aaron Judge' } }, pitcher: { athlete: { displayName: 'Tarik Skubal' } }, lastPlay: { text: 'Soto singled to right.' } },
    plays: [{ text: 'Strike looking', period: { displayValue: 'Top 5th' } }, { text: 'Ball', period: { displayValue: 'Top 5th' } }],
  };
  const d = parseLive(sm, { sport: 'baseball' });
  assert.equal(d.lines.heads.length, 9);
  assert.deepEqual(d.lines.home.slice(0, 3), ['1', '0', '2']);
  assert.deepEqual(d.lines.extra, [['H', '7', '4'], ['E', '0', '1']]);
  assert.deepEqual(d.situation.bases, [true, false, true]);
  assert.equal(d.situation.batter, 'Aaron Judge');
  assert.equal(d.plays[0].text, 'Ball');
});

test('soccer: halves, goals and cards from key events, live stats', () => {
  const sm = {
    header: header({ score: '2', linescores: [{ displayValue: '1' }, { displayValue: '1' }] }, { score: '1', linescores: [{ displayValue: '0' }, { displayValue: '1' }] }),
    keyEvents: [
      { type: { text: 'Kickoff' }, clock: { displayValue: "0'" } },
      { type: { text: 'Goal' }, scoringPlay: true, text: 'Saka scores', clock: { displayValue: "12'" }, team: { id: '1' } },
      { type: { text: 'Yellow Card' }, text: 'Rice booked', clock: { displayValue: "30'" }, team: { id: '1' } },
      { type: { text: 'Goal - Header' }, scoringPlay: true, text: 'Calvert-Lewin', clock: { displayValue: "55'" }, team: { id: '2' } },
    ],
    boxscore: { teams: [{ team: { id: '1' }, statistics: [{ name: 'possessionPct', label: 'Possession', displayValue: '61' }, { name: 'shots', label: 'Shots', displayValue: '14' }] }, { team: { id: '2' }, statistics: [{ name: 'possessionPct', label: 'Possession', displayValue: '39' }, { name: 'shots', label: 'Shots', displayValue: '6' }] }] },
  };
  const d = parseLive(sm, { sport: 'football' });
  assert.deepEqual(d.lines.heads, ['1H', '2H']);
  assert.equal(d.events.length, 3);
  assert.equal(d.events[0].text, 'Calvert-Lewin'); // newest first
  assert.equal(d.events[0].side, 'away');
  assert.equal(d.events[1].type, 'Yellow Card');
  assert.deepEqual(d.stats[0], { label: 'Possession', home: '61', away: '39' });
});

test('cricket: innings and current scorecard', () => {
  const sm = {
    header: header({ linescores: [{ period: 1, runs: 0, wickets: 0, description: 'all out' }, { period: 2, runs: 236, wickets: 5, score: '236/5 (73 ov)', isCurrent: 1 }] }, { linescores: [{ period: 1, runs: 310, wickets: 10, score: '310' }] }),
    matchcards: [
      { headline: 'Batting', inningsNumber: '2', teamName: 'Sylhet', runs: '236', total: '(5 wkts; 73 ovs)', playerDetails: [{ playerName: 'Zakir Hasan', dismissal: 'caught', runs: '60', ballsFaced: '90', fours: '7', sixes: '1' }] },
      { headline: 'Bowling', inningsNumber: '2', playerDetails: [{ playerName: 'Nahid Rana', overs: '14', maidens: '3', conceded: '41', wickets: '2' }] },
    ],
  };
  const d = parseLive(sm, { sport: 'cricket' });
  assert.equal(d.lines, null);
  assert.equal(d.card.batting[0].name, 'Zakir Hasan');
  assert.equal(d.card.bowling[0].w, '2');
  assert.ok(d.innings.some((i) => i.current && i.score === '236/5 (73 ov)'));
});

test('scoreboard renders for live events only, with esports maps and tennis sets from the event', () => {
  assert.equal(liveCenterHtml({ id: 'x', live: false }), '');
  const es = liveCenterHtml({ id: 'esports-bo3-1', live: true, home: 'FURIA', away: 'G2', score: '1 – 0', clock: 'Map 2 · Mirage', esports: { maps: [{ n: 1, map: 'Ancient', status: 'final', winner: 'home', score: '13 – 9' }, { n: 2, map: 'Mirage', status: 'live' }] } });
  assert.match(es, /Map 1 · Ancient/);
  assert.match(es, /13 – 9/);
  const tn = liveCenterHtml({ id: 'tennis-1', sport: 'tennis', live: true, home: 'Sinner', away: 'Alcaraz', score: '1 – 0', lines: { home: ['6', '3'], away: ['4', '2'] } });
  assert.match(tn, /S2/);
  assert.match(tn, /Sets/);
});
