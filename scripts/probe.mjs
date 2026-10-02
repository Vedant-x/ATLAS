// One-off discovery run (GitHub Actions): which leagues and detail fields do the free sources expose?
const get = async (u, opt) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(20000), ...opt }); const t = await r.text(); return { s: r.status, t }; } catch (e) { return { s: 'ERR ' + e.message, t: '' }; } };
const j = (t) => { try { return JSON.parse(t); } catch { return null; } };
const out = (...a) => console.log(...a);

// 1. ESPN league catalogue per sport
for (const sport of ['soccer', 'basketball', 'football', 'hockey', 'baseball', 'tennis', 'mma', 'rugby', 'cricket', 'volleyball', 'lacrosse', 'australian-football', 'rugby-league']) {
  const r = await get(`https://sports.core.api.espn.com/v2/sports/${sport}/leagues?limit=1000`);
  const d = j(r.t);
  out(`LEAGUES ${sport} status=${r.s} count=${d?.count ?? '-'}`);
  if (d?.items) {
    const refs = d.items.map((x) => x.$ref);
    const names = [];
    for (let i = 0; i < refs.length; i += 25) {
      const batch = await Promise.all(refs.slice(i, i + 25).map((u) => get(u.replace('http:', 'https:')).then((x) => j(x.t))));
      batch.forEach((l) => l && names.push(`${l.slug}|${l.abbreviation || ''}|${l.name}`));
    }
    out(names.join(' ;; '));
  }
}
// 2. Scoreboard + summary shape per sport
const samples = ['soccer/eng.1', 'basketball/nba', 'football/nfl', 'hockey/nhl', 'baseball/mlb', 'tennis/atp', 'mma/ufc', 'basketball/mens-college-basketball'];
for (const path of samples) {
  const sb = j((await get(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`)).t);
  const ev = sb?.events?.[0];
  out(`SCOREBOARD ${path} events=${sb?.events?.length ?? 'x'} compKeys=${Object.keys(ev?.competitions?.[0] || {}).join(',')}`);
  out(`  competitorKeys=${Object.keys(ev?.competitions?.[0]?.competitors?.[0] || {}).join(',')} oddsKeys=${Object.keys(ev?.competitions?.[0]?.odds?.[0] || {}).join(',')}`);
  if (ev) {
    const sm = j((await get(`https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${ev.id}`)).t);
    out(`  SUMMARY keys=${Object.keys(sm || {}).join(',')}`);
    for (const k of ['boxscore', 'predictor', 'injuries', 'leaders', 'standings', 'seasonseries', 'headToHeadGames', 'lastFiveGames', 'pickcenter', 'rosters', 'gameInfo', 'winprobability', 'odds', 'againstTheSpread']) {
      if (sm?.[k] != null) out(`   ${k}: ${JSON.stringify(sm[k]).slice(0, 700)}`);
    }
  }
}
// CORS check for browser use
const c = await get('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard', { headers: { Origin: 'https://vedant-x.github.io' } });
out('CORS espn status', c.s);
// 3. MLB statsapi pitcher depth
const mlb = j((await get('https://statsapi.mlb.com/api/v1/schedule?sportId=1&hydrate=probablePitcher&date=' + new Date().toISOString().slice(0, 10))).t);
const pp = mlb?.dates?.[0]?.games?.[0]?.teams?.home?.probablePitcher;
out('MLB games', mlb?.totalGames, 'probable', JSON.stringify(pp));
if (pp) {
  const st = (await get(`https://statsapi.mlb.com/api/v1/people/${pp.id}?hydrate=stats(group=[pitching],type=[season,career,gameLog,lastXGames],limit=5)`)).t;
  out('MLB pitcher', st.slice(0, 2500));
}
const r1 = await fetch('https://statsapi.mlb.com/api/v1/teams?sportId=1', { headers: { Origin: 'https://vedant-x.github.io' } }).catch(() => null);
out('CORS mlb', r1?.headers.get('access-control-allow-origin'));
// 4. NPB / KBO sources
for (const u of ['https://npb.jp/announcement/starter/', 'https://npb.jp/bis/eng/2026/games/', 'https://eng.koreabaseball.com/Schedule/DailySchedule.aspx', 'https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx', 'https://statsapi.mlb.com/api/v1/sports']) {
  const r = await get(u, { headers: { 'User-Agent': 'Mozilla/5.0 ATLAS research' } });
  out(`SRC ${u} status=${r.s} len=${r.t.length} sample=${r.t.replace(/\s+/g, ' ').slice(0, 600)}`);
}
const sports = j((await get('https://statsapi.mlb.com/api/v1/sports')).t);
out('MLB statsapi sports:', sports?.sports?.map((s) => `${s.id}:${s.name}`).join(', '));
// 5. NHL official
const nhl = (await get('https://api-web.nhle.com/v1/schedule/now', { headers: { Origin: 'https://vedant-x.github.io' } }));
out('NHL', nhl.s, nhl.t.slice(0, 300));
