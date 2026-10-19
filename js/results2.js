// A second, independent results source for settlement. ESPN gives the first result; the confirming
// read (settle.js) comes from the league's own feed where one is free and public: the NHL's, MLB's,
// the NBA's and WNBA's; FotMob for soccer; TheSportsDB for the NFL and college football. A result is only used when the game is clearly the same
// one (start within 3 hours, both teams matching, one orientation only) and the source calls it final;
// anything else counts as "not found" and the confirming read falls back to ESPN. A second source never
// postpones or voids a pick on its own, and player props (which need a box score) stay with ESPN.
import { sameSide } from './oddsapi.js';
import { sameTeam } from './fotmob.js';

const WINDOW = 3 * 36e5;
const num = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
// The US Eastern calendar date of a moment (the date the US leagues file a game under).
export const easternDate = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const utcDays = (t) => [...new Set([t, t - 6 * 36e5, t + 6 * 36e5].map((x) => new Date(x).toISOString().slice(0, 10).replaceAll('-', '')))];

// Each parser returns games as { home: [names], away: [names], start, done, homeScore, awayScore }.
export const parse = {
  nhl: (j) => (j?.games || []).map((g) => ({
    home: [g.homeTeam?.name?.default, g.homeTeam?.commonName?.default, [g.homeTeam?.placeName?.default, g.homeTeam?.commonName?.default ?? g.homeTeam?.name?.default].filter(Boolean).join(' ')],
    away: [g.awayTeam?.name?.default, g.awayTeam?.commonName?.default, [g.awayTeam?.placeName?.default, g.awayTeam?.commonName?.default ?? g.awayTeam?.name?.default].filter(Boolean).join(' ')],
    start: Date.parse(g.startTimeUTC || ''),
    done: /^(OFF|FINAL)$/.test(g.gameState) && (g.gameScheduleState ?? 'OK') === 'OK',
    homeScore: num(g.homeTeam?.score), awayScore: num(g.awayTeam?.score),
  })),
  mlb: (j) => (j?.dates || []).flatMap((d) => d.games || []).map((g) => ({
    home: [g.teams?.home?.team?.name], away: [g.teams?.away?.team?.name],
    start: Date.parse(g.gameDate || ''),
    // F = final, O = game over; postponed (D) and cancelled (C) games are also "Final" in the abstract state.
    done: /^[FO]$/.test(g.status?.codedGameState || ''),
    homeScore: num(g.teams?.home?.score), awayScore: num(g.teams?.away?.score),
  })),
  nba: (j) => (j?.leagueSchedule?.gameDates || []).flatMap((d) => d.games || []).map((g) => ({
    home: [`${g.homeTeam?.teamCity ?? ''} ${g.homeTeam?.teamName ?? ''}`.trim(), g.homeTeam?.teamName],
    away: [`${g.awayTeam?.teamCity ?? ''} ${g.awayTeam?.teamName ?? ''}`.trim(), g.awayTeam?.teamName],
    start: Date.parse(g.gameDateTimeUTC || ''),
    done: Number(g.gameStatus) === 3,
    homeScore: num(g.homeTeam?.score), awayScore: num(g.awayTeam?.score),
  })),
  // TheSportsDB (free public key): American football, scores including overtime as the markets settle.
  tsdb: (j) => (j?.events || []).map((e) => ({
    home: [e.strHomeTeam], away: [e.strAwayTeam],
    start: Date.parse(e.strTimestamp ? `${String(e.strTimestamp).replace(/Z$|\+00:00$/, '')}Z` : ''),
    done: /^(match finished|ft|aot|final)$/i.test(String(e.strStatus || '').trim()) && !/^yes$/i.test(e.strPostponed || ''),
    homeScore: num(e.intHomeScore), awayScore: num(e.intAwayScore),
  })),
  // FotMob: only results after 90 minutes (FT); a match decided in extra time or on penalties is left
  // to ESPN, as soccer markets settle on regular time.
  fotmob: (j) => (j?.leagues || []).flatMap((l) => l.matches || []).map((m) => ({
    home: [m.home?.longName, m.home?.name], away: [m.away?.longName, m.away?.name],
    start: Date.parse(m.status?.utcTime || ''),
    done: Boolean(m.status?.finished) && !m.status?.cancelled && !m.status?.awarded && (m.status?.reason?.short ?? 'FT') === 'FT',
    homeScore: num(m.home?.score), awayScore: num(m.away?.score),
  })),
};

