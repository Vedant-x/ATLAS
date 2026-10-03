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
import { absencesFor } from '../js/fotmob.js';
import { enrichMlb, formOf } from '../js/mlbstats.js';
import { mkdir, copyFile, cp, writeFile, rm } from 'node:fs/promises';
import { fetchAll, LEAGUES, fetchErrors } from '../js/espn.js';
import { leagueByPath } from '../js/catalog.js';

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

// Pitching table rows as cells; NPB splits innings into whole + ".1"/".2" cells, which are merged back.
function rowsOf(tableHtml) {
  return [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) => {
    const cells = [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => clean(c[1])).filter((c) => c !== '');
    return cells.reduce((a, c) => { if (/^\.\d$/.test(c) && a.length && /^\d+$/.test(a[a.length - 1])) a[a.length - 1] += c; else a.push(c); return a; }, []);
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
      if (scores.every((s) => /^\d+$/.test(s))) continue; // finished
      const [hc, ac] = codes;
      const s0 = starters.get(`${hc}-${ac}`);
      // The starters page covers one date; series repeat the same pairing, so match the date too.
      const st = s0 && Number(s0.month) === d.getUTCMonth() + 1 && Number(s0.day) === d.getUTCDate() ? s0 : null;
      events.push({
        id: `atlas_npb-${key}-${hc}-${ac}`, sport: 'baseball', league: 'NPB', leaguePath: 'atlas/npb', group: 'Pro',
        home: NPB_TEAMS[hc] || hc, away: NPB_TEAMS[ac] || ac,
        start: time ? Date.parse(`${d.toISOString().slice(0, 10)}T${time[1].padStart(2, '0')}:${time[2]}:00+09:00`) : Date.parse(`${d.toISOString().slice(0, 10)}T09:00:00Z`),
        live: false, venue: round.replace(/\d{1,2}:\d{2}/, '').trim(), markets: [], stats: {}, lineups: null,
        colors: { home: NPB_COLORS[hc], away: NPB_COLORS[ac] },
        probables: st ? [{ side: 'home', npbId: st.home, role: 'SP' }, { side: 'away', npbId: st.away, role: 'SP' }] : [],
        source: 'NPB official', sourceUrl: `https://npb.jp/bis/eng/${key.slice(0, 4)}/games/gm${key}.html`,
      });
    }
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
  const T = (html) => [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => { const rows = rowsOf(m[0]); return { h: rows[0] || [], rows: rows.slice(1) }; });
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
        live: g.GAME_STATE_SC === '2', score: g.GAME_STATE_SC === '2' ? `${g.B_SCORE_CN} – ${g.T_SCORE_CN}` : null,
        venue: g.S_NM, broadcast: g.TV_IF || null, markets: [], lineups: null,
        stats: { homeRank: g.B_RANK_NO, awayRank: g.T_RANK_NO },
        colors: { home: KBO_COLORS[g.HOME_ID], away: KBO_COLORS[g.AWAY_ID] },
        probables, source: 'KBO official', sourceUrl: 'https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx',
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

// ---------- build ----------
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/data`, { recursive: true });
for (const f of ['index.html', 'favicon.svg']) await copyFile(f, `${out}/${f}`);
for (const d of ['js', 'css', 'vendor']) await cp(d, `${out}/${d}`, { recursive: true });
await writeFile(`${out}/.nojekyll`, '');

// ESPN throttles bursts from one server, so fetch the most-followed leagues first; any league the
// build misses is still loaded live in the visitor's browser when its sport/league page opens.
const PRIORITY = ['basketball/nba', 'football/nfl', 'hockey/nhl', 'baseball/mlb', 'basketball/wnba', 'football/college-football', 'tennis/atp', 'tennis/wta', 'mma/ufc',
  'soccer/eng.1', 'soccer/esp.1', 'soccer/ger.1', 'soccer/ita.1', 'soccer/fra.1', 'soccer/uefa.champions', 'soccer/uefa.europa', 'soccer/uefa.europa.conf', 'soccer/usa.1', 'soccer/mex.1',
  'basketball/mens-college-basketball', 'rugby/267979', 'rugby/270557', 'australian-football/afl', 'rugby-league/3', 'football/cfl'];
const ordered = [...LEAGUES.filter((l) => PRIORITY.includes(l.path)).sort((a, b) => PRIORITY.indexOf(a.path) - PRIORITY.indexOf(b.path)), ...LEAGUES.filter((l) => !PRIORITY.includes(l.path))];
const [espn, npbEvents, kboEvents] = await Promise.all([
  fetchAll(AbortSignal.timeout(300000), ordered, { days: 4, concurrency: 2 }).catch((e) => { log('ESPN failed', e.message); return []; }),
  npb().catch((e) => { log('NPB failed', e.message); return []; }),
  kbo().catch((e) => { log('KBO failed', e.message); return []; }),
]);
const events = [...espn, ...npbEvents, ...kboEvents].filter((e) => leagueByPath(e.leaguePath));

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
log(`FotMob: ${absMatched}/${soccer.length} soccer matches linked, ${absFound} absences`);

// MLB starters: full reports from the official MLB Stats API.
const mlbN = await enrichMlb(events, { signal: AbortSignal.timeout(90000), addMissing: true }).catch((e) => { log('MLB Stats API failed', e.message); return 0; });
log(`MLB Stats API: ${mlbN} starter reports`);
// One line per starter so a broken parser shows up in the build log.
for (const e of events) for (const p of (e.probables || []).filter((x) => x.report).slice(0, 2)) {
  const r = p.report;
  log(`  SP ${r.league} ${r.name || '?'} (${e.away} @ ${e.home}) · ${r.throws || '?'}HP age ${r.age ?? '?'} · season ERA ${r.season?.era ?? '-'} WHIP ${r.season?.whip ?? '-'} K/9 ${r.season?.k9 ?? '-'} · recent ${r.recent?.length || 0} · form3 ${r.form3?.era ?? '-'} · splits ${r.splits?.length || 0} · years ${r.years?.length || 0} · vsOpp ${r.vsOpp ? r.vsOpp.avg ?? r.vsOpp.era : '-'} · inj ${r.injuries?.length || 0} · rest ${r.rest ?? '-'}${r.error ? ` · ERROR ${r.error}` : ''}`);
}
const byLeague = {};
for (const e of events) byLeague[e.leaguePath] = (byLeague[e.leaguePath] || 0) + 1;
await writeFile(`${out}/data/index.json`, JSON.stringify({ source: 'ATLAS snapshot', fetchedAt: Date.now(), events }));
// Back-compat file name used by older builds of the front end.
await writeFile(`${out}/data/odds.json`, JSON.stringify({ source: 'ATLAS snapshot', fetchedAt: Date.now(), events }));
if (fetchErrors.length) log('ESPN errors (first 20):', fetchErrors.join(' | '));
log(`ESPN: ${espn.length} events`);
log(`Pages build: ${events.length} events across ${Object.keys(byLeague).length} leagues`);
log(Object.entries(byLeague).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
