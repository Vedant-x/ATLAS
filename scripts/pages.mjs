#!/usr/bin/env node
// Builds the static GitHub Pages site into dist/pages, with data/index.json holding every fixture ATLAS
// tracks for the next few days:
//   - ESPN scoreboards for every league in js/catalog.js
//   - NPB (official npb.jp): schedule, probable starters and their season / career pitching lines
//   - KBO (official koreabaseball.com): schedule, starters, season line and last-10-game log
//   - MLB Stats API: full starting-pitcher reports (season, form, splits, vs opponent, injuries)
//   - FotMob: injured / suspended players for soccer matches (ESPN's soccer injury feed is empty)
// The browser refreshes scores and per-match detail live from ESPN; this file is the catalogue + the
// Japan/Korea data that only the official league sites carry.
// Each outside source has its own module in scripts/sources/ (shared helpers: scripts/lib.mjs); this
// file runs them in order, merges what they return, and writes the site.
import { absencesFor, injuryNames } from '../js/fotmob.js';
import { CRICKET_URL, parseCricket } from '../js/cricket.js';
import { enrichMlb, formOf } from '../js/mlbstats.js';
import { validateReport } from '../js/validate.js';
import { mkdir, copyFile, cp, writeFile, rm, readFile } from 'node:fs/promises';
import { fetchAll, LEAGUES, fetchErrors, leagueStatus } from '../js/espn.js';
import { leagueByPath, CATALOG } from '../js/catalog.js';
import { leaguePage, sportPage, sitemap } from '../js/staticpages.js';
import { CLUBELO, parseClubElo, eloIndex, isEuropean } from '../js/clubelo.js';
import { FD_FIXTURES, parseFixtures, applyFixtures } from '../js/footballdata.js';
import { ELO_WORLD, ELO_TEAMS, eloratingsIndex, applyEloratings, isInternational } from '../js/eloratings.js';
import { SLEEPER_NFL, injuredByTeam, applyNflInjuries } from '../js/sleeper.js';
import { TA_ELO, parseEloPage, eloIndex as tennisEloIndex, applyTennisElo } from '../js/tennisabstract.js';
import { encode as encodeResults, decode as decodeResults, merge as mergeResults, BACKFILL_DAYS } from '../js/results.js';
import { rate as rateResults, annotate as annotateRatings, sportTrusted } from '../js/ratings.js';
import { GEOCODE, FORECAST, OUTDOOR, placeKey, geoFrom, atKickoff } from '../js/weather.js';
import { DF_GOALIES, nextData, goalieGames, applyGoalies } from '../js/goalies.js';
import { UNDERSTAT, understatUrl, understatData, teamsFromJson, teamsData, xgTable, applyXg } from '../js/understat.js';
import { ODDS_API, matchOdds, overlayOdds, MAJOR_KEYS, sportOfKey, pairEvents, fixtureFromApi } from '../js/oddsapi.js';
import { carryOpen, DRIFT } from '../js/movement.js';
import { breaker, carryStatus } from '../js/breaker.js';
import { valueBets, VALUE } from '../js/track.js';
import { out, UA, get, log, problems, sources, noteSource } from './lib.mjs';
import { npb } from './sources/npb.mjs';
import { kbo } from './sources/kbo.mjs';
import { esports, esoccer } from './sources/esports.mjs';
import { f1 } from './sources/f1.mjs';
import { playerProps } from './sources/props.mjs';
import { khl } from './sources/khl.mjs';
import { tsdbFile, sportsdb, tsdbStatus } from './sources/sportsdb.mjs';
import { fields } from './sources/fields.mjs';
import { europe } from './sources/europe.mjs';
import { mmaOdds } from './sources/mma.mjs';
import { stakePrices } from './sources/stake.mjs';

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/data`, { recursive: true });
for (const f of ['index.html', 'favicon.svg', 'manifest.webmanifest', 'robots.txt']) await copyFile(f, `${out}/${f}`);
for (const d of ['vendor', 'icons']) await cp(d, `${out}/${d}`, { recursive: true });
// Service worker, stamped with this build so visitors pick up new code on the next visit.
// The worker's version is the code version (commit), not the build time: data refreshes every few
// minutes must not count as a new version, or open tabs would reload each time (main.js reloads
// once when a new version takes over).
await writeFile(`${out}/sw.js`, (await readFile('sw.js', 'utf8')).replace('__BUILD__', (process.env.GITHUB_SHA || String(Date.now())).slice(0, 12)));
// Speed: bundle + minify the JavaScript (three.js and the AI model load as separate lazy chunks, unused
// code is dropped) and inline the minified CSS so nothing blocks the first paint. If esbuild isn't
// installed the plain source files are served as before.
{
  let esbuild = null;
  try { esbuild = await import('esbuild'); } catch { log('Bundling skipped (esbuild not installed): serving source files'); }
  // Unbundled, the source modules and stylesheets are served as they are. Bundled, only what the
  // bundle loads by address ships: the AI worker's entry (it imports vendor/web-llm.mjs), GSAP and
  // WebLLM; three.js is inside the 3D scene's chunk.
  if (!esbuild) for (const d of ['js', 'css']) await cp(d, `${out}/${d}`, { recursive: true });
  else {
    await mkdir(`${out}/js/assistant`, { recursive: true });
    await copyFile('js/assistant/llm-worker.js', `${out}/js/assistant/llm-worker.js`);
    await rm(`${out}/vendor/three.module.min.js`, { force: true });
  }
  if (esbuild) {
    const r = await esbuild.build({
      entryPoints: ['js/main.js'], bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2020',
      outdir: `${out}/js`, entryNames: '[name]', chunkNames: 'chunks/[name]-[hash]', legalComments: 'none', metafile: true, logLevel: 'warning',
    });
    // The stylesheet parts in the order index.html lists them, joined into one inline <style>.
    let html = await readFile(`${out}/index.html`, 'utf8');
    const links = [...html.matchAll(/ *<link rel="stylesheet" href="(css\/[a-z-]+\.css)" \/>\n?/g)];
    const css = (await esbuild.transform((await Promise.all(links.map((m) => readFile(m[1], 'utf8')))).join('\n'), { loader: 'css', minify: true })).code;
    html = html.replace(links[0][0], () => `<style>${css}</style>\n`);
    for (const m of links.slice(1)) html = html.replace(m[0], '');
    await writeFile(`${out}/index.html`, html);
    const sizes = Object.entries(r.metafile.outputs).map(([f, o]) => [f.replace(`${out}/`, ''), o.bytes]).sort((x, y) => y[1] - x[1]);
    log(`Bundled: main ${(sizes.find(([f]) => f === 'js/main.js')?.[1] / 1024).toFixed(0)} KB, ${sizes.length} files (largest ${sizes.slice(0, 3).map(([f, n]) => `${f} ${(n / 1024).toFixed(0)} KB`).join(', ')}); CSS inlined (${(css.length / 1024).toFixed(0)} KB)`);
  }
}

// ESPN throttles bursts from one server, so fetch the most-followed leagues first; any league the
// build misses is still loaded live in the visitor's browser when its sport/league page opens.
const PRIORITY = ['basketball/nba', 'football/nfl', 'hockey/nhl', 'baseball/mlb', 'basketball/wnba', 'football/college-football', 'tennis/atp', 'tennis/wta', 'mma/ufc',
  'soccer/eng.1', 'soccer/esp.1', 'soccer/ger.1', 'soccer/ita.1', 'soccer/fra.1', 'soccer/uefa.champions', 'soccer/uefa.europa', 'soccer/uefa.europa.conf', 'soccer/usa.1', 'soccer/mex.1',
  'basketball/mens-college-basketball', 'rugby/267979', 'rugby/270557', 'australian-football/afl', 'rugby-league/3', 'football/cfl'];
// Leagues no feed prices (catalog.js demand) are left to their own pages, which load them live.
const ordered = [...LEAGUES.filter((l) => PRIORITY.includes(l.path)).sort((a, b) => PRIORITY.indexOf(a.path) - PRIORITY.indexOf(b.path)), ...LEAGUES.filter((l) => !PRIORITY.includes(l.path) && !l.demand)];
const cricket = async () => {
  const res = await fetch(CRICKET_URL, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = parseCricket(await res.json());
  log(`Cricket: ${list.length} matches (${list.filter((e) => e.live).length} live)`);
  return list;
};
// The previous build's source report: each source's last success and failure streak. A source that
// failed 3 builds in a row is paused and retried every 6 hours (breaker.js) instead of failing (and
// costing time) on every build; the Sources page says it is paused and since when it has failed.
const prevSources = new Map();
try { const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'sources.json'), { signal: AbortSignal.timeout(15000) }); if (r.ok) for (const x of (await r.json()).sources || []) prevSources.set(x.name, x); } catch { /* first run */ }
const pausedNames = new Set();
const paused = (name, site, what) => {
  const p = prevSources.get(name), b = breaker(p);
  if (!b.skip) return false;
  pausedNames.add(name);
  sources.push({ name, site, what, ok: false, count: null, note: `paused: failed ${b.streak} builds in a row (last: ${String(p.lastError || p.note || '').slice(0, 80)}); next try ${new Date(b.next).toISOString().slice(11, 16)} UTC`, at: Date.now(), skipped: true });
  log(`${name}: paused after ${b.streak} failed builds; next try ${new Date(b.next).toISOString()}`);
  return true;
};
// Sources that failed this build: their fixtures are carried over from the last good snapshot below.
const failedSources = new Set();
const fail = (src, msg) => (e) => { failedSources.add(src); log(`${msg} failed`, e.message); problems.push(`${msg} failed: ${e.message}`); return []; };
// Finished games seen on the scoreboards (yesterday's, and the backfill below), for the results history.
const finished = [];
const [espn, npbEvents, kboEvents, cricketEvents, esportsEvents, esoccerEvents, khlEvents, tsdbEvents, euroEvents] = await Promise.all([
  fetchAll(AbortSignal.timeout(720000), ordered, { days: 4, concurrency: 3, finished }).catch((e) => { log('ESPN failed', e.message); problems.push(`ESPN scoreboards failed entirely: ${e.message}`); return []; }),
  paused('NPB', 'npb.jp', 'Japanese baseball schedule and starters') ? (failedSources.add('atlas/npb'), []) : npb().catch(fail('atlas/npb', 'NPB (Japan) schedule')),
  kbo().catch(fail('atlas/kbo', 'KBO (Korea) schedule')),
  cricket().catch(fail('atlas/cricket', 'Cricket feed')),
  esports().catch((e) => { log('Esports failed', e.message); problems.push(`Esports feed (bo3.gg) failed: ${e.message}`); return []; }),
  esoccer().catch((e) => { log('eSoccer failed', e.message); problems.push(`eSoccer feed (EsportsBattle) failed: ${e.message}`); return []; }),
  khl().catch(fail('atlas/khl', 'KHL feed')),
  sportsdb().catch((e) => { log('TheSportsDB failed', e.message); return []; }),
  europe().catch((e) => { log('European feeds failed', e.message); return []; }),
]);
// Days 5 to 7 for the most-followed leagues, best effort, so 10x and bigger slips (which may use any
// match in the next 7 days, track.js slipPolicy) have a full week to choose from.
{
  const near = new Set(espn.map((e) => e.id));
  const ahead = await fetchAll(AbortSignal.timeout(150000), ordered.filter((l) => PRIORITY.includes(l.path)), { from: 5, days: 7, extra: true, concurrency: 3 }).catch(() => []);
  const added = ahead.filter((e) => !near.has(e.id) && (near.add(e.id), true));
  espn.push(...added);
  log(`ESPN days 5-7: ${added.length} more events`);
}
// Each feed's result for the Sources page (a feed that answered with nothing is not counted as failed).
{
  const failedLeagues = [...leagueStatus.values()].filter((st) => !st.ok).length;
  noteSource('ESPN', 'espn.com', 'Fixtures, scores, reference odds and match summaries for 150+ competitions', espn.length > 0, espn.length, `${espn.length} events; ${failedLeagues} of ${leagueStatus.size} league feeds failed`);
  for (const [name, site, what, list, src, extra] of [
    ['NPB', 'npb.jp', 'Japanese baseball schedule and starters', npbEvents, 'atlas/npb'], ['KBO', 'koreabaseball.com', 'Korean baseball schedule and starters', kboEvents, 'atlas/kbo'],
    ['ESPN cricket', 'espn.com', 'Cricket fixtures and scores', cricketEvents, 'atlas/cricket'], ['bo3.gg', 'bo3.gg', 'Esports (CS2, Valorant, LoL, Dota 2) with team rankings', esportsEvents],
    ['EsportsBattle', 'esportsbattle.com', 'eFootball fixtures and player form', esoccerEvents], ['KHL', 'khl.api.webcaster.pro', 'KHL schedule, live scores and records', khlEvents, 'atlas/khl'],
    ['TheSportsDB', 'thesportsdb.com', 'Darts, snooker, handball, volleyball, table tennis and more', tsdbEvents, null, tsdbStatus && `${tsdbEvents.length} events; ${tsdbStatus.calls} reads this build${tsdbStatus.failed ? `, ${tsdbStatus.failed} refused (rate limit: the rest next build)` : ''}; oldest list ${tsdbStatus.oldest ? `${Math.round((Date.now() - tsdbStatus.oldest) / 6e4)} min` : 'not yet read'} old`], ['League feeds', 'euroleague.net · liiga.fi · nationalleague.ch', 'EuroLeague, EuroCup, Liiga, Swiss hockey', euroEvents],
  ]) if (!pausedNames.has(name)) noteSource(name, site, what, src && failedSources.has(src) ? false : true, list.length, src && failedSources.has(src) ? 'failed this build: last good fixtures kept' : extra || `${list.length} events`);
}
// Known leagues only, and no stale fixtures: a game that started 12+ hours ago and isn't live is over.
const events = [...espn, ...npbEvents, ...kboEvents, ...cricketEvents, ...esportsEvents, ...esoccerEvents, ...khlEvents, ...tsdbEvents, ...euroEvents].filter((e) => leagueByPath(e.leaguePath) && (e.live || !(e.start < Date.now() - 12 * 36e5)));

// Carry-forward: start from the previously published snapshot and restore anything a source has
// since dropped for a match that hasn't finished: announced starters (the NPB page shows only one
// day's starters and moves on to tomorrow's by mid-afternoon), absences and lineups. Sources can
// only add or change information, never silently remove it.
let prevSnapshot = []; // the previous build's events (price movement below reads it too)
{
  let prev = [];
  try {
    const r = await fetch(process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json', { signal: AbortSignal.timeout(20000) });
    if (r.ok) prev = (await r.json()).events || [];
  } catch (err) { log(`Carry-forward: previous snapshot unavailable (${err.message})`); }
  prevSnapshot = prev;
  const old = new Map(prev.map((e) => [e.id, e]));
  // A source or league that failed this build keeps its unfinished fixtures from the last good
  // snapshot, marked stale (with the time of their last good update) until fresh data arrives:
  // a feed outage shows as "not updated since", never as fixtures quietly disappearing.
  const have = new Set(events.map((e) => e.id));
  // ESPN is most of the board: if it fails outright (or answers with a fraction of its usual 1,500+
  // games), every ESPN league keeps its last good fixtures rather than the board emptying.
  const espnDown = espn.length < 150;
  if (espnDown) log(`Carry-forward: ESPN gave only ${espn.length} events; keeping every ESPN league's last good fixtures`);
  const down = (e) => [...failedSources].some((src) => e.leaguePath?.startsWith(src)) || leagueStatus.get(e.leaguePath)?.ok === false || (espnDown && !e.leaguePath?.startsWith('atlas/'));
  const keep = prev.filter((e) => !have.has(e.id) && down(e) && leagueByPath(e.leaguePath) && (e.live || e.start > Date.now() - 3 * 36e5));
  for (const e of keep) events.push({ ...e, stale: true, staleSince: e.staleSince || e.fetchedAt || null });
  if (keep.length) log(`Carry-forward: kept ${keep.length} fixture(s) from feeds that failed this build (${[...new Set(keep.map((e) => e.leaguePath))].slice(0, 8).join(', ')})`);
  let starters = 0, news = 0;
  for (const e of events) {
    const o = old.get(e.id);
    if (!o || e.start < Date.now() - 6 * 36e5) continue;
    // Carried items keep the time they were last read (never this build's), marked carried, so their
    // age shows and the freshness checks judge them by it.
    const kept = (o.probables || []).filter((p) => p.report || p.npbId || p.kboId || p.name)
      .map((p) => ({ ...p, carried: true, ...(p.report ? { report: { ...p.report, fetchedAt: p.report.fetchedAt ?? o.fetchedAt ?? null } } : {}) }));
    if (!(e.probables || []).length && kept.length) { e.probables = kept; starters++; }
    else if (kept.length) {
      for (const p of kept) if (!e.probables.some((x) => x.side === p.side)) { e.probables.push(p); starters++; }
    }
    if (!e.absences && o.absences) { e.absences = { ...o.absences, carried: true, fetchedAt: o.absences.fetchedAt ?? o.fetchedAt ?? null }; news++; }
  }
  log(`Carry-forward: ${prev.length ? `restored starters for ${starters} side(s), team news for ${news} match(es)` : 'nothing to carry (no previous snapshot)'}`);
}

