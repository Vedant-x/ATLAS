import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureSides, bookPrices, stakeEvents, overlayStake, describe, allowance, STAKE_LEAGUES } from '../js/oddspapi.js';
import { valueBets, selectPicks } from '../js/track.js';

const H = 36e5;
// A fixture as OddsPapi documents it: prices by bookmaker, market id, outcome id, then player "0".
const px = (o) => ({ outcomes: Object.fromEntries(Object.entries(o).map(([id, price]) => [id, { players: { 0: { price, active: true } } }])) });
const fixture = (extra = {}, odds = {}) => ({
  fixtureId: 'id1', tournamentId: 17, participant1Name: 'Arsenal', participant2Name: 'Chelsea', startTime: new Date(Date.now() + 5 * H).toISOString(),
  bookmakerOdds: { stake: { markets: { 101: px({ 101: 2.1, 102: 3.5, 103: 3.6 }) } }, pinnacle: { markets: { 101: px({ 101: 2.05, 102: 3.6, 103: 3.9 }) } }, ...odds }, ...extra,
});

test('OddsPapi: a fixture\'s sides and start under whichever names it uses; a book\'s live prices in outcome order', () => {
  const t = Date.now() + 5 * H;
  assert.deepEqual(fixtureSides(fixture({ startTime: new Date(t).toISOString() })), { home: 'Arsenal', away: 'Chelsea', start: t, slug: null });
  assert.deepEqual(fixtureSides({ participants: [{ name: 'A' }, { name: 'B' }], startTimestamp: Math.round(t / 1000) }), { home: 'A', away: 'B', start: Math.round(t / 1000) * 1000, slug: null });
  assert.deepEqual(fixtureSides({}), { home: null, away: null, start: null, slug: null });
  assert.deepEqual(bookPrices(fixture(), 'stake', 101), [{ id: 101, price: 2.1, active: true }, { id: 102, price: 3.5, active: true }, { id: 103, price: 3.6, active: true }]);
  const off = fixture({}, { stake: { markets: { 101: { outcomes: { 101: { players: { 0: { price: 2.1, active: false } } }, 103: { players: { 0: { price: 3.6 } } } } } } } });
  assert.equal(bookPrices(off, 'stake', 101), null, 'a suspended price leaves one: no market');
  assert.equal(bookPrices(fixture(), 'bet365', 101), null);
});

test('OddsPapi: the fixtures as matchable events; leagues whose winner market is not known yet are only described', () => {
  const evs = stakeEvents([fixture(), fixture({ fixtureId: 'nba', tournamentId: 132 })]);
  assert.equal(evs.length, 1);
  assert.deepEqual([evs[0].league, evs[0].home, evs[0].stake, evs[0].pinnacle], ['Premier League', 'Arsenal', [2.1, 3.5, 3.6], [2.05, 3.6, 3.9]]);
  const d = describe([fixture(), fixture({ tournamentId: 132, participant1Name: null })]);
  assert.deepEqual(d[17], { fixtures: 1, named: 1, stake: 1, markets: { 101: 3 } });
  assert.equal(d[132].named, 0);
  assert.ok(STAKE_LEAGUES.every((l) => l.path && l.sport && l.id));
});

