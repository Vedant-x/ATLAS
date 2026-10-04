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

const KEEP = ['absences', 'predictor', 'lineups', 'source', 'sourceUrl', 'tennis', 'note', 'venue', 'colors'];

export function mergeEvent(old, fresh) {
  if (!old) return fresh;
  const out = { ...old, ...fresh };
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
const LIVE = ['live', 'score', 'clock', 'period', 'displayClock', 'markets', 'bookmaker', 'fetchedAt'];
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
    return out;
  });
}
