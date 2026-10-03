const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Accept: '*/*' };
const get = async (u, o = {}) => { const r = await fetch(u, { ...o, headers: { ...UA, ...o.headers } }); const t = await r.text(); console.log(`\n## ${r.status} ${u} len=${t.length} acao=${r.headers.get('access-control-allow-origin')}`); return t; };
const J = async (u) => { try { return JSON.parse(await get(u)); } catch { return null; } };
const cut = (x, n = 700) => JSON.stringify(x)?.slice(0, n);
// ---------- MLB ----------
const S = 'https://statsapi.mlb.com/api/v1';
const sch = await J(`${S}/schedule?sportId=1&startDate=2026-10-01&endDate=2026-10-06&hydrate=probablePitcher,team`);
const games = (sch?.dates || []).flatMap((d) => d.games);
console.log('games', games.length, games.slice(0, 3).map((g) => `${g.gameType} ${g.teams.away.team.name}@${g.teams.home.team.name} ${g.gameDate} P:${g.teams.away.probablePitcher?.fullName}/${g.teams.home.probablePitcher?.fullName}`));
let pid = games.find((g) => g.teams.home.probablePitcher)?.teams.home.probablePitcher.id || 543037;
const opp = games.find((g) => g.teams.home.probablePitcher)?.teams.away.team.id || 147;
console.log('pid', pid, 'opp', opp);
const ppl = await J(`${S}/people/${pid}?hydrate=currentTeam`);
console.log('person', cut(ppl?.people?.[0], 900));
const st = await J(`${S}/people/${pid}/stats?stats=season,career,gameLog,statSplits&group=pitching&season=2026&sitCodes=h,a,vl,vr`);
for (const s of st?.stats || []) console.log('STAT', s.type?.displayName, 'n', s.splits?.length, cut(s.splits?.[0], 1500));
const post = await J(`${S}/people/${pid}/stats?stats=season,gameLog&group=pitching&season=2026&gameType=P`);
for (const s of post?.stats || []) console.log('POST', s.type?.displayName, 'n', s.splits?.length, cut(s.splits?.[0], 400));
const post2 = await J(`${S}/people/${pid}/stats?stats=gameLog&group=pitching&season=2026&gameType=F,D,L,W`);
for (const s of post2?.stats || []) console.log('POST2', s.type?.displayName, 'n', s.splits?.length, cut(s.splits?.[0]?.stat, 300));
const vs = await J(`${S}/people/${pid}/stats?stats=vsTeamTotal&group=pitching&opposingTeamId=${opp}`);
for (const s of vs?.stats || []) console.log('VS', s.type?.displayName, 'n', s.splits?.length, cut(s.splits?.[0], 700));
const tr = await J(`${S}/transactions?playerId=${pid}&startDate=2024-01-01&endDate=2026-10-03`);
console.log('TX', (tr?.transactions || []).slice(-6).map((t) => `${t.date} ${t.typeDesc}: ${t.description}`).join('\n'));
// ---------- NPB ----------
const npbDay = await get('https://npb.jp/bis/eng/2026/games/gm20260927.html');
console.log('npb day links', [...new Set([...npbDay.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /games|score|box/i.test(h)))].slice(0, 15));
const pl = await get('https://npb.jp/bis/eng/players/41045136.html');
console.log('npb player head', pl.replace(/\s+/g, ' ').match(/<div id="pc_bio"[\s\S]{0,1500}/)?.[0] || pl.replace(/\s+/g, ' ').slice(pl.indexOf('<body'), pl.indexOf('<body') + 2500));
console.log('npb player links', [...new Set([...pl.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))].filter((h) => /player|game|log/i.test(h)).slice(0, 20));
const st2 = await get('https://npb.jp/announcement/starter/');
const firstId = st2.match(/\/bis\/players\/(\d+)\.html/)?.[1];
console.log('starter id', firstId);
if (firstId) { const p2 = await get(`https://npb.jp/bis/eng/players/${firstId}.html`); console.log('npb p2', p2.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1800)); }
// ---------- KBO ----------
const kboList = await get('https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx', Origin: 'https://www.koreabaseball.com' }, body: 'leId=1&srId=0%2C1%2C3%2C4%2C5%2C6%2C7%2C8%2C9&date=20260927' });
const kid = kboList.match(/"T_PIT_P_ID":"?(\d+)/)?.[1] || '50030';
console.log('kbo pitcher', kid);
for (const pg of ['Basic.aspx', 'Total.aspx', 'Game.aspx', 'Situation.aspx', 'Daily.aspx']) {
  const h = await get(`https://www.koreabaseball.com/Record/Player/PitcherDetail/${pg}?playerId=${kid}`);
  const tabs = [...h.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0].replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ').replace(/\|+\s*\|*/g, '|').slice(0, 260));
  console.log(pg, 'tables', tabs.length, '\n  ' + tabs.slice(0, 6).join('\n  '));
  if (pg === 'Basic.aspx') console.log('profile', h.replace(/\s+/g, ' ').match(/playerProfile[\s\S]{0,1500}/)?.[0]?.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|').slice(0, 700));
}
