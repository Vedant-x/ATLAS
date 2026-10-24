// Build source (run by scripts/pages.mjs): MMA odds.
import { get, log } from '../lib.mjs';
import { CORE } from '../../js/props.js';
import { toDecimal } from '../../js/espn.js';

// ESPN's MMA scoreboard carries no prices, but its core odds feed has DraftKings moneylines for each
// bout. That feed's "home"/"away" doesn't follow the scoreboard's fighter order, so the favourite is
// identified by name from its "details" line ("M. Gatto -115") and the prices matched to our fighters.
export async function mmaOdds(events) {
  const getJson = async (u) => JSON.parse(await get(u.replace(/^http:/, 'https:')));
  const due = events.filter((e) => e.leaguePath?.startsWith('mma/') && !e.markets?.length && !e.live && e.eventId && e.start > Date.now() && e.start < Date.now() + 8 * 864e5);
  const last = (s) => String(s || '').trim().split(/\s+/).pop().toLowerCase();
  let priced = 0;
  const q = [...due];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (q.length) {
      const e = q.shift();
      const [sport, league] = e.leaguePath.split('/');
      try {
        const it = (await getJson(`${CORE}/${sport}/leagues/${league}/events/${e.eventId}/competitions/${e.compId}/odds`)).items?.find((x) => x.homeAthleteOdds && x.awayAthleteOdds);
        if (!it) continue;
        const fav = [it.homeAthleteOdds, it.awayAthleteOdds].find((x) => x.favorite) ? (it.homeAthleteOdds.favorite ? it.homeAthleteOdds : it.awayAthleteOdds) : null;
        const dog = fav === it.homeAthleteOdds ? it.awayAthleteOdds : it.homeAthleteOdds;
        const favName = last(String(it.details || '').replace(/\s*[-+]?\d+\s*$/, ''));
        const favSide = last(e.home) === favName ? 'home' : last(e.away) === favName ? 'away' : null;
        const f = toDecimal(fav?.moneyLine), d = toDecimal(dog?.moneyLine);
        if (!fav || !favSide || !f || !d) continue;
        const odds = favSide === 'home' ? { home: f, away: d } : { home: d, away: f };
        e.markets = [{ name: 'Winner', outcomes: [{ name: e.home, odds: odds.home }, { name: e.away, odds: odds.away }] }];
        e.bookmaker = it.provider?.name || 'DraftKings';
        priced++;
      } catch { /* unpriced bout */ }
    }
  }));
  log(`MMA odds (DraftKings via ESPN core): ${priced} of ${due.length} upcoming bouts priced`);
}