// Completeness check: ESPN's all-sports header lists what is being played today. Any catalogued
// league with games there but none in this build is fetched again; anything still missing is
// logged loudly so a broken feed can never quietly show "no fixtures".
{
  const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' };
  const have = new Map();
  for (const e of events) have.set(e.leaguePath, (have.get(e.leaguePath) || 0) + 1);
  const missing = [];
  let checked = 0, listed = 0, answered = 0;
  for (const [sport, prefix] of [['soccer', 'soccer'], ['basketball', 'basketball'], ['football', 'football'], ['hockey', 'hockey'], ['baseball', 'baseball'], ['mma', 'mma']]) {
    try {
      const j = await (await fetch(`https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=${sport}`, { headers: H, signal: AbortSignal.timeout(15000) })).json();
      answered++;
      for (const lg of j.sports?.flatMap((x) => x.leagues || []) || []) {
        listed++;
        const slug = lg.slug || lg.abbreviation;
        const path = `${prefix}/${slug}`;
        const open = (lg.events || []).filter((ev) => (ev.status || ev.fullStatus?.type?.state) !== 'post').length;
        if (open && leagueByPath(path) && !leagueByPath(path).demand) { checked++; if (!have.get(path)) missing.push({ path, open }); }
      }
    } catch (err) { log(`Completeness check: ${sport} header failed (${err.message})`); }
  }
  let recovered = 0;
  for (const m of missing) {
    const l = LEAGUES.find((x) => x.path === m.path);
    const got = l ? await fetchAll(AbortSignal.timeout(60000), [l], { days: 4, concurrency: 1 }).catch(() => []) : [];
    if (got.length) { events.push(...got); recovered++; } else { log(`  COMPLETENESS: ${m.path} has ${m.open} game(s) today on ESPN but none could be loaded`); problems.push(`${m.path}: ${m.open} game(s) today on ESPN but none loaded`); }
  }
  log(`Completeness check: ${answered}/6 headers, ${listed} league(s) listed, ${checked} with games still to play compared, ${missing.length} missing games${missing.length ? `, ${recovered} recovered` : ''}`);
  // Nothing to compare is normal in quiet hours (every game today already finished). Only headers
  // that answer but list no leagues while many games start within hours mean the format changed.
  const soon = events.filter((e) => /^(soccer|basketball|football|hockey|baseball|mma)\//.test(e.leaguePath || '') && e.start > Date.now() && e.start < Date.now() + 6 * 3600e3).length;
  if (answered && !listed && soon >= 10) { log('  COMPLETENESS: ESPN headers list no leagues - the header format may have changed'); problems.push('Completeness check: ESPN headers list no leagues (the header format may have changed)'); }
}

// ClubElo ratings for European club matches (the model uses them where no bookmaker price exists;
// ATLAS's own ratings stand in while it is down).
if (!paused('ClubElo', 'clubelo.com', 'European club ratings for the model')) try {
  // Today's file, else the last two days' (a day's file can lag; ratings move little in a day).
  let csv = null;
  for (const off of [0, 1, 2]) {
    const d = new Date(Date.now() - off * 864e5).toISOString().slice(0, 10);
    for (const u of [CLUBELO(d), CLUBELO(d).replace('http:', 'https:')]) {
      try { const t = await get(u); if (/^Rank,Club/.test(t)) { csv = t; break; } log(`ClubElo ${u}: not a ratings file`); } catch (err) { log(`ClubElo ${u}: ${err.message}`); }
    }
    if (csv) { if (off) log(`ClubElo: using ratings from ${d}`); break; }
  }
  // Last try: a plain request, without the browser headers the other feeds need.
  if (!csv) {
    const u = CLUBELO(new Date().toISOString().slice(0, 10));
    try { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); const t = r.ok ? await r.text() : ''; if (/^Rank,Club/.test(t)) csv = t; else log(`ClubElo plain request: ${r.status}`); } catch (err) { log(`ClubElo plain request: ${err.message}`); }
  }
  const rows = parseClubElo(csv);
  const idx = eloIndex(rows);
  const euro = events.filter((e) => isEuropean(e.leaguePath) && !/\.w\./.test(e.leaguePath));
  let both = 0, one = 0;
  const missed = new Map();
  for (const e of euro) {
    const h = idx.find(e.home, e.leaguePath), a = idx.find(e.away, e.leaguePath);
    if (!h) missed.set(e.home, e.leaguePath); if (!a) missed.set(e.away, e.leaguePath);
    if (h && a) { e.stats = { ...(e.stats || {}), homeElo: h.elo, awayElo: a.elo, eloAt: Date.now() }; both++; } else if (h || a) one++;
  }
  log(`ClubElo: ${rows.length} clubs rated; ${both}/${euro.length} European matches with both ratings (${one} with one), ${euro.filter((e) => e.stats?.homeElo && !e.markets?.length).length} of them unpriced`);
  if (missed.size) log(`  ClubElo unmatched (first 30): ${[...missed].slice(0, 30).map(([n, p]) => `${n} [${p.split('/')[1]}]`).join(' · ')}`);
  noteSource('ClubElo', 'clubelo.com', 'European club ratings for the model', rows.length > 0, both, `${both} of ${euro.length} European matches rated`);
} catch (err) { log('ClubElo failed', err.message); noteSource('ClubElo', 'clubelo.com', 'European club ratings for the model', false, null, err.message); }

