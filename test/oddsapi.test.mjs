import test from 'node:test';
import assert from 'node:assert/strict';
import { consensus, marketsFromOdds, matchOdds, normName, ODDS_SPORT_KEYS } from '../js/oddsapi.js';

const bk = (title, markets) => ({ key: title, title, markets });
const h2h = (a, pa, b, pb, d = null) => bk('b', [{ key: 'h2h', outcomes: [{ name: a, price: pa }, { name: b, price: pb }, ...(d ? [{ name: 'Draw', price: d }] : [])] }]);

test('sport key map points at real The Odds API keys', () => {
  assert.equal(ODDS_SPORT_KEYS['basketball/nba'], 'basketball_nba');
  assert.equal(ODDS_SPORT_KEYS['soccer/eng.1'], 'soccer_epl');
  assert.equal(ODDS_SPORT_KEYS['atlas/euroleague'], 'basketball_euroleague');
});

test('every book\'s price is kept; markets take the best price and the median as consensus', () => {
  const ev = { home_team: 'Boston Celtics', away_team: 'Miami Heat', bookmakers: [
    bk('a', [{ key: 'h2h', outcomes: [{ name: 'Boston Celtics', price: 1.5 }, { name: 'Miami Heat', price: 2.6 }] }, { key: 'totals', outcomes: [{ name: 'Over', price: 1.9, point: 210.5 }, { name: 'Under', price: 1.9, point: 210.5 }] }, { key: 'spreads', outcomes: [{ name: 'Boston Celtics', price: 1.9, point: -5.5 }, { name: 'Miami Heat', price: 1.9, point: 5.5 }] }]),
    bk('b', [{ key: 'h2h', outcomes: [{ name: 'Boston Celtics', price: 1.6 }, { name: 'Miami Heat', price: 2.4 }] }, { key: 'totals', outcomes: [{ name: 'Over', price: 1.95, point: 210.5 }, { name: 'Under', price: 1.87, point: 210.5 }] }]),
    bk('c', [{ key: 'h2h', outcomes: [{ name: 'Boston Celtics', price: 1.55 }, { name: 'Miami Heat', price: 2.5 }] }]),
  ] };
  const c = consensus(ev);
  assert.equal(c.books, 3);
  const { markets } = marketsFromOdds(ev, { home: 'Boston Celtics', away: 'Miami Heat', leaguePath: 'basketball/nba' });
  const win = markets.find((m) => m.name === 'Winner');
  assert.equal(win.outcomes[0].odds, 1.6, 'the best price on offer (1.5, 1.6, 1.55)');
  assert.equal(win.outcomes[0].book, 'b');
  // Consensus: medians 1.55 / 2.5, margin removed.
  assert.equal(win.outcomes[0].cons, +((1 / 1.55) / (1 / 1.55 + 1 / 2.5)).toFixed(4));
  assert.match(win.consensusFrom, /median/);
  const tot = markets.find((m) => m.name.startsWith('Total'));
  assert.equal(tot.name, 'Total 210.5');
  const sp = markets.find((m) => m.name === 'Spread');
  assert.equal(sp.line, -5.5);
});

test('soccer keeps the draw; other sports are two-way', () => {
  const ev = { home_team: 'Arsenal', away_team: 'Chelsea', bookmakers: [h2h('Arsenal', 2.0, 'Chelsea', 3.6, 3.4)] };
  const soccer = marketsFromOdds(ev, { home: 'Arsenal', away: 'Chelsea', leaguePath: 'soccer/eng.1' });
  assert.equal(soccer.markets[0].name, 'Match Result');
  assert.equal(soccer.markets[0].outcomes.length, 3);
  const nba = marketsFromOdds({ home_team: 'A', away_team: 'B', bookmakers: [h2h('A', 1.8, 'B', 2.1)] }, { home: 'A', away: 'B', leaguePath: 'basketball/nba' });
  assert.equal(nba.markets[0].name, 'Winner');
});

