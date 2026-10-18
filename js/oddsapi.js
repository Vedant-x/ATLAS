// Bookmaker odds and fixtures from The Odds API (the-odds-api.com). Nothing here runs unless the
// build has an ODDS_API_KEY (the free plan: 500 credits a month; one credit per market per region per
// odds request; the sports list and fixture lists are free). Matches are tied by team names and start
// time; each market takes the best price on offer and the consensus fair chance. Pure functions here
// so they can be tested; the build (scripts/pages.mjs) does the fetching, caching and budgeting.

export const ODDS_API = 'https://api.the-odds-api.com/v4';

export const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(fc|cf|afc|sc|ac|as|ss|ssc|sv|if|bk|sk|hc|hk|cd|ud|rc|club|calcio|basketball|hockey|united|city|the)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

// The same team or player under two spellings: the same name, every word of the shorter name in the
// longer (at least 4 letters in all: "Valencia" / "Valencia Basket"), or one the start of the other
// ("Kocaeli" / "Kocaelispor").
export function sameSide(x, y) {
  const a = normName(x), b = normName(y);
  if (!a || !b) return false;
  if (a === b) return true;
  const wa = a.split(' '), wb = b.split(' ');
  const [sh, lo] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
  if (sh.join('').length >= 4 && sh.every((w) => lo.has(w))) return true;
  const [p, q] = a.length <= b.length ? [a, b] : [b, a];
  return p.length >= 5 && q.startsWith(p);
}

// How an API event lines up with one of ours: { orient: 'same' | 'swapped', score } or null. Both
// sides matching scores 2; one side alone (1) only within three hours, as no team or player plays
// twice in that time.
export function lineUp(o, e, { window = 6 * 36e5 } = {}) {
  const dt = Math.abs(Date.parse(o.commence_time) - e.start);
  if (!(dt <= window)) return null;
  const hh = sameSide(o.home_team, e.home), aa = sameSide(o.away_team, e.away), ha = sameSide(o.home_team, e.away), ah = sameSide(o.away_team, e.home);
  if (hh && aa) return { orient: 'same', score: 2, dt };
  if (ha && ah) return { orient: 'swapped', score: 2, dt };
  if (dt <= 3 * 36e5 && (hh || aa) !== (ha || ah)) return { orient: hh || aa ? 'same' : 'swapped', score: 1, dt };
  return null;
}

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; };

// Every bookmaker's price per outcome, per market, for one event: { p, book } lists.
export function consensus(oddsEvent) {
  const h2h = {}, totals = {}, spreads = {};
  let books = 0;
  const updated = [];
  for (const bk of oddsEvent.bookmakers || []) {
    let used = false;
    const t = Date.parse(bk.last_update || '');
    const q = (o) => ({ p: o.price, book: bk.title || bk.key || '?', key: bk.key || '' });
    for (const m of bk.markets || []) {
      if (m.key === 'h2h') { for (const o of m.outcomes || []) if (o.price > 1) { (h2h[o.name] ||= []).push(q(o)); used = true; } }
      else if (m.key === 'totals') { for (const o of m.outcomes || []) if (o.price > 1 && Number.isFinite(o.point)) { const k = `${o.point}`; (totals[k] ||= { point: o.point, over: [], under: [] })[/^over$/i.test(o.name) ? 'over' : 'under'].push(q(o)); used = true; } }
      else if (m.key === 'spreads') { for (const o of m.outcomes || []) if (o.price > 1 && Number.isFinite(o.point)) { const k = `${o.name}|${o.point}`; (spreads[k] ||= { name: o.name, point: o.point, p: [] }).p.push(q(o)); used = true; } }
    }
    if (used) { books++; if (Number.isFinite(t)) updated.push(t); }
  }
  // When the quotes were taken: the median of the books' own update times (null if none say).
  return { h2h, totals, spreads, books, quotedAt: updated.length ? median(updated) : null };
}

// The main total / spread line is the one the most books offer (ties: the middle line).
const mainBy = (entries, count) => {
  const ok = entries.filter(count);
  if (!ok.length) return null;
  const max = Math.max(...ok.map(count));
  const top = ok.filter((e) => count(e) === max).sort((a, b) => a.point - b.point);
  return top[Math.floor((top.length - 1) / 2)];
};

