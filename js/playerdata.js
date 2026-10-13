// Player game logs (data/players.json, written by the build), shared by the player research page and
// the slip analyser. Loaded once, on demand.
import { GAMELOG_KEYS } from './props.js';

let data = null, loading = null;
const waiting = new Set();
export function loadPlayers(refresh) {
  if (refresh) waiting.add(refresh);
  if (data || loading) return data;
  loading = fetch(`data/players.json?t=${Math.floor(Date.now() / 6e5)}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    .then((j) => { data = j; loading = null; waiting.forEach((f) => f()); waiting.clear(); });
  return null;
}
export const playersData = () => data;

// Per game: [date, opp abbr, opp id, home 1/0/-1, this season 1/0, minutes or at-bats, game id,
// team id, ...stat columns]. As rows the prop model reads (newest first).
const OFF = 8;
const cache = new WeakMap();
export function rowsOf(p) {
  if (!p) return [];
  if (cache.has(p)) return cache.get(p);
  const rows = p.g.map((g) => {
    const r = {};
    p.c.forEach((c, i) => { if (g[OFF + i] != null) r[c] = g[OFF + i]; });
    Object.defineProperties(r, {
      _date: { value: g[0] }, _oppAbbr: { value: g[1] }, _opp: { value: g[2] }, _home: { value: g[3] === 1 ? true : g[3] === 0 ? false : null },
      _season: { value: g[4] === 1 }, _played: { value: g[5] }, _ev: { value: g[6] || null }, _team: { value: g[7] || null },
    });
    return r;
  });
  cache.set(p, rows);
  return rows;
}
export const valueOf = (sport, type, r) => {
  const keys = GAMELOG_KEYS[sport]?.[type];
  return keys && keys.every((k) => Number.isFinite(r[k])) ? keys.reduce((s, k) => s + r[k], 0) : null;
};
