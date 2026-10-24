// TEMPORARY (removed before merge): which free sources answer GitHub's servers, and what they hold,
// for tennis serve/return stats, NBA starting lineups, cricket and esports player data. Prints the
// HTTP status, the size and a short look at each answer, so readers are built on what is really there.
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', Accept: 'application/json, text/plain, */*' };
const day = (off = 0, tz = 'America/New_York') => new Date(Date.now() + off * 864e5).toLocaleDateString('en-CA', { timeZone: tz });
const shape = (x, depth = 0) => {
  if (Array.isArray(x)) return x.length ? `[${x.length}× ${shape(x[0], depth + 1)}]` : '[]';
  if (x && typeof x === 'object') return depth > 2 ? '{…}' : `{${Object.keys(x).slice(0, 14).map((k) => `${k}: ${shape(x[k], depth + 1)}`).join(', ')}}`;
  return typeof x === 'string' ? JSON.stringify(x.slice(0, 40)) : String(x);
};
async function probe(name, url, { headers = {}, show = 700 } = {}) {
  try {
    const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(20000) });
    const body = await r.text();
    let j = null;
    try { j = JSON.parse(body); } catch { /* not JSON */ }
    console.log(`PROBE ${name}: HTTP ${r.status} ${r.headers.get('content-type') || ''} ${body.length} B :: ${j ? shape(j).slice(0, show) : body.replace(/\s+/g, ' ').slice(0, 300)}`);
    return r.ok ? (j ?? body) : null;
  } catch (e) { console.log(`PROBE ${name}: failed ${e.message}`); return null; }
}
const find = (x, pred, depth = 0) => {
  if (!x || typeof x !== 'object' || depth > 8) return null;
  if (pred(x)) return x;
  for (const v of Array.isArray(x) ? x : Object.values(x)) { const f = find(v, pred, depth + 1); if (f) return f; }
  return null;
};