// One market from every book's prices for its outcomes (lists of { p, book, key }):
// - odds: the best price on offer, and the bookmaker offering it (line shopping: the same
//   selection at the longest odds);
// - cons: the consensus chance, margin removed: Pinnacle's prices where Pinnacle quotes every
//   outcome (the sharpest book, the market's reference), otherwise the median of all books.
// A selection whose best price is longer than 1 / cons is a price the market as a whole thinks
// is too long: the same odds, a better chance.
const SHARP = /^pinnacle$/i;
function shopped(name, lists, names) {
  const best = lists.map((l) => l.reduce((a, b) => (b.p > a.p ? b : a)));
  const sharp = lists.map((l) => l.find((x) => SHARP.test(x.key) || SHARP.test(x.book)));
  const ref = sharp.every(Boolean) ? sharp.map((x) => x.p) : lists.map((l) => median(l.map((x) => x.p)));
  const inv = ref.map((p) => 1 / p), book = inv.reduce((a, b) => a + b, 0);
  return { name, consensusFrom: sharp.every(Boolean) ? 'Pinnacle' : `median of ${Math.min(...lists.map((l) => l.length))}+ books`,
    outcomes: names.map((n, i) => ({ name: n, odds: +best[i].p.toFixed(2), book: best[i].book, cons: +(inv[i] / book).toFixed(4) })) };
}

// Markets in the site's own shape (espn.js marketsFrom), from one matched Odds API event.
// api: the API's names for our home and away sides (default: the same names).
export function marketsFromOdds(oddsEvent, { home, away, api = null }) {
  const apiHome = api?.home ?? home, apiAway = api?.away ?? away;
  const c = consensus(oddsEvent);
  const markets = [];
  const list = (team) => { const hit = Object.keys(c.h2h).find((n) => normName(n) === normName(team)); return hit ? c.h2h[hit] : null; };
  const h = list(apiHome), a = list(apiAway);
  const drawKey = Object.keys(c.h2h).find((n) => /^draw$/i.test(n));
  const d = drawKey ? c.h2h[drawKey] : null;
  if (h && a) {
    // A draw the books price makes it a three-way market (soccer, rugby, handball, Test cricket).
    markets.push(d ? shopped('Match Result', [h, d, a], [home, 'Draw', away]) : shopped('Winner', [h, a], [home, away]));
  }
  const tot = mainBy(Object.values(c.totals), (e) => Math.min(e.over.length, e.under.length));
  if (tot && tot.over.length && tot.under.length) markets.push(shopped(`Total ${tot.point}`, [tot.over, tot.under], [`Over ${tot.point}`, `Under ${tot.point}`]));
  // Spreads keyed by the line from the home side: a home -1.5 pairs only with an away +1.5, so an
  // alternate line (home +1.5 / away -1.5) is a different market, never mixed in.
  const lines = {};
  for (const s of Object.values(c.spreads)) {
    const isH = normName(s.name) === normName(apiHome), isA = normName(s.name) === normName(apiAway);
    if (!isH && !isA) continue;
    const hp = isH ? s.point : -s.point;
    (lines[hp] ||= {})[isH ? 'home' : 'away'] = s;
  }
  const line = mainBy(Object.entries(lines).filter(([, v]) => v.home && v.away).map(([k, v]) => ({ point: +k, ...v })), (e) => Math.min(e.home.p.length, e.away.p.length));
  if (line) {
    const sp = line.point; // signed from the home side; the away side's own point is -sp
    markets.push({ ...shopped('Spread', [line.home.p, line.away.p], [`${home} ${sp > 0 ? '+' : ''}${sp}`, `${away} ${-sp > 0 ? '+' : ''}${-sp}`]), line: sp });
  }
  return { markets, books: c.books, quotedAt: c.quotedAt };
}

