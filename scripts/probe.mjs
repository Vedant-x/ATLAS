// Temporary: what ESPN offers for cricket.
const urls = [
  'https://site.api.espn.com/apis/site/v2/sports/cricket/scorepanel',
  'https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket',
  'https://site.api.espn.com/apis/site/v2/sports/cricket/8048/scoreboard',
  'https://site.api.espn.com/apis/site/v2/sports/cricket/8039/scoreboard',
  'https://site.api.espn.com/apis/site/v2/sports/cricket/scoreboard',
  'https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel',
  'https://hs-consumer-api.espncricinfo.com/v1/pages/matches/current?lang=en&latest=true',
];
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' } });
    const t = await r.text();
    console.log('\n###', r.status, u, t.length);
    let j; try { j = JSON.parse(t); } catch { console.log(t.slice(0, 200)); continue; }
    const ev = j.events || j.scores?.flatMap((s) => s.events || []) || j.sports?.[0]?.leagues?.flatMap((l) => l.events || []) || j.matches || [];
    const leagues = j.scores?.map((s) => `${s.leagues?.[0]?.id}:${s.leagues?.[0]?.name}:${(s.events || []).length}`) || j.sports?.[0]?.leagues?.map((l) => `${l.id}:${l.name}:${(l.events || []).length}`) || [];
    console.log('keys', Object.keys(j).slice(0, 12).join(','), '| leagues', leagues.slice(0, 40).join(' | '), '| events', ev.length);
    const e = ev[0];
    if (e) console.log('sample', JSON.stringify(e).slice(0, 1500));
  } catch (err) { console.log('ERR', u, err.message); }
}