test('Stake onto the board: beside the feed\'s price, either way round; Pinnacle\'s fair chance only where no sharp line is held', () => {
  const mr = (o) => [{ name: 'Match Result', outcomes: [{ name: 'Arsenal', odds: 2.0, ...o }, { name: 'Draw', odds: 3.4 }, { name: 'Chelsea', odds: 3.7 }] }];
  const ours = { id: 'e1', sport: 'football', home: 'Arsenal FC', away: 'Chelsea', start: Date.now() + 5 * H, markets: mr() };
  // The same match listed the other way round: Stake's home price is Chelsea's.
  const swapped = { id: 'e2', sport: 'football', home: 'Chelsea', away: 'Arsenal', start: Date.now() + 5 * H, markets: [{ name: 'Match Result', outcomes: [{ name: 'Chelsea', odds: 3.7, cons: 0.25 }, { name: 'Draw', odds: 3.4, cons: 0.27 }, { name: 'Arsenal', odds: 2.0, cons: 0.48 }] }] };
  const other = { id: 'e3', sport: 'basketball', home: 'Arsenal', away: 'Chelsea', start: Date.now() + 5 * H, markets: mr() };
  const s = stakeEvents([fixture()]);
  const n = overlayStake([ours, swapped, other], s, { at: 123 });
  assert.deepEqual(n, { stake: 2, sharp: 1 });
  assert.deepEqual(ours.markets[0].outcomes.map((o) => [o.odds, o.stake]), [[2.0, 2.1], [3.4, 3.5], [3.7, 3.6]], 'the feed\'s price stays; Stake\'s beside it');
  assert.equal(ours.stakeAt, 123);
  const inv = [1 / 2.05, 1 / 3.6, 1 / 3.9], sum = inv.reduce((a, b) => a + b, 0);
  assert.equal(ours.markets[0].outcomes[0].cons, +(inv[0] / sum).toFixed(4), 'Pinnacle\'s chance, its margin removed');
  assert.equal(ours.markets[0].consensusFrom, 'Pinnacle');
  assert.deepEqual(swapped.markets[0].outcomes.map((o) => o.stake), [3.6, 3.5, 2.1], 'swapped: Chelsea takes the away price');
  assert.equal(swapped.markets[0].outcomes[2].cons, 0.48, 'a sharp line already held is kept');
  assert.equal(other.markets[0].outcomes[0].stake, undefined, 'another sport: never matched');
});

test('OddsPapi budget: spent at an even pace to the end of the month; a new month starts again', () => {
  const now = Date.UTC(2026, 9, 24, 12); // 24 Oct, noon: 7.5 days left
  const fresh = allowance(null, { monthly: 240, now });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.month, '2026-10');
  const pace = allowance({ month: '2026-10', used: 200, spentAt: now - 3 * H }, { monthly: 240, now });
  assert.equal(Math.round(pace.gap / 6e4), Math.round((7.5 * 24 * 60) / 40), 'the 40 left over 7.5 days: one every 4.5 hours');
  assert.equal(pace.ok, false, '3 hours since the last: not yet');
  assert.equal(allowance({ month: '2026-10', used: 200, spentAt: now - 5 * H }, { monthly: 240, now }).ok, true);
  assert.equal(allowance({ month: '2026-10', used: 240, spentAt: 0 }, { monthly: 240, now }).ok, false, 'used up');
  assert.equal(allowance({ month: '2026-09', used: 240, spentAt: now - H }, { monthly: 240, now }).ok, true, 'last month\'s count does not carry over');
});

test('value at Stake: Stake\'s price over the fair odds is the price taken and recorded, and comes first', () => {
  const mk = (o) => [{ name: 'Match Result', consensusFrom: 'Pinnacle', outcomes: o }];
  const event = (id, outcomes, extra = {}) => ({ id, sport: 'football', leaguePath: 'soccer/eng.1', compId: id, home: 'Home', away: 'Away', start: Date.now() + 5 * H, live: false, markets: mk(outcomes), oddsSource: 'espn', stakeAt: Date.now() - H, sharpAt: Date.now() - 2 * H, fetchedAt: Date.now() - 6e4, ...extra });
  const evs = [
    // The feed's 2.0 is below the fair 2.08 (0.48); Stake's 2.2 is 5.6% above it.
    event('s1', [{ name: 'Home', odds: 2.0, stake: 2.2, cons: 0.48, book: 'DraftKings' }, { name: 'Draw', odds: 3.3, cons: 0.28 }, { name: 'Away', odds: 4.0, cons: 0.24 }]),
    // Value at the feed's price (+8%), none at Stake: kept, after the Stake one.
    event('s2', [{ name: 'Home', odds: 2.25, stake: 2.0, cons: 0.48, book: 'DraftKings' }, { name: 'Draw', odds: 3.3, cons: 0.28 }, { name: 'Away', odds: 4.0, cons: 0.24 }]),
    // Stake's price read 11 hours ago: too old to take.
    event('s3', [{ name: 'Home', odds: 2.0, stake: 2.3, cons: 0.48 }, { name: 'Draw', odds: 3.3, cons: 0.28 }, { name: 'Away', odds: 4.0, cons: 0.24 }], { stakeAt: Date.now() - 11 * H }),
  ];
  const v = valueBets(evs, { limit: 10 });
  assert.deepEqual(v.map((b) => [b.event.id, b.odds, b.book, Boolean(b.atStake)]), [['s1', 2.2, 'Stake', true], ['s2', 2.25, 'DraftKings', false]]);
  assert.equal(+v[0].edge.toFixed(3), 0.056);
  const rec = selectPicks([evs[0]], Date.now(), 12, []).find((p) => p.type === 'edge');
  assert.deepEqual([rec.odds, rec.bestBook, rec.atStake], [2.2, 'Stake', true], 'recorded at Stake\'s price');
});