// World Football Elo (eloratings.net): national-team ratings for internationals with no price.
if (!paused('World Football Elo', 'eloratings.net', 'National-team ratings for the model')) try {
  const [world, teams] = await Promise.all([get(ELO_WORLD), get(ELO_TEAMS)]);
  const idx = eloratingsIndex(world, teams);
  // The first rows as read, so a change in the files' layout shows in the build log.
  log(`  eloratings sample: ${world.split('\n').slice(0, 2).map((l) => l.slice(0, 60)).join(' | ')} || ${teams.split('\n').slice(0, 2).map((l) => l.slice(0, 60)).join(' | ')}`);
  const intl = events.filter((e) => isInternational(e.leaguePath));
  const r = applyEloratings(events, idx);
  log(`World Football Elo: ${idx.size} teams rated; ${r.rated}/${intl.length} international matches rated`);
  if (r.unmatched.length) log(`  World Football Elo unmatched (first 30): ${r.unmatched.slice(0, 30).join(' · ')}`);
  noteSource('World Football Elo', 'eloratings.net', 'National-team ratings for the model', idx.size > 0, r.rated, idx.size ? `${r.rated} of ${intl.length} internationals rated` : /^\s*<!doctype|^\s*<html/i.test(world) ? 'the site sent a web page instead of its ratings files' : 'files read but no ratings found');
} catch (err) { log('World Football Elo failed', err.message); noteSource('World Football Elo', 'eloratings.net', 'National-team ratings for the model', false, null, err.message); }

