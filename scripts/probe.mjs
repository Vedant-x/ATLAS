// Temporary: which sources allow browser (CORS) requests from the site.
const O = 'https://vedant-x.github.io';
const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const urls = [
  'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',
  'https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel',
  `https://www.fotmob.com/api/data/matches?date=${day}`,
  'https://www.fotmob.com/api/data/matchDetails?matchId=4813374',
  'https://statsapi.mlb.com/api/v1/schedule?sportId=1',
  'https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList',
  'https://npb.jp/bis/eng/2026/games/',
];
for (const u of urls) {
  for (const method of ['OPTIONS', 'GET']) {
    try {
      const r = await fetch(u, { method, headers: { Origin: O, 'Access-Control-Request-Method': 'GET', 'User-Agent': 'Mozilla/5.0 Chrome/130' } });
      console.log(method.padEnd(7), r.status, 'ACAO=', r.headers.get('access-control-allow-origin'), '|', u.slice(0, 90));
    } catch (e) { console.log(method, 'ERR', e.message, u); }
  }
}
