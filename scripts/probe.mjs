// TEMPORARY (removed before merge), round 4: where UTS puts its serve numbers; cricket squads.
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', Accept: 'application/json, text/plain, */*' };
async function get(url) {
  try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) }); const b = await r.text(); console.log(`PROBE GET ${url.slice(0, 120)}: HTTP ${r.status} ${b.length} B`); try { return JSON.parse(b); } catch { return b; } } catch (e) { console.log(`PROBE GET ${url}: failed ${e.message}`); return null; }
}
const say = (name, x, n = 3000) => console.log(`PROBE ${name}: ${(typeof x === 'string' ? x : JSON.stringify(x)).replace(/\s+/g, ' ').slice(0, n)}`);

const st = await get('https://www.ultimatetennisstatistics.com/playerStatsTab?playerId=50810&season=2026');
if (typeof st === 'string') {
  for (const k of ['Ace', '1st Serve', 'Service Games Won', 'Return Points Won']) { const i = st.indexOf(k); say(`UTS around "${k}" at ${i}`, i < 0 ? '' : st.slice(Math.max(0, i - 600), i + 900), 1600); }
  say('UTS tags', [...new Set(st.match(/<[a-z]+/g) || [])].join(' '), 400);
}
const sp = await get('https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel');
const pairs = (sp?.scores || []).flatMap((s) => (s.events || []).map((ev) => ({ league: s.leagues?.[0]?.id, ev })));
for (const pick of [pairs.find((x) => x.ev.status?.type?.state === 'pre'), pairs.find((x) => x.ev.status?.type?.state === 'in') || pairs.find((x) => x.ev.status?.type?.state === 'post')].filter(Boolean)) {
  const sm = await get(`https://site.web.api.espn.com/apis/site/v2/sports/cricket/${pick.league}/summary?event=${pick.ev.id}`);
  say(`cricket ${pick.ev.status?.type?.state} squads`, sm?.squads, 2500);
  say(`cricket ${pick.ev.status?.type?.state} leaders`, sm?.leaders, 1500);
}
