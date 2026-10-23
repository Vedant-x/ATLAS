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
import { absencesFor, injuryNames } from '../js/fotmob.js';
import { CRICKET_URL, parseCricket } from '../js/cricket.js';
import { parseNpbScoreboard, kboLive, npbBoxStarters } from '../js/asia-live.js';
import { BO3, ESB, BO3_GAMES, parseBo3, parseEsb, esbForm } from '../js/esports.js';
import { JOLPICA, OPENF1, ESPN_F1, currentRace, sessionsOf, driverForm, expectedPosition, simulateRace, normalizeTrack, espnSessions } from '../js/f1.js';
import { enrichMlb, formOf } from '../js/mlbstats.js';
import { validateReport } from '../js/validate.js';
import { mkdir, copyFile, cp, writeFile, rm, readFile } from 'node:fs/promises';
import { fetchAll, LEAGUES, fetchErrors, leagueStatus } from '../js/espn.js';
import { leagueByPath } from '../js/catalog.js';
import { CORE, PROVIDER, PROP_STATS, GAMELOG_KEYS, OPPORTUNITY, parseProps, gamelogRows, previousSeason, formFor, propHistory, propChance, withoutTeammate, hasForm } from '../js/props.js';
import { KHL_API, khlEvent, khlRecords } from '../js/khl.js';
import { TSDB, TSDB_SPORTS, tsdbEvent, tsdbRecords } from '../js/sportsdb.js';
import { CLUBELO, parseClubElo, eloIndex, isEuropean } from '../js/clubelo.js';
import { FD_FIXTURES, parseFixtures, applyFixtures } from '../js/footballdata.js';
import { ELO_WORLD, ELO_TEAMS, eloratingsIndex, applyEloratings, isInternational } from '../js/eloratings.js';
import { SLEEPER_NFL, injuredByTeam, applyNflInjuries } from '../js/sleeper.js';
import { TA_ELO, parseEloPage, eloIndex as tennisEloIndex, applyTennisElo } from '../js/tennisabstract.js';
import { encode as encodeResults, decode as decodeResults, merge as mergeResults, BACKFILL_DAYS } from '../js/results.js';
import { rate as rateResults, annotate as annotateRatings } from '../js/ratings.js';
import { GEOCODE, FORECAST, OUTDOOR, placeKey, geoFrom, atKickoff } from '../js/weather.js';
import { DF_GOALIES, nextData, goalieGames, applyGoalies } from '../js/goalies.js';
import { UNDERSTAT, understatUrl, understatData, teamsFromJson, teamsData, xgTable, applyXg } from '../js/understat.js';
import { parseGolf, golfForm, golfChances, parseStandings, raceChances, raceResult } from '../js/fields.js';
import { EUROLEAGUE, LIIGA, SWISS, euroSeason, euroRecords, euroEvent, liigaRecords, liigaEvent, swissRecords, swissEvent } from '../js/europe.js';
import { ODDS_API, matchOdds, sportOfKey, pairEvents, fixtureFromApi } from '../js/oddsapi.js';
import { carryOpen, DRIFT } from '../js/movement.js';
import { pendingNews } from '../js/newsgate.js';
import { valueBets, VALUE } from '../js/track.js';
import { toDecimal } from '../js/espn.js';

const out = 'dist/pages';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };
const get = async (u, opt = {}) => {
  const r = await fetch(u, { signal: AbortSignal.timeout(20000), ...opt, headers: { ...UA, ...opt.headers } });
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return r.text();
};
const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// Japan/Korea calendar day (UTC+9): toISOString() of this shifted date reads as the local date.
const day = (off) => new Date(Date.now() + 9 * 3600e3 + off * 864e5);
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const log = (...a) => console.log(...a);
// Data health: anything here opens an alert (GitHub issue, and email if configured) after the build.
const problems = [];
// Every source's result this build, published as data/sources.json for the Sources page:
// { name, site, what, ok, count, note, at }. ok: true (worked), false (failed), null (not set up).
const sources = [];
const noteSource = (name, site, what, ok, count = null, note = '') => sources.push({ name, site, what, ok, count, note, at: Date.now() });

// Parse every <table> into { headers, rows } (cells as clean text).
function tables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => {
    const rows = [...m[0].matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => clean(c[1])));
    const head = rows.find((r) => r.length > 3) || [];
    return { headers: head, rows: rows.filter((r) => r !== head && r.length === head.length) };
  });
}
const pick = (headers, row, names) => {
  for (const n of names) { const i = headers.findIndex((h) => h === n); if (i >= 0) return row[i]; }
  return null;
};
const ipToOuts = (ip) => { const [w, f = '0'] = String(ip).split('.'); return Number(w) * 3 + Number(f); };
const whip = (h, bb, ip) => { const outs = ipToOuts(ip); return outs ? (((Number(h) + Number(bb)) * 3) / outs).toFixed(2) : null; };

// ---------- NPB ----------
const NPB_TEAMS = { g: 'Yomiuri Giants', t: 'Hanshin Tigers', db: 'Yokohama DeNA BayStars', c: 'Hiroshima Toyo Carp', s: 'Tokyo Yakult Swallows', d: 'Chunichi Dragons', h: 'Fukuoka SoftBank Hawks', f: 'Hokkaido Nippon-Ham Fighters', b: 'ORIX Buffaloes', e: 'Tohoku Rakuten Golden Eagles', l: 'Saitama Seibu Lions', m: 'Chiba Lotte Marines' };
const NPB_COLORS = { g: '#f97709', t: '#ffe100', db: '#0055a5', c: '#e60012', s: '#00a73c', d: '#002569', h: '#f9c304', f: '#006298', b: '#000019', e: '#860010', l: '#1f366a', m: '#221815' };

// Table rows as cells. `keepEmpty` keeps blank cells and expands colspan so every value stays in its
// column (KBO tables leave cells blank, e.g. no decision, and merge "연도+팀명" on the career row).
// Without it, blanks are dropped and NPB's split innings ("5" + ".1") are merged back into "5.1".
function rowsOf(tableHtml, { keepEmpty = false } = {}) {
  return [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) => {
    const cells = [];
    for (const c of r[0].matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/g)) {
      const span = keepEmpty ? Math.max(1, Number(c[1].match(/colspan=["']?(\d+)/i)?.[1]) || 1) : 1;
      const v = clean(c[2]);
      for (let k = 0; k < span; k++) cells.push(v);
    }
    if (keepEmpty) return cells;
    return cells.filter((c) => c !== '').reduce((a, c) => { if (/^\.\d$/.test(c) && a.length && /^\d+$/.test(a[a.length - 1])) a[a.length - 1] += c; else a.push(c); return a; }, []);
  });
}
const per9 = (x, ip) => { const o = ipToOuts(ip); return o ? ((Number(x) * 27) / o).toFixed(2) : null; };
const derived = (v) => ({ ...v, whip: v.whip ?? whip(v.h, v.bb, v.ip), k9: per9(v.so, v.ip), bb9: per9(v.bb, v.ip), hr9: per9(v.hr, v.ip), kbb: Number(v.bb) ? (Number(v.so) / Number(v.bb)).toFixed(2) : null });
const ageFrom = (born) => { const t = Date.parse(born); return Number.isFinite(t) ? Math.floor((Date.now() - t) / 31557600000) : null; };

// The player page nests a small table inside every innings cell, so tables can't be cut out with a
// regex. The page text is read as one token stream instead: the pitching header runs from "Year Team"
// to "ERA", then a row per 4-digit year (full width) or "Totals" (no team), until the batting table's
// own "Year" header. Innings print as "385 .1" and are merged back into "385.1".
function npbYearTable(html) {
  const toks = clean(html.replace(/<script[\s\S]*?<\/script>/g, '')).split(' ').filter(Boolean)
    .reduce((a, c) => { if (/^\.\d$/.test(c) && a.length && /^\d+$/.test(a[a.length - 1])) a[a.length - 1] += c; else a.push(c); return a; }, []);
  for (let y0 = toks.indexOf('Year'); y0 >= 0; y0 = toks.indexOf('Year', y0 + 1)) {
    const end = toks.indexOf('ERA', y0);
    if (toks[y0 + 1] !== 'Team' || end < 0 || end - y0 > 40 || !toks.slice(y0, end).includes('IP')) continue;
    const H = toks.slice(y0, end + 1), rows = [H];
    for (let i = end + 1; i < toks.length && toks[i] !== 'Year';) {
      if (/^\d{4}$/.test(toks[i])) { rows.push(toks.slice(i, i + H.length)); i += H.length; }
      else if (/^Totals?$/i.test(toks[i])) { rows.push(toks.slice(i, i + H.length - 1)); i += H.length - 1; }
      else i++;
    }
    return rows;
  }
  return null;
}

async function npbPitcher(id) {
  const url = `https://npb.jp/bis/eng/players/${id}.html`;
  try {
    const html = await get(url);
    const text = clean(html.replace(/<script[\s\S]*?<\/script>/g, ''));
    const name = clean(html.match(/<li id="pc_v_name">([\s\S]*?)<\/li>/)?.[1] || html.match(/<title>([^（(|<]*)/)?.[1] || '');
    const team = html.match(/<title>[^（(]*[（(]([^）)]+)[）)]/)?.[1] || '';
    const throws = text.match(/Bats \/ Throws\s+(Left|Right|Switch)\s*\/\s*(Left|Right)/)?.[2] || null;
    const hw = text.match(/Height \/ Weight\s+(\d+cm)\s*\/\s*(\d+kg)/);
    const bornTxt = text.match(/Born\s+([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1] || null;
    const tbl = npbYearTable(html);
    if (!tbl) throw new Error('no pitching table');
    const H = tbl[0];
    const at = (row, k) => { const i = H.indexOf(k); return i < 0 ? null : row[i] ?? null; };
    const lineOf = (row, label) => derived({ label, year: at(row, 'Year'), team: at(row, 'Team'), g: at(row, 'G'), w: at(row, 'W'), l: at(row, 'L'), sv: at(row, 'SV'), cg: at(row, 'CG'), bf: at(row, 'BF'), ip: at(row, 'IP'), h: at(row, 'H'), hr: at(row, 'HR'), bb: at(row, 'BB'), so: at(row, 'SO'), r: at(row, 'R'), er: at(row, 'ER'), era: at(row, 'ERA') });
    // Year rows have one cell fewer than the header when 'Team' is absent on the Totals row.
    const yearRows = tbl.slice(1).filter((r) => /^\d{4}$/.test(r[0]) && r.length === H.length);
    const yr = String(new Date().getFullYear());
    const cur = yearRows.filter((r) => r[0] === yr);
    const totals = tbl.slice(1).find((r) => /^Totals?$/i.test(r[0]));
    const career = totals ? lineOf([totals[0], '', ...totals.slice(1)], 'Career (NPB)') : null;
    return {
      league: 'NPB', id, name, team, throws: throws ? throws[0] : null, height: hw?.[1] || null, weight: hw?.[2] || null,
      born: bornTxt, age: ageFrom(bornTxt),
      season: cur.length ? lineOf(cur[cur.length - 1], `${yr} season`) : null, career,
      years: yearRows.slice(-5).reverse().map((r) => lineOf(r)),
      recent: [], splits: [], injuries: [], source: url, sourceLabel: 'NPB official profile',
    };
  } catch (e) {
    return { league: 'NPB', id, name: null, season: null, career: null, years: [], recent: [], splits: [], injuries: [], source: url, error: e.message };
  }
}

// Recent starts from NPB box scores (the player page has no game log). The first pitcher listed for a
// team is its starter; box scores abbreviate names ("K.Takahashi"), so match surname (+ initial).
async function npbRecent(targets, days = 16) {
  if (!targets.length) return;
  const teams = new Set(targets.map((t) => t.team));
  const boxes = [];
  for (let off = 1; off <= days; off++) {
    const key = ymd(day(-off));
    let html;
    try { html = await get(`https://npb.jp/bis/eng/${key.slice(0, 4)}/games/gm${key}.html`); } catch { continue; }
    for (const m of html.matchAll(/<a href="([^"]+\/s\d+\.html)" class="link_box">([\s\S]*?)<\/a>/g)) {
      const codes = [...m[2].matchAll(/logo_([a-z]+)_l\.gif/g)].map((x) => x[1]);
      if (codes.length === 2 && (teams.has(codes[0]) || teams.has(codes[1]))) boxes.push({ date: `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6)}`, home: codes[0], away: codes[1], url: `https://npb.jp${m[1]}` });
    }
  }
  const parsed = new Map();
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < boxes.length) {
      const b = boxes[i++];
      try {
        const html = await get(b.url);
        // Pitching tables (IP/BF/H/BB/HB/SO/ER): visitor first, then home.
        const pt = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => rowsOf(m[0])).filter((rows) => rows[0]?.[0] === 'IP' && rows[0]?.includes('ER'));
        if (pt.length === 2) parsed.set(b.url, { away: pt[0].slice(1), home: pt[1].slice(1) });
      } catch { /* skip box */ }
    }
  }));
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z.]/g, '');
  for (const t of targets) {
    const [sur = '', given = ''] = String(t.report.name || '').split(',').map((x) => x.trim());
    const games = [];
    for (const b of boxes) {
      if (b.home !== t.team && b.away !== t.team) continue;
      const side = b.home === t.team ? 'home' : 'away';
      const rows = parsed.get(b.url)?.[side];
      if (!rows) continue;
      const k = rows.findIndex((r) => {
        const nm = norm(r[0].split(',')[0]);
        return nm.includes('.') ? nm === norm(`${given[0] || ''}.${sur}`) : nm === norm(sur);
      });
      if (k < 0) continue;
      const r = rows[k];
      const dec = r[0].match(/\((W|L|S|H)\)/)?.[1];
      games.push({ date: b.date, opp: NPB_TEAMS[side === 'home' ? b.away : b.home] || '', ha: side === 'home' ? 'vs' : '@', start: k === 0,
        result: { W: 'W', L: 'L', S: 'SV', H: 'HLD' }[dec] || '', ip: r[1], bf: r[2], h: r[3], bb: r[4], so: r[6], er: r[7] });
    }
    games.sort((a, b) => b.date.localeCompare(a.date));
    const starts = games.filter((g) => g.start);
    Object.assign(t.report, { recent: games.slice(0, 6), form3: formOf(starts.slice(0, 3)), form5: formOf(starts.slice(0, 5)),
      lastDate: games[0]?.date || null, rest: games[0] ? Math.floor((Date.now() - Date.parse(`${games[0].date}T12:00:00+09:00`)) / 864e5) : null,
      recentNote: `Appearances in the last ${days} days, from NPB box scores` });
  }
}