test('OddsPapi as it really answers: teams by id only; names from the participants list, else from Stake\'s link and the kick-off', async () => {
  const { participantNames, slugMatch } = await import('../js/oddspapi.js');
  const t = Date.parse('2026-10-25T11:30:00.000Z');
  // A fixture as the live API returned it (24 Oct 2026), trimmed to what is read.
  const live = (market, prices, extra = {}) => ({ fixtureId: 'id1000002371945334', participant1Id: 2697, participant2Id: 2693, sportId: 10, tournamentId: 23, startTime: '2026-10-25T11:30:00.000Z',
    bookmakerOdds: { stake: { bookmakerIsActive: true, fixturePath: 'https://stake.com/sports/e/e/e-e/46930044-inter-fiorentina', markets: { [market]: { outcomes: Object.fromEntries(prices.map((p, i) => [String(market + i), { players: { 0: { price: p, active: true } } }])) } } } }, ...extra });
  assert.deepEqual(fixtureSides(live(101, [1.5, 4.2, 6])), { home: null, away: null, start: t, slug: 'inter-fiorentina' });
  assert.deepEqual(participantNames({ 2697: 'Inter', 2693: { name: 'Fiorentina' } }), { 2697: 'Inter', 2693: 'Fiorentina' });
  assert.deepEqual(participantNames([{ participantId: 2697, participantName: 'Inter' }, { id: 2693, name: 'Fiorentina' }]), { 2697: 'Inter', 2693: 'Fiorentina' });
  assert.equal(fixtureSides(live(101, [1.5, 4.2, 6]), { 2697: 'Inter', 2693: 'Fiorentina' }).home, 'Inter');
  // Unnamed: matched by Stake's link within the league and the kick-off, either way round.
  const [s] = stakeEvents([live(101, [1.5, 4.2, 6])]);
  assert.deepEqual([s.slug, s.path, s.stake], ['inter-fiorentina', 'soccer/ita.1', [1.5, 4.2, 6]]);
  const ours = { id: 'e', sport: 'football', leaguePath: 'soccer/ita.1', home: 'Internazionale', away: 'Fiorentina', start: t, markets: [{ name: 'Match Result', outcomes: [{ name: 'Internazionale', odds: 1.48 }, { name: 'Draw', odds: 4.3 }, { name: 'Fiorentina', odds: 6.2 }] }] };
  const swapped = { ...ours, id: 'f', home: 'Fiorentina', away: 'Internazionale', markets: [{ name: 'Match Result', outcomes: [{ name: 'Fiorentina', odds: 6.2 }, { name: 'Draw', odds: 4.3 }, { name: 'Internazionale', odds: 1.48 }] }] };
  assert.equal(slugMatch(s, { ...ours, leaguePath: 'soccer/ita.2' }), null, 'another league');
  assert.equal(slugMatch(s, { ...ours, start: t + 3 * 36e5 }), null, 'another kick-off');
  assert.equal(slugMatch(s, { ...ours, away: 'Napoli' }), null, 'both teams must be in the link');
  assert.deepEqual(overlayStake([ours, swapped], [s], { now: t - 36e5 }), { stake: 2, sharp: 0 });
  assert.deepEqual(ours.markets[0].outcomes.map((o) => o.stake), [1.5, 4.2, 6]);
  assert.deepEqual(swapped.markets[0].outcomes.map((o) => o.stake), [6, 4.2, 1.5]);
  // The NBA's moneyline is market 111 (two outcomes).
  const [nba] = stakeEvents([live(111, [1.62, 2.35], { tournamentId: 132, sportId: 11, bookmakerOdds: { stake: { fixturePath: 'https://stake.com/sports/b/b/b-b/1-boston-celtics-new-york-knicks', markets: { 111: { outcomes: { 111: { players: { 0: { price: 1.62 } } }, 112: { players: { 0: { price: 2.35 } } } } } } } } })]);
  assert.deepEqual([nba.league, nba.stake, nba.slug], ['NBA', [1.62, 2.35], 'boston-celtics-new-york-knicks']);
  assert.deepEqual(slugMatch(nba, { leaguePath: 'basketball/nba', home: 'Boston Celtics', away: 'New York Knicks', start: t }), { orient: 'same', score: 2, dt: 0 });
});

