// Build source (run by scripts/pages.mjs): NPB.
import { get, clean, day, ymd, log, ipToOuts, whip } from '../lib.mjs';
import { parseNpbScoreboard, npbBoxStarters } from '../../js/asia-live.js';
import { formOf } from '../../js/mlbstats.js';

export const NPB_TEAMS = { g: 'Yomiuri Giants', t: 'Hanshin Tigers', db: 'Yokohama DeNA BayStars', c: 'Hiroshima Toyo Carp', s: 'Tokyo Yakult Swallows', d: 'Chunichi Dragons', h: 'Fukuoka SoftBank Hawks', f: 'Hokkaido Nippon-Ham Fighters', b: 'ORIX Buffaloes', e: 'Tohoku Rakuten Golden Eagles', l: 'Saitama Seibu Lions', m: 'Chiba Lotte Marines' };
export const NPB_COLORS = { g: '#f97709', t: '#ffe100', db: '#0055a5', c: '#e60012', s: '#00a73c', d: '#002569', h: '#f9c304', f: '#006298', b: '#000019', e: '#860010', l: '#1f366a', m: '#221815' };

// Table rows as cells. `keepEmpty` keeps blank cells and expands colspan so every value stays in its
// column (KBO tables leave cells blank, e.g. no decision, and merge "연도+팀명" on the career row).
// Without it, blanks are dropped and NPB's split innings ("5" + ".1") are merged back into "5.1".
export function rowsOf(tableHtml, { keepEmpty = false } = {}) {
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
export const per9 = (x, ip) => { const o = ipToOuts(ip); return o ? ((Number(x) * 27) / o).toFixed(2) : null; };
export const derived = (v) => ({ ...v, whip: v.whip ?? whip(v.h, v.bb, v.ip), k9: per9(v.so, v.ip), bb9: per9(v.bb, v.ip), hr9: per9(v.hr, v.ip), kbb: Number(v.bb) ? (Number(v.so) / Number(v.bb)).toFixed(2) : null });
export const ageFrom = (born) => { const t = Date.parse(born); return Number.isFinite(t) ? Math.floor((Date.now() - t) / 31557600000) : null; };

// The player page nests a small table inside every innings cell, so tables can't be cut out with a
// regex. The page text is read as one token stream instead: the pitching header runs from "Year Team"
// to "ERA", then a row per 4-digit year (full width) or "Totals" (no team), until the batting table's
// own "Year" header. Innings print as "385 .1" and are merged back into "385.1".
export function npbYearTable(html) {
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

export async function npbPitcher(id) {
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
export async function npbRecent(targets, days = 16) {
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

export async function npb() {
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
