// Live data from ESPN's public scoreboard API (no key). Fetched straight from the browser.
// Covers fixtures, live scores, records and the odds ESPN shows (a US sportsbook, usually DraftKings).

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

import { ALL_LEAGUES, leagueByPath } from './catalog.js';

// Back-compat name: every catalogued ESPN league.
export const LEAGUES = ALL_LEAGUES.filter((l) => !l.path.startsWith('atlas/'));

// American moneyline → decimal odds.
export const toDecimal = (ml) => {
  const n = Number(String(ml).replace('EVEN', '100'));
  if (!Number.isFinite(n) || n === 0) return null;
  return +(n > 0 ? 1 + n / 100 : 1 + 100 / -n).toFixed(2);
};

const recs = (c) => Object.fromEntries((c?.records || []).map((r) => [r.type || r.name, r.summary]));
const probs = (c, side) => (c?.probables || []).map((p) => ({ side, id: p.athlete?.id || String(p.playerId || ''), name: p.athlete?.displayName || '', role: p.shortDisplayName || p.abbreviation || 'Starter', position: p.athlete?.position || '', status: p.status?.name || null, record: p.record || '' }));
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
  const sp = Number(o.spread ?? o.pointSpread?.home?.close?.line);
  const sh = toDecimal(o.homeTeamOdds?.spreadOdds ?? o.pointSpread?.home?.close?.odds);
  const sa = toDecimal(o.awayTeamOdds?.spreadOdds ?? o.pointSpread?.away?.close?.odds);
  if (Number.isFinite(sp) && sp !== 0 && sh && sa) {
    markets.push({ name: 'Spread', line: sp, outcomes: [{ name: `${home} ${sp > 0 ? '+' : ''}${sp}`, odds: sh }, { name: `${away} ${-sp > 0 ? '+' : ''}${-sp}`, odds: sa }] });
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
        colors: { home: homeC.team?.color ? `#${homeC.team.color}` : null, away: awayC.team?.color ? `#${awayC.team.color}` : null },
        leaguePath: league.path, compId: String(comp.id || ev.id), group: league.group,
        venue: comp.venue?.fullName || null,
        broadcast: comp.broadcast || (comp.broadcasts || []).flatMap((b) => b.names || []).join(', ') || null,
        note: comp.notes?.[0]?.headline || ev.season?.slug || null,
        records: { home: recs(homeC), away: recs(awayC) },
        probables: [...probs(homeC, 'home'), ...probs(awayC, 'away')],
        logos: { home: homeC.team?.logo || null, away: awayC.team?.logo || null },
      });
    }
  }
  return out;
}

const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');

// One league's fixtures from yesterday through `days` ahead (live + upcoming). Falls back to the
// default scoreboard (today) if the date-range form is rejected.
export const fetchErrors = [];
export async function fetchLeague(league, { days = 3, signal } = {}) {
  const from = new Date(Date.now() - 864e5), to = new Date(Date.now() + days * 864e5);
  const urls = [`${BASE}/${league.path}/scoreboard?dates=${ymd(from)}-${ymd(to)}`, `${BASE}/${league.path}/scoreboard`];
  let lastErr;
  // Node (the Pages build) sends a browser-like agent; browsers set their own.
  const headers = typeof window === 'undefined' ? { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Accept: 'application/json' } : undefined;
  for (const u of urls) {
    // ESPN answers bursts with 403/429: back off and retry before giving up on this form.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(u, { signal, headers });
        if (res.status === 403 || res.status === 429) { lastErr = new Error(`HTTP ${res.status}`); await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return parseScoreboard(await res.json(), league);
      } catch (e) { lastErr = e; break; }
    }
  }
  if (fetchErrors.length < 20) fetchErrors.push(`${league.path}: ${lastErr?.message}`);
  throw lastErr;
}

// Fetch many leagues with limited parallelism; a failing league is skipped, not fatal.
export async function fetchAll(signal, leagues = LEAGUES, opts = {}) {
  const out = [];
  let i = 0;
  const worker = async () => {
    while (i < leagues.length) {
      const l = leagues[i++];
      try { out.push(...await fetchLeague(l, { ...opts, signal })); } catch { /* skip */ }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency || 8 }, worker));
  return out;
}

export async function fetchSummary(e) {
  const res = await fetch(`${BASE}/${e.leaguePath}/summary?event=${e.compId}`);
  if (!res.ok) throw new Error(`summary ${res.status}`);
  const json = await res.json();
  if (json.code) throw new Error(json.message || 'summary unavailable');
  return json;
}

// Player overview: season + career splits, recent game log, news notes.
export async function fetchAthlete(leaguePath, id) {
  const res = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/${leaguePath}/athletes/${id}/overview`);
  if (!res.ok) throw new Error(`athlete ${res.status}`);
  return res.json();
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
export { leagueByPath };
