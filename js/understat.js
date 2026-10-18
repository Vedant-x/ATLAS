// Expected goals from Understat (understat.com) for the five big European leagues: for every team,
// each match's xG (chances created) and xGA (chances conceded), so the analysis can say whether a
// side's results match the chances it makes, not just its goals. The league page embeds the data as
//   var teamsData = JSON.parse('\x7B\x22...')
// (a hex-escaped JSON string); anything unreadable gives no xG rather than wrong numbers.
import { normClub } from './clubelo.js';

export const UNDERSTAT = { 'soccer/eng.1': 'EPL', 'soccer/esp.1': 'La_liga', 'soccer/ger.1': 'Bundesliga', 'soccer/ita.1': 'Serie_A', 'soccer/fra.1': 'Ligue_1' };
export const understatUrl = (league, season) => `https://understat.com/league/${league}/${season}`;
// The site now loads its data separately; this is the request its league page makes.
export const understatData = (league, season) => `https://understat.com/getLeagueData/${league}/${season}`;
// The JSON answer: { teams: { id: { title, history } }, ... } (the same shape teamsData has).
export const teamsFromJson = (j) => (j && typeof j === 'object' && j.teams && typeof j.teams === 'object' ? j.teams : null);

export function teamsData(html) {
  const m = /var\s+teamsData\s*=\s*JSON\.parse\('([^']*)'\)/.exec(String(html || ''));
  if (!m) return null;
  try { return JSON.parse(m[1].replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))); } catch { return null; }
}

// Per team: season and last-6 xG for / against per match, and goals for / against to compare.
export function xgTable(data) {
  const out = new Map();
  for (const t of Object.values(data || {})) {
    const h = (t.history || []).filter((g) => Number.isFinite(Number(g.xG)));
    if (!h.length) continue;
    const avg = (list, k) => list.reduce((a, g) => a + Number(g[k]), 0) / list.length;
    const last = h.slice(-6);
    out.set(normClub(t.title), { team: t.title, n: h.length, xgf: avg(h, 'xG'), xga: avg(h, 'xGA'), gf: avg(h, 'scored'), ga: avg(h, 'missed'), xgf6: avg(last, 'xG'), xga6: avg(last, 'xGA') });
  }
  return out;
}

const ALIAS = { 'paris saint germain': 'paris saint germain', 'borussia monchengladbach': 'borussia m gladbach', 'internazionale': 'inter', 'inter milan': 'inter', 'ac milan': 'ac milan', 'wolverhampton wanderers': 'wolverhampton wanderers', 'atletico madrid': 'atletico madrid', 'athletic club': 'athletic club' };
export function findXg(table, name) {
  const n = normClub(name);
  if (table.has(n)) return table.get(n);
  if (ALIAS[n] && table.has(normClub(ALIAS[n]))) return table.get(normClub(ALIAS[n]));
  const w = n.split(' ');
  const hits = [...table.entries()].filter(([k]) => { const kw = k.split(' '); const [s, l] = kw.length <= w.length ? [kw, new Set(w)] : [w, new Set(kw)]; return s.every((x) => l.has(x)); });
  return hits.length === 1 ? hits[0][1] : null;
}

// xG onto upcoming matches in those leagues. Returns how many got it for both sides.
export function applyXg(events, tables) {
  let n = 0;
  for (const e of events) {
    const t = tables.get(e.leaguePath);
    if (!t || e.live) continue;
    const h = findXg(t, e.home), a = findXg(t, e.away);
    if (!h || !a) continue;
    e.xg = { home: h, away: a, source: 'Understat' };
    n++;
  }
  return n;
}
