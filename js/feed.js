// Adapter: ATLAS server payload (/api/dashboard) → dashboard events.
// Prices: Stake (via Odds-API.io) when a matching Stake event exists, else the ESPN reference line.

const SPORT = {
  MLB: 'baseball', NPB: 'baseball', KBO: 'baseball', ATP: 'tennis', WTA: 'tennis', NBA: 'basketball',
  NFL: 'americanfootball', NHL: 'hockey', Cricket: 'cricket', Soccer: 'football', Esports: 'esports',
};
// Odds-API.io sport names on Stake selections.
const STAKE_SPORT = {
  football: 'football', soccer: 'football', basketball: 'basketball', tennis: 'tennis', baseball: 'baseball',
  'american football': 'americanfootball', 'ice hockey': 'hockey', cricket: 'cricket', esports: 'esports',
};
const MAX_PRICE_AGE = 5 * 60000; // same freshness rule as the server's ticket builder

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/\b(fc|cf|sc|ac)\b/g, '').trim();
const sameTeam = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

function record(r) {
  if (!r) return null;
  if (typeof r === 'string') return r;
  if (Number.isFinite(r.wins)) return `${r.wins}-${r.losses ?? 0}`;
  return null;
}

// Stake selections → { eventId: { event, start, sport, participants, markets[] } }
export function groupStake(selections = [], now = Date.now()) {
  const events = new Map();
  for (const s of selections) {
    const updated = Date.parse(s.updated_at);
    if (!Number.isFinite(updated) || now - updated > MAX_PRICE_AGE) continue;
    if (!(Date.parse(s.start) > now)) continue;
    // id = stake:<event>:<market>:<row>:<side>; one row = one complete market (all its sides).
    const rowKey = s.id.slice(0, s.id.lastIndexOf(':'));
    if (!events.has(s.event_id)) {
      events.set(s.event_id, { id: s.event_id, name: s.event, participants: s.participants || [], start: Date.parse(s.start),
        sport: STAKE_SPORT[String(s.sport).toLowerCase()] || 'football', league: s.league, rows: new Map() });
    }
    const ev = events.get(s.event_id);
    if (!ev.rows.has(rowKey)) ev.rows.set(rowKey, { name: s.market, outcomes: [] });
    ev.rows.get(rowKey).outcomes.push({ name: s.selection, odds: s.odds, url: s.source_url });
  }
  for (const ev of events.values()) {
    // Double chance style markets overlap (sum > 1), so the de-vig maths doesn't apply to them.
    ev.markets = [...ev.rows.values()].filter((m) => m.outcomes.length >= 2 && !/double|1x|x2/i.test(m.name));
    delete ev.rows;
  }
  return events;
}

export function fromServer(payload, now = Date.now()) {
  const stake = groupStake(payload.odds?.selections, now);
  const used = new Set();
  const out = [];
  for (const e of payload.events || []) {
    if (e.state === 'finished' || e.state === 'score-update') continue;
    const sport = SPORT[e.sport];
    if (!sport) continue;
    const cs = e.competitors || [];
    const homeC = cs.find((c) => c.side === 'home') || cs[0];
    const awayC = cs.find((c) => c.side === 'away') || cs[1];
    const [n1, n2] = String(e.name).split(/ vs | @ /);
    const home = homeC?.name || (e.name.includes(' @ ') ? n2 : n1) || 'TBD';
    const away = awayC?.name || (e.name.includes(' @ ') ? n1 : n2) || 'TBD';

    const match = [...stake.values()].find((s) => !used.has(s.id)
      && s.participants.some((p) => sameTeam(p, home)) && s.participants.some((p) => sameTeam(p, away)));
    if (match) used.add(match.id);
    const markets = match?.markets?.length ? match.markets : (e.reference_odds?.markets || []);
    const bookmaker = match?.markets?.length ? 'Stake' : (e.reference_odds ? `${e.reference_odds.bookmaker} (reference, not Stake)` : null);

    out.push({
      id: e.id.replace(/[^\w-]/g, '_'),
      apiId: e.id,
      sport,
      league: e.league || e.sport,
      home, away,
      start: Date.parse(e.start) || Date.parse(`${e.date}T12:00:00Z`),
      live: e.state === 'live',
      score: e.state === 'live' ? cs.map((c) => c.score ?? '').join(' – ') : null,
      clock: e.status || '',
      bookmaker,
      markets,
      source: e.source,
      sourceUrl: e.source_url,
      official: !!e.official,
      stale: e.feed_status === 'stale',
      stats: {
        homeRecord: record(homeC?.record), awayRecord: record(awayC?.record),
        homeForm: e.form?.home ? [...e.form.home].slice(-5) : null, awayForm: e.form?.away ? [...e.form.away].slice(-5) : null,
        starters: cs.filter((c) => c.starter).map((c) => `${c.name}: ${c.starter} (probable)`),
      },
      lineups: null,
    });
  }
  // Stake events the free feeds don't list (other leagues/sports) still count for slips.
  for (const s of stake.values()) {
    if (used.has(s.id) || !s.markets.length) continue;
    const [home, away] = s.participants.length === 2 ? s.participants : String(s.name).split(' vs ');
    out.push({ id: `stake_${s.id}`, sport: s.sport, league: s.league || 'Stake', home, away, start: s.start, live: false,
      bookmaker: 'Stake', markets: s.markets, stats: null, lineups: null });
  }
  return out;
}

// /api/event detail → dashboard lineups ({ home, away } lists), or null.
export function lineupsFromDetail(d, event) {
  if (d.lineups?.length) {
    const pick = (name) => d.lineups.find((l) => sameTeam(l.team, name));
    const conv = (l) => (l?.players?.length ? l.players.map((p, i) => ({ pos: String(i + 1), name: p, rating: '', status: 'fit' })) : null);
    const home = conv(pick(event.home)), away = conv(pick(event.away));
    return home || away ? { home, away } : null;
  }
  if (d.rosters?.length) {
    const side = (ha) => d.rosters.find((r) => r.homeAway === ha)?.roster?.filter((p) => p.starter)
      .map((p) => ({ pos: p.position?.abbreviation || '', name: p.athlete?.displayName || '', rating: p.jersey ? `#${p.jersey}` : '', status: 'fit' }));
    const home = side('home'), away = side('away');
    return home?.length || away?.length ? { home: home || null, away: away || null } : null;
  }
  return null;
}
