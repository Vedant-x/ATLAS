import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFixtures, applyFixtures, ukToUtc } from '../js/footballdata.js';
import { eloratingsIndex, applyEloratings, isInternational } from '../js/eloratings.js';
import { winProbs } from '../js/models.js';

// football-data.co.uk fixtures.csv, as published (a BOM, many columns, UK times).
const CSV = '﻿Div,Date,Time,HomeTeam,AwayTeam,Referee,B365H,B365D,B365A,PSH,PSD,PSA,AvgH,AvgD,AvgA,B365>2.5,B365<2.5,P>2.5,P<2.5,Avg>2.5,Avg<2.5\n'
  + 'E2,25/10/2026,15:00,Wycombe,Bolton,,2.40,3.30,2.90,2.45,3.40,2.95,2.41,3.33,2.88,1.90,1.90,1.93,1.95,1.90,1.92\n'
  + 'SC1,26/10/2026,12:30,Partick,Ayr,,2.10,3.40,3.30,,,,2.08,3.42,3.35,1.80,2.00,,,1.81,2.01\n'
  + "E0,25/10/2026,17:30,Nott'm Forest,Man United,,3.10,3.40,2.30,3.15,3.50,2.32,3.05,3.40,2.31,1.70,2.10,1.72,2.15,1.70,2.12\n"
  + 'X9,25/10/2026,15:00,Nobody,Nowhere,,2,3,4,,,,,,,,,,,,\n';

test('football-data.co.uk: fixtures, Pinnacle first, UK time to UTC', () => {
  const f = parseFixtures(CSV);
  assert.equal(f.length, 3, 'an unknown division is skipped');
  assert.equal(f[0].book, 'Pinnacle');
  assert.deepEqual(f[0].res, [2.45, 3.4, 2.95]);
  assert.deepEqual(f[0].ou, [1.93, 1.95]);
  assert.equal(f[1].book, 'bookmaker average', 'no Pinnacle price: the average');
  // British Summer Time ends at 01:00 UTC on Sunday 25 October 2026, so that afternoon UK time is UTC.
  assert.equal(new Date(f[0].start).toISOString(), '2026-10-25T15:00:00.000Z');
  // The day before, still summer time: 15:00 UK = 14:00 UTC.
  assert.equal(new Date(ukToUtc(2026, 9, 24, 15, 0)).toISOString(), '2026-10-24T14:00:00.000Z');
  assert.equal(new Date(ukToUtc(2026, 0, 10, 15, 0)).toISOString(), '2026-01-10T15:00:00.000Z');
});

test('football-data.co.uk: prices onto unpriced matches only, names matched, file age kept', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  const ev = (id, path, home, away, iso, o = {}) => ({ id, leaguePath: path, sport: 'football', home, away, start: Date.parse(iso), ...o });
  const events = [
    ev('a', 'soccer/eng.3', 'Wycombe Wanderers', 'Bolton Wanderers', '2026-10-25T14:00:00Z'),
    ev('b', 'soccer/eng.1', 'Nottingham Forest', 'Manchester United', '2026-10-25T16:30:00Z'),
    ev('c', 'soccer/eng.1', 'Nottingham Forest', 'Manchester United', '2026-10-25T16:30:00Z', { markets: [{ name: 'Match Result', outcomes: [] }] }),
    ev('d', 'soccer/eng.3', 'Stockport County', 'Reading', '2026-10-25T14:00:00Z'),
  ];
  const fileAt = now - 6 * 36e5;
  const r = applyFixtures(events, parseFixtures(CSV), { now, fileAt });
  assert.equal(r.priced, 2);
  assert.deepEqual(events[0].markets[0].outcomes.map((o) => [o.name, o.odds]), [['Wycombe Wanderers', 2.45], ['Draw', 3.4], ['Bolton Wanderers', 2.95]]);
  assert.equal(events[0].bookmaker, 'Pinnacle via football-data.co.uk');
  assert.equal(events[0].priceAt, fileAt);
  assert.equal(events[1].markets[0].outcomes[0].odds, 3.15, "Nott'm Forest / Man United matched by alias");
  assert.equal(events[2].markets[0].outcomes.length, 0, 'an ESPN-priced match keeps its own price');
  assert.deepEqual(r.unmatched, ['Stockport County v Reading [eng.3]']);
  // A file over a week old is not used.
  const late = [ev('e', 'soccer/eng.3', 'Wycombe', 'Bolton', '2026-10-25T14:00:00Z')];
  assert.equal(applyFixtures(late, parseFixtures(CSV), { now, fileAt: now - 8 * 864e5 }).priced, 0);
});

