// Build source (run by scripts/pages.mjs): player data the review found missing (item 21).
//  - NBA starting lineups: the NBA's daily lineups feed (js/nbalineups.js).
//  - Esports rosters: each team's players with bo3.gg's six-month rating (js/esports.js).
//  - Tennis serve and return: the WTA's own figures, Ultimate Tennis Statistics for the men, and the
//    point-by-point match chance from both players' numbers (js/tennisstats.js).
//  - Cricket squads: both sides' players, roles and styles from ESPN's match summary (js/cricket.js).
// Each keeps what it read in data/players.json for a day, read back from the live site, so a build
// makes only the reads that are due, and a source that fails keeps the last good copy.
import { out, get, log, noteSource } from '../lib.mjs';
import { writeFile } from 'node:fs/promises';
import { LINEUPS_URL, LINEUP_HEADERS, parseLineups, applyLineups } from '../../js/nbalineups.js';
import { TEAM_URL, rosterOf, applyRosters } from '../../js/esports.js';
import { WTA_RANKED, WTA_YEAR, wtaIds, wtaStats, nameKey, matchModel } from '../../js/tennisstats.js';
import { CRICKET_SUMMARY, squadsOf } from '../../js/cricket.js';

const DAY = 864e5;
const getJson = async (u, opt) => JSON.parse(await get(u, opt));
const etDay = (off = 0) => new Date(Date.now() + off * DAY).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

async function nbaLineups(events) {
  const games = [];
  let read = 0;
  for (const d of [etDay(0), etDay(1)]) {
    try { games.push(...parseLineups(await getJson(LINEUPS_URL(d), { headers: LINEUP_HEADERS }))); read++; } catch { /* tomorrow's file not out yet */ }
  }
  const n = applyLineups(events, games);
  const confirmed = events.filter((e) => e.nbaLineups?.home.confirmed && e.nbaLineups?.away.confirmed).length;
  log(`NBA starting lineups (stats.nba.com): ${games.length} games in ${read} day file(s); ${n} games here with both starting fives (${confirmed} confirmed by both teams, the rest the NBA's expected lineups)`);
  if (events.some((e) => e.leaguePath === 'basketball/nba' && e.start > Date.now() && e.start < Date.now() + DAY)) noteSource('NBA starting lineups', 'stats.nba.com', "The NBA's own starting fives: expected, then confirmed before tip-off", n > 0, n, `${n} games with both starting fives, ${confirmed} confirmed`);
}

async function esportsRosters(events, cache) {
  const now = Date.now(), soon = events.filter((e) => e.sport === 'esports' && e.esports?.teams && !e.final && e.start < now + 36 * 36e5 && e.start > now - 4 * 36e5);
  const slugs = [...new Set(soon.flatMap((e) => [e.esports.teams.home, e.esports.teams.away]).filter(Boolean))];
  const teams = (cache.teams ||= {});
  const due = slugs.filter((s) => !(teams[s]?.at > now - DAY)).sort((a, b) => (teams[a]?.at || 0) - (teams[b]?.at || 0)).slice(0, 30);
  let read = 0, failed = 0;
  for (const s of due) {
    try { teams[s] = { at: Date.now(), roster: rosterOf(await getJson(TEAM_URL(s))) }; read++; } catch { failed++; }
    await new Promise((r) => setTimeout(r, 700));
  }
  for (const k of Object.keys(teams)) if (!(teams[k].at > now - 7 * DAY)) delete teams[k];
  let n = 0;
  for (const e of soon) if (applyRosters(e, teams[e.esports.teams.home]?.roster, teams[e.esports.teams.away]?.roster)) n++;
  log(`Esports rosters (bo3.gg): ${n} of ${soon.length} series in the next 36 hours with both rosters; ${read} team pages read this build${failed ? `, ${failed} failed` : ''}, ${Object.keys(teams).length} held`);
  if (soon.length) noteSource('Esports rosters', 'bo3.gg', "Each team's players with bo3.gg's six-month rating", n > 0, n, `${n} of ${soon.length} series with both rosters`);
}

