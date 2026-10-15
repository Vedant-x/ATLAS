import test from 'node:test';
import assert from 'node:assert/strict';
import { tsdbEvent, tsdbRecords, tsdbStart, tsdbState, TSDB_SPORTS } from '../js/sportsdb.js';
import { leagueByPath } from '../js/catalog.js';
import { analyse } from '../js/models.js';

const darts = TSDB_SPORTS.find((d) => d.sport === 'darts');
const boxing = TSDB_SPORTS.find((d) => d.sport === 'boxing');
const ev = (o) => ({ idEvent: '1', idLeague: '4554', strLeague: 'PDC Premier League', strHomeTeam: 'Luke Littler', strAwayTeam: 'Luke Humphries', strTimestamp: '2026-10-16T19:00:00', strStatus: 'NS', ...o });

test('every TheSportsDB sport is filed under a catalogued league', () => {
  for (const d of TSDB_SPORTS) assert.ok(leagueByPath(d.path), d.path);
});

test('kick-off times are read as UTC, with or without an offset', () => {
  assert.equal(tsdbStart(ev()), Date.parse('2026-10-16T19:00:00Z'));
  assert.equal(tsdbStart(ev({ strTimestamp: '2026-10-16T19:00:00+00:00' })), Date.parse('2026-10-16T19:00:00Z'));
  assert.equal(tsdbStart(ev({ strTimestamp: null, dateEvent: '2026-10-16', strTime: '18:30:00' })), Date.parse('2026-10-16T18:30:00Z'));
});

test('states: not started, live, final, postponed', () => {
  assert.equal(tsdbState(ev()), 'pre');
  assert.equal(tsdbState(ev({ strStatus: 'FT', intHomeScore: '10', intAwayScore: '7' })), 'final');
  assert.equal(tsdbState(ev({ strStatus: '2H', intHomeScore: '20', intAwayScore: '19' })), 'live');
  assert.equal(tsdbState(ev({ strStatus: 'Postponed' })), 'void');
  assert.equal(tsdbEvent(ev({ strStatus: 'Postponed' }), darts), null);
});

test('records and form from finished events; fixtures carry them into the model', () => {
  const past = [
    ev({ idEvent: '2', strStatus: 'FT', intHomeScore: '10', intAwayScore: '4', strTimestamp: '2026-10-01T19:00:00' }),
    ev({ idEvent: '3', strStatus: 'FT', intHomeScore: '6', intAwayScore: '10', strHomeTeam: 'Luke Humphries', strAwayTeam: 'Luke Littler', strTimestamp: '2026-10-08T19:00:00' }),
    ev({ idEvent: '3', strStatus: 'FT', intHomeScore: '6', intAwayScore: '10', strHomeTeam: 'Luke Humphries', strAwayTeam: 'Luke Littler', strTimestamp: '2026-10-08T19:00:00' }),
    ev({ idEvent: '4', strStatus: 'FT', intHomeScore: '10', intAwayScore: '8', strTimestamp: '2026-10-11T19:00:00' }),
  ];
  const rec = tsdbRecords(past);
  assert.deepEqual(rec['Luke Littler'], { w: 3, l: 0, d: 0, form: ['W', 'W', 'W'] }, 'a repeated event counts once');
  const e = tsdbEvent(ev(), darts, rec);
  assert.equal(e.leaguePath, 'atlas/darts');
  assert.equal(e.stats.homeRecord, '3-0');
  assert.equal(tsdbEvent(ev(), darts, { 'Luke Littler': { w: 2, l: 0, d: 0, form: ['W', 'W'] } }).stats.homeRecord, null, 'two results are too few to show');
  assert.equal(e.neutral, true);
  const a = analyse(e);
  assert.equal(a.kind, 'binary');
  assert.ok(a.win.home > 0.6, `the in-form player is favoured: ${a.win.home}`);
});

test('a golf round or race (no two sides) is skipped; boxing keeps boxing, not MMA', () => {
  assert.equal(tsdbEvent(ev({ strAwayTeam: null }), darts), null);
  assert.equal(tsdbEvent(ev({ strLeague: 'UFC' }), boxing), null);
  assert.ok(tsdbEvent(ev({ strLeague: 'Boxing' }), boxing));
});
