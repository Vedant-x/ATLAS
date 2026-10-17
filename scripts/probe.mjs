// Temporary: shapes of official league feeds before writing parsers (CI only).
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36', Accept: 'application/json' };
const get = async (u) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t: t.slice(0, 300) }; } catch (e) { return { s: 0, e: e.message }; } };
const short = (o, d = 0) => { if (o == null || typeof o !== 'object') return JSON.stringify(o)?.slice(0, 70); if (Array.isArray(o)) return `[${o.length}] ${o.length ? short(o[0], d + 1) : ''}`; if (d > 2) return '{…}'; return `{${Object.entries(o).slice(0, 30).map(([k, v]) => `${k}: ${short(v, d + 1)}`).join(', ')}}`; };
const today = new Date().toISOString().slice(0, 10);
const urls = [
  'https://api-live.euroleague.net/v2/competitions/E/seasons/E2026/games',
  'https://api-live.euroleague.net/v2/competitions/U/seasons/U2026/games',
  'https://api-live.euroleague.net/v1/schedules?seasonCode=E2026',
  'https://liiga.fi/api/v2/games?tournament=runkosarja&season=2027',
  'https://api.motogp.pulselive.com/motogp/v1/results/seasons',
  'https://api.motogp.pulselive.com/motogp/v1/events?seasonYear=2026',
  `https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${today}&s=Basketball`,
  `https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${today}&s=Ice%20Hockey`,
  `https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${today}&s=Cycling`,
  `https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${today}&s=Rugby`,
  `https://www.thesportsdb.com/api/v1/json/123/all_sports.php`,
];
for (const u of urls) {
  const r = await get(u);
  console.log(`\n=== ${u}\nstatus ${r.s}${r.e ? ` ${r.e}` : ''}\n${r.j ? short(r.j).slice(0, 2200) : r.t}`);
  if (u.includes('eventsday') && r.j?.events) console.log('leagues:', [...new Set(r.j.events.map((x) => x.strLeague))].join(' | '), 'count', r.j.events.length);
  if (u.includes('all_sports') && r.j?.sports) console.log('sports:', r.j.sports.map((x) => x.strSport).join(', '));
}
