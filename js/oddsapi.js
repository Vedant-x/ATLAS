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

// Consensus (median) decimal odds per outcome, per market, across the event's bookmakers.
export function consensus(oddsEvent) {
  const h2h = {}, totals = {}, spreads = {};
  let books = 0;
  for (const bk of oddsEvent.bookmakers || []) {
    let used = false;
    for (const m of bk.markets || []) {
      if (m.key === 'h2h') { for (const o of m.outcomes || []) if (o.price > 1) { (h2h[o.name] ||= []).push(o.price); used = true; } }
      else if (m.key === 'totals') { for (const o of m.outcomes || []) if (o.price > 1 && Number.isFinite(o.point)) { const k = `${o.point}`; (totals[k] ||= { point: o.point, over: [], under: [] })[/^over$/i.test(o.name) ? 'over' : 'under'].push(o.price); used = true; } }
      else if (m.key === 'spreads') { for (const o of m.outcomes || []) if (o.price > 1 && Number.isFinite(o.point)) { const k = `${o.name}|${o.point}`; (spreads[k] ||= { name: o.name, point: o.point, p: [] }).p.push(o.price); used = true; } }
    }
    if (used) books++;
  }
  return { h2h, totals, spreads, books };
}

// The main total / spread line is the one the most books offer (ties: the middle line).
const mainBy = (entries, count) => {
  const ok = entries.filter(count);
  if (!ok.length) return null;
  const max = Math.max(...ok.map(count));
  const top = ok.filter((e) => count(e) === max).sort((a, b) => a.point - b.point);
  return top[Math.floor((top.length - 1) / 2)];
};

// Markets in the site's own shape (espn.js marketsFrom), from one matched Odds API event.
export function marketsFromOdds(oddsEvent, { home, away, leaguePath }) {
  const c = consensus(oddsEvent);
  const markets = [];
  const pick = (team) => { const hit = Object.keys(c.h2h).find((n) => normName(n) === normName(team)); return hit ? median(c.h2h[hit]) : null; };
  const h = pick(home), a = pick(away);
  const drawKey = Object.keys(c.h2h).find((n) => /^draw$/i.test(n));
  const d = drawKey ? median(c.h2h[drawKey]) : null;
  if (h && a) {
    markets.push(THREE_WAY(leaguePath) && d
      ? { name: 'Match Result', outcomes: [{ name: home, odds: +h.toFixed(2) }, { name: 'Draw', odds: +d.toFixed(2) }, { name: away, odds: +a.toFixed(2) }] }
      : { name: 'Winner', outcomes: [{ name: home, odds: +h.toFixed(2) }, { name: away, odds: +a.toFixed(2) }] });
  }
  const tot = mainBy(Object.values(c.totals), (e) => Math.min(e.over.length, e.under.length));
  if (tot && tot.over.length && tot.under.length) {
    markets.push({ name: `Total ${tot.point}`, outcomes: [{ name: `Over ${tot.point}`, odds: +median(tot.over).toFixed(2) }, { name: `Under ${tot.point}`, odds: +median(tot.under).toFixed(2) }] });
  }
  // Spread from the home side's line (the away line is its mirror).
  const spreadsBy = {};
  for (const s of Object.values(c.spreads)) { const side = normName(s.name) === normName(home) ? 'home' : normName(s.name) === normName(away) ? 'away' : null; if (side) (spreadsBy[Math.abs(s.point)] ||= {})[side] = s; }
  const line = mainBy(Object.entries(spreadsBy).filter(([, v]) => v.home && v.away).map(([k, v]) => ({ point: +k, ...v })), (e) => Math.min(e.home.p.length, e.away.p.length));
  if (line) {
    const sp = line.home.point; // signed from the home side
    markets.push({ name: 'Spread', line: sp, outcomes: [{ name: `${home} ${sp > 0 ? '+' : ''}${sp}`, odds: +median(line.home.p).toFixed(2) }, { name: `${away} ${-sp > 0 ? '+' : ''}${-sp}`, odds: +median(line.away.p).toFixed(2) }] });
  }
  return { markets, books: c.books };
}

// Match our events to the API's events for one sport key, and merge prices onto the ones that have no
// bookmaker price. Both orientations are tried (the API's home/away can differ from ours). Returns
// how many events were priced.
export function matchOdds(events, oddsEvents, { now = Date.now(), window = 6 * 36e5, force = false } = {}) {
  const parsed = oddsEvents.map((o) => ({ o, h: normName(o.home_team), a: normName(o.away_team), t: Date.parse(o.commence_time) })).filter((x) => Number.isFinite(x.t));
  let priced = 0;
  for (const e of events) {
    if (e.live || !(e.start > now) || (!force && e.markets?.length)) continue;
    const eh = normName(e.home), ea = normName(e.away);
    const hit = parsed.find((x) => Math.abs(x.t - e.start) <= window && ((x.h === eh && x.a === ea) || (x.h === ea && x.a === eh)));
    if (!hit) continue;
    const { markets, books } = marketsFromOdds(hit.o, e);
    if (markets.length) { e.markets = markets; e.bookmaker = `consensus of ${books} book${books === 1 ? '' : 's'}`; e.oddsSource = 'the-odds-api'; priced++; }
  }
  return priced;
}
