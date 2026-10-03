import test from 'node:test';import assert from 'node:assert/strict';
test('multiplier slips can be limited to matches still to start today', async () => {
  const { todayEvents, localDay } = await import('../js/engine.js');
  const now = new Date(2026, 9, 2, 15, 0).getTime(); // 3pm local
  const at = (h) => new Date(2026, 9, 2, h, 0).getTime();
  const evs = [
    { id: 'a', start: at(18) },
    { id: 'b', start: at(23) },
    { id: 'c', start: new Date(2026, 9, 3, 1, 0).getTime() }, // tomorrow
    { id: 'd', start: at(13) }, // already started
    { id: 'e', start: at(14), live: true },
  ];
  assert.deepEqual(todayEvents(evs, now).map((e) => e.id), ['a', 'b']);
  assert.equal(localDay(at(18)), localDay(now));
});

test('tennis: draws split by tour, doubles pairs named, tournament/location/round/court kept', async () => {
  const { parseScoreboard } = await import('../js/espn.js');
  const { tennisBoard } = await import('./fixtures/tennis.mjs');
  const atp = parseScoreboard(tennisBoard, { path: 'tennis/atp', sport: 'tennis', name: 'ATP Tour' });
  const wta = parseScoreboard(tennisBoard, { path: 'tennis/wta', sport: 'tennis', name: 'WTA Tour' });
  assert.deepEqual(atp.map((e) => e.tennis.drawName), ["Men's Singles", "Men's Doubles"]);
  assert.deepEqual(wta.map((e) => e.tennis.drawName), ["Women's Singles"]); // TBD v TBD slot skipped
  const [sing, dbl] = atp;
  assert.equal(sing.home, 'Jannik Sinner');
  assert.deepEqual([sing.tennis.tournament, sing.tennis.location, sing.tennis.round, sing.tennis.court, sing.tennis.bestOf, sing.tennis.draw], ['China Open', 'Beijing, China PR', 'Round 2', 'Diamond', 3, 'Singles']);
  assert.deepEqual(sing.tennis.home, { country: 'Italy', seed: 1 });
  assert.equal(dbl.home, 'Zhang Zhizhen / Zhou Yi');
  assert.equal(dbl.tennis.draw, 'Doubles');
  assert.equal(dbl.tennis.away.country, 'Great Britain');
});