async function npb() {
  const events = [];
  // Probable starters (home team listed on the left).
  const starters = new Map();
  try {
    const html = await get('https://npb.jp/announcement/starter/');
    const dateTxt = html.match(/<h4>(\d+)月(\d+)日の予告先発投手<\/h4>/);
    for (const u of html.matchAll(/<div class="unit [a-z]+_\d+">([\s\S]*?)<div class="info">([\s\S]*?)<\/div>/g)) {
      const codes = [...u[1].matchAll(/logo_([a-z]+)_m\.gif/g)].map((m) => m[1]);
      const ids = [...new Set([...u[1].matchAll(/\/bis\/players\/(\d+)\.html/g)].map((m) => m[1]))];
      if (codes.length === 2 && ids.length === 2) starters.set(`${codes[0]}-${codes[1]}`, { home: ids[0], away: ids[1], month: dateTxt?.[1], day: dateTxt?.[2] });
    }
  } catch (e) { log('NPB starters failed', e.message); }
  // Today's live state (the English schedule shows digits for games in progress and finished alike).
  const liveNow = new Map();
  try { for (const g of parseNpbScoreboard(await get(`https://npb.jp/games/${ymd(day(0)).slice(0, 4)}/`))) liveNow.set(g.id, g); } catch (e) { log('NPB live state failed', e.message); }
  for (let off = 0; off < 4; off++) {
    const d = day(off), key = ymd(d);
    let html;
    try { html = await get(`https://npb.jp/bis/eng/${key.slice(0, 4)}/games/gm${key}.html`); } catch { continue; }
    for (const m of html.matchAll(/<(a|span)\b[^>]*class="link_box"[^>]*>([\s\S]*?)<\/\1>/g)) {
      const codes = [...m[2].matchAll(/logo_([a-z]+)_l\.gif/g)].map((x) => x[1]);
      if (codes.length !== 2) continue;
      const round = clean(m[2].match(/class="round"[^>]*>([\s\S]*?)<\/div>/)?.[1]);
      const time = round.match(/(\d{1,2}):(\d{2})/);
      const scores = [...m[2].matchAll(/class="score_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((x) => clean(x[1]));
      const [hc, ac] = codes;
      const lv = liveNow.get(`atlas_npb-${key}-${hc}-${ac}`);
      if (lv?.status === 'final' || lv?.status === 'cancelled' || (!lv && scores.every((s) => /^\d+$/.test(s)))) continue; // finished
      const s0 = starters.get(`${hc}-${ac}`);
      // The starters page covers one date; series repeat the same pairing, so match the date too.
      const st = s0 && Number(s0.month) === d.getUTCMonth() + 1 && Number(s0.day) === d.getUTCDate() ? s0 : null;
      events.push({
        id: `atlas_npb-${key}-${hc}-${ac}`, sport: 'baseball', league: 'NPB', leaguePath: 'atlas/npb', group: 'Pro',
        home: NPB_TEAMS[hc] || hc, away: NPB_TEAMS[ac] || ac,
        start: time ? Date.parse(`${d.toISOString().slice(0, 10)}T${time[1].padStart(2, '0')}:${time[2]}:00+09:00`) : Date.parse(`${d.toISOString().slice(0, 10)}T09:00:00Z`),
        live: lv?.status === 'live', score: lv?.status === 'live' ? lv.score : null, clock: lv?.clock || '', period: lv?.period ?? null,
        venue: round.replace(/\d{1,2}:\d{2}/, '').trim(), markets: [], stats: {}, lineups: null,
        colors: { home: NPB_COLORS[hc], away: NPB_COLORS[ac] },
        probables: st ? [{ side: 'home', npbId: st.home, role: 'SP' }, { side: 'away', npbId: st.away, role: 'SP' }] : [],
        source: 'NPB official', fetchedAt: Date.now(), sourceUrl: `https://npb.jp/bis/eng/${key.slice(0, 4)}/games/gm${key}.html`,
      });
    }
  }
  // Games under way whose starters were never announced to us (the starters page moves on to the
  // next day by mid-afternoon): read them from the game's own box score.
  for (const e of events) {
    if (e.probables.length || e.start > Date.now() + 10 * 6e4) continue;
    const lv = liveNow.get(e.id);
    if (!lv?.path) continue;
    try {
      const st = npbBoxStarters(await get(`https://npb.jp${lv.path}box.html`));
      if (st?.home) e.probables.push({ side: 'home', npbId: st.home, role: 'SP' });
      if (st?.away) e.probables.push({ side: 'away', npbId: st.away, role: 'SP' });
    } catch (err) { log('NPB box score failed', lv.path, err.message); }
  }
  // Full report for every announced starter, then recent starts from box scores.
  const targets = [];
  for (const e of events) {
    const [hc, ac] = e.id.split('-').slice(-2);
    for (const p of e.probables) {
      const r = await npbPitcher(p.npbId);
      Object.assign(p, { name: r.name || `NPB #${p.npbId}`, report: r, pitching: r });
      if (r.name) targets.push({ report: r, team: p.side === 'home' ? hc : ac });
    }
  }
  await npbRecent(targets).catch((err) => log('NPB recent failed', err.message));
  log(`NPB: ${events.length} games, ${events.filter((e) => e.probables.length).length} with starters`);
  return events;
}

// ---------- KBO ----------
const KBO_TEAMS = { OB: 'Doosan Bears', LG: 'LG Twins', HT: 'KIA Tigers', SS: 'Samsung Lions', LT: 'Lotte Giants', KT: 'KT Wiz', SK: 'SSG Landers', NC: 'NC Dinos', WO: 'Kiwoom Heroes', HH: 'Hanwha Eagles' };
const KBO_COLORS = { OB: '#131230', LG: '#c30452', HT: '#ea0029', SS: '#074ca1', LT: '#041e42', KT: '#000000', SK: '#ce0e2d', NC: '#315288', WO: '#570514', HH: '#fc4e00' };

const KBO_KR = { KIA: 'KIA Tigers', LG: 'LG Twins', NC: 'NC Dinos', SSG: 'SSG Landers', KT: 'KT Wiz', 삼성: 'Samsung Lions', 두산: 'Doosan Bears', 롯데: 'Lotte Giants', 한화: 'Hanwha Eagles', 키움: 'Kiwoom Heroes' };
const KBO_RES = { 승: 'W', 패: 'L', 세: 'SV', 홀: 'HLD' };
const kboIp = (s) => { const m = String(s || '').match(/^(\d+)?\s*(?:(\d)\/3)?$/); return m ? `${m[1] || 0}.${m[2] || 0}` : s; };

async function kboPitcher(id, oppName) {
  const base = 'https://www.koreabaseball.com/Record/Player/PitcherDetail';
  const page = async (p) => { try { return await get(`${base}/${p}.aspx?playerId=${id}`); } catch { return ''; } };
  const [basic, total, game, situ, eng] = await Promise.all([...['Basic', 'Total', 'Game', 'Situation'].map(page),
    get(`https://eng.koreabaseball.com/Teams/PlayerInfoPitcher/Summary.aspx?pcode=${id}`).catch(() => '')]);
  // English name from the KBO English site ("CARRASCO Carlos" → "Carlos Carrasco").
  const en = clean(eng).match(/Name\s*:\s*([A-Z][A-Z'-]+(?:\s[A-Z][A-Z'-]+)*)\s+(.+?)\s+Position\s*:/);
  const title = (w) => w.charAt(0) + w.slice(1).toLowerCase();
  const enName = en ? `${en[2].trim()} ${en[1].split(' ').map(title).join(' ')}` : null;
  if (!basic) return { league: 'KBO', id, name: null, season: null, years: [], recent: [], splits: [], injuries: [], error: 'profile unavailable' };
  // Header = the row carrying the column labels; data rows keep blanks so columns line up.
  const T = (html) => [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => {
    const rows = rowsOf(m[0], { keepEmpty: true }).filter((r) => r.some((c) => c !== ''));
    const hi = rows.findIndex((r) => r.some((c) => /^(구분|연도|일자|팀명|ERA|WHIP|TBF)$/.test(c)));
    const raw = hi >= 0 ? rows[hi] : rows[0] || [];
    const h = raw.slice(raw.findIndex((c) => c !== '')); // drop blank spacer cells before the labels
    // KBO tables end with their stat columns, so rows are lined up from the right edge.
    const fit = (r) => (r.length >= h.length ? r.slice(r.length - h.length) : [...Array(h.length - r.length).fill(''), ...r]);
    return { h, rows: rows.slice(hi + 1).filter((r) => r.length >= h.length - 2).map(fit) };
  });
  const at = (t, r, k) => { const i = t.h.indexOf(k); return i < 0 ? null : r[i] ?? null; };
  const prof = clean(basic.match(/playerProfile[\s\S]{0,2500}/)?.[0] || '');
  const name = clean(basic.match(/playerProfile_lblName">([^<]*)</)?.[1]);
  const bm = prof.match(/생년월일:\s*(\d{4})년\s*(\d{2})월\s*(\d{2})일/);
  const born = bm ? `${bm[1]}-${bm[2]}-${bm[3]}` : null;
  const hand = prof.match(/\((좌|우)(?:투|언)/)?.[1]; // 언 = sidearm/submarine
  const hw = prof.match(/(\d+cm)\s*\/\s*(\d+kg)/);
  const bt = T(basic);
  const t1 = bt.find((t) => t.h.includes('ERA') && t.h.includes('IP') && t.h.includes('W'));
  const t2 = bt.find((t) => t.h.includes('WHIP') && t.h.includes('SO'));
  const t3 = bt.find((t) => t.h.includes('TBF') && t.h.some((x) => /일자/.test(x)));
  const tInj = bt.find((t) => t.h.includes('일수') && t.rows.some((r) => /부상자/.test(r.join(' '))));
  const r1 = t1?.rows[0], r2 = t2?.rows[0];
  const season = r1 ? derived({ label: `${new Date().getFullYear()} season`, era: at(t1, r1, 'ERA'), g: at(t1, r1, 'G'), w: at(t1, r1, 'W'), l: at(t1, r1, 'L'), sv: at(t1, r1, 'SV'), cg: at(t1, r1, 'CG'), bf: at(t1, r1, 'TBF'), pitches: at(t1, r1, 'NP'),
    ip: kboIp(at(t1, r1, 'IP')), h: at(t1, r1, 'H'), hr: at(t1, r1, 'HR'),
    bb: r2 ? at(t2, r2, 'BB') : null, so: r2 ? at(t2, r2, 'SO') : null, r: r2 ? at(t2, r2, 'R') : null, er: r2 ? at(t2, r2, 'ER') : null,
    whip: r2 ? at(t2, r2, 'WHIP') : null, avg: r2 ? at(t2, r2, 'AVG') : null, qs: r2 ? at(t2, r2, 'QS') : null }) : null;
  const recent = (t3?.rows || []).filter((r) => /^\d{2}\.\d{2}$/.test(r[0])).slice(0, 10).map((r) => ({
    date: `${new Date().getFullYear()}-${r[0].replace('.', '-')}`, ha: /홈/.test(at(t3, r, '구분')) ? 'vs' : '@', opp: KBO_KR[at(t3, r, '상대')] || at(t3, r, '상대'),
    result: KBO_RES[at(t3, r, '결과')] || '', start: true, ip: kboIp(at(t3, r, 'IP')), h: at(t3, r, 'H'), hr: at(t3, r, 'HR'), bb: at(t3, r, 'BB'), so: at(t3, r, 'SO'), er: at(t3, r, 'ER'), bf: at(t3, r, 'TBF'),
  })).sort((a, b) => b.date.localeCompare(a.date));
  const injuries = (tInj?.rows || []).filter((r) => /부상자/.test(r.join(' '))).map((r) => ({ date: `${r[1]} → ${r[2]}`, text: `Injured list · ${String(r[3]).replace(/\D+/g, '')} days` }));
  // Career, year by year
  const tt = T(total).find((t) => t.h.includes('연도') && t.h.includes('ERA'));
  const yl = (r, label) => derived({ label, year: at(tt, r, '연도'), team: at(tt, r, '팀명'), era: at(tt, r, 'ERA'), g: at(tt, r, 'G'), w: at(tt, r, 'W'), l: at(tt, r, 'L'), sv: at(tt, r, 'SV'), bf: at(tt, r, 'TBF'), ip: kboIp(at(tt, r, 'IP')), h: at(tt, r, 'H'), hr: at(tt, r, 'HR'), bb: at(tt, r, 'BB'), so: at(tt, r, 'SO'), r: at(tt, r, 'R'), er: at(tt, r, 'ER') });
  const careerRow = tt?.rows.find((r) => r[0] === '통산');
  const years = (tt?.rows || []).filter((r) => /^\d{4}$/.test(r[0])).slice(-5).reverse().map((r) => yl(r));
  // Splits: vs each team, home/away (Game), vs left/right-handed batters (Situation)
  const gt = T(game);
  const vsT = gt.find((t) => t.rows.some((r) => KBO_KR[r[0]]));
  const haT = gt.find((t) => t.rows.some((r) => r[0] === '홈'));
  const sit = T(situ).find((t) => t.rows.some((r) => r[0] === '좌타자'));
  const oppRow = vsT?.rows.find((r) => KBO_KR[r[0]] === oppName);
  const splits = [
    ...(haT?.rows || []).filter((r) => /^(홈|방문)$/.test(r[0])).map((r) => ({ label: r[0] === '홈' ? 'Home' : 'Away', ip: kboIp(at(haT, r, 'IP')), era: at(haT, r, 'ERA'), avg: at(haT, r, 'AVG'), so: at(haT, r, 'SO'), bb: at(haT, r, 'BB') })),
    ...(sit?.rows || []).filter((r) => /^(좌타자|우타자)$/.test(r[0])).map((r) => ({ label: r[0] === '좌타자' ? 'vs LHB' : 'vs RHB', avg: at(sit, r, 'AVG'), hr: at(sit, r, 'HR'), so: at(sit, r, 'SO'), bb: at(sit, r, 'BB') })),
  ];
  const starts = recent.filter((g) => g.start);
  return {
    league: 'KBO', id, name: enName || name, nameLocal: enName ? name : null, team: '', throws: hand === '좌' ? 'L' : hand === '우' ? 'R' : null, height: hw?.[1] || null, weight: hw?.[2] || null, born, age: ageFrom(born),
    season, career: careerRow ? yl(careerRow, 'Career (KBO)') : null, years, recent, splits, injuries,
    vsOpp: oppRow ? { opp: oppName, g: at(vsT, oppRow, 'G'), ip: kboIp(at(vsT, oppRow, 'IP')), era: at(vsT, oppRow, 'ERA'), avg: at(vsT, oppRow, 'AVG'), so: at(vsT, oppRow, 'SO'), bb: at(vsT, oppRow, 'BB'), label: 'this season' } : null,
    form3: formOf(starts.slice(0, 3)), form5: formOf(starts.slice(0, 5)),
    lastDate: recent[0]?.date || null, rest: recent[0] ? Math.floor((Date.now() - Date.parse(`${recent[0].date}T12:00:00+09:00`)) / 864e5) : null,
    source: `${base}/Basic.aspx?playerId=${id}`, sourceLabel: 'KBO official profile',
  };
}

async function kbo() {
  const events = [];
  for (let off = 0; off < 4; off++) {
    const d = day(off), key = ymd(d);
    let json;
    try {
      json = JSON.parse(await get('https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx', Origin: 'https://www.koreabaseball.com' },
        body: `leId=1&srId=0%2C1%2C3%2C4%2C5%2C6%2C7%2C8%2C9&date=${key}`,
      }));
    } catch (e) { log('KBO day failed', key, e.message); continue; }
    for (const g of json.game || []) {
      if (g.GAME_STATE_SC === '3' || g.CANCEL_SC_ID !== '0') continue; // finished or cancelled
      const [hh, mm] = String(g.G_TM || '18:30').split(':');
      const probables = [];
      if (g.B_PIT_P_ID) probables.push({ side: 'home', kboId: g.B_PIT_P_ID, name: clean(g.B_PIT_P_NM), role: 'SP' });
      if (g.T_PIT_P_ID) probables.push({ side: 'away', kboId: g.T_PIT_P_ID, name: clean(g.T_PIT_P_NM), role: 'SP' });
      events.push({
        id: `atlas_kbo-${g.G_ID}`, sport: 'baseball', league: 'KBO', leaguePath: 'atlas/kbo', group: 'Pro',
        home: KBO_TEAMS[g.HOME_ID] || g.HOME_NM, away: KBO_TEAMS[g.AWAY_ID] || g.AWAY_NM,
        start: Date.parse(`${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6)}T${hh.padStart(2, '0')}:${mm}:00+09:00`),
        live: g.GAME_STATE_SC === '2', score: g.GAME_STATE_SC === '2' ? `${g.B_SCORE_CN} – ${g.T_SCORE_CN}` : null, clock: kboLive([g])[0]?.clock || '', period: Number(g.GAME_INN_NO) || null,
        venue: g.S_NM, broadcast: g.TV_IF || null, markets: [], lineups: null,
        stats: { homeRank: g.B_RANK_NO, awayRank: g.T_RANK_NO },
        colors: { home: KBO_COLORS[g.HOME_ID], away: KBO_COLORS[g.AWAY_ID] },
        probables, source: 'KBO official', fetchedAt: Date.now(), sourceUrl: 'https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx',
      });
    }
  }
  for (const e of events) for (const p of e.probables) {
    const r = await kboPitcher(p.kboId, p.side === 'home' ? e.away : e.home);
    r.team = p.side === 'home' ? e.home : e.away;
    Object.assign(p, { report: r, pitching: r, name: r.name || p.name });
  }
  log(`KBO: ${events.length} games, ${events.filter((e) => e.probables.length).length} with starters`);
  return events;
}

// ---------- esports ----------
// bo3.gg: every upcoming/live CS2, Valorant, LoL and Dota 2 series in the next 4 days.
async function esports() {
  // bo3.gg is sometimes slow: each request gets 30 s and two retries, each game is fetched on its own
  // (in parallel), and a game that still fails keeps its fixtures from the last published snapshot,
  // so a slow source never empties the esports pages or raises a false alarm.
  const getJson = async (url) => {
    for (let i = 0; ; i++) {
      try { return JSON.parse(await get(url, { signal: AbortSignal.timeout(30000) })); } catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 3000 * (i + 1))); }
    }
  };
  const failed = [];
  const lists = await Promise.all(Object.entries(BO3_GAMES).map(async ([d, g]) => {
    const rows = [];
    try {
      for (let page = 0; page < 4; page++) {
        const j = await getJson(`${BO3}/matches?page[offset]=${page * 100}&page[limit]=100&sort=start_date&filter[matches.status][in]=current,upcoming&filter[matches.discipline_id][eq]=${d}&with=teams,tournament,games`);
        rows.push(...(j.results || []));
        const last = Date.parse(j.results?.at(-1)?.start_date);
        if ((page + 1) * 100 >= (j.total?.count || 0) || last > Date.now() + 4 * 864e5) break;
      }
      return parseBo3(rows);
    } catch (e) { failed.push(g); log(`Esports: ${g.game} failed (${e.message})`); return []; }
  }));
  const list = lists.flat();
  if (failed.length) {
    let kept = 0;
    try {
      const prev = await (await fetch(process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json', { signal: AbortSignal.timeout(20000) })).json();
      for (const e of prev.events || []) if (failed.some((g) => g.path === e.leaguePath) && (e.live || e.start > Date.now() - 3 * 36e5)) { list.push(e); kept++; }
    } catch { /* no previous snapshot */ }
    log(`Esports: kept ${kept} fixture(s) from the last snapshot for ${failed.map((g) => g.game).join(', ')}`);
    if (!kept) problems.push(`Esports feed (bo3.gg) failed for ${failed.map((g) => g.game).join(', ')} with no earlier fixtures to fall back on`);
  }
  const by = (p) => list.filter((e) => e.leaguePath === p).length;
  log(`Esports (bo3.gg): ${list.length} series (CS2 ${by('atlas/cs2')}, Valorant ${by('atlas/valorant')}, LoL ${by('atlas/lol')}, Dota 2 ${by('atlas/dota2')}), ${list.filter((e) => e.markets.length).length} priced, ${list.filter((e) => e.live).length} live`);
  return list;
}

// EsportsBattle eSoccer: the next 75 minutes of matches, with each player's form from the last day.
async function esoccer() {
  const iso = (off) => new Date(Date.now() + off * 864e5).toISOString().slice(0, 10);
  const tours = [];
  for (let page = 1; page <= 10; page++) {
    const j = JSON.parse(await get(`${ESB}/tournaments?page=${page}&dateFrom=${iso(-1)}&dateTo=${iso(1)}`));
    tours.push(...(j.tournaments || []));
    if (page >= (j.totalPages || 1)) break;
  }
  const now = Date.now();
  const active = tours.filter((t) => t.status_id !== 4 && Date.parse(t.start_date) < now + 3 * 36e5);
  const recent = tours.filter((t) => t.status_id === 4).sort((a, b) => Date.parse(b.start_date) - Date.parse(a.start_date)).slice(0, 40);
  const withMatches = [];
  const queue = [...active, ...recent];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      try { withMatches.push({ tournament: t, matches: JSON.parse(await get(`${ESB}/tournaments/${t.id}/matches`)) }); } catch (e) { log('eSoccer tournament failed', t.id, e.message); }
    }
  }));
  const form = esbForm(withMatches.flatMap((x) => x.matches));
  const list = parseEsb(withMatches.filter((x) => x.tournament.status_id !== 4), now, form);
  log(`eSoccer (EsportsBattle): ${list.length} matches in the next 75 minutes (${list.filter((e) => e.live).length} live), form for ${form.size} players from ${withMatches.length} tournaments`);
  return list;
}

