// Temporary: prints the shape of feeds before parsers are written for them (CI only).
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' };
const get = async (u) => { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); return { status: r.status, j: r.ok ? await r.json().catch(() => null) : null }; };
const short = (o, d = 0) => String(short0(o, d));
const short0 = (o, d = 0) => {
  if (o == null || typeof o !== 'object') return JSON.stringify(o)?.slice(0, 80);
  if (Array.isArray(o)) return `[${o.length}] ${o.length ? short(o[0], d + 1) : ''}`;
  if (d > 3) return '{…}';
  return `{${Object.entries(o).slice(0, 40).map(([k, v]) => `${k}: ${typeof v === 'object' && v ? short(v, d + 1) : JSON.stringify(v)?.slice(0, 60)}`).join(', ')}}`;
};
const S = 'https://site.api.espn.com/apis/site/v2/sports';
for (const p of ['golf/pga', 'golf/pga?dates=20261012', 'golf/lpga', 'golf/eur', 'golf/eur?dates=20261012', 'golf/liv', 'racing/nascar-premier', 'racing/nascar-premier?dates=20261012', 'racing/irl', 'racing/irl?dates=20260830']) {
  const [path, qs] = p.split('?');
  const { status, j } = await get(`${S}/${path}/scoreboard${qs ? `?${qs}` : ''}`);
  console.log(`\n=== ${p} ${status} events ${j?.events?.length}`);
  const ev = j?.events?.[0];
  if (!ev) continue;
  console.log('event:', short({ ...ev, competitions: undefined }).slice(0, 1500));
  const c = ev.competitions?.[0];
  console.log('comps:', ev.competitions?.length, (ev.competitions || []).map((x) => `${x.type?.abbreviation || x.type?.text || '?'}@${x.date}/${x.status?.type?.state}`).join(' | '));
  console.log('comp keys:', short({ ...c, competitors: undefined }).slice(0, 1500));
  console.log('competitors', c?.competitors?.length, 'first:', short(c?.competitors?.[0]).slice(0, 2500));
  console.log('second:', JSON.stringify(c?.competitors?.[1])?.slice(0, 1500));
}
for (const u of ['https://site.api.espn.com/apis/v2/sports/racing/nascar-premier/standings', 'https://site.api.espn.com/apis/v2/sports/racing/irl/standings', 'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard']) {
  const { status, j } = await get(u);
  console.log(`\n=== ${u} ${status}`, short(j).slice(0, 2500));
}
// NHL: today's games and one game's pre-game landing (goalies?)
{
  const { status, j } = await get('https://api-web.nhle.com/v1/schedule/now');
  console.log('\n=== nhl schedule', status, short(j).slice(0, 800));
  const g = j?.gameWeek?.flatMap((d) => d.games || []).find((x) => x.gameState === 'FUT' || x.gameState === 'PRE');
  if (g) {
    const l = await get(`https://api-web.nhle.com/v1/gamecenter/${g.id}/landing`);
    console.log('landing', l.status, short(l.j).slice(0, 2500));
    console.log('matchup', JSON.stringify(l.j?.matchup)?.slice(0, 2500));
  }
}
