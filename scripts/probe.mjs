// Temporary: which date forms ESPN still accepts.
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' };
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const day = (n) => ymd(new Date(Date.now() + n * 864e5));
for (const lg of ['soccer/uefa.nations', 'soccer/eng.1', 'basketball/nba', 'football/nfl', 'hockey/nhl', 'tennis/atp']) {
  for (const q of [`dates=${day(0)}`, `dates=${day(0)}-${day(1)}`, `dates=${day(-1)}-${day(1)}`, `dates=${day(0)}-${day(3)}`, `dates=${day(-1)}-${day(4)}`, `dates=${day(0)}-${day(6)}`, `dates=${day(0)}&limit=200`, `dates=${day(2)}`]) {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${lg}/scoreboard?${q}`, { headers: H });
    const j = r.ok ? await r.json() : {};
    console.log(r.status, lg.padEnd(22), q.padEnd(30), 'events', (j.events || []).length);
  }
}
