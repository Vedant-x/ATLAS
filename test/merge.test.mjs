import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeEvent, mergeProbables, samePerson, overlayLive } from '../js/merge.js';

const report = { name: 'Gerrit Cole', season: { era: '3.61' } };

test('a live refresh keeps starter reports, absences and lineups', () => {
  const old = { id: 'm', score: null, probables: [{ side: 'home', name: 'Gerrit Cole', role: 'SP', report }, { side: 'away', name: 'Drew Rasmussen', role: 'SP', report: { name: 'Drew Rasmussen' } }], absences: { home: [{ name: 'Judge' }], away: [] }, predictor: { home: 0.6, away: 0.4 } };
  const fresh = { id: 'm', score: '1 – 0', live: true, probables: [{ side: 'home', id: '32081', name: 'Gerrit Cole', role: 'Probable Starter' }, { side: 'away', id: '9', name: 'Drew Rasmussen' }] };
  const m = mergeEvent(old, fresh);
  assert.equal(m.score, '1 – 0');
  assert.equal(m.probables.find((p) => p.side === 'home').report, report);
  assert.ok(m.probables.find((p) => p.side === 'away').report);
  assert.deepEqual(m.absences, old.absences);
  assert.deepEqual(m.predictor, old.predictor);
});

test('a starter change drops the old report; a feed without starters keeps ours', () => {
  const old = [{ side: 'home', name: 'Gerrit Cole', report }];
  const changed = mergeProbables(old, [{ side: 'home', name: 'Cam Schlittler' }]);
  assert.equal(changed[0].report, undefined);
  assert.equal(changed[0].changedFrom, 'Gerrit Cole');
  assert.equal(mergeProbables(old, [])[0].report, report);
  assert.ok(samePerson('Cole, Gerrit', 'Gerrit Cole') && samePerson('José Ramírez Jr.', 'Jose Ramirez') && !samePerson('Will Smith', 'Joe Smith'));
});

test('a snapshot reload never rolls back a fresher live score or revives a finished game', () => {
  const now = Date.now();
  const snap = [
    { id: 'a', leaguePath: 'x', start: now - 36e5, live: true, score: '0 – 0', fetchedAt: now - 3 * 36e5, probables: [{ side: 'home', report }] },
    { id: 'b', leaguePath: 'x', start: now - 3 * 36e5, live: true, score: '2 – 2', fetchedAt: now - 3 * 36e5 }, // finished since
    { id: 'c', leaguePath: 'x', start: now + 36e5, live: false, fetchedAt: now - 3 * 36e5 },
  ];
  const cur = [{ id: 'a', leaguePath: 'x', start: now - 36e5, live: true, score: '2 – 1', fetchedAt: now - 5e3 }, { id: 'c', leaguePath: 'x', start: now + 36e5, fetchedAt: now - 5e3 }];
  const out = overlayLive(snap, cur);
  assert.deepEqual(out.map((e) => e.id), ['a', 'c']);
  assert.equal(out[0].score, '2 – 1');
  assert.equal(out[0].probables[0].report, report); // snapshot enrichments kept
});

test('a live refresh keeps the build\'s additions to each price (sharp fair chance, Stake\'s price): the value bet survives it', async () => {
  const { valueBets } = await import('../js/track.js');
  const now = Date.now();
  // The build's copy: DraftKings' price with Pinnacle's fair chance and Stake's price on each outcome.
  const built = { id: 'lec-juv', compId: '1', sport: 'football', leaguePath: 'soccer/ita.1', home: 'Lecce', away: 'Juventus', start: now + 12 * 36e5, live: false, bookmaker: 'DraftKings',
    sharpAt: now - 4 * 36e5, stakeAt: now - 3 * 36e5, fetchedAt: now - 6e5,
    markets: [{ name: 'Match Result', consensusFrom: 'Pinnacle', outcomes: [
      { name: 'Lecce', odds: 6.5, cons: 0.1288, pin: 7.3, stake: 6.6, open: 6.5, book: 'DraftKings' },
      { name: 'Draw', odds: 4.1, cons: 0.2316, pin: 4.15, stake: 4.7, open: 4.1, book: 'DraftKings' },
      { name: 'Juventus', odds: 1.45, cons: 0.6396, pin: 1.5, stake: 1.4, open: 1.45, book: 'DraftKings' }] }] };
  // ESPN's scoreboard 30 seconds later: DraftKings' price only, one number moved.
  const espn = { id: 'lec-juv', live: false, bookmaker: 'DraftKings', fetchedAt: now, markets: [{ name: 'Match Result', outcomes: [{ name: 'Lecce', odds: 6.5 }, { name: 'Draw', odds: 4.2 }, { name: 'Juventus', odds: 1.45 }] }] };
  const m = mergeEvent(built, espn);
  const draw = m.markets[0].outcomes[1];
  assert.deepEqual([draw.odds, draw.cons, draw.stake, draw.pin, draw.open, m.markets[0].consensusFrom], [4.2, 0.2316, 4.7, 4.15, 4.1, 'Pinnacle']);
  assert.deepEqual(valueBets([m]).map((b) => [b.pick, b.odds, b.book]), [['Draw', 4.7, 'Stake']], 'the value bet the build found is still there');
  // A scoreboard with no price (dropped near kick-off) keeps the build's; a live match takes the feed's.
  assert.equal(mergeEvent(built, { ...espn, markets: [] }).markets[0].outcomes[1].stake, 4.7);
  assert.deepEqual(mergeEvent(built, { ...espn, live: true, markets: [] }).markets, []);
  // A match the build priced from many bookmakers keeps its best price and consensus whole.
  const shopped = { ...built, oddsSource: 'the-odds-api', bookmaker: 'best of 14 bookmakers; fair chance from Pinnacle', quoteType: 'best-available' };
  const s = mergeEvent(shopped, { ...espn, bookmaker: null });
  assert.deepEqual([s.markets, s.bookmaker, s.oddsSource], [shopped.markets, shopped.bookmaker, 'the-odds-api']);
  // A snapshot reload: the page's newer numbers on the snapshot's newer additions (a new Stake read).
  const snap = { ...built, fetchedAt: now - 6e4, markets: [{ ...built.markets[0], outcomes: built.markets[0].outcomes.map((o) => ({ ...o, stake: o.name === 'Draw' ? 4.6 : o.stake })) }] };
  const [o] = overlayLive([snap], [m]);
  assert.deepEqual([o.markets[0].outcomes[1].odds, o.markets[0].outcomes[1].stake], [4.2, 4.6]);
});
