// Build source (run by scripts/pages.mjs): KBO.
import { get, clean, day, ymd, log } from '../lib.mjs';
import { rowsOf, derived, ageFrom } from './npb.mjs';
import { kboLive } from '../../js/asia-live.js';
import { formOf } from '../../js/mlbstats.js';

export const KBO_TEAMS = { OB: 'Doosan Bears', LG: 'LG Twins', HT: 'KIA Tigers', SS: 'Samsung Lions', LT: 'Lotte Giants', KT: 'KT Wiz', SK: 'SSG Landers', NC: 'NC Dinos', WO: 'Kiwoom Heroes', HH: 'Hanwha Eagles' };
export const KBO_COLORS = { OB: '#131230', LG: '#c30452', HT: '#ea0029', SS: '#074ca1', LT: '#041e42', KT: '#000000', SK: '#ce0e2d', NC: '#315288', WO: '#570514', HH: '#fc4e00' };

export const KBO_KR = { KIA: 'KIA Tigers', LG: 'LG Twins', NC: 'NC Dinos', SSG: 'SSG Landers', KT: 'KT Wiz', 삼성: 'Samsung Lions', 두산: 'Doosan Bears', 롯데: 'Lotte Giants', 한화: 'Hanwha Eagles', 키움: 'Kiwoom Heroes' };
export const KBO_RES = { 승: 'W', 패: 'L', 세: 'SV', 홀: 'HLD' };
export const kboIp = (s) => { const m = String(s || '').match(/^(\d+)?\s*(?:(\d)\/3)?$/); return m ? `${m[1] || 0}.${m[2] || 0}` : s; };

export async function kboPitcher(id, oppName) {
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

export async function kbo() {
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