// ---------- Formula 1 ----------
// The weekend on now (or next): sessions, classification, driver form, the race model, team colours
// and the circuit map. Written to data/f1.json; the site switches to the next Grand Prix by itself.
async function f1(prevF1) {
  const J = async (path) => JSON.parse(await get(`${JOLPICA}/${path}`));
  // OpenF1 rate-limits bursts (HTTP 429): pause and retry.
  const O = async (path) => {
    for (let i = 0; ; i++) {
      try { return JSON.parse(await get(`${OPENF1}/${path}`)); } catch (e) { if (i >= 3 || !/^429/.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 2500 * (i + 1))); }
    }
  };
  // Jolpica pages results 100 rows at a time and may split one race across pages: merge by round.
  const allRows = async (path) => {
    const out = [];
    for (let off = 0; off < 3000; off += 100) {
      const j = await J(`${path}?limit=100&offset=${off}`);
      for (const r of j.MRData.RaceTable.Races) {
        const ex = out.find((x) => x.round === r.round);
        if (ex) { ex.Results = [...(ex.Results || []), ...(r.Results || [])]; ex.QualifyingResults = [...(ex.QualifyingResults || []), ...(r.QualifyingResults || [])]; } else out.push(r);
      }
      if (off + 100 >= Number(j.MRData.total)) break;
    }
    return out;
  };
  const calendar = (await J('current.json')).MRData.RaceTable.Races;
  const race = currentRace(calendar);
  if (!race) { log('F1: season over, no upcoming race'); return null; }
  const [results, qualis, ds, cs] = await Promise.all([allRows('current/results.json'), allRows('current/qualifying.json'), J('current/driverStandings.json'), J('current/constructorStandings.json')]);
  const standings = ds.MRData.StandingsTable.StandingsLists[0]?.DriverStandings || [];
  const constructors = (cs.MRData.StandingsTable.StandingsLists[0]?.ConstructorStandings || []).map((c) => ({ pos: Number(c.position), name: c.Constructor.name, points: Number(c.points), wins: Number(c.wins) }));
  const form = driverForm(results, qualis);

  // This weekend's sessions: schedule from Jolpica, status and classification from ESPN.
  let espn = [];
  try {
    const j = JSON.parse(await get(`${ESPN_F1}?dates=${race.date.replaceAll('-', '')}`));
    const ev = (j.events || []).find((e) => Math.abs(Date.parse(e.date) - Date.parse(race.date)) < 5 * 864e5);
    espn = espnSessions(ev);
  } catch (e) { log('F1: ESPN sessions failed', e.message); }
  const sessions = sessionsOf(race).map((s) => {
    const m = espn.find((x) => x.code === s.code || (s.code === 'Race' && x.code === 'Race') || Math.abs(x.start - s.start) < 30 * 6e4);
    return { ...s, state: m?.state || (Date.now() > s.start + 3 * 36e5 ? 'post' : 'pre'), detail: m?.detail || '', top: (m?.order || []).slice(0, 10).map((x) => x.name) };
  });

  // Starting grid once qualifying is in (Jolpica first, ESPN's qualifying order as a fallback).
  const grid = new Map();
  try { for (const q of (await J(`${race.season}/${race.round}/qualifying.json`)).MRData.RaceTable.Races[0]?.QualifyingResults || []) grid.set(q.Driver.driverId, Number(q.position)); } catch { /* not yet */ }
  const qualEspn = sessions.find((s) => s.code === 'Qual' && s.state === 'post');

  const drivers = standings.map((d) => {
    const name = `${d.Driver.givenName} ${d.Driver.familyName}`;
    let g = grid.get(d.Driver.driverId) || null;
    if (!g && qualEspn?.top.length) { const i = qualEspn.top.findIndex((n) => n.toLowerCase().endsWith(d.Driver.familyName.toLowerCase())); if (i >= 0) g = i + 1; }
    const f = form.get(d.Driver.driverId);
    return {
      id: d.Driver.driverId, code: d.Driver.code || d.Driver.familyName.slice(0, 3).toUpperCase(), number: d.Driver.permanentNumber || null, name, family: d.Driver.familyName,
      team: d.Constructors?.[0]?.name || '', points: Number(d.points), pos: Number(d.position), wins: Number(d.wins), grid: g,
      avgFinish: f?.avgFinish ?? null, avgFinish5: f?.avgFinish5 ?? null, avgQuali5: f?.avgQuali5 ?? null, last5: f?.last5 || [], dnfRate: f?.dnfRate ?? 0.08,
    };
  }).filter((d) => form.get(d.id)?.starts); // drivers who raced this season
  drivers.forEach((d) => { d.expected = expectedPosition(d, d.grid, drivers.length); });
  const model = simulateRace(drivers);

  // OpenF1: this meeting's sessions (for live timing), team colours and the circuit outline.
  let meeting = null, track = null, colours = {};
  try {
    const first = sessions[0].start, last = sessions.at(-1).start;
    const ses = await O(`sessions?year=${race.season}`);
    const mine = ses.filter((x) => Date.parse(x.date_start) > first - 6 * 36e5 && Date.parse(x.date_start) < last + 6 * 36e5);
    if (mine.length) meeting = { key: mine[0].meeting_key, circuitKey: mine[0].circuit_key, circuit: mine[0].circuit_short_name, sessions: mine.map((x) => ({ key: x.session_key, name: x.session_name, start: Date.parse(x.date_start), end: Date.parse(x.date_end) })) };
    for (const d of await O('drivers?session_key=latest')) if (d.last_name) colours[d.last_name.toLowerCase()] = { colour: /^[0-9a-f]{6}$/i.test(d.team_colour || '') ? `#${d.team_colour}` : null, number: d.driver_number, headshot: d.headshot_url || null };
  } catch (e) { log('F1: OpenF1 meeting/drivers failed', e.message); }
  drivers.forEach((d) => { const c = colours[d.family.toLowerCase()]; if (c) Object.assign(d, { colour: c.colour, number: c.number ?? d.number, headshot: c.headshot }); });
  model.drivers.forEach((d) => { const x = drivers.find((y) => y.id === d.id); Object.assign(d, { colour: x.colour, number: x.number, headshot: x.headshot }); });

  if (meeting?.circuitKey && prevF1?.track?.circuitKey === meeting.circuitKey) track = prevF1.track; // drawn before: keep it
  else if (meeting?.circuitKey) {
    try {
      const past = (await O(`sessions?circuit_key=${meeting.circuitKey}`)).filter((x) => Date.parse(x.date_end) < Date.now() - 36e5).sort((a, b) => (a.session_name === 'Race') - (b.session_name === 'Race') || Date.parse(a.date_start) - Date.parse(b.date_start));
      const src = past.at(-1);
      if (src) {
        const laps = (await O(`laps?session_key=${src.session_key}&lap_number=${src.session_name === 'Race' ? 8 : 4}`)).filter((l) => l.lap_duration && !l.is_pit_out_lap).sort((a, b) => a.lap_duration - b.lap_duration);
        const lap = laps[0];
        if (lap) {
          const a = new Date(Date.parse(lap.date_start)).toISOString(), b = new Date(Date.parse(lap.date_start) + lap.lap_duration * 1000).toISOString();
          const n = normalizeTrack(await O(`location?session_key=${src.session_key}&driver_number=${lap.driver_number}&date>${a}&date<${b}`));
          if (n) track = { ...n, circuitKey: meeting.circuitKey, from: `${src.session_name}, ${new Date(Date.parse(src.date_start)).getUTCFullYear()} (OpenF1 car data)`, lapSeconds: lap.lap_duration };
        }
      }
    } catch (e) { log('F1: circuit map failed', e.message); }
  }

  const lastRace = results.at(-1);
  const out = {
    updatedAt: Date.now(), season: race.season, round: Number(race.round), rounds: calendar.length,
    race: { name: race.raceName, circuit: race.Circuit.circuitName, circuitId: race.Circuit.circuitId, locality: race.Circuit.Location.locality, country: race.Circuit.Location.country, start: sessions.at(-1).start, url: race.url, sessions },
    drivers: model.drivers, h2h: model.h2h, teams: model.teams, sims: model.sims, gridKnown: drivers.some((d) => d.grid),
    standings: drivers.slice().sort((a, b) => a.pos - b.pos).map((d) => ({ pos: d.pos, name: d.name, team: d.team, points: d.points, wins: d.wins, colour: d.colour })), constructors,
    lastRace: lastRace ? { name: lastRace.raceName, round: Number(lastRace.round), podium: (lastRace.Results || []).slice(0, 3).map((r) => `${r.Driver.givenName} ${r.Driver.familyName}`) } : null,
    upcoming: calendar.filter((r) => Date.parse(r.date) > Date.parse(race.date)).slice(0, 5).map((r) => ({ round: Number(r.round), name: r.raceName, date: r.date, locality: r.Circuit.Location.locality })),
    meeting, track,
  };
  log(`F1: ${out.race.name} (round ${out.round}), ${drivers.length} drivers, favourite ${model.drivers[0]?.name} ${(model.drivers[0]?.win * 100).toFixed(0)}%, grid ${out.gridKnown ? 'known' : 'not yet'}, circuit map ${track ? `${track.points.length} points` : 'missing'}`);
  return out;
}

