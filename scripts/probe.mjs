const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };
const get = async (u) => { const r = await fetch(u, { headers: UA }); const t = await r.text(); console.log(`\n## ${r.status} ${u} len=${t.length}`); return t; };
const day = await get('https://npb.jp/bis/eng/2026/games/gm20260927.html');
const box = day.match(/\/bis\/eng\/2026\/games\/s\d+\.html/)[0];
// link_box structure around the first box link
const i = day.indexOf(box); console.log('around link', day.slice(i - 300, i + 900).replace(/\s+/g, ' '));
const b = await get('https://npb.jp' + box);
const txt = b.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
const tabs = [...txt.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0].replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ').replace(/(\|\s*)+/g, '|'));
console.log('tables', tabs.length); tabs.forEach((t, k) => console.log(k, t.slice(0, 500)));
console.log('player links in box', [...b.matchAll(/players\/(\d+)\.html[^>]*>([^<]+)/g)].slice(0, 30).map((m) => m[1] + ':' + m[2]).join(', '));
// MLB schedule: team ids/names & game types this week
const s = await (await fetch('https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2026-10-02&endDate=2026-10-06&hydrate=probablePitcher')).json();
for (const d of s.dates || []) for (const g of d.games) console.log('MLB', g.gameType, g.gameDate, g.teams.away.team.id, g.teams.away.team.name, '@', g.teams.home.team.id, g.teams.home.team.name, 'P', g.teams.away.probablePitcher?.id, g.teams.home.probablePitcher?.id);
const gl = await (await fetch('https://statsapi.mlb.com/api/v1/people/543037/stats?stats=gameLog&group=pitching&season=2026')).json();
const sp = gl.stats?.[0]?.splits?.slice(-1)[0];
console.log('gameLog split keys', sp && Object.keys(sp).join(','), JSON.stringify({ date: sp?.date, isHome: sp?.isHome, isWin: sp?.isWin, game: sp?.game, opp: sp?.opponent?.name, dec: sp?.stat?.wins + '/' + sp?.stat?.losses, gs: sp?.stat?.gamesStarted }));
