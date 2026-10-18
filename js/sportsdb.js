// Sports the main feeds do not carry (darts, snooker, handball, professional volleyball, table tennis,
// badminton, boxing, netball, Gaelic games), from TheSportsDB's free public API: fixtures by day,
// live and final scores, and each competitor's recent results for a record and form. No bookmaker
// prices: the chance comes from those records (models.js baseline). The parsers are pure so they can
// be tested; the build (scripts/pages.mjs) does the fetching.

export const TSDB = 'https://www.thesportsdb.com/api/v1/json/123/';

// ATLAS sport id → TheSportsDB sport name, and the catalog league every fixture is filed under.
export const TSDB_SPORTS = [
  { sport: 'darts', tsdb: 'Darts', path: 'atlas/darts' },
  { sport: 'snooker', tsdb: 'Snooker', path: 'atlas/snooker' },
  { sport: 'handball', tsdb: 'Handball', path: 'atlas/handball' },
  { sport: 'volleyball', tsdb: 'Volleyball', path: 'atlas/volleyball' },
  { sport: 'tabletennis', tsdb: 'Table Tennis', path: 'atlas/tabletennis' },
  { sport: 'badminton', tsdb: 'Badminton', path: 'atlas/badminton' },
  { sport: 'boxing', tsdb: 'Fighting', path: 'atlas/boxing', only: /boxing|\bwb[aco]\b|\bibf\b|\bwbo\b/i },
  { sport: 'netball', tsdb: 'Netball', path: 'atlas/netball' },
  { sport: 'gaelic', tsdb: 'Gaelic', path: 'atlas/gaelic' },
  // Leagues of sports ESPN covers, that ESPN itself does not carry (named, so nothing is doubled).
  { sport: 'basketball', tsdb: 'Basketball', path: 'atlas/basketball-more', only: /liga acb|\bacb\b|greek basket|basket league|lega basket|betclic elite|\blnb\b|pro ?a\b|new zealand nbl|nz nbl|basketbol super|korean basketball|basketball champions league|basketball bundesliga|polish basketball|\bvtb\b|aba league|adriatic|chinese basketball|\bcba\b|b\.league|japan b/i },
  { sport: 'rugby', tsdb: 'Rugby', path: 'atlas/rugbyleague-more', only: /super league|rugby league|nrlw|nrl ?women|state of origin/i },
  { sport: 'aussierules', tsdb: 'Australian Football', path: 'atlas/aussie-more', only: /afl ?women|aflw|\bvfl\b|sanfl|wafl/i },
  { sport: 'baseball', tsdb: 'Baseball', path: 'atlas/mexican-baseball', only: /mexican/i },
];