async function tennisStats(events, cache) {
  const now = Date.now(), year = new Date().getUTCFullYear();
  const singles = events.filter((e) => e.sport === 'tennis' && !e.final && e.start < now + 48 * 36e5 && e.start > now - 4 * 36e5 && !/\//.test(`${e.home}${e.away}`));
  const t = (cache.tennis ||= { wtaIds: null, wtaAt: 0, players: {} });
  // The WTA's top 500, by name (refreshed daily).
  if (!(t.wtaAt > now - DAY) && singles.some((e) => /wta/i.test(e.leaguePath))) {
    const pages = [];
    for (let p = 0; p < 5; p++) { try { pages.push(await getJson(WTA_RANKED(p))); } catch { break; } }
    if (pages.length) { t.wtaIds = Object.fromEntries(wtaIds(pages)); t.wtaAt = now; }
  }
  const ids = new Map(Object.entries(t.wtaIds || {}));
  const want = [...new Set(singles.filter((e) => /wta/i.test(e.leaguePath)).flatMap((e) => [e.home, e.away]))].map((n) => ({ n, k: nameKey(n), id: ids.get(nameKey(n))?.id })).filter((x) => x.id);
  const due = want.filter((x) => !(t.players[`wta:${x.id}`]?.at > now - DAY)).slice(0, 40);
  let read = 0;
  for (const x of due) {
    try { const s = wtaStats(await getJson(WTA_YEAR(x.id, year))); t.players[`wta:${x.id}`] = { at: Date.now(), name: x.n, stats: s }; read++; } catch { /* next build */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  for (const k of Object.keys(t.players)) if (!(t.players[k].at > now - 7 * DAY)) delete t.players[k];
  const statsOf = (name, path) => (/wta/i.test(path) ? t.players[`wta:${ids.get(nameKey(name))?.id}`]?.stats : null) || null;
  let n = 0;
  for (const e of singles) {
    const home = statsOf(e.home, e.leaguePath), away = statsOf(e.away, e.leaguePath);
    if (!home && !away) continue;
    e.serveReturn = { home, away, model: matchModel(home, away, { bestOf: e.bestOf || 3 }), source: home?.source || away?.source };
    n++;
  }
  const wta = singles.filter((e) => /wta/i.test(e.leaguePath));
  log(`Tennis serve and return (WTA): ${ids.size} ranked players by name; ${want.length} of ${new Set(wta.flatMap((e) => [e.home, e.away])).size} WTA players on the board matched; ${read} season figures read this build; ${n} matches with figures (${singles.filter((e) => e.serveReturn?.model).length} with the match chance)`);
  if (wta.length) noteSource('WTA serve and return', 'wtatennis.com', "Each player's serve and return figures this season, from the WTA", n > 0, n, `${n} matches with figures`);
}

// Cricket: each match's XIs (or squads) from ESPN's summary, for matches in the next day and live
// ones (40 a build, four at a time).
async function cricketSquads(events) {
  const now = Date.now();
  const due = events.filter((e) => e.sport === 'cricket' && e.seriesId && e.compId && !e.final && (e.live || (e.start > now - 6 * 36e5 && e.start < now + DAY))).sort((a, b) => a.start - b.start).slice(0, 40);
  let n = 0, xi = 0, i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < due.length) {
      const e = due[i++];
      try { const sq = squadsOf(await getJson(CRICKET_SUMMARY(e.seriesId, e.compId)), e); if (sq) { e.squads = sq; n++; if (sq.xi) xi++; } } catch { /* next build */ }
    }
  }));
  log(`Cricket players (ESPN): ${n} of ${due.length} matches in the next day or live with their players (${xi} with the XIs named at the toss, ${n - xi} squads)`);
  if (due.length) noteSource('Cricket players', 'espncricinfo.com (ESPN)', "Each side's XI or squad, with roles and batting and bowling styles", n > 0 || null, n, `${n} of ${due.length} matches with players`);
}

export async function playerData(events) {
  let cache = {};
  try { const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'players.json'), { signal: AbortSignal.timeout(15000) }); if (r.ok) cache = await r.json(); } catch { /* first run */ }
  for (const [name, fn] of [['NBA starting lineups', nbaLineups], ['Esports rosters', esportsRosters], ['Tennis serve and return', tennisStats], ['Cricket players', cricketSquads]]) {
    try { await fn(events, cache); } catch (e) { log(`${name} failed: ${e.message}`); noteSource(name, '', '', false, null, e.message); }
  }
  await writeFile(`${out}/data/players.json`, JSON.stringify(cache));
}
