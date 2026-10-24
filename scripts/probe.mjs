// TEMPORARY (removed before merge), round 5: a current source of the men's serve and return numbers.
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', Accept: 'application/json, text/plain, */*' };
async function get(url, headers = {}) {
  try { const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(25000) }); const b = await r.text(); console.log(`PROBE GET ${url.slice(0, 140)}: HTTP ${r.status} ${b.length} B`); try { return JSON.parse(b); } catch { return b; } } catch (e) { console.log(`PROBE GET ${url}: failed ${e.message}`); return null; }
}
const say = (name, x, n = 2000) => console.log(`PROBE ${name}: ${(typeof x === 'string' ? x : JSON.stringify(x)).replace(/\s+/g, ' ').slice(0, n)}`);

// TML-Database: is it kept current?
const on = await get('https://raw.githubusercontent.com/Tennismylife/TML-Database/master/ongoing_tourneys.csv');
if (typeof on === 'string') { const rows = on.trim().split('\n').slice(1).map((l) => l.split(',')); say('TML ongoing', `${rows.length} rows; tournaments ${[...new Set(rows.map((r) => `${r[1]} ${r[6]}`))].join(' | ')}; first: ${rows[0]?.join(',')}`, 1200); }
const cm = await get('https://api.github.com/repos/Tennismylife/TML-Database/commits?per_page=3');
if (Array.isArray(cm)) say('TML commits', cm.map((c) => `${c.commit?.committer?.date} ${c.commit?.message?.slice(0, 60)}`), 600);
const y25 = await get('https://raw.githubusercontent.com/Tennismylife/TML-Database/master/2025.csv');
if (typeof y25 === 'string') { const ls = y25.trim().split('\n'); say('TML 2025', `${ls.length} rows; last ${ls.at(-1).slice(0, 160)}`, 400); }

// ESPN: per-match statistics on this week's bigger ATP events.
const sb = await get('https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard');
const evs = sb?.events || [];
say('ESPN ATP events', evs.map((e) => `${e.id} ${e.name} (${e.groupings?.length || 0} groupings)`), 800);
let tried = 0;
for (const ev of evs) {
  for (const g of ev.groupings || []) {
    const c = (g.competitions || []).find((x) => x.status?.type?.completed && /singles/i.test(g.grouping?.displayName || x.type?.text || 'singles'));
    if (!c || tried >= 3) continue;
    tried++;
    const comp = c.competitors?.[0];
    await get(`https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/events/${ev.id}/competitions/${c.id}/competitors/${comp?.id}/statistics`).then((x) => say(`ESPN core stats ${ev.name} ${c.id}`, x, 1500));
  }
}

// The ATP's app API (not the website).
for (const u of ['https://app.atptour.com/api/v2/gateway/livematches/website?scoringTournamentLevel=tour', 'https://app.atptour.com/api/gateway/rankings.ranksglrollrange?fromRank=1&toRank=3', 'https://www.atptour.com/en/-/www/rank/sglroll/250?v=1']) await get(u).then((x) => say(`ATP app ${u.slice(26, 90)}`, x, 600));

// UTS: does it hold 2026 matches and stats?
const UTS = 'https://www.ultimatetennisstatistics.com';
await get(`${UTS}/matchesTable?playerId=50810&season=2026&current=1&rowCount=3&sort%5Bdate%5D=desc`).then((x) => say('UTS Sinner 2026 matches', x, 900));
await get(`${UTS}/matchesTable?playerId=50810&current=1&rowCount=2&sort%5Bdate%5D=desc`).then((x) => say('UTS Sinner latest matches', x, 900));
await get(`${UTS}/playerStats?playerId=50810&season=2026`).then((x) => say('UTS playerStats', x, 900));
for (const cat of ['aces', 'servicePointsWonPct', 'serviceGamesWonPct', 'returnPointsWonPct']) await get(`${UTS}/statsLeadersTable?category=${cat}&season=&current=1&rowCount=2`).then((x) => say(`UTS leaders ${cat} (all seasons)`, x, 500));