// Which second source covers a league, and the address(es) to read for one pick.
export const SOURCES = [
  { test: /^hockey\/nhl$/, name: 'NHL API', parse: 'nhl', urls: (p) => [`https://api-web.nhle.com/v1/score/${easternDate(p.start)}`] },
  { test: /^baseball\/mlb$/, name: 'MLB Stats API', parse: 'mlb', urls: (p) => [`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${easternDate(p.start)}`] },
  { test: /^basketball\/nba$/, name: 'NBA schedule', parse: 'nba', urls: () => ['https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json'] },
  { test: /^basketball\/wnba$/, name: 'WNBA schedule', parse: 'nba', urls: () => ['https://cdn.wnba.com/static/json/staticData/scheduleLeagueV2.json'] },
  { test: /^football\/(nfl|college-football)$/, name: 'TheSportsDB', parse: 'tsdb', urls: (p) => utcDays(p.start).map((d) => `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}&s=American%20Football`) },
  { test: /^soccer\//, name: 'FotMob', parse: 'fotmob', urls: (p) => utcDays(p.start).map((d) => `https://www.fotmob.com/api/data/matches?date=${d}`) },
];
export const secondSourceFor = (leaguePath = '') => SOURCES.find((s) => s.test.test(leaguePath)) || null;

const same = (ours, names, soccer) => names.some((n) => n && (sameSide(ours, n) || (soccer && sameTeam(ours, n))));
// The game in a source's list that is this pick's match, as a result oriented to the pick's home and
// away, or null when there is no single clear match.
export function findResult(p, games, { soccer = false } = {}) {
  const hits = [];
  for (const g of games) {
    if (!(Math.abs(g.start - p.start) <= WINDOW)) continue;
    const straight = same(p.home, g.home, soccer) && same(p.away, g.away, soccer);
    const swapped = same(p.home, g.away, soccer) && same(p.away, g.home, soccer);
    if (straight && swapped) return null; // both orientations fit (a derby of near-identical names): not clear
    if (straight || swapped) hits.push({ g, swapped });
  }
  if (hits.length !== 1) return null;
  const { g, swapped } = hits[0];
  if (!g.done || g.homeScore == null || g.awayScore == null) return null;
  const hs = swapped ? g.awayScore : g.homeScore, as = swapped ? g.homeScore : g.awayScore;
  return { done: true, homeScore: hs, awayScore: as, winner: hs > as ? 'home' : hs < as ? 'away' : 'draw' };
}

// A reader for the build: getJson(url) -> parsed JSON (each address fetched once per run).
export function secondReader(getJson) {
  const cache = new Map();
  const load = (url, kind, name) => {
    if (!cache.has(url)) cache.set(url, getJson(url).then((j) => parse[kind](j)).catch((e) => { reader.errors[name] = `${new URL(url).host}: ${e.message}`; return null; }));
    return cache.get(url);
  };
  // { source, result } for a pick, result null when not found; null when no second source covers it.
  const reader = async (p) => {
    const s = secondSourceFor(p.leaguePath);
    if (!s || p.prop) return null;
    const lists = await Promise.all(s.urls(p).map((u) => load(u, s.parse, s.name)));
    if (lists.every((l) => l == null)) return { source: s.name, result: null, failed: true };
    return { source: s.name, result: findResult(p, lists.flat().filter(Boolean), { soccer: s.parse === 'fotmob' }) };
  };
  reader.errors = {}; // the last failure per source, for the build log
  return reader;
}
