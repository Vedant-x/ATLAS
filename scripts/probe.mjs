// Discovery run #5: KBO JSON fields + pitcher detail page, NPB starter table + English game page.
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };
const get = async (u, opt = {}) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(20000), ...opt, headers: { ...H, ...opt.headers } }); return { s: r.status, t: await r.text() }; } catch (e) { return { s: 'ERR ' + e.message, t: '' }; } };
const flat = (t) => t.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/\s+/g, ' ');
const kbo = async (date) => { const r = await get('https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx', Origin: 'https://www.koreabaseball.com' }, body: `leId=1&srId=0%2C1%2C3%2C4%2C5%2C6%2C7%2C8%2C9&date=${date}` }); try { return JSON.parse(r.t); } catch { return null; } };
const d1 = await kbo('20261001');
const g = d1?.game?.[0];
console.log('KBO keys', Object.keys(g || {}).join(','));
console.log('KBO game', JSON.stringify(Object.fromEntries(Object.entries(g || {}).filter(([, v]) => v !== null && v !== '' && v !== 0))));
const d3 = await kbo('20261003');
console.log('KBO tomorrow', JSON.stringify((d3?.game || []).map((x) => [x.G_ID, x.G_TM, x.AWAY_NM, x.HOME_NM, x.T_P_ID, x.T_P_NM, x.B_P_ID, x.B_P_NM, x.S_NM])));
const pid = g?.T_P_ID || g?.B_P_ID || (d1?.game || []).map((x) => x.T_P_ID).find(Boolean);
if (pid) {
  const p = await get(`https://www.koreabaseball.com/Record/Player/PitcherDetail/Basic.aspx?playerId=${pid}`);
  const f = flat(p.t); const i = f.indexOf('<table');
  console.log('KBO pitcher detail', p.s, f.slice(f.indexOf('player_info') > 0 ? f.indexOf('player_info') : 0, (f.indexOf('player_info') > 0 ? f.indexOf('player_info') : 0) + 800));
  console.log('KBO pitcher tables', f.slice(i, i + 5000));
}
const n = await get('https://npb.jp/announcement/starter/');
const fn = flat(n.t);
for (const key of ['予告先発', 'starter_', 'class="unit', 'pitcher']) { const i = fn.indexOf(key, fn.indexOf('</header>')); console.log('NPB starter key', key, i, fn.slice(i, i + 2500)); }
const s = await get('https://npb.jp/bis/eng/2026/games/gm20261002.html');
const links = [...s.t.matchAll(/href="([^"]*s\d{10,}[^"]*)"/g)].map((m) => m[1]).slice(0, 3);
console.log('NPB eng game links', links);
if (links[0]) { const gp = await get(new URL(links[0], 'https://npb.jp/bis/eng/2026/games/').href); console.log('NPB eng game page', flat(gp.t).slice(2000, 6000)); }
