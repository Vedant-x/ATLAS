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
  assert.deepEqual(fixtureSides(fixture({ startTime: new Date(t).toISOString() })), { home: 'Arsenal', away: 'Chelsea', start: t });
  assert.deepEqual(fixtureSides({ participants: [{ name: 'A' }, { name: 'B' }], startTimestamp: Math.round(t / 1000) }), { home: 'A', away: 'B', start: Math.round(t / 1000) * 1000 });
  assert.deepEqual(fixtureSides({}), { home: null, away: null, start: null });
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
  const event = (id, outcomes, extra = {}) => ({ id, sport: 'football', leaguePath: 'soccer/eng.1', compId: id, home: 'Home', away: 'Away', start: Date.now() + 5 * H, live: false, markets: mk(outcomes), oddsSource: 'espn', stakeAt: Date.now() - H, ...extra });
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
