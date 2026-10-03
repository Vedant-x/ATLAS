const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Accept: 'application/json' };
const get = async (u) => { try { const r = await fetch(u, { headers: UA }); const t = await r.text(); console.log(`\n## ${r.status} ${u} len=${t.length} acao=${r.headers.get('access-control-allow-origin')}`); try { return JSON.parse(t); } catch { console.log(t.slice(0, 160)); return null; } } catch (e) { console.log('ERR', u, e.message); return null; } };
// Tennis rankings
for (const u of ['https://site.api.espn.com/apis/site/v2/sports/tennis/atp/rankings', 'https://site.web.api.espn.com/apis/site/v2/sports/tennis/atp/rankings', 'https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/rankings', 'https://site.api.espn.com/apis/site/v2/sports/tennis/wta/rankings']) {
  const j = await get(u);
  if (j) console.log('keys', Object.keys(j).join(','), JSON.stringify(j).slice(0, 700));
}
// FotMob: injury names
const d = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const fm = await get(`https://www.fotmob.com/api/data/matches?date=${d}`);
const lg = fm?.leagues?.find((l) => (l.primaryId ?? l.id) === 47) || fm?.leagues?.find((l) => (l.primaryId ?? l.id) === 87) || fm?.leagues?.[0];
const mt = lg?.matches?.find((m) => !m.status?.started) || lg?.matches?.[0];
if (mt) {
  const md = await get(`https://www.fotmob.com/api/data/matchDetails?matchId=${mt.id}`);
  const un = [...(md?.content?.lineup?.homeTeam?.unavailable || []), ...(md?.content?.lineup?.awayTeam?.unavailable || [])];
  console.log('unavailable sample', JSON.stringify(un.slice(0, 3)));
  const p = un.find((x) => x.unavailability?.type === 'injury') || un[0];
  if (p) {
    for (const u of [`https://www.fotmob.com/api/data/playerData?id=${p.id}`, `https://www.fotmob.com/api/playerData?id=${p.id}`]) {
      const pd = await get(u);
      if (pd) { console.log('player keys', Object.keys(pd).join(',')); console.log('injury info', JSON.stringify(pd.injuryInformation || pd.injury || pd.playerInformation?.find?.((x) => /injur/i.test(JSON.stringify(x))) || null).slice(0, 400)); break; }
    }
  }
  console.log('md general keys', md && Object.keys(md.general || {}).join(','));
}
for (const u of ['https://www.fotmob.com/api/data/translationmapping?locale=en', 'https://www.fotmob.com/api/translationmapping?locale=en']) { const j = await get(u); if (j) { const s = JSON.stringify(j); const i = s.search(/injury_?87|"87"/i); console.log('translation sample', s.slice(0, 200), i >= 0 ? s.slice(i - 60, i + 120) : 'no 87'); } }
