import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBo3, bo3Live, bo3Maps, esbForm, parseEsb, esbLive } from '../js/esports.js';
import { analyse, rankWin, esoccerLambdas } from '../js/models.js';
import { resultFromBo3, gradePick } from '../js/track.js';
import { applyAsiaLive } from '../js/asia-live.js';

const now = Date.parse('2026-10-05T08:30:00Z');
const team = (id, name, rank) => ({ id, name, rank });
const bo3 = (o = {}) => ({
  id: 1, slug: 'furia-vs-g2', discipline_id: 1, status: 'upcoming', bo_type: 3, tier: 's', start_date: '2026-10-05T14:00:00.000+00:00',
  team1_id: 10, team2_id: 20, team1_score: 0, team2_score: 0, team1: team(10, 'FURIA', 3), team2: team(20, 'G2', 7), tournament: { name: 'ESL Pro League', tier: 's' },
  bet_updates: { team_1: { coeff: 1.6, active: true }, team_2: { coeff: 2.3, active: true }, additional_markets: [{ bet_type: 'total_maps_over_2_5', coeff: 2.1, active: true }, { bet_type: 'total_maps_under_2_5', coeff: 1.7, active: true }] },
  games: [], ...o,
});

test('bo3.gg series become priced esports events', () => {
  const [e] = parseBo3([bo3()], now);
  assert.equal(e.id, 'esports-bo3-1');
  assert.equal(e.leaguePath, 'atlas/cs2');
  assert.equal(e.home, 'FURIA');
  assert.equal(e.bestOf, 3);
  assert.deepEqual(e.markets.map((m) => m.name), ['Winner', 'Total 2.5']);
  assert.equal(e.markets[0].outcomes[1].odds, 2.3);
  assert.equal(e.stats.homeRank, 3);
  assert.equal(e.neutral, true);
});

test('low-tier unpriced, finished and far-future series are skipped', () => {
  assert.equal(parseBo3([bo3({ tier: 'c', bet_updates: null, tournament: { tier: 'c' } })], now).length, 0);
  assert.equal(parseBo3([bo3({ tier: 'c' })], now).length, 1); // priced: kept
  assert.equal(parseBo3([bo3({ status: 'finished' })], now).length, 0);
  assert.equal(parseBo3([bo3({ start_date: '2026-10-12T14:00:00Z' })], now).length, 0);
  assert.equal(parseBo3([bo3({ team2: null })], now).length, 0);
});

test('live series show map score, current map and per-map results from the home side', () => {
  const m = bo3({ status: 'current', team1_score: 1, team2_score: 0, games: [
    { number: 2, status: 'current', map_name: 'de_mirage' },
    { number: 1, status: 'finished', map_name: 'de_ancient', winner_clan_score: 13, loser_clan_score: 9, winner_team_clan: { team_id: 10 } },
  ] });
  const [e] = parseBo3([m], now);
  assert.equal(e.live, true);
  assert.equal(e.score, '1 – 0');
  assert.equal(e.clock, 'Map 2 · Mirage');
  assert.deepEqual(e.esports.maps[0], { n: 1, map: 'Ancient', status: 'final', winner: 'home', score: '13 – 9' });
  const away = bo3Maps({ team1_id: 10, games: [{ number: 1, status: 'finished', map_name: 'de_nuke', winner_clan_score: 13, loser_clan_score: 4, winner_team_clan: { team_id: 20 } }] });
  assert.equal(away[0].winner, 'away');
  assert.equal(away[0].score, '4 – 13');
});

test('live lane entries for bo3.gg: live, final, cancelled', () => {
  assert.equal(bo3Live(bo3({ status: 'current', team1_score: 1 })).status, 'live');
  const f = bo3Live(bo3({ status: 'finished', team1_score: 2, team2_score: 1 }));
  assert.equal(f.status, 'final');
  assert.equal(f.score, '2 – 1');
  assert.equal(bo3Live(bo3({ status: 'canceled' })).status, 'cancelled');
});

test('lane applies live map scores and drops finished series', () => {
  const [e] = parseBo3([bo3()], now);
  const live = { at: now, games: [{ id: e.id, status: 'live', score: '1 – 0', clock: 'Map 2 · Inferno', maps: [{ n: 1, status: 'final', winner: 'home', score: '13 – 7' }] }] };
  const [x] = applyAsiaLive([e], live, now);
  assert.equal(x.live, true);
  assert.equal(x.esports.maps[0].score, '13 – 7');
  assert.equal(applyAsiaLive([x], live, now), null); // unchanged
  assert.deepEqual(applyAsiaLive([x], { at: now, games: [{ id: e.id, status: 'final' }] }, now), []);
});

