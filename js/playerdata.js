// Player game logs (data/players.json, written by the build), shared by the player research page and
// the slip analyser. Loaded on demand and kept current: re-fetched once it is 10 minutes old (the
// build runs about every 20), the last good copy kept if a re-fetch fails, and a failed first load
// retried after a minute (or at once with retryPlayers). The file carries its own build time.
import { GAMELOG_KEYS } from './props.js';

const FRESH = 10 * 6e4, RETRY = 6e4;
let data = null, loading = null;
const meta = { updatedAt: null, loadedAt: 0, failedAt: 0 };
const waiting = new Set();
const notify = () => { const fs = [...waiting]; waiting.clear(); fs.forEach((f) => f()); };

export function loadPlayers(refresh) {
  if (refresh) waiting.add(refresh);
  const now = Date.now();
  const due = data ? now - meta.loadedAt > FRESH : now - meta.failedAt > RETRY;
  if (!loading && due) {
    loading = fetch(`data/players.json?t=${Math.floor(now / 6e4)}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => {
        const players = j && typeof j === 'object' && j.players ? j.players : j;
        const changed = !data || (j.updatedAt ?? null) !== meta.updatedAt;
        data = players || {};
        meta.updatedAt = j.updatedAt ?? null;
        meta.loadedAt = Date.now();
        meta.failedAt = 0;
        if (changed) notify(); else waiting.clear();
      })
      .catch(() => { meta.failedAt = Date.now(); if (!data) notify(); })
      .finally(() => { loading = null; });
  }
  return data;
}
export const playersData = () => data;
// { updatedAt (build time of the logs), loadedAt, failed (no copy at all after a failed load) }
export const playersMeta = () => ({ updatedAt: meta.updatedAt, loadedAt: meta.loadedAt, failed: !data && meta.failedAt > 0, loading: Boolean(loading) });
export function retryPlayers(refresh) { meta.failedAt = 0; return loadPlayers(refresh); }

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
// Share of a player's games that carry the minutes / at-bats column (filters need most of them).
export const opportunityCoverage = (p) => (p?.g?.length ? p.g.filter((g) => g[5] != null).length / p.g.length : 0);
