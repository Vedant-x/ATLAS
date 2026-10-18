// Optional real bookmaker odds from The Odds API (the-odds-api.com). Nothing here runs unless the
// build has an ODDS_API_KEY — a free key the site owner registers in their own name (free tier about
// 500 credits a month; one credit per market per region per request). Prices are merged onto matches
// that have no bookmaker price yet, matched by team names and start time, as the consensus (median)
// across the books the key returns. Pure matching (consensus, marketsFromOdds, matchOdds) so it can
// be tested; the build does the fetching, caching and budgeting.

export const ODDS_API = 'https://api.the-odds-api.com/v4';

// Our leaguePath -> The Odds API sport key. Only mapped leagues are fetched; unmapped ones are
// skipped (ESPN already prices most US leagues). The build also skips any key the API reports as not
// in season. Keys that do not exist on the API simply return nothing.
export const ODDS_SPORT_KEYS = {
  'basketball/nba': 'basketball_nba', 'basketball/wnba': 'basketball_wnba', 'basketball/mens-college-basketball': 'basketball_ncaab',
  'atlas/euroleague': 'basketball_euroleague',
  'football/nfl': 'americanfootball_nfl', 'football/college-football': 'americanfootball_ncaaf', 'football/cfl': 'americanfootball_cfl', 'football/ufl': 'americanfootball_ufl',
  'baseball/mlb': 'baseball_mlb', 'atlas/npb': 'baseball_npb', 'atlas/kbo': 'baseball_kbo',
  'hockey/nhl': 'icehockey_nhl', 'atlas/liiga': 'icehockey_sweden_hockey_league', 'atlas/swissnl': 'icehockey_switzerland_nl',
  'mma/ufc': 'mma_mixed_martial_arts',
  'australian-football/afl': 'aussierules_afl', 'rugby-league/3': 'rugbyleague_nrl',
  'soccer/eng.1': 'soccer_epl', 'soccer/eng.2': 'soccer_efl_champ', 'soccer/esp.1': 'soccer_spain_la_liga', 'soccer/esp.2': 'soccer_spain_segunda_division',
  'soccer/ger.1': 'soccer_germany_bundesliga', 'soccer/ger.2': 'soccer_germany_bundesliga2', 'soccer/ita.1': 'soccer_italy_serie_a', 'soccer/ita.2': 'soccer_italy_serie_b',
  'soccer/fra.1': 'soccer_france_ligue_one', 'soccer/fra.2': 'soccer_france_ligue_two', 'soccer/ned.1': 'soccer_netherlands_eredivisie', 'soccer/por.1': 'soccer_portugal_primeira_liga',
  'soccer/bel.1': 'soccer_belgium_first_div', 'soccer/tur.1': 'soccer_turkey_super_league', 'soccer/sco.1': 'soccer_spl', 'soccer/gre.1': 'soccer_greece_super_league',
  'soccer/uefa.champions': 'soccer_uefa_champs_league', 'soccer/uefa.europa': 'soccer_uefa_europa_league', 'soccer/uefa.europa.conf': 'soccer_uefa_europa_conference_league',
  'soccer/usa.1': 'soccer_usa_mls', 'soccer/mex.1': 'soccer_mexico_ligamx', 'soccer/bra.1': 'soccer_brazil_campeonato', 'soccer/arg.1': 'soccer_argentina_primera_division',
  'soccer/jpn.1': 'soccer_japan_j_league', 'soccer/chn.1': 'soccer_china_superleague', 'soccer/aus.1': 'soccer_australia_aleague', 'soccer/ksa.1': 'soccer_saudi_pro_league',
};

// Three-way result markets (a draw is possible): soccer only, among the mapped leagues.
const THREE_WAY = (leaguePath) => leaguePath.startsWith('soccer/');

export const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(fc|cf|afc|sc|ac|as|ss|ssc|sv|if|bk|sk|hc|hk|cd|ud|rc|club|calcio|basketball|hockey|united|city|the)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

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
export function marketsFromOdds(oddsEvent, { home, away, leaguePath }) {
  const c = consensus(oddsEvent);
  const markets = [];
  const list = (team) => { const hit = Object.keys(c.h2h).find((n) => normName(n) === normName(team)); return hit ? c.h2h[hit] : null; };
  const h = list(home), a = list(away);
  const drawKey = Object.keys(c.h2h).find((n) => /^draw$/i.test(n));
  const d = drawKey ? c.h2h[drawKey] : null;
  if (h && a) {
    markets.push(THREE_WAY(leaguePath) && d ? shopped('Match Result', [h, d, a], [home, 'Draw', away]) : shopped('Winner', [h, a], [home, away]));
  }
  const tot = mainBy(Object.values(c.totals), (e) => Math.min(e.over.length, e.under.length));
  if (tot && tot.over.length && tot.under.length) markets.push(shopped(`Total ${tot.point}`, [tot.over, tot.under], [`Over ${tot.point}`, `Under ${tot.point}`]));
  // Spread from the home side's line (the away line is its mirror).
  const spreadsBy = {};
  for (const s of Object.values(c.spreads)) { const side = normName(s.name) === normName(home) ? 'home' : normName(s.name) === normName(away) ? 'away' : null; if (side) (spreadsBy[Math.abs(s.point)] ||= {})[side] = s; }
  const line = mainBy(Object.entries(spreadsBy).filter(([, v]) => v.home && v.away).map(([k, v]) => ({ point: +k, ...v })), (e) => Math.min(e.home.p.length, e.away.p.length));
  if (line) {
    const sp = line.home.point; // signed from the home side
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
    const hit = parsed.find((x) => Math.abs(x.t - e.start) <= window && ((x.h === eh && x.a === ea) || (x.h === ea && x.a === eh)));
    if (!hit) continue;
    const { markets, books, quotedAt } = marketsFromOdds(hit.o, e);
    const at = quotedAt ?? fetchedAt;
    if (at != null && now - at > maxAge) continue;
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
