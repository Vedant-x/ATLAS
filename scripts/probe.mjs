const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Accept: 'application/json', Origin: 'https://vedant-x.github.io', Referer: 'https://vedant-x.github.io/' };
const get = async (u) => { try { const r = await fetch(u, { headers: UA }); const t = await r.text(); console.log('\n##', r.status, u, '| ACAO:', r.headers.get('access-control-allow-origin'), '| len', t.length); try { return JSON.parse(t); } catch { console.log(t.slice(0, 200)); return null; } } catch (e) { console.log('\n## ERR', u, e.message); return null; } };
const B = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
for (const lg of ['eng.1', 'esp.1', 'fifa.friendly', 'uefa.nations', 'fifa.worldq.uefa']) {
  const sb = await get(`${B}/${lg}/scoreboard?dates=20260925-20261020`);
  const ev = sb?.events?.[0]; if (!ev) continue;
  console.log(lg, ev.name, ev.id);
  const sm = await get(`${B}/${lg}/summary?event=${ev.id}`);
  if (sm) { console.log('summary keys', Object.keys(sm).join(',')); console.log('injuries', JSON.stringify(sm.injuries)?.slice(0, 600)); console.log('rosters', (sm.rosters || []).map((r) => `${r.team?.displayName}:${r.roster?.length}`).join(' ')); }
  const tid = ev.competitions[0].competitors[0].team.id;
  const ro = await get(`${B}/${lg}/teams/${tid}/roster`);
  const ath = ro?.athletes || [];
  console.log('roster keys', ro && Object.keys(ro).join(','), 'n', ath.length, 'athlete keys', ath[0] && Object.keys(ath[0]).join(','));
  const inj = ath.filter((a) => a.injuries?.length || (a.status && a.status.type !== 'active'));
  console.log('roster injured', inj.length, JSON.stringify(inj.slice(0, 2)).slice(0, 800));
  const ci = await get(`https://sports.core.api.espn.com/v2/sports/soccer/leagues/${lg}/teams/${tid}/injuries`);
  console.log('core injuries', JSON.stringify(ci)?.slice(0, 400));
  const tm = await get(`${B}/${lg}/teams/${tid}?enable=roster,injuries`);
  console.log('team keys', tm?.team && Object.keys(tm.team).join(','), JSON.stringify(tm?.team?.injuries)?.slice(0, 300));
}
// France team (ESPN id 478)
const fr = await get(`${B}/fifa.world/teams/478/roster`);
console.log('FRA roster n', fr?.athletes?.length, JSON.stringify((fr?.athletes || []).find((a) => /Mbapp/.test(a.displayName)))?.slice(0, 1200));
const d = new Date().toISOString().slice(0, 10);
const ss = await get(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${d}`);
const sev = ss?.events?.find((e) => e.tournament?.uniqueTournament?.id === 17) || ss?.events?.[0];
if (sev) { console.log('sofa', sev.homeTeam.name, sev.awayTeam.name, sev.id); const lu = await get(`https://api.sofascore.com/api/v1/event/${sev.id}/lineups`); console.log('missing', JSON.stringify(lu?.home?.missingPlayers)?.slice(0, 500)); }
await get('https://www.fotmob.com/api/data/matches?date=' + d.replaceAll('-', ''));
