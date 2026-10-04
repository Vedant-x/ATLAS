// Temporary: FotMob lineup structure.
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36', Accept: 'application/json' };
const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const j = await (await fetch(`https://www.fotmob.com/api/data/matches?date=${day}`, { headers: H })).json();
const ms = (j.leagues || []).flatMap((l) => (l.matches || []).map((m) => ({ ...m, league: l.name }))).filter((m) => /Premier League|LaLiga|Serie A|Bundesliga|Ligue 1|Eredivisie|MLS|Championship/.test(m.league));
console.log('matches', ms.length);
let shown = 0;
for (const m of ms.slice(0, 25)) {
  const d = await (await fetch(`https://www.fotmob.com/api/data/matchDetails?matchId=${m.id}`, { headers: H })).json();
  const lu = d?.content?.lineup;
  if (!lu) continue;
  console.log('\n##', m.league, m.home?.name, 'v', m.away?.name, 'status', JSON.stringify(m.status).slice(0, 120), '| lineupType', lu.lineupType, '| keys', Object.keys(lu).join(','), '| team keys', Object.keys(lu.homeTeam || {}).join(','));
  if (shown++ < 3) {
    console.log('home formation', lu.homeTeam?.formation, 'starters', (lu.homeTeam?.starters || []).length, JSON.stringify((lu.homeTeam?.starters || [])[0]).slice(0, 600));
    console.log('subs', (lu.homeTeam?.subs || []).length, 'coach', JSON.stringify(lu.homeTeam?.coach).slice(0, 200));
  }
}
