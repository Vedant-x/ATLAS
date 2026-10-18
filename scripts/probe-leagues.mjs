// One-off probe (CI only, removed after use): which feeds carry the leagues ATLAS is missing.
// Prints, for candidate ESPN league paths, the league name ESPN answers with and how many events;
// and TheSportsDB's league names per sport for the next three days.
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };
const get = async (u) => { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) }); return r.ok ? r.json() : { status: r.status }; };
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const cands = [
  ...Array.from({ length: 40 }, (_, i) => `rugby-league/${i + 1}`),
  ...['aflw', 'vfl', 'afl-women', 'afl-w'].map((s) => `australian-football/${s}`),
  ...['bra.camp.paulista', 'bra.camp.carioca', 'bra.copa_do_brazil'].map((s) => `soccer/${s}`),
  ...['mexican-league', 'lmb', 'lmp', 'mexican-pacific-league', 'liga-mexicana'].map((s) => `baseball/${s}`),
  ...['spain-acb', 'esp.1', 'acb', 'greece', 'gre.1', 'nzl.1', 'nz-nbl', 'nbl-nz'].map((s) => `basketball/${s}`),
];
for (const p of cands) {
  try { const j = await get(`${ESPN}/${p}/scoreboard`); if (j.leagues?.length || j.events?.length) console.log(`PROBE ESPN ${p}: "${j.leagues?.[0]?.name || '?'}" ${j.events?.length || 0} events`); }
  catch (e) { /* not there */ }
}
const day = (o) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
for (const s of ['Basketball', 'Rugby', 'Australian Football', 'Baseball', 'Soccer']) {
  const names = new Map();
  for (const o of [0, 1, 2]) {
    try { const j = await get(`https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${day(o)}&s=${encodeURIComponent(s)}`); for (const x of j.events || []) names.set(`${x.strLeague} (${x.idLeague})`, (names.get(`${x.strLeague} (${x.idLeague})`) || 0) + 1); } catch { /* skip */ }
  }
  console.log(`PROBE TSDB ${s}: ${[...names].map(([k, v]) => `${k}:${v}`).join(' | ') || 'none'}`);
}
