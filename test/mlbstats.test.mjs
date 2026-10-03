import { test } from 'node:test';
import assert from 'node:assert/strict';
import { line, formOf, enrichMlb } from '../js/mlbstats.js';

test('pitching line keeps rates and derives per-start pitch count', () => {
  const l = line({ gamesPitched: 31, gamesStarted: 31, inningsPitched: '187.2', era: '2.98', whip: '1.04', strikeOuts: 211, baseOnBalls: 44, homeRuns: 19, numberOfPitches: 3007, strikeoutsPer9Inn: '10.12' });
  assert.equal(l.k9, '10.12');
  assert.equal(l.bb9, '2.11'); // derived: 44 * 27 / 563 outs
  assert.equal(l.ppStart, 97);
});

test('form over recent starts uses thirds of an inning', () => {
  const f = formOf([{ ip: '6.1', er: 1, h: 4, bb: 1, so: 8 }, { ip: '5.2', er: 3, h: 6, bb: 2, so: 5 }]);
  assert.deepEqual(f, { games: 2, ip: '12.0', era: '3.00', whip: '1.08', k9: '9.75' });
});

test('MLB games missing from ESPN are added from the schedule and get starter reports', async () => {
  const start = Date.now() + 5 * 36e5;
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => {
    const u = String(url);
    if (u.includes('/schedule')) return { dates: [{ games: [{ gamePk: 9, gameDate: new Date(start).toISOString(), gameType: 'D', seriesDescription: 'Division Series', status: { abstractGameState: 'Preview' }, venue: { name: 'Tropicana Field' },
      teams: { home: { team: { id: 139, name: 'Tampa Bay Rays' }, probablePitcher: { id: 1, fullName: 'Drew Rasmussen' } }, away: { team: { id: 147, name: 'New York Yankees' }, probablePitcher: { id: 2, fullName: 'Gerrit Cole' } } } }] }] };
    if (u.includes('/stats?stats=season,career')) return { stats: [{ type: { displayName: 'season' }, splits: [{ stat: { era: '2.67', inningsPitched: '150.0', gamesStarted: 27 } }] },
      { type: { displayName: 'gameLog' }, splits: [{ date: '2026-09-27', isHome: true, opponent: { name: 'Boston Red Sox' }, stat: { gamesStarted: 1, wins: 1, inningsPitched: '7.0', earnedRuns: 1, hits: 3, baseOnBalls: 0, strikeOuts: 9 } }] }] };
    if (u.includes('vsTeamTotal')) return { stats: [{ splits: [{ stat: { gamesPlayed: 5, avg: '.180', ops: '.520' } }] }] };
    if (u.includes('/transactions')) return { transactions: [{ date: '2025-05-01', typeDesc: 'Status Change', description: 'placed on the 15-day injured list' }] };
    if (u.includes('/people/')) return { people: [{ fullName: u.includes('/people/1') ? 'Drew Rasmussen' : 'Gerrit Cole', pitchHand: { code: 'R' }, currentAge: 31 }] };
    return {};
  } });
  try {
    const events = [];
    const n = await enrichMlb(events, { addMissing: true });
    assert.equal(n, 2);
    assert.equal(events.length, 1);
    const [e] = events;
    assert.equal(e.note, 'Division Series');
    const home = e.probables.find((p) => p.side === 'home').report;
    assert.equal(home.season.era, '2.67');
    assert.equal(home.vsOpp.avg, '.180');
    assert.equal(home.recent[0].result, 'W');
    assert.equal(home.injuries.length, 1);
    assert.equal(home.throws, 'R');
  } finally { globalThis.fetch = real; }
});
