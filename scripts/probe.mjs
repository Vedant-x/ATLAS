// TEMPORARY (removed before merge), round 3: the exact fields to read.
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', Accept: 'application/json, text/plain, */*' };
async function get(url, headers = {}) {
  try {
    const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(25000) });
    const body = await r.text();
    console.log(`PROBE GET ${url.slice(0, 120)}: HTTP ${r.status} ${body.length} B`);
    try { return JSON.parse(body); } catch { return body; }
  } catch (e) { console.log(`PROBE GET ${url}: failed ${e.message}`); return null; }
}
const say = (name, x, n = 3000) => console.log(`PROBE ${name}: ${(typeof x === 'string' ? x : JSON.stringify(x)).replace(/\s+/g, ' ').slice(0, n)}`);

// WTA: the full player-year stats object, and the rankings page (ids by name).
const wy = await get('https://api.wtatennis.com/tennis/players/324166/year/2026');
say('WTA year stats', wy?.stats, 3500);
const wr = await get('https://api.wtatennis.com/tennis/players/ranked?page=0&pageSize=100&type=rankSingles&sort=asc&name=&metric=SINGLES');
say('WTA ranked page', { n: Array.isArray(wr) ? wr.length : null, last: Array.isArray(wr) ? wr.at(-1) : wr }, 500);

// UTS: the stats tab for Sinner (UTS id 50810), the table part; rankings with 100 rows.
const st = await get('https://www.ultimatetennisstatistics.com/playerStatsTab?playerId=50810&season=2026');
if (typeof st === 'string') {
  const i = st.indexOf('<table');
  say('UTS stats table', st.slice(i, i + 6000), 6000);
}
const ur = await get('https://www.ultimatetennisstatistics.com/rankingsTableTable?current=1&rowCount=100&rankType=RANK&season=');
say('UTS rankings', { n: ur?.rows?.length, total: ur?.total, last: ur?.rows?.at(-1) }, 400);

// ESPN cricket: an upcoming match's summary (squads before the toss?).
const sp = await get('https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel');
const pairs = (sp?.scores || []).flatMap((s) => (s.events || []).map((ev) => ({ league: s.leagues?.[0]?.id, ev })));
for (const st2 of ['pre', 'in']) {
  const pick = pairs.find((x) => x.ev.status?.type?.state === st2);
  if (!pick) { say(`cricket ${st2}`, 'none in the score panel'); continue; }
  const sm = await get(`https://site.web.api.espn.com/apis/site/v2/sports/cricket/${pick.league}/summary?event=${pick.ev.id}`);
  say(`cricket ${st2} summary keys`, Object.keys(sm || {}), 400);
  say(`cricket ${st2} rosters`, (sm?.rosters || []).map((r) => ({ team: r.team?.displayName, n: r.roster?.length, first: r.roster?.slice(0, 2).map((p) => ({ name: p.athlete?.displayName, role: p.position?.name, starter: p.starter, captain: p.captain, keeper: p.keeper, style: p.athlete?.style?.map((s) => s.description) })) })), 1500);
  say(`cricket ${st2} event`, { name: pick.ev.name, league: pick.league, status: pick.ev.status?.type }, 400);
}
