// Temporary probe: prop-bet shapes and box-score stats (printed to the CI log).
const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const J = (o, n = 1800) => JSON.stringify(o).slice(0, n);
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replaceAll('-', '');
for (const [sport, league] of [['basketball', 'nba'], ['baseball', 'mlb'], ['hockey', 'nhl'], ['soccer', 'eng.1'], ['football', 'nfl'], ['soccer', 'esp.1'], ['soccer', 'uefa.champions'], ['basketball', 'wnba']]) {
  try {
    const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`);
    const ev = (sb.events || []).find((e) => e.status?.type?.state === 'pre') || sb.events?.[0];
    if (ev) {
      const comp = ev.competitions[0];
      const base = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${ev.id}/competitions/${comp.id}`;
      const pb = await get(`${base}/odds/100/propBets?limit=1000`).catch((e) => ({ err: e.message }));
      console.log(`## ${league} ${ev.name} props=${pb.count ?? pb.err}`);
      const seen = new Set();
      for (const x of pb.items || []) {
        const t = x.type?.name;
        if (seen.has(t) || !/Milestones|Anytime|To Receive a Card|Both Teams To Score$|Team Total|Clean Sheet|Total Hits$|Total Points$/.test(t)) continue;
        seen.add(t);
        const same = pb.items.filter((y) => y.type?.name === t && (y.athlete?.$ref || y.team?.$ref) === (x.athlete?.$ref || x.team?.$ref));
        console.log(`TYPE ${t} n_same_subject=${same.length}`);
        console.log('  ', same.slice(0, 3).map((y) => J({ ...y, competition: undefined, provider: undefined }, 700)).join('\n   '));
      }
      const keys = new Set(); for (const x of pb.items || []) { for (const k of Object.keys(x)) keys.add(k); for (const k of Object.keys(x.current || {})) keys.add('current.' + k); for (const k of Object.keys(x.odds || {})) keys.add('odds.' + k); }
      console.log('KEYS', [...keys].join(','));
      const aref = pb.items?.find((x) => x.athlete)?.athlete?.$ref;
      if (aref) { const a = await get(aref.replace('http:', 'https:')); console.log('ATHLETE', J({ id: a.id, displayName: a.displayName, shortName: a.shortName, team: a.team, position: a.position?.abbreviation }, 600)); }
    }
    // A finished game from the last days: box score layout.
    for (let d = 1; d <= 4; d++) {
      const old = await get(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${ymd(Date.now() - d * 864e5)}`).catch(() => null);
      const done = old?.events?.find((e) => e.status?.type?.state === 'post');
      if (!done) continue;
      const sm = await get(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${done.id}`);
      console.log(`BOX ${league} ${done.name}`);
      for (const team of (sm.boxscore?.players || []).slice(0, 1)) {
        for (const g of team.statistics || []) console.log('  GROUP', J({ name: g.name, type: g.type, keys: g.keys, labels: g.labels, names: g.names, first: g.athletes?.[0] && { id: g.athletes[0].athlete?.id, name: g.athletes[0].athlete?.displayName, stats: g.athletes[0].stats } }, 1200));
      }
      if (!sm.boxscore?.players) console.log('  NO PLAYERS; rosters?', J(Object.keys(sm)), J(sm.rosters?.[0]?.roster?.[0], 1500));
      break;
    }
  } catch (e) { console.log(`## ${league} ERR ${e.message}`); }
}
