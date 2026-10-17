import test from 'node:test';
import assert from 'node:assert/strict';
import { euroRecords, euroEvent, liigaRecords, liigaEvent, euroSeason } from '../js/europe.js';
import { leagueByPath } from '../js/catalog.js';
import { analyse } from '../js/models.js';

const club = (code, name) => ({ club: { code, name } });
const g = (n, h, a, hs, as, played, date) => ({ identifier: `E2026_${n}`, gameCode: n, local: { ...club(h, h), score: hs }, road: { ...club(a, a), score: as }, played, utcDate: date, roundName: 'Round 1' });

test('season codes', () => {
  assert.equal(euroSeason(Date.parse('2026-10-17')), 2026);
  assert.equal(euroSeason(Date.parse('2027-03-01')), 2026);
});

test('EuroLeague: records from played games, fixtures in the catalog, a model from records', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const games = [g(1, 'RMB', 'OLY', 90, 80, true, '2026-10-01T18:00:00Z'), g(2, 'RMB', 'PAN', 88, 70, true, '2026-10-08T18:00:00Z'), g(3, 'OLY', 'PAN', 75, 79, true, '2026-10-09T18:00:00Z'), g(4, 'RMB', 'MAD', 0, 0, false, '2026-10-18T18:00:00Z')];
  const rec = euroRecords(games);
  assert.deepEqual(rec.RMB, { w: 2, l: 0, d: 0, form: ['W', 'W'] });
  const e = euroEvent(games[3], { comp: 'E', league: 'EuroLeague', path: 'atlas/euroleague' }, rec, now);
  assert.ok(leagueByPath(e.leaguePath));
  assert.equal(e.stats.homeRecord, '2-0');
  assert.equal(e.final, false);
  assert.ok(analyse(e).win.home > 0.5);
});

test('Liiga: Veikkaus prices in hundredths, regulation records, finished games dropped', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const team = (name, goals, ranking) => ({ teamName: name, goals, ranking });
  const done = { id: 1, season: 2027, start: '2026-10-10T15:30:00Z', ended: true, started: true, finishedType: 'ENDED_DURING_OVERTIME', homeTeam: team('Tappara', 2, 1), awayTeam: team('HIFK', 3, 4) };
  const next = { id: 2, season: 2027, start: '2026-10-18T15:30:00Z', ended: false, started: false, homeTeam: team('Tappara', 0, 1), awayTeam: team('Ilves', 0, 6), gamblingEvent: { homeTeamOdds: 185, tieOdds: 420, awayTeamOdds: 360 } };
  const rec = liigaRecords([done]);
  assert.deepEqual(rec.Tappara, { w: 0, l: 0, d: 0, otl: 1, form: ['L'] });
  assert.equal(liigaEvent(done, rec, now), null);
  const e = liigaEvent(next, rec, now);
  assert.ok(leagueByPath(e.leaguePath));
  assert.deepEqual(e.markets[0].outcomes.map((o) => o.odds), [1.85, 4.2, 3.6]);
  assert.equal(e.compId, undefined, 'kept out of the official record (graded on regulation time)');
  const a = analyse(e);
  assert.ok(a.win.home > a.win.away && a.win.draw > 0.15, JSON.stringify(a.win));
});

test('Swiss National League: records with overtime losses, upcoming games only', async () => {
  const { swissRecords, swissEvent } = await import('../js/europe.js');
  const now = Date.parse('2026-10-17T12:00:00Z');
  const done = { gameId: '1', homeTeamName: 'ZSC Lions', awayTeamName: 'HC Davos', date: '2026-10-10T18:00:00+00:00', status: 'finished', homeTeamResult: 3, awayTeamResult: 2, isOvertime: true };
  const next = { gameId: '2', homeTeamName: 'HC Davos', awayTeamName: 'ZSC Lions', date: '2026-10-18T18:00:00+00:00', status: 'scheduled' };
  const rec = swissRecords([done]);
  assert.equal(rec['HC Davos'].otl, 1);
  assert.equal(swissEvent(done, rec, now), null);
  assert.equal(swissEvent({ ...next, status: 'end' }, rec, now), null, '"end" means finished');
  const e = swissEvent(next, rec, now);
  assert.equal(e.leaguePath, 'atlas/swissnl');
  assert.equal(e.stats.awayRecord, '1-0-0');
});