// Tennis Elo (Tennis Abstract): overall and per-surface ratings for singles matches with no price
// (rankings stand in while it is down; it has refused requests from the build servers).
if (!paused('Tennis Abstract', 'tennisabstract.com', 'Tennis Elo (overall and by surface) for the model')) try {
  // The browser headers first, then a plain request (the site has refused the first from CI).
  const page = async (u, tour) => {
    try { return await get(u); } catch (e) { log(`Tennis Abstract ${tour}: ${e.message}; trying a plain request`); }
    try { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); if (r.ok) return r.text(); log(`Tennis Abstract ${tour} plain request: HTTP ${r.status}`); } catch (e) { log(`Tennis Abstract ${tour} plain request: ${e.message}`); }
    return '';
  };
  const [atpHtml, wtaHtml] = await Promise.all([page(TA_ELO.atp, 'ATP'), page(TA_ELO.wta, 'WTA')]);
  const atp = tennisEloIndex(parseEloPage(atpHtml)), wta = tennisEloIndex(parseEloPage(wtaHtml));
  const singles = events.filter((e) => e.sport === 'tennis' && e.tennis?.draw === 'Singles' && !e.markets?.length);
  const r = applyTennisElo(events, { atp, wta });
  log(`Tennis Abstract Elo: ${atp.size} ATP and ${wta.size} WTA players; ${r.rated}/${singles.length} unpriced singles matches rated`);
  if (r.unmatched.length) log(`  Tennis Elo unmatched (first 30): ${r.unmatched.slice(0, 30).join(' · ')}`);
  noteSource('Tennis Abstract', 'tennisabstract.com', 'Tennis Elo (overall and by surface) for the model', atp.size + wta.size > 0, r.rated, atp.size + wta.size ? `${r.rated} of ${singles.length} unpriced singles matches rated` : atpHtml || wtaHtml ? 'pages read but no ratings found' : 'HTTP 403: the site refused the request; rankings used instead');
} catch (err) { log('Tennis Abstract failed', err.message); noteSource('Tennis Abstract', 'tennisabstract.com', 'Tennis Elo (overall and by surface) for the model', false, null, err.message); }

// NFL injury report (Sleeper): the injured players only, kept in data/nfl-injuries.json and refreshed
// when over 6 hours old (the full list is ~5 MB and Sleeper asks for it about once a day).
let nflReport = null;
try {
  try { const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'nfl-injuries.json'), { signal: AbortSignal.timeout(15000) }); if (r.ok) nflReport = await r.json(); } catch { /* first run */ }
  const nflGames = events.filter((e) => e.leaguePath === 'football/nfl' && e.start > Date.now() - 6 * 36e5).length;
  if (nflGames && !(nflReport?.at > Date.now() - 6 * 36e5)) {
    const players = await (await fetch(SLEEPER_NFL, { signal: AbortSignal.timeout(60000) })).json();
    const teams = injuredByTeam(players);
    if (Object.keys(teams).length) nflReport = { at: Date.now(), teams }; else log('Sleeper: no injured players in the list (format change?)');
  }
  const n = applyNflInjuries(events, nflReport);
  const listed = Object.values(nflReport?.teams || {}).reduce((a, l) => a + l.length, 0);
  log(`Sleeper NFL injuries: ${listed} players on ${Object.keys(nflReport?.teams || {}).length} teams (read ${nflReport?.at ? Math.round((Date.now() - nflReport.at) / 36e5) : '?'} h ago); ${n}/${nflGames} NFL matches`);
  noteSource('Sleeper', 'api.sleeper.app', 'NFL injury report', Boolean(nflReport) || !nflGames, n, nflGames ? `${listed} injured players; ${n} of ${nflGames} NFL matches` : 'no NFL matches coming up');
  if (nflReport) await writeFile(`${out}/data/nfl-injuries.json`, JSON.stringify(nflReport));
} catch (err) { log('Sleeper NFL injuries failed', err.message); noteSource('Sleeper', 'api.sleeper.app', 'NFL injury report', false, null, err.message); }

