import test from 'node:test';
import assert from 'node:assert/strict';
import { propReadiness, analysisPanel } from '../js/propcheck.js';
import { parseConstraints } from '../js/assistant/constraints.js';

const now = Date.now();
const e = { id: 'e', sport: 'basketball', fetchedAt: now - 5 * 6e4, injuryChecked: now - 6e4, injuries: { home: [{ id: '9', name: 'Jamal Murray', status: 'Questionable' }, { id: '7', name: 'Aaron Gordon', status: 'Out' }], away: [] } };
const x = (o = {}) => ({ id: '1', side: 'home', hist: { l20: [12, 20] }, ...o });

test('prop readiness: ready, waiting, conflict, stale, limited', () => {
  assert.equal(propReadiness(e, x(), { now, logsAt: now - 10 * 6e4 }).state, 'ready');
  assert.equal(propReadiness(e, x({ id: '9' }), { now }).state, 'waiting', 'his own status is questionable');
  assert.equal(propReadiness(e, x({ id: '7' }), { now }).state, 'conflict', 'a line offered on a player listed out');
  assert.equal(propReadiness({ ...e, fetchedAt: now - 90 * 6e4 }, x(), { now }).state, 'stale', 'an hour-old price');
  assert.equal(propReadiness(e, x(), { now, logsAt: now - 80 * 6e4 }).state, 'stale', 'old game logs');
  assert.equal(propReadiness(e, x({ hist: { l20: [2, 4] } }), { now }).state, 'limited', 'thin history');
  assert.equal(propReadiness({ ...e, injuryChecked: null, injuries: null }, x(), { now }).state, 'limited', 'no injury report');
  assert.equal(propReadiness(e, x({ adj: [{ name: 'Jamal Murray', status: 'Questionable', applied: false }] }), { now }).state, 'waiting', 'a key teammate questionable');
  assert.equal(propReadiness({ ...e, sport: 'hockey' }, x(), { now }).state, 'limited', 'no goalie feed');
});

test('analysis panel: forecast, break-even, return, range, sample, age, missing', () => {
  const html = analysisPanel({ hits: 11, n: 20, avg: 26.1, forecast: 0.6, range: [0.5, 0.7], nEff: 11, priced: true, odds: 2, marketEst: 0.475, readiness: propReadiness(e, x(), { now }), priceAge: 5, logsAge: 10 });
  assert.match(html, /Ready to assess/);
  assert.match(html, /50%/); // break-even at 2.00
  assert.match(html, /\+20\.0%/); // return 0.6 x 2 - 1
  assert.match(html, /approx\. 80% range 50%–70%/);
  assert.match(html, /price 5 min · logs 10 min/);
  assert.match(html, /forecast \+13 pts vs it/);
});

test('constraints: odds, days, exclusions, sport-only, positive only, counts', () => {
  const K = { leagueIn: (t) => (/\bnba\b/.test(t) ? 'basketball/nba' : null), sportIn: (t) => (/tennis/.test(t) ? 'tennis' : /baseball/.test(t) ? 'baseball' : null) };
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  assert.equal(parseConstraints('one bet with odds at least 1.80', K, now).minOdds, 1.8);
  assert.equal(parseConstraints('one bet with odds at least 1.80', K, now).n, 1);
  assert.equal(parseConstraints('best bets tomorrow', K, now).from, day0.getTime() + 864e5);
  assert.deepEqual(parseConstraints('best bets excluding NBA', K, now).exclude.leagues, ['basketball/nba']);
  assert.equal(parseConstraints('best bets excluding NBA', K, now).league, undefined);
  assert.equal(parseConstraints('an NBA-only 3x slip', K, now).league, 'basketball/nba');
  assert.equal(parseConstraints('an NBA-only 3x slip', K, now).target, 3);
  assert.equal(parseConstraints('positive edge bets only', K, now).positiveOnly, true);
  const c = parseConstraints('3 safe bets no tennis or baseball, odds 1.5+', K, now);
  assert.deepEqual(c.exclude.sports, ['tennis', 'baseball']);
  assert.equal(c.minOdds, 1.5);
  assert.equal(c.n, 3);
  assert.equal(parseConstraints('under 2.5 goals bets', K, now).maxOdds, undefined, 'a goals line is not an odds limit');
});
