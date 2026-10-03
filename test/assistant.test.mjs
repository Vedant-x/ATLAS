import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrain } from '../js/assistant/brain.js';

// Stub knowledge layer: records which data each question asks for.
const e = { id: 'm1', sport: 'basketball', league: 'NBA', leaguePath: 'basketball/nba', home: 'Boston Celtics', away: 'Miami Heat', start: Date.now() + 36e5 };
const calls = [];
const K = {
  norm: (s) => String(s).toLowerCase(),
  currentEvent: () => null, currentScope: () => ({}),
  sportIn: (q) => (/nba|basketball/.test(q) ? 'basketball' : null), leagueIn: (q) => (/nba/.test(q) ? 'basketball/nba' : null),
  eventsIn: (q) => (/celtics|heat/.test(q) ? [e] : []),
  filterEvents: () => [e],
  picks: (o) => { calls.push(['picks', o]); return [{ e, market: 'Winner', pick: 'Boston Celtics', odds: 1.5, p: 0.64, ev: -0.04, priced: true }]; },
  matchSummary: () => ({ winProbability: { home: 0.64, away: 0.36 }, basis: 'Bookmaker price, margin removed', bestPrices: [{ market: 'Winner', pick: 'Boston Celtics', odds: 1.5, probability: 0.64, edge: -0.04, priced: true }], starters: [] }),
  injuriesOf: async () => ({ covered: true, source: 'ESPN', home: [{ name: 'Jayson Tatum', status: 'Out', detail: 'Right Achilles', back: null }], away: [] }),
  startersOf: () => [], slips: (t) => { calls.push(['slips', t]); return [{ odds: 3.02, p: 0.31, legs: [{ pick: 'X', market: 'Winner', match: 'A vs B', odds: 1.74, p: 0.56, eventId: 'm1' }] }]; },
};
const brain = createBrain(K);

test('assistant routes questions to the right data', async () => {
  calls.length = 0;
  await brain.answer('give me 3 safe NBA bets today');
  assert.deepEqual(calls[0], ['picks', { league: 'basketball/nba', sport: 'basketball', leagueName: 'NBA', sportName: 'basketball', today: true, mode: 'safe', limit: 3 }]);
  const inj = await brain.answer('injuries Celtics vs Heat');
  assert.match(inj.text, /Jayson Tatum.*Right Achilles/);
  await brain.answer('make me a 3x slip');
  assert.deepEqual(calls.at(-1), ['slips', 3]);
  const who = await brain.answer('who wins celtics heat');
  assert.match(who.text, /Boston Celtics \*\*64%\*\*/);
  assert.match((await brain.answer('hello')).text, /best bets today/);
});