// Results history and ATLAS ratings (js/results.js, js/ratings.js): every finished game seen, kept
// 180 days in data/results.json and carried from build to build; a few older days are backfilled per
// build (up to BACKFILL_DAYS). Every team and player gets a rating, and upcoming matches their
// ratings, rest days, last meetings and, where the feed has none, recent form.
try {
  let prev = { meta: {}, list: [] };
  try {
    const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'results.json'), { signal: AbortSignal.timeout(30000) });
    if (r.ok) { const j = await r.json(); prev = { meta: j.meta || {}, list: decodeResults(j) }; }
  } catch { /* first run */ }
  let back = Number(prev.meta.backfilledTo) || 1;
  if (back < BACKFILL_DAYS) {
    // Four more days back per build, every league, best effort (never marks a league as failed):
    // 120 days of history in about 30 builds.
    const from = -(back + 4), to = -(back + 1);
    const before = finished.length;
    await fetchAll(AbortSignal.timeout(240000), ordered, { from, days: to, extra: true, concurrency: 3, finished }).catch(() => []);
    log(`Results backfill: ${-to} to ${-from} days ago, ${finished.length - before} finished games`);
    back += 4;
  }
  const history = mergeResults(prev.list, finished);
  const R = rateResults(history);
  const rated = annotateRatings(events, R);
  const bySport = Object.entries(history.reduce((m, g) => ((m[g.sport] = (m[g.sport] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  log(`ATLAS ratings: ${history.length} results (${finished.length} read this build, history back ${back} days); ${R.r.size} teams/players rated; ${rated} upcoming matches with trusted ratings`);
  log(`  results by sport: ${bySport.map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  log(`  how well the ratings called results (trusted sides): ${Object.entries(R.quality).map(([k, q]) => `${k} ${q.n} games, ${(q.right * 100).toFixed(0)}% right, Brier ${q.brier.toFixed(3)}${sportTrusted(q) ? ' (used)' : ' (shown only)'}`).join(' · ') || 'not enough yet'}`);
  noteSource('ATLAS results history', 'built from the feeds above', 'Ratings for every team and player, rest days, last meetings, form', history.length > 0, rated, `${history.length} results over ${back} days; ${rated} upcoming matches rated`);
  await writeFile(`${out}/data/results.json`, JSON.stringify({ meta: { backfilledTo: back, at: Date.now() }, ...encodeResults(history) }));
} catch (err) { log('Results history failed', err.message); noteSource('ATLAS results history', 'built from the feeds above', 'Ratings for every team and player', false, null, err.message); }

// NHL starting goalies (Daily Faceoff).
{
  const nhl = events.filter((e) => e.leaguePath === 'hockey/nhl' && e.start > Date.now() - 36e5 && e.start < Date.now() + 36 * 36e5).length;
  if (nhl && !paused('Daily Faceoff', 'dailyfaceoff.com', 'NHL starting goalies (confirmed / likely)')) {
    try {
      // The page lists one US (Eastern) day; each day with NHL games here is fetched by its date.
      const etDay = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t));
      const dates = [...new Set(events.filter((e) => e.leaguePath === 'hockey/nhl' && e.start > Date.now() - 36e5 && e.start < Date.now() + 36 * 36e5).map((e) => etDay(e.start)))].sort().slice(0, 3);
      let data = null; const games = [];
      for (const d of dates) {
        try { const x = nextData(await get(`${DF_GOALIES}/${d}`)); data ||= x; games.push(...goalieGames(x)); } catch (err) { log(`Daily Faceoff ${d}: ${err.message}`); }
      }
      if (!games.length) { data = nextData(await get(DF_GOALIES)); games.push(...goalieGames(data)); }
      const n = applyGoalies(events, games);
      log(`Daily Faceoff goalies: ${data ? 'page data read' : 'NO page data'}; ${games.length} games listed; ${n}/${nhl} NHL matches${games[0] ? ` (e.g. ${games[0].away} @ ${games[0].home}: ${games[0].awayGoalie} / ${games[0].homeGoalie}, ${games[0].homeStatus}, ${games[0].date})` : ''}`);
      if (games.length && n < nhl) log(`  NHL matches here: ${events.filter((e) => e.leaguePath === 'hockey/nhl' && e.start > Date.now() - 36e5 && e.start < Date.now() + 36 * 36e5).map((e) => `${e.away} @ ${e.home}`).join(' · ')} | listed: ${games.slice(0, 16).map((g) => `${g.away} @ ${g.home}`).join(' · ')}`);
      noteSource('Daily Faceoff', 'dailyfaceoff.com', 'NHL starting goalies (confirmed / likely)', games.length > 0, n, `${n} of ${nhl} NHL matches in the next 36 hours`);
    } catch (err) { log('Daily Faceoff failed', err.message); noteSource('Daily Faceoff', 'dailyfaceoff.com', 'NHL starting goalies (confirmed / likely)', false, null, err.message); }
  } else if (!nhl) noteSource('Daily Faceoff', 'dailyfaceoff.com', 'NHL starting goalies (confirmed / likely)', true, 0, 'no NHL matches in the next 36 hours');
}

// Expected goals (Understat) for the five big European leagues.
if (!paused('Understat', 'understat.com', 'Expected goals for the big five leagues')) try {
  // The season is named by the year it starts (2026 = 2026/27): from July on, this year.
  const now = new Date(), season = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const tables = new Map();
  for (const [path, lg] of Object.entries(UNDERSTAT)) {
    try {
      // The data request the page itself makes, then the page (older layout: data inline).
      let data = null;
      try { data = teamsFromJson(JSON.parse(await get(understatData(lg, season), { headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: understatUrl(lg, season) } }))); } catch (err) { log(`Understat ${lg} data request: ${err.message}`); }
      if (!data) { const html = await get(understatUrl(lg, season)); data = teamsData(html); if (!data) log(`Understat ${lg}: no team data (page starts: ${html.replace(/\s+/g, ' ').slice(0, 120)})`); }
      const t = xgTable(data);
      if (t.size) tables.set(path, t);
    } catch (err) { log(`Understat ${lg}: ${err.message}`); }
  }
  const big = events.filter((e) => UNDERSTAT[e.leaguePath] && !e.live && e.start > Date.now()).length;
  const n = applyXg(events, tables);
  log(`Understat xG: ${tables.size}/5 leagues read (${[...tables.values()].reduce((a, t) => a + t.size, 0)} teams); ${n}/${big} upcoming matches`);
  noteSource('Understat', 'understat.com', 'Expected goals (xG / xGA) for the big five leagues', tables.size > 0, n, `${tables.size} of 5 leagues; ${n} of ${big} upcoming matches`);
} catch (err) { log('Understat failed', err.message); noteSource('Understat', 'understat.com', 'Expected goals for the big five leagues', false, null, err.message); }

// Match-day weather (Open-Meteo) for outdoor matches in the next 48 hours that have a price (the ones
// a bet can be placed on). Open-Meteo's free tier counts every place in a request, and asking for
// ~700 places every 20 minutes ran into its daily limit (HTTP 429): so a match's forecast is reused
// from the last snapshot while under 3 hours old, new cities are geocoded 40 per build, and a 429 ends
// this build's requests (the rest keep their last forecast). Cities are kept in data/geo.json.
try {
  let geo = {};
  try { const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'geo.json'), { signal: AbortSignal.timeout(15000) }); if (r.ok) geo = await r.json(); } catch { /* first run */ }
  const due = events.filter((e) => OUTDOOR.has(e.sport) && e.place && !e.place.indoor && e.markets?.length && e.start > Date.now() - 3 * 36e5 && e.start < Date.now() + 48 * 36e5);
  const before = new Map(prevSnapshot.map((e) => [e.id, e]));
  let reused = 0;
  for (const e of due) {
    const w = before.get(e.id)?.weather;
    if (w && before.get(e.id).start === e.start && w.at > Date.now() - 3 * 36e5) { e.weather = w; reused++; }
  }
  const need = due.filter((e) => !e.weather);
  const places = [...new Map(need.map((e) => [placeKey(e.place), e.place])).entries()];
  let looked = 0, limited = false;
  for (const [key, p] of places) {
    if (key in geo || looked >= 40 || limited) continue;
    looked++;
    try { geo[key] = geoFrom(JSON.parse(await get(GEOCODE(p.city))), p); } catch (err) { if (/^429\b/.test(err.message)) limited = true; }
  }
  const located = places.filter(([k]) => geo[k]);
  const fc = new Map();
  for (let i = 0; i < located.length && !limited; i += 50) {
    const batch = located.slice(i, i + 50);
    try {
      const j = JSON.parse(await get(FORECAST(batch.map(([k]) => geo[k].lat), batch.map(([k]) => geo[k].lon))));
      (Array.isArray(j) ? j : [j]).forEach((x, n) => fc.set(batch[n][0], x.hourly));
    } catch (err) { log(`Open-Meteo forecast batch failed: ${err.message}`); if (/^429\b/.test(err.message)) limited = true; }
  }
  let fresh = 0;
  for (const e of need) {
    const h = fc.get(placeKey(e.place));
    const w = h && atKickoff(h, e.start);
    if (w) { e.weather = { ...w, city: e.place.city, at: Date.now(), source: 'Open-Meteo' }; fresh++; }
  }
  const withWeather = reused + fresh;
  log(`Weather (Open-Meteo): ${withWeather}/${due.length} priced outdoor matches in the next 48h (${reused} forecasts under 3 h old reused, ${fresh} new from ${located.length} places, ${looked} new city lookups)${limited ? '; rate limited: the rest next build' : ''}`);
  noteSource('Open-Meteo', 'open-meteo.com', 'Kick-off weather for outdoor matches', !due.length || withWeather > 0 || !need.length, withWeather, `${withWeather} of ${due.length} priced outdoor matches in the next 48 hours${limited ? '; HTTP 429 rate limited this build: the rest next build' : ''}`);
  await writeFile(`${out}/data/geo.json`, JSON.stringify(geo));
} catch (err) { log('Weather failed', err.message); noteSource('Open-Meteo', 'open-meteo.com', 'Kick-off weather for outdoor matches', false, null, err.message); }

// Soccer absences: ESPN's soccer injury feed is empty, FotMob lists who is injured or suspended.
const soccer = events.filter((e) => e.leaguePath?.startsWith('soccer/') && e.start < Date.now() + 5 * 864e5).sort((a, b) => a.start - b.start).slice(0, 400);
let absFound = 0, absMatched = 0, si = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (si < soccer.length) {
    const e = soccer[si++];
    try {
      const a = await absencesFor(e, AbortSignal.timeout(20000));
      if (a) { e.absences = a; absMatched++; absFound += a.home.length + a.away.length; }
    } catch { /* skip this match */ }
  }
}));
const injNames = await injuryNames();
await writeFile(`${out}/data/injury-names.json`, JSON.stringify(injNames));
noteSource('FotMob', 'fotmob.com', 'Soccer injuries, suspensions and lineups', absMatched > 0 || !soccer.length, absMatched, `${absMatched} of ${soccer.length} soccer matches linked`);
log(`FotMob: ${absMatched}/${soccer.length} soccer matches linked, ${absFound} absences, ${soccer.filter((e) => e.absences?.lineup).length} lineups (${soccer.filter((e) => e.absences?.lineup && !['lastStarting11', 'predicted'].includes(e.absences.lineup.type)).length} confirmed), ${Object.keys(injNames).length} injury names`);

// MLB starters: full reports from the official MLB Stats API.
const mlbN = await enrichMlb(events, { signal: AbortSignal.timeout(90000), addMissing: true }).catch((e) => { log('MLB Stats API failed', e.message); return 0; });
log(`MLB Stats API: ${mlbN} starter reports`);
noteSource('MLB Stats API', 'statsapi.mlb.com', 'Probable starters, pitcher reports, injured list', true, mlbN, `${mlbN} starter reports`);
// Validate every starter report: shifted or impossible numbers are dropped (and logged), then
// recent form is recomputed from the rows that survived.
let dropped = 0;
for (const e of events) for (const p of (e.probables || []).filter((x) => x.report)) {
  p.report.fetchedAt ??= e.fetchedAt ?? null; // never the build time: unknown stays unknown
  validateReport(p.report, (msg) => { dropped++; if (dropped <= 25) log('  VALIDATION', msg); });
  const starts = (p.report.recent || []).filter((g) => g.start);
  p.report.form3 = formOf(starts.slice(0, 3)); p.report.form5 = formOf(starts.slice(0, 5));
  p.pitching = p.report;
}
log(`Starter validation: ${dropped} item(s) dropped`);
// One line per starter so a broken parser shows up in the build log.
for (const e of events) for (const p of (e.probables || []).filter((x) => x.report).slice(0, 2)) {
  const r = p.report;
  log(`  SP ${r.league} ${r.name || '?'} (${e.away} @ ${e.home}) · ${r.throws || '?'}HP age ${r.age ?? '?'} · season ERA ${r.season?.era ?? '-'} WHIP ${r.season?.whip ?? '-'} K/9 ${r.season?.k9 ?? '-'} · career ERA ${r.career?.era ?? '-'} in ${r.career?.ip ?? '-'} IP · recent ${r.recent?.length || 0}${r.recent?.[0] ? ` (last: ${r.recent[0].date} ${r.recent[0].ip} IP ${r.recent[0].er} ER)` : ''} · form3 ${r.form3?.era ?? '-'} · splits ${r.splits?.length || 0} · years ${r.years?.length || 0} · vsOpp ${r.vsOpp ? r.vsOpp.avg ?? r.vsOpp.era : '-'} · inj ${r.injuries?.length || 0} · rest ${r.rest ?? '-'}${r.error ? ` · ERROR ${r.error}` : ''}`);
}
await mmaOdds(events).catch((e) => log('MMA odds failed', e.message));
await playerProps(events).catch((e) => log('Player props failed', e.message));
// Golf and motor racing (their own file, like F1). A failed read keeps the last published copy.
{
  const data = await fields().catch((e) => { log('Fields failed', e.message); return null; });
  let keep = null;
  if (!data?.golf.length && !data?.racing.length) { try { const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'fields.json'), { signal: AbortSignal.timeout(15000) }); if (r.ok) keep = await r.json(); } catch { /* none yet */ } }
  if (data || keep) await writeFile(`${out}/data/fields.json`, JSON.stringify(data?.golf.length || data?.racing.length ? data : keep));
}
// Formula 1 weekend (its own file: a race is a field of 20+ drivers, not a two-sided match).
{
  let prevF1 = null;
  try { const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'f1.json'), { signal: AbortSignal.timeout(15000) }); if (r.ok) prevF1 = await r.json(); } catch { /* first build */ }
  const data = await f1(prevF1).catch((e) => { log('F1 failed', e.message); problems.push(`Formula 1 data failed: ${e.message}`); return null; });
  if (data) await writeFile(`${out}/data/f1.json`, JSON.stringify(data));
  else if (prevF1) await writeFile(`${out}/data/f1.json`, JSON.stringify(prevF1));
}
// football-data.co.uk: Pinnacle (or average) odds for European league matches still unpriced.
try {
  const r = await fetch(FD_FIXTURES, { signal: AbortSignal.timeout(20000), headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const fileAt = Date.parse(r.headers.get('last-modified') || '') || null;
  const fixtures = parseFixtures(await r.text());
  const res = applyFixtures(events, fixtures, { fileAt });
  const age = fileAt ? `${Math.round((Date.now() - fileAt) / 36e5)} h old` : 'age unknown';
  log(`football-data.co.uk: ${fixtures.length} fixtures with odds (file ${age}); priced ${res.priced} unpriced match(es); Pinnacle as the sharp line on ${res.sharp} priced match(es)`);
  if (res.unmatched.length) log(`  football-data unmatched (first 30): ${res.unmatched.slice(0, 30).join(' · ')}`);
  noteSource('football-data.co.uk', 'football-data.co.uk', 'Pinnacle odds for European leagues: a price where none, the sharp line where ESPN prices', fixtures.length > 0, res.priced + res.sharp, `${res.priced} matches priced, ${res.sharp} given the sharp line, from ${fixtures.length} fixtures; file ${age}`);
} catch (e) { log(`football-data.co.uk failed: ${e.message}`); noteSource('football-data.co.uk', 'football-data.co.uk', 'Pinnacle / average odds for European leagues', false, null, e.message); }
// Bookmaker odds from The Odds API (ODDS_API_KEY repository secret), used sparingly: the free plan has
// 500 credits a month, so paid odds are only fetched for matches no other source prices.
//  1. The in-season sports list and each sport key's fixture list cost no credits. The fixture lists
//     (kept in data/odds-extra.json, each refreshed every 6 hours) tie every key to the matches here it
//     covers, and add the matches in the next 3 days the bookmakers list that no feed here does
//     (catalog: "Other competitions"), so nothing they offer is missing from the board.
//  2. A key is due for odds when (a) it is one of the most-bet leagues (MAJOR_KEYS) with a match in
//     the next 36 hours and its odds are 8+ hours old: the sharp market (Pinnacle) and the typical
//     price across books on top of ESPN's one-book price; or (b) it has matches in the next 3 days no
//     other source prices and its odds are older than ODDS_HOURS (default 12). Majors first, then the
//     most unpriced matches; credits spent at an even pace to the end of the month.
//  3. Odds already held merge (free): a match no other source prices takes the best price across
//     bookmakers and the consensus fair chance; a priced one keeps its price and gains the sharp
//     fair chance, the typical price and the best one (oddsapi.js overlayOdds).
if (process.env.ODDS_API_KEY) {
  try {
    const key = process.env.ODDS_API_KEY;
    const markets = (process.env.ODDS_MARKETS || 'h2h').split(',').map((x) => x.trim()).filter(Boolean).join(',');
    const regions = (process.env.ODDS_REGIONS || 'eu').split(',').map((x) => x.trim()).filter(Boolean).join(',');
    const maxAgeH = Number(process.env.ODDS_HOURS || 12);
    let cache = { fetchedAt: 0, sports: {}, at: {}, lists: {}, listAt: {} };
    try { const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'odds-extra.json'), { signal: AbortSignal.timeout(15000) }); if (r.ok) cache = { at: {}, lists: {}, listAt: {}, ...(await r.json()) }; } catch { /* first run */ }
    // In-season keys with a sport the site models (free), outrights left out.
    const titles = {};
    try {
      const res = await fetch(`${ODDS_API}/sports?apiKey=${key}`, { signal: AbortSignal.timeout(20000) });
      const list = await res.json();
      if (Array.isArray(list)) { for (const x of list) if (x.active && !x.has_outrights && !/_winner$/.test(x.key) && sportOfKey(x.key)) titles[x.key] = x.title || x.key; }
      else log(`Odds API sports list: ${JSON.stringify(list).slice(0, 160)}`);
    } catch (e) { log(`Odds API sports list failed: ${e.message}`); }
    const active = Object.keys(titles);
    // Fixture lists (free): the stalest first, up to 25 per build, each kept 6 hours.
    const lists = { ...(cache.lists || {}) }, listAt = { ...(cache.listAt || {}) };
    let listed = 0, tried = 0;
    for (const k of active.filter((x) => !(listAt[x] > Date.now() - 6 * 36e5)).sort((x, y) => (listAt[x] || 0) - (listAt[y] || 0)).slice(0, 25)) {
      // One request a second; a rate limit ends this build's lists (the stalest go first next build).
      if (tried++) await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await fetch(`${ODDS_API}/sports/${k}/events?apiKey=${key}`, { signal: AbortSignal.timeout(20000) });
        if (res.ok) { lists[k] = (await res.json()).map((o) => ({ id: o.id, commence_time: o.commence_time, home_team: o.home_team, away_team: o.away_team })); listAt[k] = Date.now(); listed++; }
        else if (res.status === 429) { log(`Odds API fixture lists: rate limited after ${listed}; the rest next build`); break; }
        else log(`Odds API ${k} fixtures: HTTP ${res.status}`);
      } catch (e) { log(`Odds API ${k} fixtures: ${e.message}`); }
    }
    if (active.length) for (const k of Object.keys(lists)) if (!active.includes(k)) { delete lists[k]; delete listAt[k]; }
    // Tie each key to our matches; add the ones no feed here lists (upcoming, within 7 days).
    const byKey = {}, addedBy = {};
    for (const [k, list] of Object.entries(lists)) {
      const sport = sportOfKey(k);
      const upcoming = list.filter((o) => { const t = Date.parse(o.commence_time); return t > Date.now() && t < Date.now() + 7 * 864e5; });
      const { pairs, extra } = pairEvents(events.filter((e) => e.sport === sport && !e.live && e.start > Date.now() - 36e5), upcoming);
      byKey[k] = pairs.map(([o, e]) => { e.oddsId = o.id; return e; });
      // Added only within 3 days: further out, our own feeds may simply not have loaded the match yet.
      for (const o of extra.filter((x) => Date.parse(x.commence_time) < Date.now() + 72 * 36e5)) { const ev = fixtureFromApi(o, { key: k, title: titles[k], sport, at: listAt[k] }); events.push(ev); byKey[k].push(ev); }
      const n = extra.filter((x) => Date.parse(x.commence_time) < Date.now() + 72 * 36e5).length;
      if (n) addedBy[titles[k] || k] = n;
    }
    // Matches each key covers in the next 3 days that no other source prices (before any Odds API odds).
    const need = (k) => (byKey[k] || []).filter((e) => e.start < Date.now() + 72 * 36e5 && !e.markets?.length).length;
    // The month's budget: the credits left, spent at an even pace over the time left this month. A new
    // month resets the credits, so the last count is only trusted within the month it was read.
    const now = new Date(), monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1), monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const per = markets.split(',').length * regions.split(',').length;
    const remaining = cache.fetchedAt >= monthStart ? Number(cache.credits) : NaN;
    const capEnv = process.env.ODDS_MAX_SPORTS;
    const cap = capEnv != null && capEnv !== '' && Number.isFinite(Number(capEnv)) ? Number(capEnv) : Infinity;
    const gap = per * (monthEnd - Date.now()) / Math.max(1, remaining);
    const allowance = Math.min(cap, !Number.isFinite(remaining) ? 1 : remaining < per ? 0 : Math.min(6, Math.floor((Date.now() - (cache.spentAt || 0)) / gap)));
    // Majors: matches in the next 36 hours with a price from another feed and no fresh sharp line.
    const soon = (k) => (byKey[k] || []).filter((e) => e.start < Date.now() + 36 * 36e5 && e.markets?.length && e.oddsSource !== 'the-odds-api');
    const majors = active.filter((k) => MAJOR_KEYS.includes(k)).map((k) => ({ k, n: soon(k).length, major: true, first: Math.min(...soon(k).map((e) => e.start)), at: cache.at?.[k] || 0 }))
      .filter((x) => x.n > 0 && !(x.at > Date.now() - 8 * 36e5)).sort((x, y) => x.first - y.first);
    const wanted = active.map((k) => ({ k, n: need(k), at: cache.at?.[k] || 0 })).filter((x) => x.n > 0);
    const due = [...majors, ...wanted.filter((x) => !majors.some((m) => m.k === x.k) && !(x.at > Date.now() - maxAgeH * 36e5)).sort((x, y) => y.n - x.n || x.at - y.at)].slice(0, allowance);
    const sports = { ...(cache.sports || {}) }, at = { ...(cache.at || {}) };
    let credits = cache.credits ?? null, used = 0;
    for (const { k } of due) {
      try {
        const res = await fetch(`${ODDS_API}/sports/${k}/odds?apiKey=${key}&regions=${regions}&markets=${markets}&oddsFormat=decimal`, { signal: AbortSignal.timeout(20000) });
        credits = Number(res.headers.get('x-requests-remaining') ?? credits); used = res.headers.get('x-requests-used') ?? used;
        if (res.ok) { sports[k] = await res.json(); at[k] = Date.now(); } else log(`Odds API ${k}: HTTP ${res.status} (keeping the last good odds)`);
      } catch (e) { log(`Odds API ${k}: ${e.message} (keeping the last good odds)`); }
    }
    // Drop keys no longer in season or older than two days.
    for (const k of Object.keys(sports)) if ((active.length && !active.includes(k)) || !(at[k] > Date.now() - 48 * 36e5)) { delete sports[k]; delete at[k]; }
    cache = { fetchedAt: Date.now(), markets, regions, sports, at, credits, spentAt: due.length ? Date.now() : cache.spentAt || 0, lists, listAt };
    let priced = 0, sharp = 0;
    for (const [k, list] of Object.entries(sports)) {
      priced += matchOdds(byKey[k] || [], list, { fetchedAt: at[k] });
      sharp += overlayOdds(byKey[k] || [], list, { fetchedAt: at[k] });
    }
    const bySport = {};
    for (const e of events) if (e.oddsSource === 'the-odds-api') bySport[e.sport] = (bySport[e.sport] || 0) + 1;
    const added = Object.values(addedBy).reduce((x, y) => x + y, 0);
    log(`Odds API: ${active.length} sports in season; ${listed} fixture lists read (free), ${Object.keys(lists).length} held; ${added} matches added that no feed here lists`);
    if (added) log(`  added: ${Object.entries(addedBy).sort((x, y) => y[1] - x[1]).map(([t, n]) => `${t} ${n}`).join(' · ')}`);
    log(`  majors due for the sharp line (next 36h): ${majors.map((x) => `${x.k} ${x.n}`).join(' · ') || 'none'}`);
    log(`  need odds (no other price, next 3 days): ${wanted.sort((x, y) => y.n - x.n).map((x) => `${x.k} ${x.n}`).join(' · ') || 'none'}`);
    log(`  fetched ${due.map((x) => x.k).join(', ') || 'nothing'} (allowance ${allowance}, one fetch per ${Number.isFinite(gap) ? Math.round(gap / 6e4) : '?'} min, ${per} credit(s) each) [${markets} @ ${regions}]; credits used ${used}, remaining ${credits ?? '?'}; ${Object.keys(sports).length} sports held`);
    log(`  priced ${priced} matches: ${Object.entries(bySport).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}; sharp line added to ${sharp} matches priced by another feed`);
    await writeFile(`${out}/data/odds-extra.json`, JSON.stringify(cache));
    noteSource('The Odds API', 'the-odds-api.com', 'Many bookmakers\' prices: the sharp fair chance and typical price on the main leagues, and a price where nothing else has one', true, priced + sharp, `${sharp} matches with the sharp line, ${priced} priced, ${added} added from the bookmakers' lists; ${credits ?? '?'} credits left this month`);
  } catch (e) { log(`Odds API failed: ${e.message}`); noteSource('The Odds API', 'the-odds-api.com', 'Fixtures the bookmakers list; best price and consensus fair chance where nothing else prices a match', false, null, e.message); }
} else noteSource('The Odds API', 'the-odds-api.com', 'Fixtures the bookmakers list; best price and consensus fair chance where nothing else prices a match', null, null, 'not switched on: add an ODDS_API_KEY repository secret');
// Stake's own prices (OddsPapi, ODDSPAPI_KEY): beside each main-league price, and Pinnacle's fair
// chance where the match has no sharp line yet (sources/stake.mjs).
try { await stakePrices(events); } catch (e) { log(`Stake (OddsPapi) failed: ${e.message}`); noteSource('Stake (OddsPapi)', 'oddspapi.io', "Stake's own prices on the main football leagues", false, null, e.message); }
// Price movement: every price remembers the first one seen (movement.js), once all prices are in.
// Then how many prices beat the sharp market's fair odds right now (Value bets), for the log.
{
  const kept = carryOpen(events, prevSnapshot);
  const moved = events.flatMap((e) => (e.markets || []).flatMap((m) => m.outcomes || [])).filter((o) => o.open > 1 && Math.abs(o.odds / o.open - 1) >= DRIFT);
  log(`Price movement: ${kept} prices carry their first price; ${moved.length} have moved ${Math.round(DRIFT * 100)}%+ since`);
  const vb = valueBets(events.filter((e) => !e.live && e.start > Date.now() && e.start < Date.now() + 48 * 36e5), { limit: 200 });
  log(`Value bets (best price at least ${Math.round(VALUE.min * 100)}% above the sharp fair odds, next 48h): ${vb.length}${vb.length ? `: ${vb.slice(0, 8).map((b) => `${b.pick} ${b.odds} (fair ${(1 / b.fair).toFixed(2)}, ${b.book || '?'})`).join(' · ')}` : ''}`);
}
// What is still unpriced in the next 48 hours, by league: the gaps left after every price source.
{
  const gaps = {};
  for (const e of events) if (!e.live && e.start > Date.now() && e.start < Date.now() + 48 * 36e5 && !e.markets?.length && !e.leaguePath?.match(/golf|nascar|indycar|moto|f1/)) gaps[e.leaguePath] = (gaps[e.leaguePath] || 0) + 1;
  const list = Object.entries(gaps).sort((x, y) => y[1] - x[1]);
  log(`Unpriced in the next 48h: ${list.reduce((n, [, c]) => n + c, 0)} matches in ${list.length} leagues: ${list.slice(0, 40).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
}
const byLeague = {};
for (const e of events) byLeague[e.leaguePath] = (byLeague[e.leaguePath] || 0) + 1;
if (tsdbFile) await writeFile(`${out}/data/sportsdb.json`, JSON.stringify(tsdbFile));
// Per-provider status across builds (breaker.js carryStatus): when it was last tried, when it last
// worked, how many builds in a row it has failed, and what kind of failure it was. A source that worked
// but found nothing (ok true, count 0) is an empty result, not a failure.
{
  const category = (note) => (/\b40[13]\b|forbidden|unauthori|refused the request/i.test(note) ? 'blocked' : /\b429\b|rate/i.test(note) ? 'rate limited' : /\b5\d\d\b/.test(note) ? 'provider error'
    : /timeout|abort/i.test(note) ? 'timeout' : /fetch failed|ENOTFOUND|ECONN|network/i.test(note) ? 'network' : /\b404\b/.test(note) ? 'not found' : 'unreadable response');
  for (const x of sources) {
    carryStatus(x, prevSources.get(x.name));
    x.errorCategory = x.ok === false ? category(String(x.lastError || x.note || '')) : null;
  }
}
await writeFile(`${out}/data/sources.json`, JSON.stringify({ at: Date.now(), sources }));
await writeFile(`${out}/data/index.json`, JSON.stringify({ source: 'ATLAS snapshot', fetchedAt: Date.now(), leagueStatus: Object.fromEntries(leagueStatus), events }));
// Pages search engines can read (js/staticpages.js): one per league and per sport with fixtures in the
// next 7 days, at real addresses, and the sitemap listing them.
{
  const now = Date.now(), leagues = new Map(), bySport = {}, written = [];
  for (const e of events) if (e.leaguePath && !e.final && e.start > now - 3 * 36e5 && e.start < now + 7 * 864e5 && !leagues.has(e.leaguePath)) leagues.set(e.leaguePath, { path: e.leaguePath, name: e.league || e.leaguePath, sport: e.sport });
  for (const l of leagues.values()) {
    const sp = CATALOG.find((x) => x.id === l.sport);
    const pg = leaguePage({ ...l, sportName: sp?.name }, events, { now });
    await mkdir(`${out}/${pg.path}`, { recursive: true });
    await writeFile(`${out}/${pg.path}index.html`, pg.html);
    written.push(pg.path);
    (bySport[l.sport] ||= []).push({ ...l, count: pg.count });
  }
  for (const [id, list] of Object.entries(bySport)) {
    const pg = sportPage(CATALOG.find((x) => x.id === id) || { id, name: id }, list);
    await mkdir(`${out}/${pg.path}`, { recursive: true });
    await writeFile(`${out}/${pg.path}index.html`, pg.html);
    written.push(pg.path);
  }
  await writeFile(`${out}/sitemap.xml`, sitemap(written.sort(), { at: now }));
  log(`Search pages: ${leagues.size} leagues and ${Object.keys(bySport).length} sports at real addresses, all in sitemap.xml`);
}
if (fetchErrors.length) log('ESPN errors (first 20):', fetchErrors.join(' | '));
log(`ESPN: ${espn.length} events`);
{
  const failedLeagues = [...leagueStatus.entries()].filter(([, st]) => !st.ok).map(([p]) => p);
  if (espn.length < 150) problems.push(`Only ${espn.length} ESPN games loaded (normally 500+): ESPN may have changed its API again`);
  if (failedLeagues.length > LEAGUES.length * 0.15) problems.push(`${failedLeagues.length} of ${LEAGUES.length} leagues failed to load: ${failedLeagues.slice(0, 12).join(', ')}${failedLeagues.length > 12 ? ' …' : ''}`);
  const soccerSoon = events.filter((e) => e.leaguePath?.startsWith('soccer/') && e.start < Date.now() + 2 * 864e5).length;
  if (soccerSoon > 30 && !events.some((e) => e.absences)) problems.push(`FotMob linked no soccer matches (${soccerSoon} soccer games in the next 2 days): injuries and lineups missing`);
  // Not only the core feeds: every source that failed or is paused is named, with how long it has
  // been down. One down for a day or more becomes an alert of its own (scripts/alert.cjs), once.
  const down = sources.filter((x) => x.ok === false);
  const since = (x) => Date.now() - (x.downSince ?? Date.now());
  const age = (ms) => (ms < 36e5 ? 'down under an hour' : ms < 2 * 864e5 ? `down ${Math.round(ms / 36e5)} h` : `down ${Math.round(ms / 864e5)} days`);
  const degraded = down.map((x) => `${x.name} (${x.status === 'paused' ? 'paused, ' : ''}${age(since(x))}: ${String(x.lastError || x.note || '').slice(0, 80)})`);
  const longDown = down.filter((x) => since(x) >= 864e5).map((x) => `${x.name} down for a day or more: ${String(x.lastError || x.note || '').slice(0, 120)}`);
  await writeFile(`${out}/data/health.json`, JSON.stringify({ checkedAt: Date.now(), ok: !problems.length, level: problems.length ? 'problem' : down.length ? 'degraded' : 'ok', problems, degraded, alerts: [...problems, ...longDown], espnGames: espn.length, failedLeagues }));
  log(`DATA HEALTH: ${problems.length ? `${problems.length} problem(s)` : 'core feeds ok'}${down.length ? `; ${down.length} source(s) down` : ''}${[...problems.map((p) => `\n  - ${p}`), ...degraded.map((d) => `\n  - DOWN ${d}`)].join('')}`);
}
log(`Pages build: ${events.length} events across ${Object.keys(byLeague).length} leagues`);
log(Object.entries(byLeague).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));

