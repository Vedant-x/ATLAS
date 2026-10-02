const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Accept: 'application/json' };
for (const lg of ['atp', 'wta']) {
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/${lg}/scoreboard`, { headers: UA });
  const j = await r.json();
  console.log('\n#####', lg, r.status, 'top keys', Object.keys(j).join(','), 'events', j.events?.length);
  for (const ev of (j.events || []).slice(0, 4)) {
    console.log('EVENT', JSON.stringify({ id: ev.id, name: ev.name, shortName: ev.shortName, date: ev.date, endDate: ev.endDate, keys: Object.keys(ev), venue: ev.venue, major: ev.major, season: ev.season }).slice(0, 700));
    for (const g of ev.groupings || []) {
      const cs = g.competitions || [];
      console.log('  GROUP', JSON.stringify(g.grouping).slice(0, 200), 'n', cs.length);
      const c = cs.find((x) => x.status?.type?.state === 'pre') || cs[0];
      if (c) {
        console.log('   comp keys', Object.keys(c).join(','));
        console.log('   comp', JSON.stringify({ round: c.round, type: c.type, venue: c.venue, notes: c.notes, format: c.format, status: c.status?.type?.shortDetail, date: c.date, odds: c.odds?.[0] && Object.keys(c.odds[0]) }).slice(0, 600));
        console.log('   competitor', JSON.stringify(c.competitors?.[0]).slice(0, 700));
      }
    }
  }
}
