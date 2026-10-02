// Live data from ESPN's public scoreboard API (no key). Fetched straight from the browser.
// Covers fixtures, live scores, records and the odds ESPN shows (a US sportsbook, usually DraftKings).

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

export const LEAGUES = [
  // Football (soccer)
  ...[
    ['eng.1', 'Premier League'], ['eng.2', 'Championship'], ['esp.1', 'La Liga'], ['ita.1', 'Serie A'],
    ['ger.1', 'Bundesliga'], ['fra.1', 'Ligue 1'], ['ned.1', 'Eredivisie'], ['por.1', 'Primeira Liga'],
    ['sco.1', 'Scottish Prem'], ['tur.1', 'Süper Lig'], ['bel.1', 'Belgian Pro League'], ['bra.1', 'Brasileirão'],
    ['arg.1', 'Liga Profesional'], ['mex.1', 'Liga MX'], ['usa.1', 'MLS'], ['ksa.1', 'Saudi Pro League'],
    ['jpn.1', 'J1 League'], ['uefa.champions', 'Champions League'], ['uefa.europa', 'Europa League'],
    ['uefa.europa.conf', 'Conference League'], ['conmebol.libertadores', 'Libertadores'], ['fifa.world', 'World Cup'],
  ].map(([l, name]) => ({ sport: 'football', path: `soccer/${l}`, name })),
  { sport: 'basketball', path: 'basketball/nba', name: 'NBA' },
  { sport: 'basketball', path: 'basketball/wnba', name: 'WNBA' },
  { sport: 'americanfootball', path: 'football/nfl', name: 'NFL' },
  { sport: 'americanfootball', path: 'football/college-football', name: 'NCAAF' },
  { sport: 'hockey', path: 'hockey/nhl', name: 'NHL' },
  { sport: 'baseball', path: 'baseball/mlb', name: 'MLB' },
  { sport: 'tennis', path: 'tennis/atp', name: 'ATP' },
  { sport: 'tennis', path: 'tennis/wta', name: 'WTA' },
  { sport: 'mma', path: 'mma/ufc', name: 'UFC' },
];

// American moneyline → decimal odds.
export const toDecimal = (ml) => {
  const n = Number(String(ml).replace('EVEN', '100'));
  if (!Number.isFinite(n) || n === 0) return null;
  return +(n > 0 ? 1 + n / 100 : 1 + 100 / -n).toFixed(2);
};

const name = (c) => c?.team?.displayName || c?.athlete?.displayName || c?.athlete?.fullName || 'TBD';
const form = (c) => (c?.form ? [...c.form].slice(-5) : null);

function marketsFrom(comp, home, away) {
  const o = comp.odds?.[0];
  if (!o) return [];
  const markets = [];
  const h = toDecimal(o.homeTeamOdds?.moneyLine ?? o.moneyline?.home?.close?.odds);
  const a = toDecimal(o.awayTeamOdds?.moneyLine ?? o.moneyline?.away?.close?.odds);
  const d = toDecimal(o.drawOdds?.moneyLine ?? o.moneyline?.draw?.close?.odds);
  if (h && a) {
    markets.push(d
      ? { name: 'Match Result', outcomes: [{ name: home, odds: h }, { name: 'Draw', odds: d }, { name: away, odds: a }] }
      : { name: 'Winner', outcomes: [{ name: home, odds: h }, { name: away, odds: a }] });
  }
  const over = toDecimal(o.overOdds ?? o.total?.over?.close?.odds);
  const under = toDecimal(o.underOdds ?? o.total?.under?.close?.odds);
  if (o.overUnder && over && under) {
    markets.push({ name: `Total ${o.overUnder}`, outcomes: [{ name: `Over ${o.overUnder}`, odds: over }, { name: `Under ${o.overUnder}`, odds: under }] });
  }
  return markets;
}

// Team sports: one competition per event. Tennis nests matches under groupings.
function competitionsOf(ev) {
  if (ev.competitions?.length) return ev.competitions.map((c) => ({ ev, comp: c }));
  return (ev.groupings || []).flatMap((g) => (g.competitions || []).map((c) => ({ ev, comp: c })));
}

export function parseScoreboard(json, league) {
  const out = [];
  for (const raw of json.events || []) {
    for (const { ev, comp } of competitionsOf(raw)) {
      const cs = comp.competitors || [];
      const homeC = cs.find((c) => c.homeAway === 'home') || cs[0];
      const awayC = cs.find((c) => c.homeAway === 'away') || cs[1];
      if (!homeC || !awayC) continue;
      const home = name(homeC), away = name(awayC);
      const state = (comp.status || ev.status)?.type?.state; // pre | in | post
      if (state === 'post') continue;
      out.push({
        id: `${league.path}-${comp.id || ev.id}`.replace(/\//g, '_'),
        sport: league.sport,
        league: league.name,
        home, away,
        start: Date.parse(comp.date || ev.date),
        live: state === 'in',
        score: state === 'in' ? `${homeC.score ?? ''} – ${awayC.score ?? ''}` : null,
        clock: (comp.status || ev.status)?.type?.shortDetail || '',
        bookmaker: comp.odds?.[0]?.provider?.name || null,
        markets: marketsFrom(comp, home, away),
        stats: {
          homeForm: form(homeC), awayForm: form(awayC),
          homeRecord: homeC.records?.[0]?.summary || null, awayRecord: awayC.records?.[0]?.summary || null,
        },
        lineups: null,
      });
    }
  }
  return out;
}

async function fetchLeague(league, signal) {
  const res = await fetch(`${BASE}/${league.path}/scoreboard`, { signal });
  if (!res.ok) throw new Error(`${league.name}: ${res.status}`);
  return parseScoreboard(await res.json(), league);
}

// Fetch all leagues in parallel; a failing league is skipped, not fatal.
export async function fetchAll(signal) {
  const results = await Promise.allSettled(LEAGUES.map((l) => fetchLeague(l, signal)));
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

// Starting lineups for one event, from ESPN's summary endpoint (available close to kick-off).
export async function fetchLineups(event) {
  const [path, id] = splitId(event.id);
  if (!path) return null;
  const res = await fetch(`${BASE}/${path}/summary?event=${id}`);
  if (!res.ok) return null;
  const json = await res.json();
  const rosters = json.rosters || [];
  const side = (ha) => rosters.find((r) => r.homeAway === ha)?.roster
    ?.filter((p) => p.starter)
    .map((p) => ({ pos: p.position?.abbreviation || '', name: p.athlete?.displayName || '', rating: p.jersey ? `#${p.jersey}` : '', status: 'fit' }));
  const home = side('home'), away = side('away');
  return home?.length || away?.length ? { home: home || null, away: away || null } : null;
}

function splitId(id) {
  const league = LEAGUES.find((l) => id.startsWith(l.path.replace(/\//g, '_') + '-'));
  return league ? [league.path, id.slice(league.path.length + 1)] : [];
}
