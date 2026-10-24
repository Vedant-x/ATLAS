import test from 'node:test';
import assert from 'node:assert/strict';
import { canonStats, standingsTable, usedColumns, ranked } from '../js/standings.js';

// ESPN's soccer summary lists the stats in its own order (GP, L, GD, P, D, W, R, Total).
const espn = (gp, l, gd, p, d, w, r) => [
  { abbreviation: 'GP', displayValue: String(gp) }, { abbreviation: 'L', displayValue: String(l) }, { abbreviation: 'GD', displayValue: gd },
  { abbreviation: 'P', displayValue: String(p) }, { abbreviation: 'D', displayValue: String(d) }, { abbreviation: 'W', displayValue: String(w) },
  { abbreviation: 'R', displayValue: String(r) }, { name: 'Total', summary: `${w}-${d}-${l}` },
];
const wsl = [
  { team: 'Chelsea', ours: true, stats: canonStats(espn(5, 0, '+11', 13, 1, 4, 2)) },
  { team: 'Manchester City', stats: canonStats(espn(5, 0, '+10', 15, 0, 5, 1)) },
  { team: 'Arsenal', stats: canonStats(espn(6, 2, '-2', 6, 3, 1, 8)) },
];

test('league table: GP, W, D, L, GD, Pts in that order; no rank or Total column', () => {
  assert.deepEqual(usedColumns(wsl).map((c) => c.key), ['GP', 'W', 'D', 'L', 'GD', 'PTS']);
  const html = standingsTable(wsl, { goals: true });
  const heads = [...html.matchAll(/<th(?: [^>]*)?>(?:<abbr[^>]*>)?([^<]*)/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['#', 'Team', 'GP', 'W', 'D', 'L', 'GD', 'Pts']);
  assert.doesNotMatch(html, /Total|5-0-0/);
});

test('league table: rows in rank order, each value under its own heading', () => {
  assert.deepEqual(ranked(wsl).map((e) => e.team), ['Manchester City', 'Chelsea', 'Arsenal']);
  const row = standingsTable(wsl, { goals: true }).match(/<tr class="">[\s\S]*?Manchester City[\s\S]*?<\/tr>/)[0];
  assert.deepEqual([...row.matchAll(/<td class="num[^"]*">([^<]*)/g)].map((m) => m[1]), ['1', '5', '5', '0', '0', '+10', '15']);
});

test('league table: full ESPN names and US sports', () => {
  const nhl = canonStats([{ name: 'losses', abbreviation: 'L', displayValue: '3' }, { name: 'wins', abbreviation: 'W', displayValue: '8' }, { name: 'gamesPlayed', abbreviation: 'GP', displayValue: '12' },
    { name: 'overtimeLosses', abbreviation: 'OTL', displayValue: '1' }, { name: 'points', abbreviation: 'PTS', displayValue: '17' }, { name: 'pointsFor', abbreviation: 'GF', displayValue: '40' }, { name: 'pointsAgainst', abbreviation: 'GA', displayValue: '30' }]);
  assert.deepEqual(usedColumns([{ stats: nhl }]).map((c) => c.key), ['GP', 'W', 'L', 'OTL', 'GF', 'GA', 'PTS']);
  const nfl = standingsTable([{ team: 'Bills', stats: canonStats([{ abbreviation: 'T', displayValue: '1' }, { abbreviation: 'W', displayValue: '5' }, { abbreviation: 'L', displayValue: '2' }, { abbreviation: 'PF', displayValue: '200' }]) }]);
  assert.match(nfl, /<abbr data-tip="Tied">T<\/abbr>/);
  assert.match(nfl, /<abbr data-tip="Points for">PF<\/abbr>/);
});
