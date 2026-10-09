import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLeague, leagueStatus } from '../js/espn.js';

const ymd = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10).replaceAll('-', '');
const game = (id, day, state = 'pre') => ({ id, date: new Date(Date.now() + day * 864e5).toISOString(), competitions: [{ id, date: new Date(Date.now() + day * 864e5).toISOString(), status: { type: { state } }, competitors: [{ homeAway: 'home', team: { displayName: `H${id}` } }, { homeAway: 'away', team: { displayName: `A${id}` } }] }] });

// Behaves like ESPN since Oct 2026: multi-day ranges are rejected, single days and the plain board work.
function fakeEspn({ failDay } = {}) {
  return async (url) => {
    const q = new URL(url).searchParams.get('dates');
    if (q && q.includes('-')) return new Response('{}', { status: 400 });
    if (q && q === failDay) return new Response('{}', { status: 500 });
    const byDay = { [ymd(-1)]: [game('1', -1, 'post')], [ymd(0)]: [game('2', 0, 'in'), game('3', 0.2)], [ymd(2)]: [game('4', 2)] };
    const events = q ? byDay[q] || [] : [game('2', 0, 'in')]; // plain board = current matchday only
    return new Response(JSON.stringify({ events }), { status: 200 });
  };
}

test('every day of the window is fetched separately and merged (no range requests)', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = fakeEspn();
  try {
    const list = await fetchLeague({ path: 'soccer/uefa.nations', name: 'Nations League', sport: 'football' }, { days: 4 });
    assert.deepEqual(list.map((e) => e.id.split('-').pop()).sort(), ['2', '3', '4']); // finished game 1 dropped, day+2 game found
    assert.equal(leagueStatus.get('soccer/uefa.nations').ok, true);
  } finally { globalThis.fetch = real; }
});

test('a league with a failed day is not marked as loaded, so pages never claim "no fixtures"', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = fakeEspn({ failDay: ymd(2) });
  try {
    await fetchLeague({ path: 'soccer/x.test', name: 'X', sport: 'football' }, { days: 4 });
    assert.equal(leagueStatus.get('soccer/x.test').ok, false);
  } finally { globalThis.fetch = real; }
});

test('a league split into divisions (college football FBS + FCS) fetches both and merges them', async () => {
  const { fetchLeague } = await import('../js/espn.js');
  const seen = [];
  const game = (id, home, away) => ({ id, date: new Date(Date.now() + 864e5).toISOString(), competitions: [{ id, date: new Date(Date.now() + 864e5).toISOString(), status: { type: { state: 'pre' } },
    competitors: [{ homeAway: 'home', team: { displayName: home } }, { homeAway: 'away', team: { displayName: away } }] }] });
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => { seen.push(String(u)); const fcs = /groups=81/.test(u); return { ok: true, status: 200, json: async () => ({ events: fcs ? [game('2', 'Montana', 'Idaho'), game('1', 'Ohio State', 'Youngstown State')] : [game('1', 'Ohio State', 'Youngstown State')] }) }; };
  try {
    const list = await fetchLeague({ path: 'football/college-football', name: 'NCAA Football', sport: 'americanfootball', also: ['groups=81'] }, { days: 0, from: 0 });
    assert.ok(seen.some((u) => /scoreboard\?dates=\d{8}&groups=81$/.test(u)) && seen.some((u) => /scoreboard\?dates=\d{8}$/.test(u)), 'both divisions requested');
    assert.deepEqual(list.map((e) => e.home).sort(), ['Montana', 'Ohio State'], 'merged, the shared game once');
  } finally { globalThis.fetch = real; }
});