// ---------- player props ----------
// DraftKings player milestones and anytime scorers from ESPN's core odds feed, for matches in the
// next 36 hours. Names come from the two teams' rosters (one request per team), with the athlete
// record as a fallback for anyone a roster misses (a recent trade or call-up).
async function playerProps(events) {
  const now = Date.now();
  const getJson = async (u) => JSON.parse(await get(u.replace(/^http:/, 'https:')));
  const due = events.filter((e) => !e.live && e.compId && e.teamIds?.home && e.teamIds?.away && e.start > now && e.start < now + 36 * 36e5 && PROP_STATS[e.leaguePath?.split('/')[0]]);
  const rosters = new Map(), athletes = new Map();
  const roster = (lp, team) => {
    const k = `${lp}|${team}`;
    if (!rosters.has(k)) {
      rosters.set(k, getJson(`https://site.api.espn.com/apis/site/v2/sports/${lp}/teams/${team}/roster`).then((j) => {
        const m = new Map(), add = (a) => { if (a?.id) m.set(String(a.id), a.displayName || a.fullName); };
        for (const a of j.athletes || []) { if (Array.isArray(a.items)) a.items.forEach(add); else add(a); }
        return m;
      }).catch(() => new Map()));
    }
    return rosters.get(k);
  };
  const athlete = (ref) => {
    if (!athletes.has(ref)) athletes.set(ref, getJson(ref).then((a) => ({ name: a.displayName, team: /\/teams\/(\d+)/.exec(a.team?.$ref || '')?.[1] || null })).catch(() => null));
    return athletes.get(ref);
  };
  let lines = 0, matched = 0, failed = 0, propSample = null;
  const queue = [...due];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const e = queue.shift();
      const [sport, league] = e.leaguePath.split('/');
      const url = `${CORE}/${sport}/leagues/${league}/events/${e.compId}/competitions/${e.compId}/odds/${PROVIDER}/propBets?limit=1000`;
      let items = [];
      try {
        const j = await getJson(url);
        items = j.items || [];
        for (let pg = 2; pg <= Math.min(j.pageCount || 1, 3); pg++) items.push(...((await getJson(`${url}&page=${pg}`)).items || []));
      } catch (err) { if (!/404/.test(err.message)) failed++; continue; }
      if (!items.length) continue;
      // What the feed's rebound lines look like (one NBA match per build): line, price and fields.
      if (sport === 'basketball' && !propSample) {
        const who1 = items.find((x) => /Rebounds/.test(x.type?.name || ''))?.athlete?.$ref;
        propSample = [JSON.stringify(items.find((x) => /Rebounds/.test(x.type?.name || ''))), ...items.filter((x) => x.athlete?.$ref === who1).slice(0, 40).map((x) => JSON.stringify({ type: x.type?.name, odds: x.odds?.decimal?.value, total: x.odds?.total?.value, target: x.current?.target, over: x.current?.over, under: x.current?.under }))];
        if (propSample.length) log(`  prop feed sample (${e.home} v ${e.away}):\n    ${propSample.join('\n    ')}`);
      }
      const [h, a] = await Promise.all([roster(e.leaguePath, e.teamIds.home), roster(e.leaguePath, e.teamIds.away)]);
      const extra = new Map();
      // Only player references (a team or other ref has no athlete id, and used to stop the whole step).
      const idOf = (r) => /athletes\/(\d+)/.exec(r || '')?.[1];
      const refs = [...new Set(items.map((x) => x.athlete?.$ref).filter((r) => idOf(r) && !h.has(idOf(r)) && !a.has(idOf(r))))].slice(0, 25);
      for (const r of refs) { const x = await athlete(r); if (x?.name) extra.set(idOf(r), { name: x.name, side: x.team === String(e.teamIds.home) ? 'home' : x.team === String(e.teamIds.away) ? 'away' : null }); }
      const who = (id) => (h.has(id) ? { name: h.get(id), side: 'home' } : a.has(id) ? { name: a.get(id), side: 'away' } : extra.get(id) || null);
      e.props = parseProps(items, sport, who);
      if (e.props.length) { matched++; lines += e.props.length; }
    }
  }));
  log(`Player props (DraftKings via ESPN): ${lines} lines on ${matched} of ${due.length} matches in the next 36h${failed ? `, ${failed} lookup(s) failed` : ''}`);
  // Player history: each player's last 20 games from his ESPN game log (last season too while this
  // one is under 10 games old). It gives the props page its hit rates, splits and charts, and the
  // ATLAS chance (propChance): the price as a prior, moved by how the player's recent games went.
  // Injury reports (ESPN match summaries) for every match with props: who is out, doubtful or
  // questionable tonight, by athlete id, so their absence can be read from the game logs.
  const INJ = /^(out|doubtful|questionable|day-to-day|injured reserve|suspension)/i;
  const withProps = due.filter((e) => e.props?.length);
  // Every NBA game too, props or not: its picks wait on the injury report (newsgate.js).
  const sq = due.filter((e) => e.props?.length || e.leaguePath === 'basketball/nba');
  let injured = 0, pending = 0, pulled = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (sq.length) {
      const e = sq.shift();
      try {
        const sm = await getJson(`https://site.api.espn.com/apis/site/v2/sports/${e.leaguePath}/summary?event=${e.compId}`);
        e.injuryChecked = Date.now(); // the report was read, even if nobody is on it
        const inj = { home: [], away: [] };
        for (const t of sm.injuries || []) {
          const side = String(t.team?.id) === String(e.teamIds.home) ? 'home' : String(t.team?.id) === String(e.teamIds.away) ? 'away' : null;
          if (!side) continue;
          inj[side] = (t.injuries || []).map((x) => ({ id: x.athlete?.id != null ? String(x.athlete.id) : null, name: x.athlete?.displayName || '', status: x.status || x.type?.description || '' }))
            .filter((x) => x.id && x.name && INJ.test(x.status));
        }
        if (inj.home.length || inj.away.length) { e.injuries = { ...inj, source: 'ESPN', at: Date.now() }; injured += inj.home.length + inj.away.length; }
        if (e.leaguePath === 'basketball/nba') {
          // Key players: each team's season leaders (points, rebounds, assists) in the summary.
          const leaders = new Set((sm.leaders || []).flatMap((t) => (t.leaders || []).flatMap((c) => (c.leaders || []).map((l) => String(l.athlete?.id ?? '')))).filter(Boolean));
          const names = pendingNews(e.injuries, leaders);
          if (names.length) { e.newsPending = names; pending++; }
          // A player on the injury report (out, doubtful, questionable) has no props here: he may not
          // play, or play limited minutes.
          const listed = new Set(['home', 'away'].flatMap((s) => (e.injuries?.[s] || []).map((x) => x.id)));
          const before = e.props?.length || 0;
          if (before) { e.props = e.props.filter((p) => !listed.has(String(p.id))); pulled += before - e.props.length; }
        }
      } catch { /* no injury report */ }
    }
  }));
  log(`Injury reports (ESPN): ${injured} players out, doubtful or questionable across ${withProps.filter((e) => e.injuries).length} of ${withProps.length} prop matches; NBA: ${pending} game(s) waiting on a key player's status, ${pulled} prop(s) of listed players left out`);

  // Player history: each player's last 20 games from his ESPN game log (last season too while this
  // one is under 10 games old). It gives the props page its hit rates, splits and charts, and the
  // ATLAS chance (propChance): the price as a prior, moved by how the player's recent games went.
  // Injured teammates' logs are read too: the games they missed show how the player does without them.
  const logs = new Map();
  const want = [];
  for (const e of due) for (const pr of e.props || []) {
    const [sport, league] = e.leaguePath.split('/');
    if (hasForm(sport, pr.type) && !logs.has(`${league}|${pr.id}`) && want.length < 320) { logs.set(`${league}|${pr.id}`, null); want.push([sport, league, pr.id]); }
  }
  let mates = 0;
  for (const e of withProps) for (const side of ['home', 'away']) for (const x of e.injuries?.[side] || []) {
    const [sport, league] = e.leaguePath.split('/');
    if (!logs.has(`${league}|${x.id}`) && mates < 160) { logs.set(`${league}|${x.id}`, null); want.push([sport, league, x.id]); mates++; }
  }
  const q = [...want];
  let backfilled = 0, sample = null;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (q.length) {
      const [sport, league, id] = q.shift();
      const base = `https://site.web.api.espn.com/apis/common/v3/sports/${sport}/${league}/athletes/${id}/gamelog`;
      try {
        const g = await getJson(base);
        const rows = gamelogRows(g, 20);
        sample ||= { keys: Object.keys(g).join(','), season: previousSeason(g), game: Object.values(g.events || {})[0] };
        if (sport === 'hockey' && !sample.hockeyNames) sample.hockeyNames = (g.names || []).join(',');
        const prev = rows.length < 10 && previousSeason(g);
        if (prev) {
          try {
            const old = gamelogRows(await getJson(`${base}?season=${prev}`), 20 - rows.length);
            old.forEach((r) => Object.defineProperty(r, '_season', { value: false }));
            rows.push(...old);
            backfilled++;
          } catch { /* this season only */ }
        }
        logs.set(`${league}|${id}`, rows);
      } catch { /* price only */ }
    }
  }));
  // Teammates of a prop player tonight: the injured (with their status) and the other prop players
  // on his side, each with a game log.
  const teammatesOf = (e, league, pr) => {
    if (!pr.side) return [];
    const list = (e.injuries?.[pr.side] || []).filter((x) => x.id !== String(pr.id)).map((x) => ({ id: x.id, name: x.name, status: x.status }));
    for (const o of e.props || []) if (o.side === pr.side && String(o.id) !== String(pr.id) && !list.some((x) => x.id === String(o.id))) list.push({ id: String(o.id), name: o.player, status: null });
    return list.filter((x) => logs.get(`${league}|${x.id}`)?.length);
  };
  const OUT = /^(out|doubtful|injured reserve|suspension)/i;
  let formed = 0, adjusted = 0;
  for (const e of due) {
    const [sport, league] = e.leaguePath.split('/');
    for (const pr of e.props || []) {
      const rows = logs.get(`${league}|${pr.id}`);
      const home = pr.side === 'home' ? true : pr.side === 'away' ? false : null;
      const opp = pr.side ? e.teamIds?.[pr.side === 'home' ? 'away' : 'home'] : null;
      const hist = rows?.length ? propHistory(sport, pr.type, pr.target, rows, { opp, home }) : null;
      if (!hist) continue;
      pr.hist = hist;
      pr.form = formFor(sport, pr.type, pr.target, rows.slice(0, 10));
      // Teammates ruled out (or doubtful) tonight: how he did in the games they missed moves the
      // forecast; questionable ones are listed as "what if" only.
      const adj = [];
      for (const m of teammatesOf(e, league, pr).filter((x) => x.status)) {
        const w = withoutTeammate(sport, pr.type, pr.target, rows, logs.get(`${league}|${m.id}`));
        if (w) adj.push({ name: m.name, status: m.status, applied: OUT.test(m.status) && w.fresh, ...w });
      }
      const live = adj.filter((x) => x.applied).sort((a, b) => Math.abs(b.scale - 1) - Math.abs(a.scale - 1));
      const scale = Math.min(1.4, Math.max(0.7, live.reduce((m, x) => m * x.scale, 1)));
      const top = live[0];
      pr.pBase = propChance(pr.pm ?? pr.p, sport, pr.type, pr.target, rows, { home }).p;
      pr.p = top ? propChance(pr.pm ?? pr.p, sport, pr.type, pr.target, rows, { home, scale, without: top.without }).p : pr.pBase;
      if (adj.length) pr.adj = adj.slice(0, 4);
      if (top && Math.abs(pr.p - pr.pBase) >= 0.02) { pr.why = `without ${top.name} (${top.status.toLowerCase()})`; adjusted++; }
      formed++;
    }
    e.props?.sort((a, b) => b.p - a.p);
  }
  // Every prop player's game log (and his injured teammates') for the player research page
  // (data/players.json, loaded on demand): per game the date, opponent, home/away, this season or
  // last, minutes (or at-bats), the game and team ids (for with/without a teammate) and each stat a
  // prop of his sport uses; and for prop players, tonight's teammates to compare against.
  const players = {};
  const entry = (sport, rows, name, team, extra = {}) => {
    const cols = [...new Set(Object.values(GAMELOG_KEYS[sport] || {}).flat())];
    const opp = OPPORTUNITY[sport];
    return {
      n: name, s: sport, t: team, c: cols, o: opp || null, ...extra,
      g: rows.map((r) => [r._at ? new Date(r._at).toISOString().slice(0, 10) : '', r._oppAbbr || '', r._opp || '', r._home === true ? 1 : r._home === false ? 0 : -1, r._season === false ? 0 : 1, opp && Number.isFinite(r[opp]) ? r[opp] : null, r._ev || '', r._team || '', ...cols.map((c) => (Number.isFinite(r[c]) ? r[c] : null))]),
    };
  };
  for (const e of due) {
    const [sport, league] = e.leaguePath.split('/');
    for (const pr of e.props || []) {
      const k = `${league}|${pr.id}`, rows = logs.get(k);
      if (!rows?.length || players[k]) continue;
      const team = pr.side === 'home' ? e.home : pr.side === 'away' ? e.away : '';
      players[k] = entry(sport, rows, pr.player, team, { tm: teammatesOf(e, league, pr).map((m) => [`${league}|${m.id}`, m.name, m.status]) });
      for (const m of teammatesOf(e, league, pr)) {
        const mk = `${league}|${m.id}`;
        if (!players[mk] && m.status) players[mk] = entry(sport, logs.get(mk), m.name, team, { inj: m.status });
      }
    }
  }
  await mkdir(`${out}/data`, { recursive: true });
  await writeFile(`${out}/data/players.json`, JSON.stringify({ updatedAt: Date.now(), players }));
  log(`Player history: ${[...logs.values()].filter(Boolean).length} of ${want.length} game logs (${mates} of injured teammates, ${backfilled} with last season), ${formed} props modelled from recent games, ${adjusted} moved by a teammate's absence`);
  due.flatMap((e) => (e.props || []).filter((pr) => pr.why)).slice(0, 5).forEach((pr) => log(`  ABSENCE ${pr.player} ${pr.target}+ ${pr.label}: ${Math.round(pr.pBase * 100)}% → ${Math.round(pr.p * 100)}% ${pr.why}`));
  const withVenue = Object.values(players).reduce((n, pl) => n + pl.g.filter((g) => g[3] !== -1).length, 0), games = Object.values(players).reduce((n, pl) => n + pl.g.length, 0);
  // How complete the minutes / at-bats column is per sport (the player page disables the filter when thin).
  const cover = {};
  for (const pl of Object.values(players)) { const c = (cover[pl.s] ||= [0, 0]); c[0] += pl.g.filter((g) => g[5] != null).length; c[1] += pl.g.length; }
  log(`  opportunity column: ${Object.entries(cover).map(([sp, [a, b]]) => `${sp} ${a}/${b}`).join(' · ')}`);
  if (sample?.hockeyNames) log(`  hockey gamelog columns: ${sample.hockeyNames}`);
  if (sample) log(`  gamelog: previous season ${sample.season} · game keys ${Object.keys(sample.game || {}).join(',')} · atVs ${sample.game?.atVs} · opponent ${sample.game?.opponent?.abbreviation} · ${withVenue}/${games} games with home/away`);
  for (const e of due.filter((x) => x.props?.length).slice(0, 3)) log(`  PROPS ${e.away} @ ${e.home}: ${e.props.slice(0, 4).map((x) => `${x.player} ${x.target}+ ${x.label} @${x.odds}`).join(' · ')}`);
}

