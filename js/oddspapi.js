// Stake's own prices (and Pinnacle's) from OddsPapi (oddspapi.io), the one odds service found that
// carries Stake, the book ATLAS's users bet at. Nothing here runs unless the build has an
// ODDS_PAPI_API_KEY repository secret (a free account: about 250 requests a month). Prices sit by
// bookmaker, then market id, then outcome id, then a player key ("0" for a match market):
//   fixture.bookmakerOdds.stake.markets["101"].outcomes["101"].players["0"].price
// Market 101 is football's full-time result (outcomes 101 home, 102 draw, 103 away), market 111 the
// NBA's moneyline (111 home, 112 away), as the live API returns them. Tournament ids are the usual ones
// (17 Premier League, 8 LaLiga ...); at most 5 per request, one bookmaker per request. Fixtures name
// their teams by id only (participant1Id = home): the names come from the API's participants list,
// and until then from Stake's own match link (".../46930044-inter-fiorentina") and the kick-off. Pure functions here; the build
// (scripts/sources/stake.mjs) fetches, budgets and caches.

import { normName, lineUp } from './oddsapi.js';

export const ODDSPAPI = 'https://api.oddspapi.io/v4';
// The books read: Stake (the API takes one bookmaker per request); Pinnacle where a response has it.
export const BOOKS = ['stake', 'pinnacle'];

// The leagues fetched, by tournament id, with the market that settles the match winner there.
// Football first: the most-bet leagues on Stake from India. Others are added once their market id
// is read from a live response (the build logs the market ids it finds on each league).
// path: the same league on the board (ESPN's), to tell when it has matches coming up.
export const STAKE_LEAGUES = [
  { id: 17, name: 'Premier League', sport: 'football', market: 101, path: 'soccer/eng.1' },
  { id: 8, name: 'LaLiga', sport: 'football', market: 101, path: 'soccer/esp.1' },
  { id: 23, name: 'Serie A', sport: 'football', market: 101, path: 'soccer/ita.1' },
  { id: 35, name: 'Bundesliga', sport: 'football', market: 101, path: 'soccer/ger.1' },
  { id: 34, name: 'Ligue 1', sport: 'football', market: 101, path: 'soccer/fra.1' },
  { id: 7, name: 'UEFA Champions League', sport: 'football', market: 101, path: 'soccer/uefa.champions' },
  { id: 679, name: 'UEFA Europa League', sport: 'football', market: 101, path: 'soccer/uefa.europa' },
  { id: 132, name: 'NBA', sport: 'basketball', market: 111, path: 'basketball/nba' },
];

// A fixture's two sides and start: names from the response, else from names (the participants list,
// id → name); slug: the teams in Stake's own match link ("inter-fiorentina"), home first.
export function fixtureSides(f, names = {}) {
  const pick = (...xs) => xs.find((x) => typeof x === 'string' && x.trim()) || null;
  const home = pick(f.participant1Name, f.homeName, f.home, f.participants?.[0]?.name, f.participant1?.name, names[f.participant1Id]);
  const away = pick(f.participant2Name, f.awayName, f.away, f.participants?.[1]?.name, f.participant2?.name, names[f.participant2Id]);
  const t = f.startTime ?? f.startTimestamp ?? f.start ?? f.commenceTime;
  const start = typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t);
  const link = String(f.bookmakerOdds?.stake?.fixturePath || f.bookmakerOdds?.stake?.bookmakerFixtureId || '');
  const slug = /(?:^|\/)\d+-([a-z0-9-]+)\/?$/.exec(link)?.[1] || null;
  return { home, away, start: Number.isFinite(start) ? start : null, slug };
}

// The participants list (id → name), whichever shape it comes in: an object of ids, or a list.
export function participantNames(j) {
  const out = {};
  const list = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : null;
  if (list) for (const p of list) { const id = p?.participantId ?? p?.id; const n = p?.participantName ?? p?.name ?? p?.shortName; if (id != null && n) out[id] = String(n); }
  else if (j && typeof j === 'object') for (const [id, v] of Object.entries(j)) { const n = typeof v === 'string' ? v : v?.participantName ?? v?.name; if (n) out[id] = String(n); }
  return out;
}

// One bookmaker's live prices for one market, outcomes in id order: [{ id, price }], or null.
export function bookPrices(f, book, market) {
  const m = f?.bookmakerOdds?.[book]?.markets?.[market];
  if (!m?.outcomes) return null;
  const out = Object.entries(m.outcomes).map(([id, o]) => {
    const p = o?.players?.['0'] ?? o?.players?.[0] ?? Object.values(o?.players || {})[0];
    return { id: Number(id), price: Number(p?.price), active: p?.active !== false };
  }).filter((x) => x.active && x.price > 1).sort((a, b) => a.id - b.id);
  return out.length >= 2 ? out : null;
}

// What a response holds, for the build log (the first live response settles what the docs leave
// open): each league's fixtures, how many have names, and the market ids found with their outcome
// counts, so the winner market of a new sport can be read off and added above.
export function describe(fixtures) {
  const byT = {};
  for (const f of fixtures) {
    const t = (byT[f.tournamentId] ||= { fixtures: 0, named: 0, stake: 0, markets: {} });
    t.fixtures++;
    const s = fixtureSides(f);
    if (s.home && s.away && s.start) t.named++;
    if (f.bookmakerOdds?.stake) t.stake++;
    for (const [book, b] of Object.entries(f.bookmakerOdds || {})) if (BOOKS.includes(book)) for (const [id, m] of Object.entries(b.markets || {})) t.markets[id] = Math.max(t.markets[id] || 0, Object.keys(m.outcomes || {}).length);
  }
  return byT;
}

