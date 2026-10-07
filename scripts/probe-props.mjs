// Temporary probe: what ESPN's prop-bet feed returns (printed to the CI log).
const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const short = (o, n = 2500) => JSON.stringify(o).slice(0, n);
for (const [sport, league] of [['football', 'nfl'], ['basketball', 'nba'], ['baseball', 'mlb'], ['hockey', 'nhl'], ['soccer', 'eng.1'], ['football', 'college-football']]) {
  try {
    const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`);
    const ev = (sb.events || []).find((e) => e.status?.type?.state === 'pre') || sb.events?.[0];
    if (!ev) { console.log(`## ${league}: no events`); continue; }
    const comp = ev.competitions[0];
    console.log(`## ${league} ${ev.id} ${ev.name} ${ev.date}`);
    console.log('SITE ODDS', short(comp.odds?.[0], 1500));
    const base = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${ev.id}/competitions/${comp.id}`;
    const odds = await get(`${base}/odds?limit=50`);
    console.log('PROVIDERS', (odds.items || []).map((i) => `${i.provider?.id}:${i.provider?.name}`).join(', '));
    console.log('CORE ODDS ITEM', short(odds.items?.[0], 3000));
    for (const it of odds.items || []) {
      const id = it.provider?.id;
      try {
        const pb = await get(`${base}/odds/${id}/propBets?limit=1000`);
        console.log(`PROPBETS provider ${id} count=${pb.count} pageCount=${pb.pageCount}`);
        console.log('PROPBETS SAMPLE', short((pb.items || []).slice(0, 4), 4000));
        const types = {}; for (const x of pb.items || []) { const k = x.type?.name || x.type?.id || JSON.stringify(x.type); types[k] = (types[k] || 0) + 1; }
        console.log('PROPBET TYPES', short(types, 3000));
        const ath = pb.items?.find((x) => x.athlete)?.athlete;
        if (ath?.$ref) console.log('ATHLETE REF', ath.$ref);
      } catch (e) { console.log(`PROPBETS provider ${id} ERR ${e.message}`); }
    }
  } catch (e) { console.log(`## ${league} ERR ${e.message}`); }
}
// Scoreboard date ranges (reported to return 400 for MLB/NFL).
for (const [s, l] of [['baseball', 'mlb'], ['football', 'nfl'], ['basketball', 'nba'], ['hockey', 'nhl'], ['soccer', 'eng.1']]) {
  const d = new Date(), a = d.toISOString().slice(0, 10).replaceAll('-', ''), b = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10).replaceAll('-', '');
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${s}/${l}/scoreboard?dates=${a}-${b}`).catch((e) => ({ status: e.message }));
  console.log(`RANGE ${l} ${a}-${b}: ${r.status}`);
}