// ---------- KHL ----------
// The KHL's app feed (khl.api.webcaster.pro): the next 7 days in one-day windows (the feed returns at
// most 16 games per request), plus the season's results so far for each club's record and form.
async function khl() {
  const getJson = async (u) => JSON.parse(await get(u));
  const now = Math.floor(Date.now() / 1000), day = 86400;
  const seen = new Map();
  for (let d = -0.5; d < 7; d += 1) {
    const list = await getJson(`${KHL_API}events_v2?q[start_at_gt_time_from_unixtime]=${Math.floor(now + d * day)}&q[start_at_lt_time_from_unixtime]=${Math.floor(now + (d + 1) * day)}&order_direction=asc`);
    for (const x of list) seen.set(x.event.id, x);
  }
  const finished = [];
  for (let page = 1; page <= 30; page++) {
    const list = await getJson(`${KHL_API}events_v2?q[start_at_lt_time_from_unixtime]=${now}&order_direction=desc&page=${page}`);
    if (!list.length) break;
    finished.push(...list);
    if (list.some((x) => x.event.stage_name && !/2026\/2027|2026-2027/.test(x.event.stage_name))) break; // previous season reached
  }
  const season = finished.filter((x) => /2026\/2027|2026-2027/.test(x.event.stage_name || ''));
  const records = khlRecords(season);
  const events = [...seen.values()].filter((x) => x.event.game_state_key !== 'finished').map((x) => khlEvent(x, records));
  log(`KHL: ${events.length} games in the next 7 days (${events.filter((e) => e.live).length} live), records from ${season.length} results`);
  if (!events.length) throw new Error('no fixtures returned');
  return events;
}

