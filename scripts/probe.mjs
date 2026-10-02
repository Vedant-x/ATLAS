// Discovery run #2: field shapes + KBO/NPB coverage in MLB statsapi.
const get = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); return { s: r.status, t: await r.text() }; } catch (e) { return { s: 'ERR ' + e.message, t: '' }; } };
const j = async (u) => { const r = await get(u); try { return JSON.parse(r.t); } catch { return null; } };
const show = (label, v, n = 1500) => console.log(`${label}: ${JSON.stringify(v)?.slice(0, n)}`);
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (['logos', 'links', 'logo', 'headshot', 'flag', 'uid', '$ref', 'guid', 'images'].includes(k) ? undefined : v)));

const day = (d) => d.toISOString().slice(0, 10);
const today = new Date();
for (const sportId of [31, 32, 1]) {
  const s = await j(`https://statsapi.mlb.com/api/v1/schedule?sportId=${sportId}&startDate=${day(new Date(+today - 3 * 864e5))}&endDate=${day(new Date(+today + 3 * 864e5))}&hydrate=probablePitcher,team,linescore`);
  const games = (s?.dates || []).flatMap((d) => d.games);
  console.log(`STATSAPI sport ${sportId}: games=${games.length}`);
  const g = games.find((x) => x.teams?.home?.probablePitcher) || games[0];
  if (g) show(' game', strip({ pk: g.gamePk, date: g.gameDate, status: g.status, home: g.teams.home, away: g.teams.away }), 1200);
  const pp = g?.teams?.home?.probablePitcher || g?.teams?.away?.probablePitcher;
  if (pp) {
    const p = await j(`https://statsapi.mlb.com/api/v1/people/${pp.id}?hydrate=stats(group=[pitching],type=[season,career,lastXGames,gameLog],limit=5,sportId=${sportId})`);
    show(' pitcher', strip(p?.people?.[0]), 3000);
  }
  // season standings & injuries/transactions
  const st = await j(`https://statsapi.mlb.com/api/v1/standings?leagueId=${sportId === 1 ? '103,104' : ''}&sportId=${sportId}`);
  show(' standings', st?.records?.[0]?.teamRecords?.slice(0, 1).map(strip), 800);
}
// Season-wide: 2025 KBO/NPB (offseason fallback check)
for (const sportId of [31, 32]) {
  const s = await j(`https://statsapi.mlb.com/api/v1/schedule?sportId=${sportId}&season=2026&gameType=R`);
  console.log(`STATSAPI season2026 sport ${sportId}: dates=${s?.dates?.length} games=${s?.totalGames}`);
}
// ESPN shapes
for (const path of ['baseball/mlb', 'hockey/nhl', 'basketball/nba', 'soccer/eng.1', 'football/nfl', 'tennis/atp', 'mma/ufc']) {
  const sb = await j(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`);
  const ev = sb?.events?.find((e) => e.status?.type?.state === 'pre') || sb?.events?.[0];
  const comp = ev?.competitions?.[0] || ev?.groupings?.[0]?.competitions?.[0];
  console.log(`=== ${path} event=${ev?.id} state=${ev?.status?.type?.state}`);
  if (comp?.competitors?.[0]) show(' competitor', strip(comp.competitors[0]), 1800);
  if (!ev) continue;
  const sm = await j(`https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${comp?.id || ev.id}`);
  if (sm?.code) { console.log(' summary error', sm.code, sm.message); continue; }
  if (sm?.injuries?.[0]) show(' injury', strip(sm.injuries.find((t) => t.injuries?.length)?.injuries?.slice(0, 2)), 1200);
  if (sm?.leaders?.[0]) show(' leaders', strip(sm.leaders[0].leaders?.slice(0, 2)), 1200);
  if (sm?.lastFiveGames?.[0]) show(' last5', strip(sm.lastFiveGames[0].events?.slice(0, 1)), 800);
  if (sm?.predictor) show(' predictor', sm.predictor, 300);
  if (sm?.goalies) show(' goalies', strip(sm.goalies), 1200);
  if (sm?.rosters?.[0]) show(' roster', strip({ formation: sm.rosters[0].formation, first: sm.rosters[0].roster?.slice(0, 2) }), 900);
  if (sm?.boxscore?.teams?.[0]?.statistics) show(' teamstats', strip(sm.boxscore.teams[0].statistics).slice(0, 3), 1200);
  if (sm?.standings?.groups?.[0]) show(' standingsEntry', strip(sm.standings.groups[0].standings.entries[0]), 900);
}
// ESPN athlete stats endpoint (for pitcher/goalie/player depth)
const ath = await j('https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/33039/overview');
show('ATHLETE overview keys', Object.keys(ath || {}));
show('ATHLETE overview stats', strip(ath?.statistics), 1500);
show('ATHLETE gamelog', strip(ath?.gameLog), 800);