// The fixtures, as matchable events: { home, away, start, stake: [prices], pinnacle: [prices] } for
// each league's winner market (outcomes in order: home, draw, away; or home, away).
export function stakeEvents(fixtures, leagues = STAKE_LEAGUES, names = {}) {
  const out = [];
  for (const f of fixtures) {
    const lg = leagues.find((l) => l.id === Number(f.tournamentId));
    if (!lg?.market) continue;
    const { home, away, start, slug } = fixtureSides(f, names);
    const stake = bookPrices(f, 'stake', lg.market);
    if (!start || !stake || !((home && away) || slug)) continue;
    out.push({ id: f.fixtureId, league: lg.name, path: lg.path, sport: lg.sport, home, away, slug, start, stake: stake.map((x) => x.price), pinnacle: bookPrices(f, 'pinnacle', lg.market)?.map((x) => x.price) || null });
  }
  return out;
}

// A fixture known only by Stake's link: the board's match in the same league kicking off within 15
// minutes, both of whose teams appear in the link ("inter-fiorentina": Internazionale, Fiorentina);
// home first in the link, else swapped. → { orient, score, dt } or null.
const words = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !['the', 'club', 'cf', 'fc', 'sc', 'ac'].includes(w));
export function slugMatch(s, e) {
  if (!s.slug || (s.path && e.leaguePath && s.path !== e.leaguePath) || !(Math.abs(s.start - e.start) <= 15 * 6e4)) return null;
  const sl = s.slug.split('-');
  const at = (name) => {
    for (const w of words(name)) {
      const i = sl.findIndex((x) => x === w || (x.length >= 4 && w.length >= 4 && (x.startsWith(w) || w.startsWith(x))));
      if (i >= 0) return i;
    }
    return -1;
  };
  const h = at(e.home), a = at(e.away);
  if (h < 0 || a < 0 || h === a) return null;
  return { orient: h < a ? 'same' : 'swapped', score: 2, dt: Math.abs(s.start - e.start) };
}

const WINNERS = ['Winner', 'Match Result', 'Moneyline'];
// Stake's price onto each matching event's winner market (o.stake, kept beside the feed's own price,
// e.stakeAt), and Pinnacle's fair chance (its margin removed) where the match has no sharp line yet.
// Only a market with the same outcomes is touched: three-way with a draw, or two-way without.
// Returns { stake: events given Stake's price, sharp: events given Pinnacle's fair chance }.
export function overlayStake(events, stakeEvs, { at = Date.now(), now = Date.now(), window = 6 * 36e5 } = {}) {
  let stake = 0, sharp = 0;
  for (const e of events) {
    if (e.live || !(e.start > now) || !e.markets?.length) continue;
    let best = null;
    for (const s of stakeEvs) {
      if (s.sport !== e.sport) continue;
      const m = s.home && s.away ? lineUp({ commence_time: new Date(s.start).toISOString(), home_team: s.home, away_team: s.away }, e, { window }) : slugMatch(s, e);
      if (m && (!best || m.score > best.m.score || (m.score === best.m.score && m.dt < best.m.dt))) best = { s, m };
    }
    if (!best) continue;
    const { s, m } = best;
    const mk = e.markets.find((x) => WINNERS.includes(x.name) && x.outcomes?.length === s.stake.length);
    if (!mk) continue;
    // Our outcomes in the order home, (draw,) away, and the response's the same way round or swapped.
    const order = mk.outcomes.length === 3 ? [e.home, 'Draw', e.away] : [e.home, e.away];
    const outs = order.map((n) => mk.outcomes.find((o) => (n === 'Draw' ? /^draw$/i.test(o.name) : normName(o.name) === normName(n))));
    if (!outs.every(Boolean)) continue;
    const flip = (xs) => (m.orient === 'swapped' ? [...xs].reverse() : xs);
    flip(s.stake).forEach((p, i) => { outs[i].stake = p; });
    e.stakeAt = at;
    e.stakeId = s.id;
    stake++;
    if (s.pinnacle?.length === outs.length && !outs.every((o) => Number.isFinite(o.cons))) {
      const inv = flip(s.pinnacle).map((p) => 1 / p), sum = inv.reduce((a, b) => a + b, 0);
      outs.forEach((o, i) => { o.cons = +(inv[i] / sum).toFixed(4); });
      mk.consensusFrom = 'Pinnacle';
      e.sharpAt = at;
      e.sharpFrom ||= 'oddspapi';
      sharp++;
    }
  }
  return { stake, sharp };
}

// The month's requests: the allowance left, spent at an even pace over the rest of the month (the
// free plan's monthly count resets at the start of each month). cache: { month, used, spentAt }.
export function allowance(cache, { monthly = 240, now = Date.now(), per = 1 } = {}) {
  const d = new Date(now), month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const used = cache?.month === month ? Number(cache.used) || 0 : 0;
  const left = monthly - used;
  if (left < per) return { month, used, ok: false, gap: Infinity };
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const gap = (per * (end - now)) / left; // ms between fetches at an even pace
  return { month, used, ok: now - (cache?.month === month ? cache.spentAt || 0 : 0) >= gap, gap };
}
