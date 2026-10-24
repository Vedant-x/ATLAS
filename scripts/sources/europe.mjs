// Build source (run by scripts/pages.mjs): European leagues from their own feeds: EuroLeague, EuroCup, Liiga.
import { get, log, problems } from '../lib.mjs';
import { EUROLEAGUE, LIIGA, SWISS, euroSeason, euroRecords, euroEvent, liigaRecords, liigaEvent, swissRecords, swissEvent } from '../../js/europe.js';

export async function europe() {
  const getJson = async (u) => JSON.parse(await get(u, { headers: { Accept: 'application/json' } }));
  const season = euroSeason(), now = Date.now(), soon = (e) => e && (e.live || (e.start > now - 3 * 36e5 && e.start < now + 7 * 864e5));
  const out = [];
  for (const [comp, league, path] of [['E', 'EuroLeague', 'atlas/euroleague'], ['U', 'EuroCup', 'atlas/eurocup']]) {
    try {
      const games = (await getJson(EUROLEAGUE(comp, season))).data || [];
      const rec = euroRecords(games);
      const ev = games.map((g) => euroEvent(g, { comp, league, path }, rec, now)).filter((e) => soon(e) && !e.final);
      out.push(...ev);
      log(`${league}: ${ev.length} games in the next 7 days (${games.filter((g) => g.played).length} played this season, ${Object.keys(rec).length} clubs with records)${ev[0] ? `; next ${ev[0].home} v ${ev[0].away} (${ev[0].stats.homeRecord || '-'} / ${ev[0].stats.awayRecord || '-'})` : ''}`);
    } catch (err) { log(`${league} failed: ${err.message}`); problems.push(`${league} feed failed: ${err.message}`); }
  }
  try {
    const games = await getJson(LIIGA(season + 1));
    const rec = liigaRecords(games);
    const ev = games.map((g) => liigaEvent(g, rec, now)).filter(soon);
    out.push(...ev);
    log(`Liiga: ${ev.length} games in the next 7 days, ${ev.filter((e) => e.markets.length).length} with Veikkaus prices, ${games.filter((g) => g.ended).length} played${ev[0] ? `; next ${ev[0].home} v ${ev[0].away} ${ev[0].markets[0] ? ev[0].markets[0].outcomes.map((o) => o.odds).join('/') : 'unpriced'}` : ''}`);
  } catch (err) { log(`Liiga failed: ${err.message}`); problems.push(`Liiga feed failed: ${err.message}`); }
  try {
    const games = await getJson(SWISS);
    const rec = swissRecords(games);
    const ev = games.map((g) => swissEvent(g, rec, now)).filter(soon);
    out.push(...ev);
    log(`Swiss National League: ${ev.length} games in the next 7 days, ${Object.keys(rec).length} teams with records${ev[0] ? `; next ${ev[0].home} v ${ev[0].away} (${ev[0].stats.homeRecord || '-'} / ${ev[0].stats.awayRecord || '-'})` : ''}; statuses ${[...new Set(games.map((g) => g.status))].join(',')}`);
  } catch (err) { log(`Swiss NL failed: ${err.message}`); }
  return out;
}