// ---------- TheSportsDB: darts, snooker, handball, volleyball, table tennis, badminton, boxing … ----------
// The free public key allows about 30 requests a minute, so requests go one at a time, 2.2 s apart:
// each sport's fixtures for yesterday to three days ahead (yesterday gives recent results), then the
// last results of each competition seen, for every competitor's record and form.
// These sports change slowly and the free key is slow to read, so the fixtures are kept for 30
// minutes (data/sportsdb.json): most builds reuse the last copy, with finished games dropped and
// live ones still shown until the next full read.
// CI sets TSDB_KEEP_MIN high so test builds reuse the site's copy and leave the shared key to the live build.
const TSDB_KEEP = (Number(process.env.TSDB_KEEP_MIN) || 30) * 6e4;
async function sportsdb() {
  let prev = null;
  try {
    const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'sportsdb.json'), { signal: AbortSignal.timeout(15000) });
    prev = r.ok ? await r.json() : null;
    if (prev?.fetchedAt && Date.now() - prev.fetchedAt < TSDB_KEEP && Array.isArray(prev.events)) {
      const kept = prev.events.filter((e) => e.live || e.start > Date.now() - 3 * 36e5);
      tsdbFile = prev;
      log(`TheSportsDB: reusing ${kept.length} fixtures read ${Math.round((Date.now() - prev.fetchedAt) / 6e4)} min ago`);
      return kept;
    }
  } catch { /* first build, or the site is unreachable: read afresh */ }
  const kept = Array.isArray(prev?.events) ? prev.events.filter((e) => e.start > Date.now() - 3 * 36e5) : [];
  const fresh = await sportsdbFetch().catch((e) => { log(`TheSportsDB failed: ${e.message}`); return null; });
  // A read cut short (rate limits, an outage) never wipes the fixtures already known: the last good
  // copy stays, with its own read time, until a full read replaces it.
  if (!fresh || (fresh.partial && fresh.events.length < kept.length)) {
    if (kept.length) log(`TheSportsDB: keeping ${kept.length} fixtures from the last full read (${Math.round((Date.now() - prev.fetchedAt) / 6e4)} min ago)`);
    tsdbFile = prev?.events ? prev : { fetchedAt: Date.now(), events: [] };
    return kept;
  }
  tsdbFile = { fetchedAt: Date.now(), events: fresh.events };
  return fresh.events;
}
let tsdbFile = null;
async function sportsdbFetch() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let last = 0, calls = 0, errors = 0, backoffs = 0;
  const getJson = async (path, retry = true) => {
    const gap = 2200 - (Date.now() - last);
    if (gap > 0) await wait(gap);
    last = Date.now(); calls++;
    try { return JSON.parse(await get(`${TSDB}${path}`, { headers: { Accept: 'application/json' } })); } catch (e) {
      // Rate limited (the key is shared): wait out the minute and try once more, at most 3 times a build.
      if (retry && /^429\b/.test(e.message) && backoffs < 3) { backoffs++; log(`  TheSportsDB rate limited: waiting 60 s (${backoffs} of 3)`); await wait(60000); return getJson(path, false); }
      errors++; if (errors <= 4) log(`  TheSportsDB ${path}: ${e.message}`); return null;
    }
  };
  const iso = (off) => new Date(Date.now() + off * 864e5).toISOString().slice(0, 10);
  const raw = new Map(), leagues = new Map(), counts = {};
  for (const def of TSDB_SPORTS) {
    let n = 0;
    for (const off of [-1, 0, 1, 2, 3]) {
      const j = await getJson(`eventsday.php?d=${iso(off)}&s=${encodeURIComponent(def.tsdb)}`);
      for (const x of j?.events || []) {
        if (def.only && !def.only.test(`${x.strLeague || ''} ${x.strEvent || ''}`)) continue;
        raw.set(x.idEvent, { x, def }); n++;
        if (x.idLeague && !leagues.has(x.idLeague)) leagues.set(x.idLeague, def);
      }
    }
    counts[def.sport] = n;
  }
  // Each competition's current season (results so far and the fixtures still to come): records and
  // form, and fixtures the day lists missed. At most 16 competitions, the busiest first.
  const busy = [...leagues.keys()].map((id) => [id, [...raw.values()].filter((r) => r.x.idLeague === id).length]).sort((a, b) => b[1] - a[1]).slice(0, 16);
  const past = [];
  let seasons = 0;
  for (const [id] of busy) {
    const lg = (await getJson(`lookupleague.php?id=${id}`))?.leagues?.[0];
    const season = lg?.strCurrentSeason;
    const j = season ? await getJson(`eventsseason.php?id=${id}&s=${encodeURIComponent(season)}`) : null;
    const list = j?.events?.length ? j.events : (await getJson(`eventspastleague.php?id=${id}`))?.events || [];
    if (j?.events?.length) seasons++;
    past.push(...list);
    const def = leagues.get(id), lo = Date.now() - 864e5, hi = Date.now() + 4 * 864e5;
    for (const x of list) { const t = Date.parse(`${x.dateEvent || ''}T00:00:00Z`); if (t >= lo && t <= hi && !raw.has(x.idEvent)) raw.set(x.idEvent, { x, def }); }
  }
  const all = [...raw.values()].map((r) => r.x);
  const records = tsdbRecords([...past, ...all]);
  const events = [...raw.values()].map(({ x, def }) => tsdbEvent(x, def, records)).filter((e) => e && !e.final);
  log(`TheSportsDB: ${events.length} upcoming or live fixtures (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')} listed), ${events.filter((e) => e.live).length} live, ${events.filter((e) => e.stats.homeRecord && e.stats.awayRecord).length} with both records, from ${past.length} season events in ${busy.length} competitions (${seasons} full seasons); ${calls} requests, ${errors} failed`);
  for (const e of events.slice(0, 6)) log(`  TSDB ${e.sport} ${e.league}: ${e.home} v ${e.away} ${new Date(e.start).toISOString()} rec ${e.stats.homeRecord || '-'} / ${e.stats.awayRecord || '-'}`);
  if (calls && errors === calls) throw new Error('every request failed');
  return { events, partial: errors > 0 };
}

// ---------- Golf and motor racing (field events, data/fields.json) ----------
// Golf: each tour's event this week from ESPN, with form from the tour's previous four events.
// Racing: NASCAR Cup and IndyCar, the next (or last) race and the season standings.
const GOLF_TOURS = [['pga', 'PGA Tour'], ['lpga', 'LPGA Tour'], ['eur', 'DP World Tour'], ['champions-tour', 'PGA Tour Champions']];
const RACING = [['nascar-premier', 'NASCAR Cup Series'], ['nascar-secondary', "NASCAR O'Reilly Series"], ['nascar-truck', 'NASCAR Truck Series'], ['irl', 'IndyCar Series']];
async function fields() {
  const S = 'https://site.api.espn.com/apis/site/v2/sports';
  const getJson = async (u) => JSON.parse(await get(u));
  const ymd8 = (t) => new Date(t).toISOString().slice(0, 10).replaceAll('-', '');
  const golf = [], racing = [];
  for (const [tour, tourName] of GOLF_TOURS) {
    try {
      const cur = parseGolf((await getJson(`${S}/golf/${tour}/scoreboard`)).events?.[0], tour);
      if (!cur || cur.state === 'post' && cur.end < Date.now() - 2 * 864e5) { log(`Golf ${tour}: no current event`); continue; }
      const past = [];
      for (const w of [1, 2, 3, 4]) {
        try {
          const e = parseGolf((await getJson(`${S}/golf/${tour}/scoreboard?dates=${ymd8(cur.start - w * 7 * 864e5 + 3 * 864e5)}`)).events?.[0], tour);
          if (e && e.id !== cur.id && e.state === 'post' && e.field.length >= 30 && !past.some((x) => x.id === e.id)) past.push(e);
        } catch { /* skip that week */ }
      }
      const form = golfForm(past);
      const players = golfChances(cur, form);
      golf.push({ tour, tourName, id: cur.id, name: cur.name, start: cur.start, end: cur.end, state: cur.state, round: cur.round, detail: cur.detail,
        fieldSize: cur.field.length, formEvents: past.map((e) => e.name), players: players.slice(0, 60) });
      const top = players.slice(0, 3).map((p) => `${p.name} ${(p.win * 100).toFixed(1)}%${p.toPar != null && cur.state !== 'pre' ? ` (${p.toPar})` : ''}`).join(', ');
      log(`Golf ${tour}: ${cur.name} (${cur.state}, round ${cur.round}), ${cur.field.length} players, form from ${past.length} events (${form.size} players rated); favourites ${top || '-'}`);
    } catch (err) { log(`Golf ${tour} failed: ${err.message}`); }
  }
  for (const [series, seriesName] of RACING) {
    try {
      const sb = await getJson(`${S}/racing/${series}/scoreboard`);
      const ev = sb.events?.[0];
      const st = await getJson(`https://site.api.espn.com/apis/v2/sports/racing/${series}/standings`);
      const entries = st?.children?.[0]?.standings?.entries || [];
      if (entries[0]) log(`  ${series} standings stats: ${(entries[0].stats || []).filter((x) => (x.name || x.abbreviation) && (x.displayValue ?? x.value) != null).map((x) => `${x.name || x.abbreviation}=${x.displayValue ?? x.value}`).join(' ')}`);
      const drivers = parseStandings(st);
      const state = ev?.competitions?.[0]?.status?.type?.state || ev?.status?.type?.state || 'pre';
      const next = ev && state !== 'post' ? { name: ev.name, start: Date.parse(ev.date), state } : null;
      const last = ev && state === 'post' ? raceResult(ev) : null;
      const chances = raceChances(drivers);
      racing.push({ series, seriesName, next, last, season: st?.children?.[0]?.standings?.season || null, drivers: chances.slice(0, 40) });
      log(`Racing ${series}: ${next ? `next ${next.name} ${new Date(next.start).toISOString()}` : last ? `last ${last.name}: ${last.top.slice(0, 3).join(', ')}` : 'no race'}; ${drivers.length} drivers in standings; favourites ${chances.slice(0, 3).map((d) => `${d.name} ${(d.win * 100).toFixed(1)}%`).join(', ') || '-'}`);
    } catch (err) { log(`Racing ${series} failed: ${err.message}`); }
  }
  // MotoGP, Moto2 and Moto3 from the championship's own results feed.
  try {
    const M = 'https://api.motogp.pulselive.com/motogp/v1';
    const seasons = await getJson(`${M}/results/seasons`);
    const cur = seasons.find((x) => x.current) || seasons[0];
    const cats = await getJson(`${M}/results/categories?seasonUuid=${cur.id}`);
    const next = (await getJson(`${M}/results/events?seasonUuid=${cur.id}&isFinished=false`)).filter((e) => !e.test).sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))[0];
    for (const c of cats) {
      const name = String(c.name || '').replace(/™/g, '').trim();
      const st = await getJson(`${M}/results/standings?seasonUuid=${cur.id}&categoryUuid=${c.id}`);
      const drivers = (st.classification || []).map((r, i) => ({ id: String(r.rider?.id || i), name: r.rider?.full_name || [r.rider?.name, r.rider?.surname].filter(Boolean).join(' ') || '?', pos: r.position ?? i + 1, points: r.points ?? null, starts: null, wins: r.race_wins ?? null, top5: r.podiums ?? null, top10: null }));
      const chances = raceChances(drivers);
      racing.push({ series: `motogp-${name.toLowerCase()}`, seriesName: name, next: next ? { name: next.sponsored_name || next.name, start: Date.parse(`${next.date_end}T12:00:00Z`), state: next.status === 'NOT-STARTED' ? 'pre' : 'in' } : null, last: null, season: cur.year, drivers: chances.slice(0, 40) });
      log(`Racing ${name}: ${drivers.length} riders in standings; next ${next?.name || '-'} (${next?.date_start || '-'}); favourites ${chances.slice(0, 3).map((d) => `${d.name} ${(d.win * 100).toFixed(1)}%`).join(', ')}`);
    }
  } catch (err) { log(`MotoGP failed: ${err.message}`); }
  return { updatedAt: Date.now(), golf, racing };
}

