const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Accept: 'application/json' };
const get = async (u) => { const r = await fetch(u, { headers: UA }); const t = await r.text(); console.log('\n##', r.status, u, 'len', t.length); try { return JSON.parse(t); } catch { return null; } };
for (const day of ['20261003', '20261010']) {
  const fm = await get('https://www.fotmob.com/api/data/matches?date=' + day);
  console.log('leagues', (fm?.leagues || []).length, (fm?.leagues || []).slice(0, 40).map((l) => `${l.name}#${l.primaryId ?? l.id}(${l.ccode})`).join(' | '));
  const lg = fm?.leagues?.find((l) => (l.primaryId ?? l.id) === 87 || (l.primaryId ?? l.id) === 47) || fm?.leagues?.find((l) => /Nations|Qualif|Friendl/.test(l.name));
  const mt = lg?.matches?.find((m) => !m.status?.started) || lg?.matches?.[0];
  if (!mt) continue;
  console.log('pick', lg.name, JSON.stringify(mt).slice(0, 300));
  const md = await get(`https://www.fotmob.com/api/data/matchDetails?matchId=${mt.id}`);
  const lu = md?.content?.lineup;
  console.log('lineupType', lu?.lineupType, 'home keys', lu?.homeTeam && Object.keys(lu.homeTeam).join(','));
  console.log('home unavailable', JSON.stringify(lu?.homeTeam?.unavailable)?.slice(0, 1500));
  console.log('away unavailable', JSON.stringify(lu?.awayTeam?.unavailable)?.slice(0, 600));
  console.log('starter sample', JSON.stringify(lu?.homeTeam?.starters?.[0])?.slice(0, 500));
  console.log('matchFacts keys', md?.content?.matchFacts && Object.keys(md.content.matchFacts).join(','));
  console.log('insights?', JSON.stringify(md?.content?.matchFacts?.insights)?.slice(0, 300));
  const tid = mt.home.id;
  const tm = await get(`https://www.fotmob.com/api/data/teams?id=${tid}`);
  const sq = tm?.squad?.squad || tm?.squad;
  console.log('squad type', Array.isArray(sq), JSON.stringify(sq)?.slice(0, 200));
  const members = (Array.isArray(sq) ? sq : []).flatMap((g) => g.members || []);
  console.log('member keys', members[0] && Object.keys(members[0]).join(','));
  console.log('injured members', JSON.stringify(members.filter((m) => m.injured || m.injury).slice(0, 3)).slice(0, 800));
}