test('Stake against the fair odds: each price\'s distance from the fair odds, best first; Pinnacle\'s margin off by the power method', async () => {
  const { stakeVsFair } = await import('../js/oddspapi.js');
  const { powerDevig } = await import('../js/engine.js');
  // The power method takes more of the margin off the long prices than an even split does.
  const p = powerDevig([1.36, 5.5, 8.6]), even = [1.36, 5.5, 8.6].map((x) => 1 / x), sum = even.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-3, 'adds up to 1');
  assert.ok(p[0] > even[0] / sum && p[2] < even[2] / sum, 'favourite up, long shot down');
  assert.equal(powerDevig([1.5]), null);
  assert.equal(powerDevig([0.9, 2]), null);
  const event = (id, outcomes, extra = {}) => ({ id, sport: 'football', home: 'Home', away: 'Away', start: Date.now() + 5 * H, markets: [{ name: 'Match Result', consensusFrom: 'Pinnacle', outcomes }], stakeAt: Date.now() - H, sharpAt: Date.now() - 2 * H, ...extra });
  const rows = stakeVsFair([
    // Pinnacle 1.36 / 5.5 / 8.6, its margin split evenly: 0.7115 / 0.1759 / 0.1125.
    event('a', [{ name: 'Home', odds: 1.32, stake: 1.34, cons: 0.7115, pin: 1.36 }, { name: 'Draw', odds: 5.25, stake: 5.6, cons: 0.1759, pin: 5.5 }, { name: 'Away', odds: 7, stake: 8, cons: 0.1125, pin: 8.6 }]),
    event('b', [{ name: 'Home', odds: 1.6, stake: 1.56, cons: 0.6022 }, { name: 'Draw', odds: 4, stake: 3.95, cons: 0.235 }, { name: 'Away', odds: 6, stake: 6.4, cons: 0.1628 }]),
    event('live', [{ name: 'Home', odds: 2, stake: 2.5, cons: 0.5 }, { name: 'Away', odds: 2, stake: 2.5, cons: 0.5 }], { live: true }),
  ]);
  assert.deepEqual(rows.map((r) => [r.event.id, r.pick]).slice(0, 2), [['b', 'Away'], ['a', 'Draw']], 'best edge first; live matches left out');
  assert.equal(rows.length, 6);
  assert.equal(+rows[0].edge.toFixed(3), 0.042);
  const away = rows.find((r) => r.event.id === 'a' && r.pick === 'Away'), home = rows.find((r) => r.event.id === 'a' && r.pick === 'Home');
  assert.ok(away.edgePow < away.edge && home.edgePow > home.edge, 'the long price looks less good, the favourite better, once the margin comes off the long prices');
  assert.equal(rows.find((r) => r.event.id === 'b').edgePow, undefined, 'no Pinnacle prices held: no power figure');
});