// ---------- European leagues from their own feeds: EuroLeague, EuroCup, Liiga ----------
async function europe() {
  const getJson = async (u) => JSON.parse(await get(u, { headers: { Accept: 'application/json' } }));
  const season = euroSeason(), now = Date.now(), soon = (e) => e && (e.live || (e.start > now - 3 * 36e5 && e.start < now + 7 * 864e5));
  const out = [];
  for (const [comp, league, path] of [['E', 'EuroLeague', 'atlas/euroleague'], ['U', 'EuroCup', 'atlas/eurocup']]) {
    try {
      const games = (await getJson(EUROLEAGUE(comp, season))).data || [];
      const rec = euroRecords(games);
      const ev = games.map((g) => euroEvent(g, { comp, league, path }, rec, now)).filter((e) => soon(e) && !e.final);
      out.push(...ev);
      log(`${league}: ${ev.length} games in the next 7 days (${games.filter((g) => g.played).length} played this season, ${Object.keys(rec).length} clubs with records)${ev[0] ? `; next ${ev[0].home} v ${ev[0].away} (${ev[0].stats.homeRecord || '-'} / ${ev[0].stats.awayRecord || '-'})` : ''}`);
    } catch (err) { log(`${league} failed: ${err.message}`); problems.push(`${league} feed failed: ${err.message}`); }
  }
  try {
    const games = await getJson(LIIGA(season + 1));
    const rec = liigaRecords(games);
    const ev = games.map((g) => liigaEvent(g, rec, now)).filter(soon);
    out.push(...ev);
    log(`Liiga: ${ev.length} games in the next 7 days, ${ev.filter((e) => e.markets.length).length} with Veikkaus prices, ${games.filter((g) => g.ended).length} played${ev[0] ? `; next ${ev[0].home} v ${ev[0].away} ${ev[0].markets[0] ? ev[0].markets[0].outcomes.map((o) => o.odds).join('/') : 'unpriced'}` : ''}`);
  } catch (err) { log(`Liiga failed: ${err.message}`); problems.push(`Liiga feed failed: ${err.message}`); }
  try {
    const games = await getJson(SWISS);
    const rec = swissRecords(games);
    const ev = games.map((g) => swissEvent(g, rec, now)).filter(soon);
    out.push(...ev);
    log(`Swiss National League: ${ev.length} games in the next 7 days, ${Object.keys(rec).length} teams with records${ev[0] ? `; next ${ev[0].home} v ${ev[0].away} (${ev[0].stats.homeRecord || '-'} / ${ev[0].stats.awayRecord || '-'})` : ''}; statuses ${[...new Set(games.map((g) => g.status))].join(',')}`);
  } catch (err) { log(`Swiss NL failed: ${err.message}`); }
  return out;
}

// ---------- MMA odds ----------
// ESPN's MMA scoreboard carries no prices, but its core odds feed has DraftKings moneylines for each
// bout. That feed's "home"/"away" doesn't follow the scoreboard's fighter order, so the favourite is
// identified by name from its "details" line ("M. Gatto -115") and the prices matched to our fighters.
async function mmaOdds(events) {
  const getJson = async (u) => JSON.parse(await get(u.replace(/^http:/, 'https:')));
  const due = events.filter((e) => e.leaguePath?.startsWith('mma/') && !e.markets?.length && !e.live && e.eventId && e.start > Date.now() && e.start < Date.now() + 8 * 864e5);
  const last = (s) => String(s || '').trim().split(/\s+/).pop().toLowerCase();
  let priced = 0;
  const q = [...due];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (q.length) {
      const e = q.shift();
      const [sport, league] = e.leaguePath.split('/');
      try {
        const it = (await getJson(`${CORE}/${sport}/leagues/${league}/events/${e.eventId}/competitions/${e.compId}/odds`)).items?.find((x) => x.homeAthleteOdds && x.awayAthleteOdds);
        if (!it) continue;
        const fav = [it.homeAthleteOdds, it.awayAthleteOdds].find((x) => x.favorite) ? (it.homeAthleteOdds.favorite ? it.homeAthleteOdds : it.awayAthleteOdds) : null;
        const dog = fav === it.homeAthleteOdds ? it.awayAthleteOdds : it.homeAthleteOdds;
        const favName = last(String(it.details || '').replace(/\s*[-+]?\d+\s*$/, ''));
        const favSide = last(e.home) === favName ? 'home' : last(e.away) === favName ? 'away' : null;
        const f = toDecimal(fav?.moneyLine), d = toDecimal(dog?.moneyLine);
        if (!fav || !favSide || !f || !d) continue;
        const odds = favSide === 'home' ? { home: f, away: d } : { home: d, away: f };
        e.markets = [{ name: 'Winner', outcomes: [{ name: e.home, odds: odds.home }, { name: e.away, odds: odds.away }] }];
        e.bookmaker = it.provider?.name || 'DraftKings';
        priced++;
      } catch { /* unpriced bout */ }
    }
  }));
  log(`MMA odds (DraftKings via ESPN core): ${priced} of ${due.length} upcoming bouts priced`);
}

