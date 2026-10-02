// Discovery run #3: KBO + NPB official sources (starters and pitcher stats).
const UA = { 'User-Agent': 'Mozilla/5.0 (ATLAS research dashboard)' };
const get = async (u, opt = {}) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(20000), ...opt, headers: { ...UA, ...opt.headers } }); return { s: r.status, t: await r.text() }; } catch (e) { return { s: 'ERR ' + e.message, t: '' }; } };
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const now = new Date();
// KBO JSON (used by the desk server)
for (const off of [0, 1, -1]) {
  const d = new Date(+now + off * 864e5);
  const r = await get('https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ leId: '1', srId: '0,1,3,4,5,6,7,8,9', date: ymd(d) }) });
  console.log(`KBO ${ymd(d)} status=${r.s} len=${r.t.length}`);
  console.log(r.t.slice(0, 2500));
}
// KBO pitcher record page candidates
for (const u of ['https://eng.koreabaseball.com/Stats/PitchingByPlayer.aspx', 'https://www.koreabaseball.com/Record/Player/PitcherBasic/Basic1.aspx']) {
  const r = await get(u);
  const i = r.t.search(/ERA|평균자책/);
  console.log(`KBOSTATS ${u} ${r.s} len=${r.t.length} idx=${i} :: ${r.t.slice(Math.max(0, i - 400), i + 1800).replace(/\s+/g, ' ')}`);
}
// NPB probable starters page
const n = await get('https://npb.jp/announcement/starter/');
const k = n.t.indexOf('starter');
console.log(`NPB starter page ${n.s} len=${n.t.length}`);
const body = n.t.slice(n.t.indexOf('<main') > 0 ? n.t.indexOf('<main') : 0).replace(/\s+/g, ' ');
console.log(body.slice(0, 6000));
// NPB English stats page for pitchers (league leaders / team pitching)
for (const u of ['https://npb.jp/bis/eng/2026/stats/', 'https://npb.jp/bis/eng/2026/stats/pit_c.html', 'https://npb.jp/bis/eng/2026/stats/idp1_g.html']) {
  const r = await get(u);
  console.log(`NPBSTATS ${u} ${r.s} len=${r.t.length} :: ${r.t.replace(/\s+/g, ' ').slice(1500, 4000)}`);
}