const WORLD = '1\t1\tES\t2172\t1\t2242\t+5\n2\t2\tAR\t2140\t1\t2165\t-3\n80\t80\tSQ\t1712\t12\t1950\t0\n';
const TEAMS = 'ES\tSpain\nAR\tArgentina\nSQ\tScotland\nUS\tUnited States\tUSA\n';

test('World Football Elo: ratings by code, names by alias; senior men only', () => {
  const idx = eloratingsIndex(WORLD, TEAMS);
  assert.equal(idx.size, 3);
  assert.equal(idx.find('Spain'), 2172);
  assert.equal(idx.find('Scotland'), 1712);
  assert.equal(idx.find('Spain U21'), null);
  assert.equal(idx.find('Spain Women'), null);
  assert.equal(idx.find('USA'), null, 'named but not rated in this file');
  const e = { id: 'w', sport: 'football', leaguePath: 'soccer/fifa.worldq.uefa', home: 'Spain', away: 'Scotland', start: Date.now() + 36e5 };
  const r = applyEloratings([e, { ...e, id: 'x', leaguePath: 'soccer/eng.1' }], idx);
  assert.equal(r.rated, 1);
  assert.equal(e.stats.eloSource, 'World Football Elo');
  const w = winProbs(e);
  assert.equal(w.confidence, 'medium');
  assert.ok(w.home > 0.7, `Spain strong favourites (${w.home})`);
  assert.ok(isInternational('soccer/uefa.nations') && !isInternational('soccer/fifa.wwc'));
  assert.equal(eloratingsIndex('garbage', 'garbage').size, 0, 'an unreadable file gives no ratings');
});

test('Sleeper: the NFL injury report, injured players only, onto NFL matches with its time', async () => {
  const { injuredByTeam, applyNflInjuries } = await import('../js/sleeper.js');
  const { readiness } = await import('../js/readiness.js');
  const players = {
    1: { full_name: 'Josh Allen', team: 'BUF', position: 'QB', injury_status: null, active: true },
    2: { full_name: 'Von Miller', team: 'BUF', position: 'LB', injury_status: 'Questionable', injury_body_part: 'Knee', active: true },
    3: { full_name: 'Tua Tagovailoa', team: 'MIA', position: 'QB', injury_status: 'Out', injury_body_part: 'Concussion', active: true },
    4: { full_name: 'Free Agent', team: null, injury_status: 'Out' },
  };
  const teams = injuredByTeam(players);
  assert.deepEqual(Object.keys(teams).sort(), ['BUF', 'MIA']);
  const now = Date.now();
  const e = { id: 'n1', sport: 'americanfootball', leaguePath: 'football/nfl', home: 'Buffalo Bills', away: 'Miami Dolphins', start: now + 36e5, markets: [{ name: 'Winner', outcomes: [] }] };
  assert.equal(applyNflInjuries([e], { at: now - 2 * 36e5, teams }), 1);
  assert.deepEqual(e.injuries.away.map((p) => [p.name, p.status]), [['Tua Tagovailoa', 'Out']]);
  const inj = readiness(e, { now, priceAt: now }).checks.find((c) => c.key === 'injuries');
  assert.equal(inj.ok, true);
  assert.match(inj.note, /Sleeper: 2 listed, read 2 h ago/);
});
