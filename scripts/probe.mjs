// Temporary: walk ESPN's directory of sports and leagues and list every league with games in the
// next 7 days that the catalog does not have (CI only).
import { ALL_LEAGUES } from '../js/catalog.js';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' };
const get = async (u) => { try { const r = await fetch(u.replace(/^http:/, 'https:'), { headers: UA, signal: AbortSignal.timeout(20000) }); return r.ok ? await r.json() : null; } catch { return null; } };
const have = new Set(ALL_LEAGUES.map((l) => l.path));
const sports = (await get('https://sports.core.api.espn.com/v2/sports?limit=200'))?.items || [];
console.log('ESPN sports:', sports.length);
const leagues = [];
for (const s of sports) {
  const sj = await get(s.$ref); const slug = sj?.slug; if (!slug) continue;
  const lj = await get(`https://sports.core.api.espn.com/v2/sports/${slug}/leagues?limit=1000`);
  const items = lj?.items || [];
  console.log(`sport ${slug}: ${lj?.count ?? items.length} leagues`);
  for (const it of items) leagues.push({ sport: slug, ref: it.$ref });
}
const ymd = (o) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10).replaceAll('-', '');
const found = [];
let i = 0;
await Promise.all(Array.from({ length: 10 }, async () => {
  while (i < leagues.length) {
    const l = leagues[i++];
    const lj = await get(l.ref); const slug = lj?.slug; if (!slug) continue;
    const path = `${l.sport}/${slug}`;
    if (have.has(path)) continue;
    const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${ymd(0)}-${ymd(7)}&limit=300`);
    const n = sb?.events?.length || 0;
    if (n) found.push({ path, name: lj.name || lj.abbreviation, n, odds: (sb.events || []).filter((e) => e.competitions?.[0]?.odds?.length).length });
  }
}));
found.sort((a, b) => b.n - a.n);
console.log(`\nLEAGUES WITH GAMES NOT IN CATALOG: ${found.length}`);
for (const f of found) console.log(`  ${f.path} | ${f.name} | ${f.n} events | ${f.odds} with odds`);
