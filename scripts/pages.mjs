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
import { CORE, PROVIDER, PROP_STATS, parseProps } from '../js/props.js';

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
  let lines = 0, matched = 0, failed = 0;
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
      const [h, a] = await Promise.all([roster(e.leaguePath, e.teamIds.home), roster(e.leaguePath, e.teamIds.away)]);
      const extra = new Map();
      const refs = [...new Set(items.map((x) => x.athlete?.$ref).filter((r) => r && !h.has(/athletes\/(\d+)/.exec(r)?.[1]) && !a.has(/athletes\/(\d+)/.exec(r)?.[1])))].slice(0, 25);
      for (const r of refs) { const x = await athlete(r); if (x?.name) extra.set(/athletes\/(\d+)/.exec(r)[1], { name: x.name, side: x.team === String(e.teamIds.home) ? 'home' : x.team === String(e.teamIds.away) ? 'away' : null }); }
      const who = (id) => (h.has(id) ? { name: h.get(id), side: 'home' } : a.has(id) ? { name: a.get(id), side: 'away' } : extra.get(id) || null);
      e.props = parseProps(items, sport, who);
      if (e.props.length) { matched++; lines += e.props.length; }
    }
  }));
  log(`Player props (DraftKings via ESPN): ${lines} lines on ${matched} of ${due.length} matches in the next 36h${failed ? `, ${failed} lookup(s) failed` : ''}`);
  for (const e of due.filter((x) => x.props?.length).slice(0, 3)) log(`  PROPS ${e.away} @ ${e.home}: ${e.props.slice(0, 4).map((x) => `${x.player} ${x.target}+ ${x.label} @${x.odds}`).join(' · ')}`);
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
    const css = (await esbuild.transform(await readFile('css/style.css', 'utf8'), { loader: 'css', minify: true })).code;
    const html = (await readFile(`${out}/index.html`, 'utf8')).replace('<link rel="stylesheet" href="css/style.css" />', () => `<style>${css}</style>`);
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
const [espn, npbEvents, kboEvents, cricketEvents, esportsEvents, esoccerEvents] = await Promise.all([
  fetchAll(AbortSignal.timeout(720000), ordered, { days: 4, concurrency: 3 }).catch((e) => { log('ESPN failed', e.message); problems.push(`ESPN scoreboards failed entirely: ${e.message}`); return []; }),
  npb().catch((e) => { log('NPB failed', e.message); problems.push(`NPB (Japan) schedule failed: ${e.message}`); return []; }),
  kbo().catch((e) => { log('KBO failed', e.message); problems.push(`KBO (Korea) schedule failed: ${e.message}`); return []; }),
  cricket().catch((e) => { log('Cricket failed', e.message); problems.push(`Cricket feed failed: ${e.message}`); return []; }),
  esports().catch((e) => { log('Esports failed', e.message); problems.push(`Esports feed (bo3.gg) failed: ${e.message}`); return []; }),
  esoccer().catch((e) => { log('eSoccer failed', e.message); problems.push(`eSoccer feed (EsportsBattle) failed: ${e.message}`); return []; }),
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
// Known leagues only, and no stale fixtures: a game that started 12+ hours ago and isn't live is over.
const events = [...espn, ...npbEvents, ...kboEvents, ...cricketEvents, ...esportsEvents, ...esoccerEvents].filter((e) => leagueByPath(e.leaguePath) && (e.live || !(e.start < Date.now() - 12 * 36e5)));

// Carry-forward: start from the previously published snapshot and restore anything a source has
// since dropped for a match that hasn't finished: announced starters (the NPB page shows only one
// day's starters and moves on to tomorrow's by mid-afternoon), absences and lineups. Sources can
// only add or change information, never silently remove it.
{
  let prev = [];
  try {
    const r = await fetch(process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json', { signal: AbortSignal.timeout(20000) });
    if (r.ok) prev = (await r.json()).events || [];
  } catch (err) { log(`Carry-forward: previous snapshot unavailable (${err.message})`); }
  const old = new Map(prev.map((e) => [e.id, e]));
  let starters = 0, news = 0;
  for (const e of events) {
    const o = old.get(e.id);
    if (!o || e.start < Date.now() - 6 * 36e5) continue;
    const kept = (o.probables || []).filter((p) => p.report || p.npbId || p.kboId || p.name);
    if (!(e.probables || []).length && kept.length) { e.probables = kept; starters++; }
    else if (kept.length) {
      for (const p of kept) if (!e.probables.some((x) => x.side === p.side)) { e.probables.push(p); starters++; }
    }
    if (!e.absences && o.absences) { e.absences = o.absences; news++; }
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
  let checked = 0;
  for (const [sport, prefix] of [['soccer', 'soccer'], ['basketball', 'basketball'], ['football', 'football'], ['hockey', 'hockey'], ['baseball', 'baseball'], ['mma', 'mma']]) {
    try {
      const j = await (await fetch(`https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=${sport}`, { headers: H, signal: AbortSignal.timeout(15000) })).json();
      for (const lg of j.sports?.flatMap((x) => x.leagues || []) || []) {
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
  log(`Completeness check: ${checked} league(s) with games today on ESPN compared, ${missing.length} missing games${missing.length ? `, ${recovered} recovered` : ''}`);
  if (!checked) { log('  COMPLETENESS: the check compared nothing - ESPN header format may have changed'); problems.push('Completeness check compared nothing (ESPN header format may have changed)'); }
}

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
log(`FotMob: ${absMatched}/${soccer.length} soccer matches linked, ${absFound} absences, ${soccer.filter((e) => e.absences?.lineup).length} lineups (${soccer.filter((e) => e.absences?.lineup && !['lastStarting11', 'predicted'].includes(e.absences.lineup.type)).length} confirmed), ${Object.keys(injNames).length} injury names`);

// MLB starters: full reports from the official MLB Stats API.
const mlbN = await enrichMlb(events, { signal: AbortSignal.timeout(90000), addMissing: true }).catch((e) => { log('MLB Stats API failed', e.message); return 0; });
log(`MLB Stats API: ${mlbN} starter reports`);
// Validate every starter report: shifted or impossible numbers are dropped (and logged), then
// recent form is recomputed from the rows that survived.
let dropped = 0;
for (const e of events) for (const p of (e.probables || []).filter((x) => x.report)) {
  p.report.fetchedAt ??= e.fetchedAt || Date.now();
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
await playerProps(events).catch((e) => log('Player props failed', e.message));
// Formula 1 weekend (its own file: a race is a field of 20+ drivers, not a two-sided match).
{
  let prevF1 = null;
  try { const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'f1.json'), { signal: AbortSignal.timeout(15000) }); if (r.ok) prevF1 = await r.json(); } catch { /* first build */ }
  const data = await f1(prevF1).catch((e) => { log('F1 failed', e.message); problems.push(`Formula 1 data failed: ${e.message}`); return null; });
  if (data) await writeFile(`${out}/data/f1.json`, JSON.stringify(data));
  else if (prevF1) await writeFile(`${out}/data/f1.json`, JSON.stringify(prevF1));
}
const byLeague = {};
for (const e of events) byLeague[e.leaguePath] = (byLeague[e.leaguePath] || 0) + 1;
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

// Collect at the end so the long sports build does not age the odds before publication.
// API keys remain in the process environment; only sanitized quotes go into the Pages artifact.