test('series model: map score markets add up and follow the price', () => {
  const [e] = parseBo3([bo3()], now);
  const a = analyse(e);
  assert.equal(a.confidence, 'high');
  const ms = a.groups.find((g) => g.group === 'Map score').markets[0];
  assert.ok(Math.abs(ms.outcomes.reduce((s, o) => s + o.p, 0) - 1) < 1e-9);
  const furia = ms.outcomes.filter((o) => o.name.startsWith('FURIA')).reduce((s, o) => s + o.p, 0);
  assert.ok(Math.abs(furia - a.win.home / (a.win.home + a.win.away)) < 1e-3);
});

test('unpriced esports use team rankings', () => {
  const [e] = parseBo3([bo3({ bet_updates: null })], now);
  const a = analyse(e);
  assert.equal(a.confidence, 'medium');
  assert.match(a.basis, /ranking #3 vs #7/);
  assert.ok(a.win.home > 0.6 && a.win.home < 0.7);
  assert.ok(Math.abs(rankWin(1, 10) - 0.849) < 0.01);
  assert.equal(rankWin(5, 5), 0.5);
});

test('bo3.gg results grade series and total maps picks', () => {
  const r = resultFromBo3({ status: 'finished', team1_id: 10, winner_team_id: 10, team1_score: 2, team2_score: 1 });
  assert.deepEqual(r, { done: true, homeScore: 2, awayScore: 1, winner: 'home' });
  assert.equal(gradePick({ market: 'Winner', pick: 'FURIA', home: 'FURIA', away: 'G2' }, r), 'won');
  assert.equal(gradePick({ market: 'Total 2.5', pick: 'Over 2.5', home: 'FURIA', away: 'G2' }, r), 'won');
  assert.deepEqual(resultFromBo3({ status: 'canceled' }), { void: true });
  assert.deepEqual(resultFromBo3({ status: 'current' }), { done: false });
});

// ---------- eSoccer ----------
const p = (nickname, score, club = 'Club') => ({ nickname, score, team: { token_international: club }, prevPeriodsScores: score == null ? [] : [String(Math.min(score, 1))] });
const esbMatch = (id, a, as, b, bs, status, date) => ({ id, date, status_id: status, participant1: p(a, as, 'France'), participant2: p(b, bs, 'Brazil') });

test('eSoccer form and upcoming/live matches', () => {
  const done = [esbMatch(1, 'Paka', 4, 'Dov1n', 1, 3, '2026-10-05T07:00:00Z'), esbMatch(2, 'Dov1n', 2, 'Paka', 2, 3, '2026-10-05T07:12:00Z'), esbMatch(3, 'Paka', 3, 'Dov1n', 0, 3, '2026-10-05T07:24:00Z')];
  const form = esbForm(done);
  assert.deepEqual(form.get('Paka'), { g: 3, w: 2, d: 1, l: 0, gf: 9, ga: 3 });
  const t = { id: 9, token_international: 'Ligue 1 2026-10-05' };
  const list = parseEsb([{ tournament: t, matches: [...done, esbMatch(4, 'Paka', 1, 'Dov1n', 0, 2, '2026-10-05T08:24:00Z'), esbMatch(5, 'Dov1n', null, 'Paka', null, 1, '2026-10-05T08:36:00Z'), esbMatch(6, 'A', null, 'B', null, 1, '2026-10-05T10:30:00Z')] }], now, form);
  assert.deepEqual(list.map((e) => e.id), ['esoccer-4', 'esoccer-5']);
  assert.equal(list[0].live, true);
  assert.equal(list[0].home, 'France (Paka)');
  assert.equal(list[0].league, 'eSoccer Battle · Ligue 1');
  const l = esoccerLambdas(list[0]);
  assert.ok(l.lh > l.la);
  const a = analyse(list[0]);
  assert.equal(a.kind, 'poisson');
  assert.equal(a.confidence, 'medium');
  assert.ok(a.win.home > a.win.away && a.win.draw > 0);
  assert.ok(a.groups.some((g) => g.markets.some((m) => /Both teams/i.test(m.name))));
});

test('eSoccer live lane entries', () => {
  assert.deepEqual(esbLive(esbMatch(4, 'Paka', 2, 'Dov1n', 1, 2, '')), { id: 'esoccer-4', status: 'live', score: '2 – 1', clock: '2nd half · HT 1 – 1' });
  assert.equal(esbLive(esbMatch(4, 'Paka', 2, 'Dov1n', 1, 3, '')).status, 'final');
});
