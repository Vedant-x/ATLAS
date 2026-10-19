import test from 'node:test';
import assert from 'node:assert/strict';
import { consensus, marketsFromOdds, matchOdds, normName, sportOfKey, pairEvents, fixtureFromApi, sameSide } from '../js/oddsapi.js';

const bk = (title, markets) => ({ key: title, title, markets });
const h2h = (a, pa, b, pb, d = null) => bk('b', [{ key: 'h2h', outcomes: [{ name: a, price: pa }, { name: b, price: pb }, ...(d ? [{ name: 'Draw', price: d }] : [])] }]);

test('sport keys map to the site\'s sports by prefix; unmodelled sports are left out', () => {
  assert.equal(sportOfKey('soccer_sweden_allsvenskan'), 'football');
  assert.equal(sportOfKey('tennis_atp_paris'), 'tennis');
  assert.equal(sportOfKey('rugbyleague_nrl'), 'rugby');
  assert.equal(sportOfKey('icehockey_sweden_allsvenskan'), 'hockey');
  assert.equal(sportOfKey('politics_us_presidential_election_winner'), null);
});

test('fixture lists: our matches are paired either way round, the rest become new matches', () => {
  const t = Date.parse('2026-10-20T18:00:00Z');
  const ours = [{ id: 'x', home: 'AIK', away: 'Hammarby IF', start: t + 30 * 6e4 }];
  const list = [
    { id: 'a1', commence_time: new Date(t).toISOString(), home_team: 'Hammarby', away_team: 'AIK' }, // reversed, IF dropped
    { id: 'a2', commence_time: new Date(t).toISOString(), home_team: 'Mjallby AIF', away_team: 'Degerfors IF' },
  ];
  const { pairs, extra } = pairEvents(ours, list);
  assert.deepEqual(pairs.map(([o, e]) => [o.id, e.id]), [['a1', 'x']]);
  assert.deepEqual(extra.map((o) => o.id), ['a2']);
  const ev = fixtureFromApi(extra[0], { key: 'soccer_sweden_allsvenskan', title: 'Allsvenskan', sport: 'football', at: t - 864e5 });
  assert.equal(ev.leaguePath, 'atlas/odds-football');
  assert.equal(ev.league, 'Allsvenskan');
  assert.equal(ev.start, t);
  assert.deepEqual(ev.markets, []);
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

test('a draw the books price makes a three-way market in any sport', () => {
  const ev = { home_team: 'Leinster', away_team: 'Munster', bookmakers: [h2h('Leinster', 1.4, 'Munster', 3.6, 21)] };
  const { markets } = marketsFromOdds(ev, { home: 'Leinster', away: 'Munster' });
  assert.equal(markets[0].name, 'Match Result');
  assert.deepEqual(markets[0].outcomes.map((o) => o.name), ['Leinster', 'Draw', 'Munster']);
});

test('pairing tolerates different spellings and reads prices by the API\'s own names', () => {
  assert.ok(sameSide('Valencia Basket', 'Valencia'));
  assert.ok(sameSide('Kocaelispor', 'Kocaeli'));
  assert.ok(!sameSide('Real Madrid', 'Real Betis'));
  const t = Date.parse('2026-10-20T18:00:00Z');
  const ours = [{ id: 'v', home: 'Paris Basketball', away: 'Valencia Basket', start: t, markets: [] },
    { id: 'w', home: 'Gremio', away: 'Vasco da Gama', start: t, markets: [] }];
  const list = [
    { id: 'p1', commence_time: new Date(t).toISOString(), home_team: 'Valencia', away_team: 'Paris' }, // swapped, both shortened
    { id: 'p2', commence_time: new Date(t + 36e5).toISOString(), home_team: 'Gremio FBPA', away_team: 'CR Vasco' }, // one side matches, within 3 h
  ];
  const { pairs, extra } = pairEvents(ours, list);
  assert.deepEqual(pairs.map(([o, e]) => [o.id, e.id]), [['p1', 'v'], ['p2', 'w']]);
  assert.equal(extra.length, 0);
  // Prices land on the right side even though the API has the teams the other way round.
  ours[0].oddsId = 'p1';
  const odds = [{ ...list[0], bookmakers: [h2h('Valencia', 2.4, 'Paris', 1.6)] }];
  assert.equal(matchOdds([ours[0]], odds, { now: t - 36e5, force: true }), 1);
  const w = ours[0].markets.find((m) => m.name === 'Winner');
  assert.deepEqual(w.outcomes.map((o) => [o.name, o.odds]), [['Paris Basketball', 1.6], ['Valencia Basket', 2.4]]);
});

test('spreads pair a home line only with its mirror; a soccer match never loses its draw to a two-way price', () => {
  const sp = (name, point, price) => ({ name, point, price });
  const ev = { home_team: 'A', away_team: 'B', bookmakers: [
    bk('x', [{ key: 'spreads', outcomes: [sp('A', -1.5, 2.1), sp('B', 1.5, 1.75)] }]),
    bk('y', [{ key: 'spreads', outcomes: [sp('A', -1.5, 2.05), sp('B', 1.5, 1.8), sp('A', 1.5, 1.3), sp('B', -1.5, 3.4)] }]),
  ] };
  const { markets } = marketsFromOdds(ev, { home: 'A', away: 'B' });
  const s = markets.find((m) => m.name === 'Spread');
  assert.equal(s.line, -1.5);
  assert.deepEqual(s.outcomes.map((o) => [o.name, o.odds]), [['A -1.5', 2.1], ['B +1.5', 1.8]]);
  // Soccer with no draw quoted: the feed's three-way market is kept, the two-way one left out.
  const start = Date.now() + 864e5;
  const e = { id: 's', sport: 'football', home: 'Arsenal', away: 'Chelsea', start, markets: [{ name: 'Match Result', outcomes: [{ name: 'Arsenal', odds: 1.9 }, { name: 'Draw', odds: 3.6 }, { name: 'Chelsea', odds: 4.2 }] }] };
  matchOdds([e], [{ id: 'o', commence_time: new Date(start).toISOString(), home_team: 'Arsenal', away_team: 'Chelsea', bookmakers: [h2h('Arsenal', 1.5, 'Chelsea', 2.6)] }], { force: true });
  assert.deepEqual(e.markets.map((m) => m.name), ['Match Result']);
  assert.ok(e.markets[0].outcomes.some((o) => o.name === 'Draw'));
});