// Match our events to the API's events for one sport key and merge the shopped markets: onto every
// upcoming match (force), replacing a market of the same name and keeping the feed's others, or only
// onto matches with no price. Both orientations are tried (the API's home/away can differ from ours).
// Returns how many events were priced.
// fetchedAt: when these odds were downloaded, the quote time if the books give none. Quotes older than
// maxAge are not applied: an old consensus is no price at all.
export function matchOdds(events, oddsEvents, { now = Date.now(), window = 6 * 36e5, force = false, fetchedAt = null, maxAge = 24 * 36e5 } = {}) {
  const parsed = oddsEvents.map((o) => ({ o, h: normName(o.home_team), a: normName(o.away_team), t: Date.parse(o.commence_time) })).filter((x) => Number.isFinite(x.t));
  let priced = 0;
  for (const e of events) {
    if (e.live || !(e.start > now) || (!force && e.markets?.length)) continue;
    const eh = normName(e.home), ea = normName(e.away);
    // The event the build paired with this one (pairEvents), else the same names either way round.
    const hit = (e.oddsId && parsed.find((x) => x.o.id === e.oddsId)) || parsed.find((x) => Math.abs(x.t - e.start) <= window && ((x.h === eh && x.a === ea) || (x.h === ea && x.a === eh)));
    if (!hit) continue;
    const swapped = hit.h === eh && hit.a === ea ? false : hit.h === ea && hit.a === eh ? true : lineUp(hit.o, e, { window: Infinity })?.orient === 'swapped';
    const api = swapped ? { home: hit.o.away_team, away: hit.o.home_team } : { home: hit.o.home_team, away: hit.o.away_team };
    const { markets: got, books, quotedAt } = marketsFromOdds(hit.o, { home: e.home, away: e.away, api });
    const at = quotedAt ?? fetchedAt;
    if (at != null && now - at > maxAge) continue;
    // A two-way winner for a match that can end in a draw (soccer, or a feed that already prices a
    // draw) is the wrong market: kept out, so the three-way market and its draw stay.
    const drawable = e.sport === 'football' || (e.markets || []).some((m) => m.name === 'Match Result' || m.outcomes?.some((o) => o.name === 'Draw'));
    const markets = got.filter((m) => !(m.name === 'Winner' && drawable));
    if (markets.length) {
      const names = new Set(markets.map((m) => m.name));
      // The feed's winner market may be named either way: the shopped one replaces it.
      const same = (m) => names.has(m.name) || (['Winner', 'Match Result', 'Moneyline'].includes(m.name) && markets.some((x) => ['Winner', 'Match Result'].includes(x.name)));
      e.markets = [...markets, ...(e.markets || []).filter((m) => !same(m))];
      e.bookmaker = `best of ${books} bookmaker${books === 1 ? '' : 's'}; fair chance from ${markets[0].consensusFrom}`; e.oddsSource = 'the-odds-api';
      e.priceAt = at; // when the quotes were taken, kept through to readiness and the sources line
      priced++;
    }
  }
  return priced;
}

// ---------- Fixtures from the bookmakers' own lists ----------
// The API's event list for a sport key (GET /sports/{key}/events) costs no credits and has no odds:
// it says which matches the bookmakers price. It is used to (1) tie each key to the matches here it
// covers, so paid odds are only fetched for keys with matches no other source prices, and (2) add the
// matches no feed here lists at all, so nothing the bookmakers offer is missing from the board.

// The site's sport for an API key (by its prefix); null for sports the site has no model for.
const KEY_SPORT = [[/^soccer_/, 'football'], [/^basketball_/, 'basketball'], [/^americanfootball_/, 'americanfootball'], [/^icehockey_/, 'hockey'],
  [/^baseball_/, 'baseball'], [/^tennis_/, 'tennis'], [/^mma_/, 'mma'], [/^boxing_/, 'boxing'], [/^rugbyunion_/, 'rugby'], [/^rugbyleague_/, 'rugby'],
  [/^aussierules_/, 'aussierules'], [/^cricket_/, 'cricket'], [/^handball_/, 'handball']];
export const sportOfKey = (key) => KEY_SPORT.find(([re]) => re.test(key))?.[1] || null;
export const LISTED_SPORTS = [...new Set(KEY_SPORT.map(([, s]) => s))];
export const listedPath = (sport) => `atlas/odds-${sport}`;

// Pair the API's events with ours (lineUp: the best-matching of ours, nearest in time on a tie).
// Returns { pairs: [[apiEvent, ourEvent]], extra: [apiEvents with no match here] }.
export function pairEvents(ours, apiEvents, { window = 6 * 36e5 } = {}) {
  const pairs = [], extra = [];
  for (const o of apiEvents) {
    if (!Number.isFinite(Date.parse(o.commence_time)) || !normName(o.home_team) || !normName(o.away_team)) continue;
    let best = null;
    for (const e of ours) { const m = lineUp(o, e, { window }); if (m && (!best || m.score > best.m.score || (m.score === best.m.score && m.dt < best.m.dt))) best = { e, m }; }
    if (best) pairs.push([o, best.e]); else extra.push(o);
  }
  return { pairs, extra };
}

// A match the bookmakers list and no feed here does, in the site's event shape (no odds yet).
export function fixtureFromApi(o, { key, title, sport, at = Date.now() }) {
  return {
    id: `atlas_odds-${o.id}`, sport, league: title || key, leaguePath: listedPath(sport), group: 'Bookmaker listings',
    home: o.home_team, away: o.away_team, start: Date.parse(o.commence_time), live: false, final: false, score: null, clock: '',
    venue: null, neutral: false, markets: [], lineups: null, probables: [], stats: {}, logos: { home: null, away: null },
    note: title || null, source: "The Odds API (the bookmakers' fixture list)", fetchedAt: at, oddsKey: key, oddsId: o.id,
  };
}