const num = (x) => (x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const LIVE = /^(1H|2H|HT|ET|P|LIVE|IN ?PLAY|IN PROGRESS|BREAK|S\d|SET \d|Q\d|\d+'?)$/i;
const FINAL = /^(FT|AET|AP|PEN|FINISHED|MATCH FINISHED|FINAL|AWARDED|ENDED)$/i;
const VOID = /^(PST|POSTPONED|CANC|CANCELLED|ABD|ABANDONED|SUSP|SUSPENDED)$/i;

// Kick-off in epoch ms. strTimestamp is UTC ("2026-10-15T19:00:00" or "...+00:00"); otherwise
// dateEvent + strTime, also UTC.
export function tsdbStart(x) {
  const t = x?.strTimestamp;
  if (t) { const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`); if (Number.isFinite(ms)) return ms; }
  if (x?.dateEvent) { const ms = Date.parse(`${x.dateEvent}T${(x.strTime || '12:00:00').slice(0, 8)}Z`); if (Number.isFinite(ms)) return ms; }
  return null;
}

export function tsdbState(x) {
  const s = String(x?.strStatus || '').trim();
  if (VOID.test(s)) return 'void';
  if (FINAL.test(s)) return 'final';
  if (LIVE.test(s)) return 'live';
  if (s && !/^(NS|NOT STARTED|TBD|SCHEDULED|TIME TO BE DEFINED)$/i.test(s) && num(x.intHomeScore) != null) return 'live';
  return num(x?.intHomeScore) != null && num(x?.intAwayScore) != null && !s ? 'final' : 'pre';
}

// Records and last-five form (newest last) per competitor, from finished events.
export function tsdbRecords(events) {
  const rec = {};
  const done = events.filter((x) => tsdbState(x) === 'final' && x.strHomeTeam && x.strAwayTeam && num(x.intHomeScore) != null && num(x.intAwayScore) != null)
    .sort((a, b) => (tsdbStart(a) || 0) - (tsdbStart(b) || 0));
  const seen = new Set();
  for (const x of done) {
    if (seen.has(x.idEvent)) continue;
    seen.add(x.idEvent);
    const h = num(x.intHomeScore), a = num(x.intAwayScore);
    for (const [name, r] of [[x.strHomeTeam, Math.sign(h - a)], [x.strAwayTeam, Math.sign(a - h)]]) {
      const o = (rec[name] ||= { w: 0, l: 0, d: 0, form: [] });
      if (r > 0) o.w++; else if (r < 0) o.l++; else o.d++;
      o.form.push(r > 0 ? 'W' : r < 0 ? 'L' : 'D');
      if (o.form.length > 5) o.form.shift();
    }
  }
  return rec;
}
// Fewer than three results say almost nothing, so they are left out rather than shown as evidence.
const MIN_GAMES = 3;
const enough = (r) => r && r.w + r.l + r.d >= MIN_GAMES;
const recText = (r) => (enough(r) ? (r.d ? `${r.w}-${r.d}-${r.l}` : `${r.w}-${r.l}`) : null);
const formOf = (r) => (enough(r) ? r.form : null);

// One TheSportsDB event as an ATLAS event, or null when it is not a two-sided fixture (a golf round, a
// race) or is outside the sport (boxing is filed under "Fighting" with MMA).
export function tsdbEvent(x, def, records = {}, now = Date.now()) {
  if (!x?.idEvent || !x.strHomeTeam || !x.strAwayTeam) return null;
  if (def.only && !def.only.test(`${x.strLeague || ''} ${x.strEvent || ''}`)) return null;
  const start = tsdbStart(x);
  if (!start) return null;
  const state = tsdbState(x);
  if (state === 'void') return null;
  const h = num(x.intHomeScore), a = num(x.intAwayScore);
  const neutral = ['darts', 'snooker', 'tabletennis', 'badminton', 'boxing'].includes(def.sport);
  return {
    id: `atlas_${def.sport}-${x.idEvent}`, sport: def.sport, league: x.strLeague || def.tsdb, leaguePath: def.path, group: x.strLeague || def.tsdb,
    home: x.strHomeTeam, away: x.strAwayTeam, start, neutral,
    live: state === 'live', final: state === 'final', score: state !== 'pre' && h != null && a != null ? `${h} – ${a}` : null,
    clock: state === 'live' ? String(x.strProgress || x.strStatus || 'Live') : state === 'final' ? 'Final' : '',
    venue: x.strVenue || null, markets: [], lineups: null, probables: [],
    stats: { homeRecord: recText(records[x.strHomeTeam]), awayRecord: recText(records[x.strAwayTeam]), homeForm: formOf(records[x.strHomeTeam]), awayForm: formOf(records[x.strAwayTeam]) },
    logos: { home: x.strHomeTeamBadge || null, away: x.strAwayTeamBadge || null },
    note: [x.strLeague, x.intRound && x.intRound !== '0' ? `round ${x.intRound}` : null].filter(Boolean).join(' · ') || null,
    source: 'TheSportsDB', fetchedAt: now, sourceUrl: `https://www.thesportsdb.com/event/${x.idEvent}`,
    tsdbLeague: x.idLeague || null,
  };
}
