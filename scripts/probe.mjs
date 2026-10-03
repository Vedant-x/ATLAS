const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };
const get = async (u, json = true) => { const r = await fetch(u, { headers: UA }); const t = await r.text(); console.log(`\n## ${r.status} ${u} len=${t.length}`); if (!json) return t; try { return JSON.parse(t); } catch { return null; } };
const rk = await get('https://site.api.espn.com/apis/site/v2/sports/tennis/atp/rankings');
const r0 = rk?.rankings?.[0];
console.log('rankings keys', r0 && Object.keys(r0).join(','), 'ranks', r0?.ranks?.length);
console.log('rank sample', JSON.stringify(r0?.ranks?.slice(0, 2)).slice(0, 900));
console.log('rank 150', JSON.stringify(r0?.ranks?.[149] && { current: r0.ranks[149].current, points: r0.ranks[149].points, name: r0.ranks[149].athlete?.displayName, id: r0.ranks[149].athlete?.id }));
// FotMob player web page: find injury_6 translation
const html = await get('https://www.fotmob.com/players/616170/martin-erlic', false);
for (const k of ['injury_6', 'injury_87', 'injury_92', 'Knee', 'Hamstring', 'Ankle']) { const i = html.indexOf(k); console.log(k, i, i >= 0 ? html.slice(Math.max(0, i - 120), i + 160).replace(/\s+/g, ' ') : ''); }
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((s) => /chunk|app|_next/.test(s));
console.log('scripts', scripts.length, scripts.slice(0, 8).join(' '));
// search JS chunks for injury translations
let found = 0;
for (const s of scripts.slice(0, 40)) {
  const url = s.startsWith('http') ? s : `https://www.fotmob.com${s}`;
  try { const js = await (await fetch(url, { headers: UA })).text(); const i = js.indexOf('injury_87'); if (i >= 0) { console.log('FOUND in', url, js.slice(Math.max(0, i - 200), i + 400)); found++; if (found > 1) break; } } catch {}
}
console.log('found', found);