// ---------- build ----------
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/data`, { recursive: true });
for (const f of ['index.html', 'favicon.svg', 'manifest.webmanifest']) await copyFile(f, `${out}/${f}`);
for (const d of ['js', 'css', 'vendor', 'icons']) await cp(d, `${out}/${d}`, { recursive: true });
// Service worker, stamped with this build so visitors pick up new code on the next visit.
// The worker's version is the code version (commit), not the build time: data refreshes every few
// minutes must not count as a new version, or open tabs would reload each time (main.js reloads
// once when a new version takes over).
await writeFile(`${out}/sw.js`, (await readFile('sw.js', 'utf8')).replace('__BUILD__', (process.env.GITHUB_SHA || String(Date.now())).slice(0, 12)));
await writeFile(`${out}/.nojekyll`, '');
// Speed: bundle + minify the JavaScript (three.js and the AI model load as separate lazy chunks, unused
// code is dropped) and inline the minified CSS so nothing blocks the first paint. If esbuild isn't
// installed the plain source files are served as before.
{
  let esbuild = null;
  try { esbuild = await import('esbuild'); } catch { log('Bundling skipped (esbuild not installed): serving source files'); }
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
const ordered = [...LEAGUES.filter((l) => PRIORITY.includes(l.path)).sort((a, b) => PRIORITY.indexOf(a.path) - PRIORITY.indexOf(b.path)), ...LEAGUES.filter((l) => !PRIORITY.includes(l.path))];
const cricket = async () => {
  const res = await fetch(CRICKET_URL, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = parseCricket(await res.json());
  log(`Cricket: ${list.length} matches (${list.filter((e) => e.live).length} live)`);
  return list;
};
// Sources that failed this build: their fixtures are carried over from the last good snapshot below.
const failedSources = new Set();
const fail = (src, msg) => (e) => { failedSources.add(src); log(`${msg} failed`, e.message); problems.push(`${msg} failed: ${e.message}`); return []; };
// Finished games seen on the scoreboards (yesterday's, and the backfill below), for the results history.
const finished = [];
const [espn, npbEvents, kboEvents, cricketEvents, esportsEvents, esoccerEvents, khlEvents, tsdbEvents, euroEvents] = await Promise.all([
  fetchAll(AbortSignal.timeout(720000), ordered, { days: 4, concurrency: 3, finished }).catch((e) => { log('ESPN failed', e.message); problems.push(`ESPN scoreboards failed entirely: ${e.message}`); return []; }),
  npb().catch(fail('atlas/npb', 'NPB (Japan) schedule')),
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
  for (const [name, site, what, list, src] of [
    ['NPB', 'npb.jp', 'Japanese baseball schedule and starters', npbEvents, 'atlas/npb'], ['KBO', 'koreabaseball.com', 'Korean baseball schedule and starters', kboEvents, 'atlas/kbo'],
    ['ESPN cricket', 'espn.com', 'Cricket fixtures and scores', cricketEvents, 'atlas/cricket'], ['bo3.gg', 'bo3.gg', 'Esports (CS2, Valorant, LoL, Dota 2) with team rankings', esportsEvents],
    ['EsportsBattle', 'esportsbattle.com', 'eFootball fixtures and player form', esoccerEvents], ['KHL', 'khl.api.webcaster.pro', 'KHL schedule, live scores and records', khlEvents, 'atlas/khl'],
    ['TheSportsDB', 'thesportsdb.com', 'Darts, snooker, handball, volleyball, table tennis and more', tsdbEvents], ['League feeds', 'euroleague.net · liiga.fi · nationalleague.ch', 'EuroLeague, EuroCup, Liiga, Swiss hockey', euroEvents],
  ]) noteSource(name, site, what, src && failedSources.has(src) ? false : true, list.length, src && failedSources.has(src) ? 'failed this build: last good fixtures kept' : `${list.length} events`);
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
  const down = (e) => [...failedSources].some((src) => e.leaguePath?.startsWith(src)) || leagueStatus.get(e.leaguePath)?.ok === false;
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
        if (open && leagueByPath(path)) { checked++; if (!have.get(path)) missing.push({ path, open }); }
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

// ClubElo ratings for European club matches (the model uses them where no bookmaker price exists).
try {
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
try {
  const [world, teams] = await Promise.all([get(ELO_WORLD), get(ELO_TEAMS)]);
  const idx = eloratingsIndex(world, teams);
  // The first rows as read, so a change in the files' layout shows in the build log.
  log(`  eloratings sample: ${world.split('\n').slice(0, 2).map((l) => l.slice(0, 60)).join(' | ')} || ${teams.split('\n').slice(0, 2).map((l) => l.slice(0, 60)).join(' | ')}`);
  const intl = events.filter((e) => isInternational(e.leaguePath));
  const r = applyEloratings(events, idx);
  log(`World Football Elo: ${idx.size} teams rated; ${r.rated}/${intl.length} international matches rated`);
  if (r.unmatched.length) log(`  World Football Elo unmatched (first 30): ${r.unmatched.slice(0, 30).join(' · ')}`);
  noteSource('World Football Elo', 'eloratings.net', 'National-team ratings for the model', idx.size > 0, r.rated, idx.size ? `${r.rated} of ${intl.length} internationals rated` : 'files read but no ratings found');
} catch (err) { log('World Football Elo failed', err.message); noteSource('World Football Elo', 'eloratings.net', 'National-team ratings for the model', false, null, err.message); }

// Tennis Elo (Tennis Abstract): overall and per-surface ratings for singles matches with no price.
try {
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
  noteSource('Tennis Abstract', 'tennisabstract.com', 'Tennis Elo (overall and by surface) for the model', atp.size + wta.size > 0, r.rated, atp.size + wta.size ? `${r.rated} of ${singles.length} unpriced singles matches rated` : atpHtml || wtaHtml ? 'pages read but no ratings found' : 'the site refused the request: rankings used instead');
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
  log(`  how well the ratings called results (trusted sides): ${Object.entries(R.quality).map(([k, q]) => `${k} ${q.n} games, ${(q.right * 100).toFixed(0)}% right, Brier ${q.brier.toFixed(3)}`).join(' · ') || 'not enough yet'}`);
  noteSource('ATLAS results history', 'built from the feeds above', 'Ratings for every team and player, rest days, last meetings, form', history.length > 0, rated, `${history.length} results over ${back} days; ${rated} upcoming matches rated`);
  await writeFile(`${out}/data/results.json`, JSON.stringify({ meta: { backfilledTo: back, at: Date.now() }, ...encodeResults(history) }));
} catch (err) { log('Results history failed', err.message); noteSource('ATLAS results history', 'built from the feeds above', 'Ratings for every team and player', false, null, err.message); }

// NHL starting goalies (Daily Faceoff).
{
  const nhl = events.filter((e) => e.leaguePath === 'hockey/nhl' && e.start > Date.now() - 36e5 && e.start < Date.now() + 36 * 36e5).length;
  if (nhl) {
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
  } else noteSource('Daily Faceoff', 'dailyfaceoff.com', 'NHL starting goalies (confirmed / likely)', true, 0, 'no NHL matches in the next 36 hours');
}

// Expected goals (Understat) for the five big European leagues.
try {
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

// Match-day weather (Open-Meteo) for outdoor matches in the next 48 hours. Cities are geocoded once
// and kept in data/geo.json; forecasts are fetched for up to 50 places per request.
try {
  let geo = {};
  try { const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'geo.json'), { signal: AbortSignal.timeout(15000) }); if (r.ok) geo = await r.json(); } catch { /* first run */ }
  const due = events.filter((e) => OUTDOOR.has(e.sport) && e.place && !e.place.indoor && e.start > Date.now() - 3 * 36e5 && e.start < Date.now() + 48 * 36e5);
  const places = [...new Map(due.map((e) => [placeKey(e.place), e.place])).entries()];
  let looked = 0;
  for (const [key, p] of places) {
    if (key in geo || looked >= 150) continue; // new cities only, 150 per build at most
    looked++;
    try { geo[key] = geoFrom(JSON.parse(await get(GEOCODE(p.city))), p); } catch { /* try again next build */ }
  }
  const located = places.filter(([k]) => geo[k]);
  const fc = new Map();
  for (let i = 0; i < located.length; i += 50) {
    const batch = located.slice(i, i + 50);
    try {
      const j = JSON.parse(await get(FORECAST(batch.map(([k]) => geo[k].lat), batch.map(([k]) => geo[k].lon))));
      (Array.isArray(j) ? j : [j]).forEach((x, n) => fc.set(batch[n][0], x.hourly));
    } catch (err) { log(`Open-Meteo forecast batch failed: ${err.message}`); }
  }
  let withWeather = 0;
  for (const e of due) {
    const h = fc.get(placeKey(e.place));
    const w = h && atKickoff(h, e.start);
    if (w) { e.weather = { ...w, city: e.place.city, at: Date.now(), source: 'Open-Meteo' }; withWeather++; }
  }
  log(`Weather (Open-Meteo): ${withWeather}/${due.length} outdoor matches in the next 48h; ${located.length}/${places.length} places located (${looked} new lookups)`);
  noteSource('Open-Meteo', 'open-meteo.com', 'Kick-off weather for outdoor matches', !due.length || withWeather > 0, withWeather, `${withWeather} of ${due.length} outdoor matches in the next 48 hours`);
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
  log(`football-data.co.uk: ${fixtures.length} fixtures with odds (file ${age}); priced ${res.priced} unpriced match(es)`);
  if (res.unmatched.length) log(`  football-data unmatched (first 30): ${res.unmatched.slice(0, 30).join(' · ')}`);
  noteSource('football-data.co.uk', 'football-data.co.uk', 'Pinnacle / average odds for European leagues', fixtures.length > 0, res.priced, `${res.priced} matches priced from ${fixtures.length} fixtures; file ${age}`);
} catch (e) { log(`football-data.co.uk failed: ${e.message}`); noteSource('football-data.co.uk', 'football-data.co.uk', 'Pinnacle / average odds for European leagues', false, null, e.message); }
// Bookmaker odds from The Odds API (ODDS_API_KEY repository secret), used sparingly: the free plan has
// 500 credits a month, so paid odds are only fetched for matches no other source prices.
//  1. The in-season sports list and each sport key's fixture list cost no credits. The fixture lists
//     (kept in data/odds-extra.json, each refreshed every 6 hours) tie every key to the matches here it
//     covers, and add the matches in the next 3 days the bookmakers list that no feed here does
//     (catalog: "Other competitions"), so nothing they offer is missing from the board.
//  2. A key is due for odds only if it has matches in the next 3 days with no price from ESPN,
//     football-data.co.uk or the other feeds, and its last odds are older than ODDS_HOURS (default
//     12). The most such matches first; credits spent at an even pace to the end of the month.
//  3. Odds already held merge (free) onto every match of their key: the best price across bookmakers
//     and the consensus fair chance (oddsapi.js).
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
    const wanted = active.map((k) => ({ k, n: need(k), at: cache.at?.[k] || 0 })).filter((x) => x.n > 0);
    const due = wanted.filter((x) => !(x.at > Date.now() - maxAgeH * 36e5)).sort((x, y) => y.n - x.n || x.at - y.at).slice(0, allowance);
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
    let priced = 0;
    for (const [k, list] of Object.entries(sports)) priced += matchOdds(byKey[k] || [], list, { force: true, fetchedAt: at[k] });
    const bySport = {};
    for (const e of events) if (e.oddsSource === 'the-odds-api') bySport[e.sport] = (bySport[e.sport] || 0) + 1;
    const added = Object.values(addedBy).reduce((x, y) => x + y, 0);
    log(`Odds API: ${active.length} sports in season; ${listed} fixture lists read (free), ${Object.keys(lists).length} held; ${added} matches added that no feed here lists`);
    if (added) log(`  added: ${Object.entries(addedBy).sort((x, y) => y[1] - x[1]).map(([t, n]) => `${t} ${n}`).join(' · ')}`);
    log(`  need odds (no other price, next 3 days): ${wanted.sort((x, y) => y.n - x.n).map((x) => `${x.k} ${x.n}`).join(' · ') || 'none'}`);
    log(`  fetched ${due.map((x) => x.k).join(', ') || 'nothing'} (allowance ${allowance}, one fetch per ${Number.isFinite(gap) ? Math.round(gap / 6e4) : '?'} min, ${per} credit(s) each) [${markets} @ ${regions}]; credits used ${used}, remaining ${credits ?? '?'}; ${Object.keys(sports).length} sports held`);
    log(`  priced ${priced} matches: ${Object.entries(bySport).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}`);
    await writeFile(`${out}/data/odds-extra.json`, JSON.stringify(cache));
    noteSource('The Odds API', 'the-odds-api.com', 'Fixtures the bookmakers list; best price and consensus fair chance where nothing else prices a match', true, priced, `${priced} matches priced, ${added} added from the bookmakers' lists; ${credits ?? '?'} credits left this month`);
  } catch (e) { log(`Odds API failed: ${e.message}`); noteSource('The Odds API', 'the-odds-api.com', 'Fixtures the bookmakers list; best price and consensus fair chance where nothing else prices a match', false, null, e.message); }
} else noteSource('The Odds API', 'the-odds-api.com', 'Fixtures the bookmakers list; best price and consensus fair chance where nothing else prices a match', null, null, 'not switched on: add an ODDS_API_KEY repository secret');
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
// Per-provider status across builds: when it was last tried, when it last worked (carried from the
// previous published report), and what kind of failure it was. A source that worked but found
// nothing (ok true, count 0) is an empty result, not a failure.
{
  let prev = [];
  try { const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'sources.json'), { signal: AbortSignal.timeout(15000) }); if (r.ok) prev = (await r.json()).sources || []; } catch { /* first run */ }
  const before = new Map(prev.map((x) => [x.name, x]));
  const category = (note) => (/\b40[13]\b|forbidden|unauthori/i.test(note) ? 'blocked' : /\b429\b|rate/i.test(note) ? 'rate limited' : /\b5\d\d\b/.test(note) ? 'provider error'
    : /timeout|abort/i.test(note) ? 'timeout' : /fetch failed|ENOTFOUND|ECONN|network/i.test(note) ? 'network' : /\b404\b/.test(note) ? 'not found' : 'unreadable response');
  for (const x of sources) {
    const p = before.get(x.name);
    x.lastAttemptAt = x.at;
    x.lastSuccessAt = x.ok === true ? x.at : p?.lastSuccessAt ?? (p?.ok === true ? p.at : null);
    x.status = x.ok === true ? (x.count === 0 ? 'empty' : 'ok') : x.ok === false ? 'failed' : 'off';
    x.errorCategory = x.ok === false ? category(String(x.note || '')) : null;
  }
}
await writeFile(`${out}/data/sources.json`, JSON.stringify({ at: Date.now(), sources }));
await writeFile(`${out}/data/index.json`, JSON.stringify({ source: 'ATLAS snapshot', fetchedAt: Date.now(), leagueStatus: Object.fromEntries(leagueStatus), events }));
// Back-compat file name used by older builds of the front end.
await writeFile(`${out}/data/odds.json`, JSON.stringify({ source: 'ATLAS snapshot', fetchedAt: Date.now(), events }));
if (fetchErrors.length) log('ESPN errors (first 20):', fetchErrors.join(' | '));
log(`ESPN: ${espn.length} events`);
{
  const failedLeagues = [...leagueStatus.entries()].filter(([, st]) => !st.ok).map(([p]) => p);
  if (espn.length < 150) problems.push(`Only ${espn.length} ESPN games loaded (normally 500+): ESPN may have changed its API again`);
  if (failedLeagues.length > LEAGUES.length * 0.15) problems.push(`${failedLeagues.length} of ${LEAGUES.length} leagues failed to load: ${failedLeagues.slice(0, 12).join(', ')}${failedLeagues.length > 12 ? ' …' : ''}`);
  const soccerSoon = events.filter((e) => e.leaguePath?.startsWith('soccer/') && e.start < Date.now() + 2 * 864e5).length;
  if (soccerSoon > 30 && !events.some((e) => e.absences)) problems.push(`FotMob linked no soccer matches (${soccerSoon} soccer games in the next 2 days): injuries and lineups missing`);
  await writeFile(`${out}/data/health.json`, JSON.stringify({ checkedAt: Date.now(), ok: !problems.length, problems, espnGames: espn.length, failedLeagues }));
  log(problems.length ? `DATA HEALTH: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}` : 'DATA HEALTH: ok');
}
log(`Pages build: ${events.length} events across ${Object.keys(byLeague).length} leagues`);
log(Object.entries(byLeague).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));

