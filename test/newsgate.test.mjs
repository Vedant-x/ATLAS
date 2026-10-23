import test from 'node:test';
import assert from 'node:assert/strict';
import { newsHold, pendingNews } from '../js/newsgate.js';
import { rankedBankers, valueBets } from '../js/track.js';
import { legPool } from '../js/picks.js';

const now = Date.now(), M = 6e4;
const nba = (id, inMin, extra = {}) => ({ id, sport: 'basketball', leaguePath: 'basketball/nba', compId: id, home: 'Celtics', away: 'Knicks', start: now + inMin * M, live: false,
  markets: [{ name: 'Winner', consensusFrom: 'Pinnacle', outcomes: [{ name: 'Celtics', odds: 1.5, cons: 0.7 }, { name: 'Knicks', odds: 2.8, cons: 0.3 }] }], ...extra });

test('NBA picks come hours ahead, but not while a key player is unresolved', () => {
  assert.equal(newsHold(nba('a', 8 * 60)), false); // eight hours out: fine (bet the evening before)
  assert.equal(newsHold(nba('c', 8 * 60, { newsPending: ['Jayson Tatum'] })), true);
  assert.equal(newsHold({ ...nba('d', 240, { newsPending: ['X'] }), leaguePath: 'soccer/eng.1' }), false); // NBA only
  const evs = [nba('ready', 8 * 60), nba('waiting', 8 * 60, { newsPending: ['Jayson Tatum'] })];
  const ids = (l) => l.map((b) => b.event?.id ?? b.eventId);
  assert.deepEqual(ids(rankedBankers(evs, { min: 0.55, minOdds: 1.2, maxOdds: 2.5 })), ['ready']);
  assert.deepEqual(ids(valueBets(evs.map((e) => ({ ...e, markets: [{ ...e.markets[0], outcomes: [{ name: 'Celtics', odds: 1.5, cons: 0.7 }, { name: 'Knicks', odds: 3.5, cons: 0.3 }] }] })))), ['ready']);
  assert.deepEqual(ids(legPool(evs, { minP: 0.5, maxOdds: 2 })), ['ready']);
});

test('only a key player (a team leader) who is questionable or day-to-day holds the game', () => {
  const inj = { home: [{ id: '1', name: 'Star', status: 'Day-To-Day' }, { id: '2', name: 'Bench', status: 'Questionable' }], away: [{ id: '3', name: 'Other star', status: 'Out' }] };
  assert.deepEqual(pendingNews(inj, new Set(['1', '3'])), ['Star']); // ruled out is settled news: the price has it
});
