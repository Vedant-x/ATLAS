// TEMPORARY (removed before merge), round 2: the fields of the sources that answered, and more
// candidates for what did not.
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', Accept: 'application/json, text/plain, */*' };
const day = (off = 0, tz = 'America/New_York') => new Date(Date.now() + off * 864e5).toLocaleDateString('en-CA', { timeZone: tz });
const shape = (x, depth = 0) => {
  if (Array.isArray(x)) return x.length ? `[${x.length}× ${shape(x[0], depth + 1)}]` : '[]';
  if (x && typeof x === 'object') return depth > 3 ? '{…}' : `{${Object.keys(x).slice(0, 40).map((k) => `${k}: ${shape(x[k], depth + 1)}`).join(', ')}}`;
  return typeof x === 'string' ? JSON.stringify(x.slice(0, 30)) : String(x);
};
async function probe(name, url, { headers = {}, show = 900, text = false } = {}) {
  try {
    const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(25000) });
    const body = await r.text();
    let j = null;
    try { j = JSON.parse(body); } catch { /* not JSON */ }
    console.log(`PROBE ${name}: HTTP ${r.status} ${r.headers.get('content-type') || ''} ${body.length} B${r.headers.get('last-modified') ? ` (modified ${r.headers.get('last-modified')})` : ''} :: ${j && !text ? shape(j).slice(0, show) : body.replace(/\s+/g, ' ').slice(0, show)}`);
    return r.ok ? (j ?? body) : null;
  } catch (e) { console.log(`PROBE ${name}: failed ${e.message}`); return null; }
}
const say = (name, x, n = 1500) => console.log(`PROBE ${name}: ${typeof x === 'string' ? x.slice(0, n) : JSON.stringify(x).slice(0, n)}`);

// ---- NBA lineups: the fields
const nba = await probe('NBA daily lineups', `https://stats.nba.com/js/data/leaders/00_daily_lineups_${day(0).replace(/-/g, '')}.json`, { headers: { Referer: 'https://www.nba.com/', Origin: 'https://www.nba.com' } });
if (nba?.games?.[0]) say('NBA lineups game', nba.games[0], 2500);

// ---- Tennis: match files with serve stats, and official APIs
const tml = await probe('TML-Database 2026', 'https://raw.githubusercontent.com/Tennismylife/TML-Database/master/2026.csv', { text: true, show: 700 });
if (typeof tml === 'string') { const ls = tml.trim().split('\n'); say('TML-Database rows', `${ls.length} rows; last: ${ls.at(-1)}`, 600); }
await probe('TML-Database ongoing', 'https://raw.githubusercontent.com/Tennismylife/TML-Database/master/ongoing_tourneys.csv', { text: true, show: 300 });
await probe('Sackmann WTA 2025', 'https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_matches_2025.csv', { text: true, show: 300 });
await probe('ESPN core tennis competitor statistics', 'https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/events/440-2026/competitions/186982/competitors/14601/statistics', { show: 1500 });
await probe('ESPN core tennis competition', 'https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/events/440-2026/competitions/186982', { show: 900 });
for (const p of ['tennis/stats/2026/', 'tennis/stats/2026/singles', 'tennis/players/324166/year/2026', 'tennis/players/324166/stats/2026', 'tennis/players/324166/stats?year=2026', 'tennis/players/324166/matches?year=2026', 'tennis/players/324166']) await probe(`WTA ${p}`, `https://api.wtatennis.com/${p}`, { show: 600 });
const UTS = 'https://www.ultimatetennisstatistics.com';
await probe('UTS rankings table', `${UTS}/rankingsTableTable?current=1&rowCount=3&rankType=RANK&season=`, { show: 700 });
await probe('UTS stats leaders', `${UTS}/statsLeadersTable?category=serviceGamesWonPct&season=2026&current=1&rowCount=3&sort%5Bvalue%5D=desc`, { show: 700 });
await probe('UTS player stats (Sinner)', `${UTS}/playerStatsTab?playerId=206173&season=2026`, { text: true, show: 900 });
await probe('UTS player matches (Sinner)', `${UTS}/matchesTable?playerId=206173&season=2026&current=1&rowCount=3`, { show: 900 });

// ---- Cricket: ESPN's match summary (league id from the score panel)
const sp = await probe('ESPN cricket scorepanel', 'https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel', { show: 200 });
const pairs = (sp?.scores || []).flatMap((s) => (s.events || []).map((ev) => ({ league: s.leagues?.[0]?.id, ev })));
const pick = pairs.find((x) => x.ev.status?.type?.state === 'post') || pairs[0];
if (pick) {
  const sm = await probe('ESPN cricket summary', `https://site.web.api.espn.com/apis/site/v2/sports/cricket/${pick.league}/summary?event=${pick.ev.id}`, { show: 1500 });
  if (sm?.rosters) say('ESPN cricket roster player', sm.rosters[0]?.roster?.[0], 1500);
  if (sm?.matchcards) say('ESPN cricket matchcard', sm.matchcards[0], 1000);
  const pid = sm?.rosters?.[0]?.roster?.[0]?.athlete?.id;
  if (pid) {
    await probe('ESPN cricket athlete (common)', `https://site.web.api.espn.com/apis/common/v3/sports/cricket/athletes/${pid}`, { show: 900 });
    await probe('ESPN cricket athlete stats', `https://site.web.api.espn.com/apis/common/v3/sports/cricket/athletes/${pid}/stats`, { show: 900 });
    await probe('ESPN core cricket athlete', `https://sports.core.api.espn.com/v2/sports/cricket/athletes/${pid}`, { show: 900 });
  }
}

// ---- Esports: bo3.gg team players and their stats; LoL
const t = await probe('bo3.gg team detail', 'https://api.bo3.gg/api/v1/teams/legacy-br?with=players', { show: 2500 });
if (t?.players?.[0]) say('bo3.gg player', t.players[0], 1500);
const pl = t?.players?.[0]?.slug;
if (pl) {
  await probe('bo3.gg player detail', `https://api.bo3.gg/api/v1/players/${pl}`, { show: 1500 });
  await probe('bo3.gg player general stats', `https://api.bo3.gg/api/v1/players/${pl}/general_stats`, { show: 1200 });
  await probe('bo3.gg player stats', `https://api.bo3.gg/api/v1/players/${pl}/stats`, { show: 1200 });
}
await probe('bo3.gg team stats', 'https://api.bo3.gg/api/v1/teams/legacy-br/stats', { show: 1200 });
await probe('Oracle\'s Elixir 2026', 'https://oracleselixir-downloadable-match-data.s3-us-west-2.amazonaws.com/2026_LoL_esports_match_data_from_OraclesElixir.csv', { text: true, show: 400 });
await new Promise((r) => setTimeout(r, 4000));
await probe('Leaguepedia (again)', 'https://lol.fandom.com/api.php?action=cargoquery&tables=ScoreboardPlayers&fields=Link,Team,Champion,Kills,Deaths,Assists&limit=2&format=json', { show: 500 });
