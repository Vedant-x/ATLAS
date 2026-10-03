import { parseScoreboard, fetchLeague } from '../js/espn.js';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };
const B = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
for (const lg of ['atp', 'wta']) {
  const league = { path: `tennis/${lg}`, sport: 'tennis', name: lg.toUpperCase() };
  for (const u of [`${B}/${lg}/scoreboard`, `${B}/${lg}/scoreboard?dates=${ymd(new Date(Date.now() - 864e5))}-${ymd(new Date(Date.now() + 3 * 864e5))}`]) {
    const r = await fetch(u, { headers: UA }); const t = await r.text();
    console.log(`\n## ${lg} ${r.status} ${u} len=${t.length}`);
    let j; try { j = JSON.parse(t); } catch { console.log(t.slice(0, 200)); continue; }
    console.log('events', (j.events || []).map((e) => `${e.name} [${(e.groupings || []).map((g) => `${g.grouping?.slug}:${g.competitions?.length}`).join(' ')}] comps=${e.competitions?.length || 0}`).join(' | '));
    const states = {}; for (const e of j.events || []) for (const g of e.groupings || []) for (const c of g.competitions || []) { const s = c.status?.type?.state; states[s] = (states[s] || 0) + 1; }
    console.log('states', JSON.stringify(states));
    const ev = parseScoreboard(j, league);
    const by = {}; for (const e of ev) { const k = `${e.tennis?.tournament} / ${e.tennis?.drawName} / ${e.live ? 'LIVE' : 'pre'}`; by[k] = (by[k] || 0) + 1; }
    console.log('parsed', ev.length, JSON.stringify(by));
    console.log('sample', ev.slice(0, 4).map((e) => `${e.home} v ${e.away} | ${new Date(e.start).toISOString()} | mk=${e.markets.length} | ${e.tennis?.round} | ${e.clock}`).join('\n  '));
    console.log('TBD-ish', ev.filter((e) => /TBD|^$/.test(e.home) || /TBD|^$/.test(e.away)).length, 'odds', ev.filter((e) => e.markets.length).length);
    const c0 = j.events?.[0]?.groupings?.[0]?.competitions?.find((c) => c.odds) ; console.log('odds sample', JSON.stringify(c0?.odds?.[0])?.slice(0, 400));
  }
  try { const viaFetch = await fetchLeague({ path: `tennis/${lg}`, sport: 'tennis', name: lg }, { days: 4 }); console.log('fetchLeague', lg, viaFetch.length); } catch (e) { console.log('fetchLeague ERR', lg, e.message); }
}
