import test from 'node:test';import assert from 'node:assert/strict';
test('multiplier slips can be limited to matches still to start today (IST calendar day)', async () => {
  const { todayEvents, localDay } = await import('../js/engine.js');
  const ist = (d, h, m = 0) => Date.UTC(2026, 9, d, h, m) - 330 * 60000; // h:m IST on 2026-10-d
  const now = ist(2, 15); // 3pm IST
  const evs = [
    { id: 'a', start: ist(2, 18) },
    { id: 'b', start: ist(2, 23, 30) },
    { id: 'c', start: ist(3, 1) }, // tomorrow in IST (still Oct 2 in UTC)
    { id: 'd', start: ist(2, 13) }, // already started
    { id: 'e', start: ist(2, 14), live: true },
  ];
  assert.deepEqual(todayEvents(evs, now).map((e) => e.id), ['a', 'b']);
  assert.equal(localDay(ist(2, 18)), '2026-10-02');
  assert.equal(localDay(ist(3, 0, 10)), '2026-10-03');
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
  assert.deepEqual(sing.tennis.home, { id: 'a1', country: 'Italy', seed: 1 });
  assert.equal(dbl.home, 'Zhang Zhizhen / Zhou Yi');
  assert.equal(dbl.tennis.draw, 'Doubles');
  assert.equal(dbl.tennis.away.country, 'Great Britain');
});

test('tennis model uses ranking points, ranks, or a single ranking', async () => {
  const { tennisRankWin, analyse } = await import('../js/models.js');
  const top = tennisRankWin({ home: { rank: 1, points: 11000 }, away: { rank: 50, points: 1200 } });
  assert.ok(top.p > 0.85 && top.p < 0.92, `got ${top.p}`);
  assert.ok(Math.abs(tennisRankWin({ home: { rank: 10 }, away: { rank: 10 } }).p - 0.5) < 1e-9);
  assert.ok(tennisRankWin({ home: {}, away: { rank: 80 } }).p < 0.5);
  assert.equal(tennisRankWin({ home: {}, away: {} }), null);
  const a = analyse({ sport: 'tennis', home: 'Sinner', away: 'Halys', markets: [], stats: {}, tennis: { home: { rank: 1, points: 11000 }, away: { rank: 60, points: 1000 } } });
  assert.ok(a.win.home > 0.85 && /ranking/.test(a.basis));
});

test('soccer absences carry the injury name', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true,
    text: async () => '<script>{"injury_14":"Knee injury","injury_87":"Muscle injury"}</script>',
    json: async () => (String(url).includes('matchDetails')
      ? { content: { lineup: { homeTeam: { unavailable: [{ id: 5, name: 'A', unavailability: { type: 'injury', injuryId: 87, expectedReturn: 'Mid October 2026' } }] }, awayTeam: { unavailable: [{ id: 6, name: 'B', unavailability: { type: 'suspension' } }] } } } }
      : { leagues: [{ name: 'L', matches: [{ id: 1, home: { name: 'Aston Villa' }, away: { name: 'Burnley' }, status: { utcTime: '2026-10-10T14:00:00Z' } }] }] }) });
  try {
    const { absencesFor } = await import('../js/fotmob.js?names');
    const a = await absencesFor({ home: 'Aston Villa', away: 'Burnley', start: Date.parse('2026-10-10T14:00:00Z') });
    assert.equal(a.home[0].injury, 'Muscle injury');
    assert.equal(a.away[0].type, 'Suspended');
  } finally { globalThis.fetch = real; }
});
