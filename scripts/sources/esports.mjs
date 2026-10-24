// Build source (run by scripts/pages.mjs): esports.
import { get, log, problems } from '../lib.mjs';
import { BO3, ESB, BO3_GAMES, parseBo3, parseEsb, esbForm } from '../../js/esports.js';

// bo3.gg: every upcoming/live CS2, Valorant, LoL and Dota 2 series in the next 4 days.
export async function esports() {
  // bo3.gg is sometimes slow: each request gets 30 s and two retries, each game is fetched on its own
  // (in parallel), and a game that still fails keeps its fixtures from the last published snapshot,
  // so a slow source never empties the esports pages or raises a false alarm.
  const getJson = async (url) => {
    for (let i = 0; ; i++) {
      try { return JSON.parse(await get(url, { signal: AbortSignal.timeout(30000) })); } catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 3000 * (i + 1))); }
    }
  };
  const failed = [];
  const lists = await Promise.all(Object.entries(BO3_GAMES).map(async ([d, g]) => {
    const rows = [];
    try {
      for (let page = 0; page < 4; page++) {
        const j = await getJson(`${BO3}/matches?page[offset]=${page * 100}&page[limit]=100&sort=start_date&filter[matches.status][in]=current,upcoming&filter[matches.discipline_id][eq]=${d}&with=teams,tournament,games`);
        rows.push(...(j.results || []));
        const last = Date.parse(j.results?.at(-1)?.start_date);
        if ((page + 1) * 100 >= (j.total?.count || 0) || last > Date.now() + 4 * 864e5) break;
      }
      return parseBo3(rows);
    } catch (e) { failed.push(g); log(`Esports: ${g.game} failed (${e.message})`); return []; }
  }));
  const list = lists.flat();
  if (failed.length) {
    let kept = 0;
    try {
      const prev = await (await fetch(process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json', { signal: AbortSignal.timeout(20000) })).json();
      for (const e of prev.events || []) if (failed.some((g) => g.path === e.leaguePath) && (e.live || e.start > Date.now() - 3 * 36e5)) { list.push(e); kept++; }
    } catch { /* no previous snapshot */ }
    log(`Esports: kept ${kept} fixture(s) from the last snapshot for ${failed.map((g) => g.game).join(', ')}`);
    if (!kept) problems.push(`Esports feed (bo3.gg) failed for ${failed.map((g) => g.game).join(', ')} with no earlier fixtures to fall back on`);
  }
  const by = (p) => list.filter((e) => e.leaguePath === p).length;
  log(`Esports (bo3.gg): ${list.length} series (CS2 ${by('atlas/cs2')}, Valorant ${by('atlas/valorant')}, LoL ${by('atlas/lol')}, Dota 2 ${by('atlas/dota2')}), ${list.filter((e) => e.markets.length).length} priced, ${list.filter((e) => e.live).length} live`);
  return list;
}

// EsportsBattle eSoccer: the next 75 minutes of matches, with each player's form from the last day.
export async function esoccer() {
  const iso = (off) => new Date(Date.now() + off * 864e5).toISOString().slice(0, 10);
  const tours = [];
  for (let page = 1; page <= 10; page++) {
    const j = JSON.parse(await get(`${ESB}/tournaments?page=${page}&dateFrom=${iso(-1)}&dateTo=${iso(1)}`));
    tours.push(...(j.tournaments || []));
    if (page >= (j.totalPages || 1)) break;
  }
  const now = Date.now();
  const active = tours.filter((t) => t.status_id !== 4 && Date.parse(t.start_date) < now + 3 * 36e5);
  const recent = tours.filter((t) => t.status_id === 4).sort((a, b) => Date.parse(b.start_date) - Date.parse(a.start_date)).slice(0, 40);
  const withMatches = [];
  const queue = [...active, ...recent];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      try { withMatches.push({ tournament: t, matches: JSON.parse(await get(`${ESB}/tournaments/${t.id}/matches`)) }); } catch (e) { log('eSoccer tournament failed', t.id, e.message); }
    }
  }));
  const form = esbForm(withMatches.flatMap((x) => x.matches));
  const list = parseEsb(withMatches.filter((x) => x.tournament.status_id !== 4), now, form);
  log(`eSoccer (EsportsBattle): ${list.length} matches in the next 75 minutes (${list.filter((e) => e.live).length} live), form for ${form.size} players from ${withMatches.length} tournaments`);
  return list;
}
