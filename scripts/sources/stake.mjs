// Build source (run by scripts/pages.mjs): Stake's own prices, and Pinnacle's, from OddsPapi
// (js/oddspapi.js). Off until the ODDS_PAPI_API_KEY repository secret is set (a free oddspapi.io account;
// the workflows pass it in as ODDSPAPI_KEY).
// The free plan's requests are few (ODDSPAPI_MONTHLY, default 240 a month), so: one request a time
// for every league at once, only while one of them has a match in the next 36 hours and the prices
// held are 3+ hours old, spent at an even pace to the end of the month. The prices and the month's
// count are kept in data/stake.json, which the next build reads back from the live site. CI sets
// ODDSPAPI_BUDGET=0: test builds only reuse the live site's prices.
import { out, log, noteSource } from '../lib.mjs';
import { writeFile } from 'node:fs/promises';
import { ODDSPAPI, STAKE_LEAGUES, stakeEvents, overlayStake, describe, allowance } from '../../js/oddspapi.js';

const NAME = 'Stake (OddsPapi)', SITE = 'oddspapi.io', WHAT = "Stake's own prices on the main football leagues, and Pinnacle's fair chance";
const MAX_AGE = 12 * 36e5; // older prices are not shown

export async function stakePrices(events) {
  const key = process.env.ODDSPAPI_KEY;
  if (!key) { noteSource(NAME, SITE, WHAT, null, null, 'not switched on: add an ODDS_PAPI_API_KEY repository secret (a free oddspapi.io account)'); return; }
  let cache = { month: null, used: 0, spentAt: 0, at: 0, events: [] };
  try {
    const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'stake.json'), { signal: AbortSignal.timeout(15000) });
    if (r.ok) cache = { ...cache, ...(await r.json()) };
  } catch { /* first run */ }
  const monthly = Number(process.env.ODDSPAPI_MONTHLY || 240);
  // ODDSPAPI_BUDGET: '0' spends nothing (CI); 'force' reads once now, whatever the pace (to check a
  // change against the live API); unset: the even pace below.
  const force = process.env.ODDSPAPI_BUDGET === 'force', spend = process.env.ODDSPAPI_BUDGET !== '0';
  const now = Date.now();
  const soon = STAKE_LEAGUES.filter((l) => events.some((e) => e.leaguePath === l.path && !e.live && e.start > now && e.start < now + 36 * 36e5));
  const pace = allowance(cache, { monthly, now });
  const due = force || (spend && soon.length && pace.ok && !(cache.at > now - 3 * 36e5));
  let fetched = null, note = '';
  if (due) {
    // One bookmaker per request (the API refuses more): Stake. Pinnacle's line on these leagues comes
    // from The Odds API. The key goes only in the request, never in the log.
    const path = `/odds-by-tournaments?tournamentIds=${STAKE_LEAGUES.map((l) => l.id).join(',')}&bookmaker=stake&oddsFormat=decimal`;
    try {
      const r = await fetch(`${ODDSPAPI}${path}&apiKey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(30000) });
      cache = { ...cache, month: pace.month, used: pace.used + 1, spentAt: now };
      const body = await r.text();
      let j = null;
      try { j = JSON.parse(body); } catch { /* not JSON */ }
      const list = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.fixtures) ? j.fixtures : null;
      if (!r.ok || !list) { note = `HTTP ${r.status}: ${body.replace(/\s+/g, ' ').slice(0, 300)}`; log(`Stake (OddsPapi) ${path}: ${note}`); }
      else {
        fetched = list;
        const evs = stakeEvents(list);
        cache = { ...cache, at: now, events: evs, seen: describe(list) };
        log(`Stake (OddsPapi): ${list.length} fixtures read; by league: ${Object.entries(cache.seen).map(([t, x]) => `${STAKE_LEAGUES.find((l) => l.id === Number(t))?.name || t} ${x.fixtures} (${x.named} named, ${x.stake} with Stake; markets ${Object.entries(x.markets).map(([m, n]) => `${m}:${n}`).join(' ') || 'none'})`).join(' · ') || 'none'}`);
        // The first fixture's keys, while the reader is new: what the response holds when names are missing.
        if (list.length && !evs.length) log(`  no fixture read; first fixture's keys: ${Object.keys(list[0]).join(', ')}; ${JSON.stringify(list[0]).slice(0, 600)}`);
        else log(`  e.g. ${evs.slice(0, 4).map((x) => `${x.home} v ${x.away} (${x.league}): Stake ${x.stake.join(' / ')}`).join(' · ')}`);
      }
    } catch (e) { note = e.message; log(`Stake (OddsPapi) failed: ${e.message}`); }
  }
  // The prices held (just read, or from the live site) onto the board, while they are fresh.
  const held = cache.at > now - MAX_AGE ? (cache.events || []).filter((s) => s.start > now) : [];
  const { stake, sharp } = overlayStake(events, held, { at: cache.at, now });
  cache = { ...cache, events: held };
  await writeFile(`${out}/data/stake.json`, JSON.stringify(cache));
  const age = cache.at ? `${Math.round((now - cache.at) / 6e4)} min old` : 'none yet';
  log(`Stake (OddsPapi): ${fetched ? 'read this build' : due ? 'read failed' : `held (${age})`}; ${held.length} fixtures with Stake prices; Stake's price on ${stake} matches here, Pinnacle's fair chance added to ${sharp}; requests this month ${cache.month === pace.month ? cache.used : 0} of ${monthly}${spend ? '' : ' (CI: none spent)'}; leagues with matches in 36 h: ${soon.map((l) => l.name).join(', ') || 'none'}`);
  const ok = note ? false : held.length ? true : cache.at ? true : null;
  noteSource(NAME, SITE, WHAT, ok, stake, note || (held.length ? `Stake's price on ${stake} matches; read ${age}` : `waiting for the first read (${soon.length ? 'due' : 'no main-league match in the next 36 hours'})`));
}