test('value at Stake runs to long prices, with a higher bar the longer the price; the lower of the two fair chances; data errors left out', () => {
  const now = Date.now();
  const event = (id, outcomes, extra = {}) => ({ id, sport: 'football', leaguePath: 'soccer/esp.1', compId: id, home: 'Home', away: 'Away', start: now + 5 * H, live: false, stakeAt: now - H, sharpAt: now - 2 * H,
    markets: [{ name: 'Match Result', consensusFrom: 'Pinnacle', outcomes }], ...extra });
  // Pinnacle 1.62 / 4.10 / 6.20 (fair, margin split evenly: 0.5956 / 0.2353 / 0.1556).
  const pin = (o) => o.map(([name, odds, cons, pinP, stake]) => ({ name, odds, cons, pin: pinP, ...(stake ? { stake } : {}) }));
  const v = valueBets([
    // The draw (23.5%) at Stake 4.70: +10.6% against the fair odds; the bar at a 23.5% chance is 3.3%.
    event('draw', pin([['Home', 1.6, 0.5956, 1.62], ['Draw', 4.3, 0.2353, 4.1, 4.7], ['Away', 6.0, 0.1556, 6.2]])),
    // The away side (15.4-15.6%) at Stake 6.60: +1.8% by the power method, under the 4.9% bar for that chance.
    event('dog', pin([['Home', 1.6, 0.5956, 1.62], ['Draw', 4.0, 0.2353, 4.1], ['Away', 6.0, 0.1556, 6.2, 6.6]])),
    // The same draw at the board's own book (not Stake): outside the 30%+ range other books keep.
    event('book', pin([['Home', 1.6, 0.5956, 1.62], ['Draw', 4.7, 0.2353, 4.1], ['Away', 6.0, 0.1556, 6.2]])),
    // A draw at 9.80 against fair odds of 7.01 is no value bet: another match, or a stale price.
    event('error', [{ name: 'Home', odds: 1.3, cons: 0.74 }, { name: 'Draw', odds: 6.5, cons: 0.1427, stake: 9.8 }, { name: 'Away', odds: 9, cons: 0.1173 }]),
  ], { limit: 10 });
  assert.deepEqual(v.map((b) => [b.event.id, b.pick, b.odds, b.book]), [['draw', 'Draw', 4.7, 'Stake']]);
  // Power method on Pinnacle's prices: 0.6101 / 0.2357 / 0.1543. The draw's two figures are 0.2353 and
  // 0.2357: the lower is the one used; the away side's power figure (0.1543) is the lower of its two.
  assert.equal(+v[0].edge.toFixed(4), +(4.7 * 0.2353 - 1).toFixed(4));
  assert.equal(v[0].fairPow, 0.2357);
  assert.ok(v[0].takeAt > 4.1 && v[0].takeAt < 4.7, String(v[0].takeAt));
});

test('nearest misses when the lists are empty: Stake\'s prices nearest the value bar and the likeliest winners nearest a fair price, never as picks', async () => {
  const { nearBest, nearValue, bestBets } = await import('../js/track.js');
  const now = Date.now();
  const ev = (id, outcomes) => ({ id, compId: id, sport: 'football', leaguePath: 'soccer/ita.1', home: outcomes[0].name, away: outcomes[2].name, start: now + 6 * H, stakeAt: now - H, sharpAt: now - 2 * H, fetchedAt: now - 6e4,
    markets: [{ name: 'Match Result', consensusFrom: 'Pinnacle', outcomes }] });
  const board = [
    ev('a', [{ name: 'Inter', odds: 1.32, cons: 0.7143, stake: 1.34 }, { name: 'Draw', odds: 5.25, cons: 0.1665, stake: 5.6 }, { name: 'Fiorentina', odds: 7, cons: 0.1192, stake: 8 }]),
    ev('b', [{ name: 'Lecce', odds: 6.5, cons: 0.1288, stake: 6.6 }, { name: 'Draw', odds: 4.1, cons: 0.2316, stake: 4.5 }, { name: 'Juventus', odds: 1.45, cons: 0.6396, stake: 1.42 }]),
  ];
  assert.equal(bestBets(board).length, 0);
  const nb = nearBest(board);
  // Inter at Stake's 1.34 (4.3% under the fair 1.40) is nearer than Juventus at the board's 1.45 (7.3% under).
  assert.deepEqual(nb.map((b) => [b.pick, b.odds, Boolean(b.atStake)]), [['Inter', 1.34, true], ['Juventus', 1.45, false]]);
  assert.ok(nb.every((b) => b.near && b.ev < 0), 'each shows what it costs');
  // The Lecce draw at Stake (+4.2% against the 3.4% it needs) is a value bet, so it is not a miss.
  const { valueBets } = await import('../js/track.js');
  assert.deepEqual(valueBets(board).map((b) => [b.event.id, b.pick]), [['b', 'Draw']]);
  const nv = nearValue(board);
  assert.ok(nv.length && !nv.some((b) => b.event.id === 'b' && b.pick === 'Draw'));
  assert.ok(nv.every((b) => b.atStake && b.odds === b.stake && Number.isFinite(b.need) && b.why && b.priceNeeded > b.odds), 'each says why and the price it needs');
});