test('matchOdds merges by name and time, both orientations, only onto unpriced upcoming matches', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const start = now + 36e5;
  const events = [
    { home: 'Real Madrid', away: 'FC Barcelona', leaguePath: 'soccer/esp.1', start, markets: [] },
    { home: 'Already Priced', away: 'Team', leaguePath: 'soccer/esp.1', start, markets: [{ name: 'Winner', outcomes: [] }] },
    { home: 'Live Team', away: 'Other', leaguePath: 'soccer/esp.1', start, live: true, markets: [] },
  ];
  const odds = [
    { home_team: 'Barcelona', away_team: 'Real Madrid', commence_time: new Date(start + 5 * 6e4).toISOString(), bookmakers: [h2h('Barcelona', 2.5, 'Real Madrid', 2.7, 3.3)] },
  ];
  const n = matchOdds(events, odds, { now });
  assert.equal(n, 1);
  assert.equal(events[0].markets.length, 1);
  assert.equal(events[0].oddsSource, 'the-odds-api');
  assert.equal(events[0].markets[0].outcomes.find((o) => o.name === 'Real Madrid').odds, 2.7);
  assert.equal(events[1].markets[0].outcomes.length, 0, 'already priced: untouched');
  assert.ok(!events[2].oddsSource, 'live: skipped');
  assert.equal(normName('Atlético Madrid CF'), 'atletico madrid');
});

test('odds keep their quote time; quotes over a day old are not applied', () => {
  const now = Date.parse('2026-10-18T06:00:00Z');
  const book = (t, h, a) => ({ key: 'b', last_update: new Date(t).toISOString(), markets: [{ key: 'h2h', outcomes: [{ name: 'A', price: h }, { name: 'B', price: a }] }] });
  const odds = [{ home_team: 'A', away_team: 'B', commence_time: new Date(now + 36e5).toISOString(), bookmakers: [book(now - 30 * 6e4, 1.8, 2.0), book(now - 50 * 6e4, 1.9, 1.95), book(now - 40 * 6e4, 1.85, 2.0)] }];
  const fresh = [{ id: 'x', home: 'A', away: 'B', start: now + 36e5, leaguePath: 'basketball/nba' }];
  assert.equal(matchOdds(fresh, odds, { now }), 1);
  assert.equal(fresh[0].priceAt, now - 40 * 6e4, 'median of the books\' update times');
  assert.match(fresh[0].bookmaker, /best of 3 bookmakers; fair chance from median/);
  const old = [{ id: 'y', home: 'A', away: 'B', start: now + 36e5, leaguePath: 'basketball/nba' }];
  const stale = odds.map((o) => ({ ...o, bookmakers: o.bookmakers.map((b) => ({ ...b, last_update: new Date(now - 30 * 36e5).toISOString() })) }));
  assert.equal(matchOdds(old, stale, { now }), 0);
  assert.equal(old[0].markets, undefined);
});

test('Pinnacle is the consensus where it quotes; the shopped market replaces the feed\'s winner market', async () => {
  const { devig } = await import('../js/engine.js');
  const now = Date.parse('2026-10-20T12:00:00Z'), start = now + 36e5;
  const book = (key, a, b) => ({ key, title: key, last_update: new Date(now - 6e4).toISOString(), markets: [{ key: 'h2h', outcomes: [{ name: 'Lakers', price: a }, { name: 'Celtics', price: b }] }] });
  const odds = [{ home_team: 'Los Angeles Lakers', away_team: 'Boston Celtics', commence_time: new Date(start).toISOString(),
    bookmakers: [book('pinnacle', 1.62, 2.38), book('fanduel', 1.70, 2.15), book('draftkings', 1.55, 2.5)] }];
  odds[0].bookmakers.forEach((b) => b.markets[0].outcomes.forEach((o, i) => { o.name = i ? 'Boston Celtics' : 'Los Angeles Lakers'; }));
  const e = { home: 'Los Angeles Lakers', away: 'Boston Celtics', leaguePath: 'basketball/nba', start,
    markets: [{ name: 'Winner', outcomes: [{ name: 'Los Angeles Lakers', odds: 1.6 }, { name: 'Boston Celtics', odds: 2.35 }] }, { name: 'Total 221.5', outcomes: [] }] };
  assert.equal(matchOdds([e], odds, { now, force: true }), 1);
  const win = e.markets.find((m) => m.name === 'Winner');
  assert.equal(win.outcomes[0].odds, 1.7, 'best price: FanDuel');
  assert.equal(win.outcomes[0].book, 'fanduel');
  assert.equal(win.consensusFrom, 'Pinnacle');
  assert.ok(e.markets.some((m) => m.name === 'Total 221.5'), 'the feed\'s other markets are kept');
  assert.equal(e.markets.filter((m) => m.name === 'Winner').length, 1);
  // The fair chance is Pinnacle's, margin removed; at 1.70 the Lakers beat it.
  const f = devig(win).outcomes[0].fair;
  assert.equal(f, +((1 / 1.62) / (1 / 1.62 + 1 / 2.38)).toFixed(4));
  assert.ok(f * 1.7 > 1, 'the best price is longer than the fair odds');
});
