const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Accept: 'application/json', Origin: 'https://vedant-x.github.io', Referer: 'https://vedant-x.github.io/' };
const get = async (u, h = {}) => { try { const r = await fetch(u, { headers: { ...UA, ...h } }); const t = await r.text(); console.log('\n##', r.status, u, '| ACAO:', r.headers.get('access-control-allow-origin'), '| len', t.length); try { return JSON.parse(t); } catch { console.log(t.slice(0, 300)); return null; } } catch (e) { console.log('\n## ERR', u, e.message); return null; } };
const B = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const sb = await get(`${B}/esp.1/scoreboard?dates=20261002-20261006`);
const ev = sb?.events?.[0];
if (ev) {
  console.log(ev.name, ev.id);
  const sm = await get(`${B}/esp.1/summary?event=${ev.id}`);
  console.log('summary keys', Object.keys(sm || {}).join(','), '| injuries', JSON.stringify(sm?.injuries)?.slice(0, 300));
  const tid = ev.competitions[0].competitors[0].team.id;
  const ro = await get(`${B}/esp.1/teams/${tid}/roster`);
  const a = ro?.athletes || [];
  console.log('athlete keys', a[0] && Object.keys(a[0]).join(','));
  console.log('with injuries', a.filter((x) => x.injuries?.length).map((x) => x.displayName + ':' + JSON.stringify(x.injuries).slice(0, 200)).slice(0, 4));
}
const fr = await get(`${B}/fifa.world/teams/478/roster`);
const m = (fr?.athletes || []).find((x) => /Mbapp/.test(x.displayName));
console.log('Mbappe keys', m && Object.keys(m).join(','), 'injuries', JSON.stringify(m?.injuries), 'status', JSON.stringify(m?.status));
const d = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const fm = await get('https://www.fotmob.com/api/data/matches?date=' + d);
console.log('fotmob keys', Object.keys(fm || {}).join(','));
const lg = fm?.leagues?.find((l) => /LaLiga|Premier/.test(l.name)) || fm?.leagues?.[0];
const mt = lg?.matches?.[0];
console.log('league', lg?.name, lg?.id, 'match', JSON.stringify(mt)?.slice(0, 400));
if (mt) {
  for (const u of [`https://www.fotmob.com/api/data/matchDetails?matchId=${mt.id}`, `https://www.fotmob.com/api/matchDetails?matchId=${mt.id}`]) {
    const md = await get(u);
    if (!md) continue;
    console.log('md keys', Object.keys(md).join(','), 'content keys', md.content && Object.keys(md.content).join(','));
    const lu = md.content?.lineup;
    console.log('lineup keys', lu && Object.keys(lu).join(','), 'home keys', lu?.homeTeam && Object.keys(lu.homeTeam).join(','));
    console.log('unavailable', JSON.stringify(lu?.homeTeam?.unavailable)?.slice(0, 900));
    break;
  }
}
const tm = await get('https://www.fotmob.com/api/data/teams?id=6723');
console.log('team keys', tm && Object.keys(tm).join(','));
const sq = await get('https://www.fotmob.com/api/data/teams?id=6723&tab=squad');
