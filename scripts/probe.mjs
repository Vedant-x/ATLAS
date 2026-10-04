// Temporary: why does the Nations League show no matches?
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' };
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const now = new Date(), from = new Date(Date.now() - 864e5), to = new Date(Date.now() + 4 * 864e5);
const B = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
for (const lg of ['uefa.nations', 'uefa.w.nations', 'concacaf.nations.league', 'fifa.friendly', 'uefa.euroq']) {
  for (const q of ['', `?dates=${ymd(now)}`, `?dates=${ymd(from)}-${ymd(to)}`, `?dates=${ymd(from)}-${ymd(to)}&limit=500`]) {
    try {
      const r = await fetch(`${B}/${lg}/scoreboard${q}`, { headers: H });
      const j = r.ok ? await r.json() : {};
      const ev = j.events || [];
      console.log(r.status, lg.padEnd(24), (q || '(default)').padEnd(36), 'events', String(ev.length).padStart(3), '|', ev.slice(0, 4).map((e) => `${e.shortName} ${e.date.slice(5, 16)} ${e.status?.type?.state}`).join(' ; '), '| leagueDay', j.day?.date || '', (j.leagues?.[0]?.calendar || []).slice(0, 0));
    } catch (e) { console.log('ERR', lg, q, e.message); }
  }
}
// Whole-site check: how many leagues return MORE games on the default scoreboard than on the range form?
import('../js/catalog.js').then(async ({ ALL_LEAGUES }) => {
  const ls = ALL_LEAGUES.filter((l) => !l.path.startsWith('atlas/'));
  let worse = [];
  for (let i = 0; i < ls.length; i += 6) {
    await Promise.all(ls.slice(i, i + 6).map(async (l) => {
      const get = async (q) => { try { const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${l.path}/scoreboard${q}`, { headers: H }); return r.ok ? ((await r.json()).events || []).filter((e) => e.status?.type?.state !== 'post') : null; } catch { return null; } };
      const [d, rg] = await Promise.all([get(''), get(`?dates=${ymd(from)}-${ymd(to)}`)]);
      if (d && rg) { const ids = new Set(rg.map((e) => e.id)); const miss = d.filter((e) => !ids.has(e.id)); if (miss.length) worse.push(`${l.path}: default has ${miss.length} not in range (${miss.slice(0, 2).map((e) => e.shortName + ' ' + e.status?.type?.state).join(', ')})`); }
      if (d === null || rg === null) worse.push(`${l.path}: request failed (default ${d === null ? 'X' : 'ok'}, range ${rg === null ? 'X' : 'ok'})`);
    }));
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`\nLeagues where the range form misses games or fails (${worse.length}/${ls.length}):\n` + worse.join('\n'));
});
