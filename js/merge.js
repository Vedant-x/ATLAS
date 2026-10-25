// Merging a fresh scoreboard copy of a match into the one already on screen. The scoreboard only
// knows the basics (teams, time, score, odds, the names of the starters), while ATLAS adds more on
// top: full starting-pitcher reports, injury/absence lists, lineups, the matchup predictor. A
// refresh must keep all of that, or pages lose it every few seconds until a reload.

// "Gerrit Cole", "Cole, Gerrit" and "Gérrit Cole Jr." are the same pitcher.
export function samePerson(a, b) {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z, ]/g, ' ').trim();
  const parts = (s) => {
    const n = norm(s);
    if (!n) return null;
    if (n.includes(',')) { const [last, first = ''] = n.split(',').map((x) => x.trim()); return { last: last.split(/\s+/).pop(), first: first[0] || '' }; }
    const w = n.split(/\s+/).filter(Boolean);
    return { last: w[w.length - 1], first: w[0][0] || '' };
  };
  const x = parts(a), y = parts(b);
  return Boolean(x && y && x.last === y.last && (!x.first || !y.first || x.first === y.first));
}

const nameOf = (p) => p?.report?.name || p?.name || '';
const idMatch = (a, b) => a?.id && b?.id && String(a.id) === String(b.id);

// Starters: keep the old report for a side when the fresh feed still names the same pitcher; a new
// name means the starter changed, so the old report is dropped. Sides the feed no longer lists
// keep what we had.
export function mergeProbables(old = [], fresh = []) {
  if (!fresh.length) return old;
  const out = fresh.map((p) => {
    const o = old.find((x) => x.side === p.side);
    if (!o) return p;
    if (idMatch(o, p) || samePerson(nameOf(o), p.name)) return { ...o, ...p, name: nameOf(o) || p.name, report: o.report ?? p.report, pitching: o.pitching ?? p.pitching, profile: o.profile ?? p.profile };
    return { ...p, changedFrom: nameOf(o) || null };
  });
  for (const o of old) if (!out.some((p) => p.side === o.side)) out.push(o);
  return out;
}

const KEEP = ['absences', 'injuries', 'injuryChecked', 'props', 'predictor', 'lineups', 'source', 'sourceUrl', 'tennis', 'note', 'venue', 'colors'];

// Prices. The scoreboard carries only the feed's own price; the build adds to each price the sharp
// market's fair chance (cons, pin), Stake's price, the typical and best price across bookmakers, the
// first price seen (open) and the bookmaker. A refresh takes the feed's new number and keeps all of
// that, or the value checks (track.js) lose it within 30 seconds of the page opening. Matched by
// market (the winner market under any of its names), line and outcome names. A market the refresh
// no longer carries stays. Once a match is live the feed's markets stand as they come.
const ADDED = ['cons', 'med', 'best', 'bestBook', 'books', 'pin', 'stake', 'open', 'book'];
const WINNER = ['Winner', 'Match Result', 'Moneyline'];
const sameMarket = (a, b) => (a.name === b.name || (WINNER.includes(a.name) && WINNER.includes(b.name))) && (a.line ?? null) === (b.line ?? null)
  && a.outcomes?.length === b.outcomes?.length && a.outcomes.every((o) => b.outcomes.some((x) => x.name === o.name));
export function mergeMarkets(base = [], fresh = [], { live = false } = {}) {
  if (live) return fresh ?? base;
  if (!fresh?.length) return base;
  const out = fresh.map((fm) => {
    const bm = (base || []).find((m) => sameMarket(m, fm));
    if (!bm) return fm;
    return { ...bm, ...fm, consensusFrom: fm.consensusFrom ?? bm.consensusFrom, outcomes: fm.outcomes.map((fo) => {
      // The model's chance is worked out again on every render (intel.js applyModel): never carried.
      const { model, ...bo } = bm.outcomes.find((x) => x.name === fo.name) || {};
      return { ...bo, ...Object.fromEntries(Object.entries(fo).filter(([k]) => !ADDED.includes(k) && k !== 'model')) };
    }) };
  });
  for (const m of base || []) if (!out.some((x) => x.name === m.name)) out.push(m);
  return out;
}
// The price fields of an event the build priced from many bookmakers (The Odds API's best price and
// consensus): kept whole until the next build, as the scoreboard's one price would replace the best.
const PRICED = ['markets', 'bookmaker', 'oddsSource', 'quoteType', 'priceAt'];

export function mergeEvent(old, fresh) {
  if (!old) return fresh;
  const out = { ...old, ...fresh };
  if (!fresh.live && old.markets?.length && (old.oddsSource === 'the-odds-api' || !fresh.markets?.length)) for (const k of PRICED) out[k] = old[k];
  else if ('markets' in fresh) out.markets = mergeMarkets(old.markets, fresh.markets, { live: fresh.live });
  // Fields the scoreboard doesn't carry (or sends empty) keep the richer value we already have.
  for (const k of KEEP) {
    const v = fresh[k];
    if ((v == null || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) && old[k] != null) out[k] = old[k];
  }
  if (old.tennis && fresh.tennis) out.tennis = { ...old.tennis, ...Object.fromEntries(Object.entries(fresh.tennis).filter(([, v]) => v != null && v !== '')) };
  if (old.stats && fresh.stats) out.stats = { ...old.stats, ...Object.fromEntries(Object.entries(fresh.stats).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))) };
  out.probables = mergeProbables(old.probables, fresh.probables);
  return out;
}

// A reloaded snapshot (built minutes or hours ago) must not roll back live scores the page already
// refreshed: keep the snapshot's enrichments but the newer live fields.
const LIVE = ['live', 'score', 'clock', 'period', 'displayClock', 'lines', 'fetchedAt'];
export function overlayLive(snapshotEvents, current) {
  const byId = new Map(current.map((e) => [e.id, e]));
  const leagues = new Set(current.map((e) => e.leaguePath));
  const now = Date.now();
  // A game that already started, is gone from a league we still show and isn't in our list has
  // finished since the snapshot was built: don't bring it back.
  return snapshotEvents.filter((e) => byId.has(e.id) || !(e.start < now - 30 * 6e4 && leagues.has(e.leaguePath) && current.length)).map((e) => {
    const c = byId.get(e.id);
    if (!c || !(c.fetchedAt > (e.fetchedAt || 0))) return e;
    const out = { ...e };
    for (const k of LIVE) if (c[k] !== undefined) out[k] = c[k];
    // Prices: the newer numbers on the snapshot's additions (its fresher sharp line and Stake read).
    if (c.live) { for (const k of ['markets', 'bookmaker']) if (c[k] !== undefined) out[k] = c[k]; }
    else if (e.oddsSource !== 'the-odds-api' && c.markets?.length) { out.markets = mergeMarkets(e.markets, c.markets); out.bookmaker = c.bookmaker ?? e.bookmaker; }
    return out;
  });
}