// ---- Tennis: serve and return stats
const espn = await probe('ESPN tennis ATP scoreboard', 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard');
const done = find(espn, (o) => o.status?.type?.completed === true && Array.isArray(o.competitors));
if (done) {
  console.log(`PROBE ESPN tennis finished match: ${shape(done).slice(0, 900)}`);
  console.log(`PROBE ESPN tennis competitor: ${JSON.stringify(done.competitors[0]).slice(0, 900)}`);
  const ath = done.competitors[0]?.athlete?.id || done.competitors[0]?.id;
  if (ath) {
    await probe('ESPN tennis athlete stats', `https://site.web.api.espn.com/apis/common/v3/sports/tennis/atp/athletes/${ath}/stats`);
    await probe('ESPN tennis athlete overview', `https://site.web.api.espn.com/apis/common/v3/sports/tennis/atp/athletes/${ath}/overview`);
  }
  await probe('ESPN tennis summary', `https://site.api.espn.com/apis/site/v2/sports/tennis/atp/summary?event=${done.id}`);
}
await probe('ATP leaderboard serve (JSON)', 'https://www.atptour.com/en/-/www/StatsLeaderboard/serve/52week/all/all/false?v=1');
await probe('ATP leaderboard page', 'https://www.atptour.com/en/stats/leaderboard?boardType=serve&timeFrame=52Week&surface=all&versusRank=all&formerNo1=false');
await probe('ATP player stats page', 'https://www.atptour.com/en/players/jannik-sinner/s0ag/player-stats?year=all&surfaceType=all');
await probe('ATP player hero (JSON)', 'https://www.atptour.com/en/-/www/players/hero/s0ag?v=1');
await probe('WTA ranked players', 'https://api.wtatennis.com/tennis/players/ranked?page=0&pageSize=3&type=rankSingles&sort=asc&name=&metric=SINGLES');
await probe('WTA stats leaders', 'https://api.wtatennis.com/tennis/stats/2026/singles?page=0&pageSize=3&metric=ACES&sort=desc');
const sofa = await probe('Sofascore tennis day', `https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${day(-1, 'UTC')}`);
const sev = (sofa?.events || []).find((x) => x.status?.type === 'finished' && /ATP|WTA/.test(x.tournament?.category?.name || ''));
if (sev) {
  await probe('Sofascore tennis match statistics', `https://api.sofascore.com/api/v1/event/${sev.id}/statistics`, { show: 1200 });
  await probe('Sofascore tennis player year stats', `https://api.sofascore.com/api/v1/team/${sev.homeTeam?.id}/year-statistics/${new Date().getUTCFullYear()}`, { show: 1200 });
}
await probe('Ultimate Tennis Statistics', 'https://www.ultimatetennisstatistics.com/rankingsTable');
await probe('Sackmann tennis_atp (main)', 'https://raw.githubusercontent.com/JeffSackmann/tennis_atp/main/atp_matches_2024.csv');
await probe('tennis-data.co.uk', 'http://www.tennis-data.co.uk/alldata.php');

// ---- NBA: starting lineups
for (const d of [day(0), day(1)]) await probe(`NBA daily lineups ${d}`, `https://stats.nba.com/js/data/leaders/00_daily_lineups_${d.replace(/-/g, '')}.json`, { headers: { Referer: 'https://www.nba.com/', Origin: 'https://www.nba.com' }, show: 1200 });
await probe('NBA today\'s lineups page', 'https://www.nba.com/players/todays-lineups');

// ---- Cricket: players
const sp = await probe('ESPN cricket scorepanel', 'https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel');
const cev = find(sp, (o) => Array.isArray(o.competitions) && o.competitions[0]?.competitors?.length === 2 && o.id);
if (cev) {
  const series = find(sp, (o) => Array.isArray(o.events) && o.events.some((x) => x.id === cev.id))?.id || cev.season?.id || '';
  const sm = await probe('ESPN cricket summary', `https://site.web.api.espn.com/apis/site/v2/sports/cricket/${series}/summary?event=${cev.id}`, { show: 1500 });
  if (sm?.rosters) console.log(`PROBE ESPN cricket roster entry: ${JSON.stringify(sm.rosters[0]?.roster?.[0] || sm.rosters[0]).slice(0, 800)}`);
  const pid = find(sm, (o) => o.athlete?.id)?.athlete?.id;
  if (pid) await probe('ESPN cricket athlete', `https://site.web.api.espn.com/apis/common/v3/sports/cricket/athletes/${pid}`, { show: 1200 });
}
await probe('Cricinfo consumer API', 'https://hs-consumer-api.espncricinfo.com/v1/pages/matches/current?lang=en&latest=true');

// ---- Esports: players
const bo3 = await probe('bo3.gg match list', 'https://api.bo3.gg/api/v1/matches?page[limit]=3&sort=start_date&filter[matches.status][in]=upcoming&filter[matches.discipline_id][eq]=1&with=teams,tournament');
const bm = bo3?.results?.[0];
if (bm) {
  console.log(`PROBE bo3.gg match keys: ${Object.keys(bm).join(', ')}; team1: ${JSON.stringify(bm.team1).slice(0, 500)}`);
  await probe('bo3.gg match detail', `https://api.bo3.gg/api/v1/matches/${bm.slug}?with=teams,players,tournament,games,team_stats,player_stats`, { show: 1500 });
  await probe('bo3.gg team players', `https://api.bo3.gg/api/v1/players?filter[players.team_id][eq]=${bm.team1_id}&page[limit]=7`, { show: 1200 });
  await probe('bo3.gg team detail', `https://api.bo3.gg/api/v1/teams/${bm.team1?.slug}?with=players`, { show: 1200 });
}
await probe('OpenDota teams', 'https://api.opendota.com/api/teams', { show: 500 });
await probe('OpenDota pro players', 'https://api.opendota.com/api/proPlayers', { show: 500 });
await probe('Leaguepedia scoreboard players', 'https://lol.fandom.com/api.php?action=cargoquery&tables=ScoreboardPlayers&fields=Link,Team,Champion,Kills,Deaths,Assists,DateTime_UTC&order_by=DateTime_UTC%20DESC&limit=3&format=json', { show: 900 });
await probe('vlr.gg stats', 'https://www.vlr.gg/stats/?event_group_id=all&region=all&min_rounds=200&timespan=60d');
await probe('HLTV player stats', 'https://www.hltv.org/stats/players');
