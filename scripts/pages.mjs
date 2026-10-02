#!/usr/bin/env node
// Builds the static GitHub Pages site into dist/pages, with data/index.json holding every fixture ATLAS
// tracks for the next few days:
//   - ESPN scoreboards for every league in js/catalog.js
//   - NPB (official npb.jp): schedule, probable starters and their season / career pitching lines
//   - KBO (official koreabaseball.com): schedule, starters, season line and last-10-game log
// The browser refreshes scores and per-match detail live from ESPN; this file is the catalogue + the
// Japan/Korea data that only the official league sites carry.
import { mkdir, copyFile, cp, writeFile, rm } from 'node:fs/promises';
import { fetchAll, LEAGUES } from '../js/espn.js';
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

async function npbPitcher(id) {
  // English player page first, Japanese page as fallback.
  for (const [url, map] of [
    [`https://npb.jp/bis/eng/players/${id}.html`, { year: ['Year'], g: ['G'], w: ['W'], l: ['L'], ip: ['IP'], h: ['H'], bb: ['BB'], so: ['SO'], hr: ['HR'], era: ['ERA'], team: ['Team'] }],
    [`https://npb.jp/bis/players/${id}.html`, { year: ['年度'], g: ['登板'], w: ['勝利'], l: ['敗北'], ip: ['投球回'], h: ['安打'], bb: ['四球'], so: ['三振'], hr: ['本塁打'], era: ['防御率'], team: ['所属球団'] }],
  ]) {
    try {
      const html = await get(url);
      const name = clean(html.match(/<li id="pc_v_name">([\s\S]*?)<\/li>/)?.[1] || html.match(/<title>([^|<]*)/)?.[1] || '');
      const t = tables(html).find((x) => x.headers.some((h) => map.era.includes(h)) && x.headers.some((h) => map.ip.includes(h)));
      if (!t) continue;
      const line = (row) => {
        const v = Object.fromEntries(Object.entries(map).map(([k, names]) => [k, pick(t.headers, row, names)]));
        return { ...v, whip: whip(v.h, v.bb, v.ip), k9: ipToOuts(v.ip) ? ((Number(v.so) * 27) / ipToOuts(v.ip)).toFixed(2) : null };
      };
      const yearRows = t.rows.filter((r) => /^\d{4}$/.test(pick(t.headers, r, map.year) || ''));
      const season = yearRows.filter((r) => pick(t.headers, r, map.year) === String(new Date().getFullYear())).map(line)[0] || null;
      const totalRow = t.rows.find((r) => /total|通算/i.test(r[0] || ''));
      return { id, name, season, career: totalRow ? line(totalRow) : null, seasons: yearRows.slice(-3).map(line), source: url };
    } catch { /* try next */ }
  }
  return { id, name: null, season: null, career: null, seasons: [] };
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
  // Pitcher lines for every announced starter.
  for (const e of events) {
    for (const p of e.probables) {
      const s = await npbPitcher(p.npbId);
      Object.assign(p, { name: s.name || `NPB #${p.npbId}`, pitching: s });
    }
  }
  log(`NPB: ${events.length} games, ${events.filter((e) => e.probables.length).length} with starters`);
  return events;
}

// ---------- KBO ----------
const KBO_TEAMS = { OB: 'Doosan Bears', LG: 'LG Twins', HT: 'KIA Tigers', SS: 'Samsung Lions', LT: 'Lotte Giants', KT: 'KT Wiz', SK: 'SSG Landers', NC: 'NC Dinos', WO: 'Kiwoom Heroes', HH: 'Hanwha Eagles' };
const KBO_COLORS = { OB: '#131230', LG: '#c30452', HT: '#ea0029', SS: '#074ca1', LT: '#041e42', KT: '#000000', SK: '#ce0e2d', NC: '#315288', WO: '#570514', HH: '#fc4e00' };

async function kboPitcher(id) {
  try {
    const html = await get(`https://www.koreabaseball.com/Record/Player/PitcherDetail/Basic.aspx?playerId=${id}`);
    const name = clean(html.match(/playerProfile_lblName">([^<]*)</)?.[1]);
    const ts = tables(html);
    const t1 = ts.find((t) => t.headers.includes('ERA') && t.headers.includes('IP') && t.headers.includes('W'));
    const t2 = ts.find((t) => t.headers.includes('WHIP') && t.headers.includes('SO'));
    const t3 = ts.find((t) => t.headers.includes('TBF') && t.headers.some((h) => /일자/.test(h)));
    const r1 = t1?.rows[0], r2 = t2?.rows[0];
    const season = r1 ? {
      era: pick(t1.headers, r1, ['ERA']), g: pick(t1.headers, r1, ['G']), w: pick(t1.headers, r1, ['W']), l: pick(t1.headers, r1, ['L']),
      ip: pick(t1.headers, r1, ['IP']), h: pick(t1.headers, r1, ['H']), hr: pick(t1.headers, r1, ['HR']),
      bb: r2 ? pick(t2.headers, r2, ['BB']) : null, so: r2 ? pick(t2.headers, r2, ['SO']) : null,
      whip: r2 ? pick(t2.headers, r2, ['WHIP']) : null, avg: r2 ? pick(t2.headers, r2, ['AVG']) : null, qs: r2 ? pick(t2.headers, r2, ['QS']) : null,
    } : null;
    const recent = (t3?.rows || []).slice(0, 10).map((r) => ({ date: r[0], opp: r[2], result: r[3], era: r[4], ip: r[6], h: r[7], hr: r[8], bb: r[9], so: r[11], er: r[13] }));
    return { id, name, season, recent, source: `https://www.koreabaseball.com/Record/Player/PitcherDetail/Basic.aspx?playerId=${id}` };
  } catch (e) { return { id, name: null, season: null, recent: [], error: e.message }; }
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
  for (const e of events) for (const p of e.probables) p.pitching = await kboPitcher(p.kboId);
  log(`KBO: ${events.length} games, ${events.filter((e) => e.probables.length).length} with starters`);
  return events;
}

// ---------- build ----------
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/data`, { recursive: true });
for (const f of ['index.html', 'favicon.svg']) await copyFile(f, `${out}/${f}`);
for (const d of ['js', 'css', 'vendor']) await cp(d, `${out}/${d}`, { recursive: true });
await writeFile(`${out}/.nojekyll`, '');

const [espn, npbEvents, kboEvents] = await Promise.all([
  fetchAll(AbortSignal.timeout(120000), LEAGUES, { days: 4, concurrency: 10 }).catch((e) => { log('ESPN failed', e.message); return []; }),
  npb().catch((e) => { log('NPB failed', e.message); return []; }),
  kbo().catch((e) => { log('KBO failed', e.message); return []; }),
]);
const events = [...espn, ...npbEvents, ...kboEvents].filter((e) => leagueByPath(e.leaguePath));
const byLeague = {};
for (const e of events) byLeague[e.leaguePath] = (byLeague[e.leaguePath] || 0) + 1;
await writeFile(`${out}/data/index.json`, JSON.stringify({ source: 'ATLAS snapshot', fetchedAt: Date.now(), events }));
// Back-compat file name used by older builds of the front end.
await writeFile(`${out}/data/odds.json`, JSON.stringify({ source: 'ATLAS snapshot', fetchedAt: Date.now(), events }));
log(`Pages build: ${events.length} events across ${Object.keys(byLeague).length} leagues`);
log(Object.entries(byLeague).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
