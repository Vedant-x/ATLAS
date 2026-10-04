// Soccer absences (injuries, suspensions) from FotMob's public match data. ESPN's soccer injury
// feed is empty, so this is the source for who is out. Used by the Pages build and, as a
// fallback, by the browser.
const BASE = 'https://www.fotmob.com/api/data';
const headers = typeof window === 'undefined' ? { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Accept: 'application/json' } : undefined;

const getJson = async (url, signal) => {
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`FotMob ${res.status}`);
  return res.json();
};

const STOP = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'cd', 'ud', 'sd', 'rc', 'club', 'de', 'the', 'and', 'city', 'united', 'utd', 'real', 'sporting', 'athletic', 'atletico', 'women']);
export const tokens = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
// Two names refer to the same team when they share a distinctive word ("Manchester City" / "Man City" share none,
// so a full-string match is also accepted; "Man" variants are handled by the kickoff-time + other-team check).
export const sameTeam = (a, b) => {
  const x = tokens(a), y = tokens(b);
  if (!x.length || !y.length) return String(a).toLowerCase() === String(b).toLowerCase();
  return x.some((t) => y.includes(t));
};

const ymd = (t) => new Date(t).toISOString().slice(0, 10).replaceAll('-', '');
const dayCache = new Map();
export function matchesOn(day, signal) {
  if (!dayCache.has(day)) {
    dayCache.set(day, getJson(`${BASE}/matches?date=${day}`, signal)
      .then((j) => (j.leagues || []).flatMap((l) => (l.matches || []).map((m) => ({ id: m.id, home: m.home?.longName || m.home?.name, homeShort: m.home?.name, away: m.away?.longName || m.away?.name, awayShort: m.away?.name, start: Date.parse(m.status?.utcTime || ''), league: l.name }))))
      .catch((e) => { dayCache.delete(day); throw e; }));
  }
  return dayCache.get(day);
}

// FotMob match for an event: same kickoff (±3h) and at least one side's name agrees, the other not contradicting.
export async function findMatch(e, signal) {
  const days = [...new Set([ymd(e.start), ymd(e.start - 6 * 36e5), ymd(e.start + 6 * 36e5)])];
  const lists = await Promise.all(days.map((d) => matchesOn(d, signal).catch(() => [])));
  const near = lists.flat().filter((m) => Number.isFinite(m.start) && Math.abs(m.start - e.start) <= 3 * 36e5);
  const score = (m) => (sameTeam(e.home, m.home) || sameTeam(e.home, m.homeShort) ? 1 : 0) + (sameTeam(e.away, m.away) || sameTeam(e.away, m.awayShort) ? 1 : 0);
  const best = near.map((m) => [score(m), m]).sort((a, b) => b[0] - a[0] || Math.abs(a[1].start - e.start) - Math.abs(b[1].start - e.start))[0];
  return best && (best[0] === 2 || (best[0] === 1 && near.filter((m) => score(m) >= 1).length === 1)) ? best[1] : null;
}

const TYPE = { injury: 'Injured', suspension: 'Suspended', international: 'International duty' };
const player = (p, names) => {
  const u = p.unavailability || {};
  return { name: p.name || '', type: TYPE[u.type] || (u.type ? u.type[0].toUpperCase() + u.type.slice(1) : 'Out'),
    injury: u.injuryId != null ? names[`injury_${u.injuryId}`] || null : null,
    expectedReturn: u.expectedReturn || '', updated: u.lastUpdated || null };
};

// FotMob sends injuries as codes ("injury_87"); the readable names ("Muscle injury") ship in the
// translations embedded in its player pages. The build reads them there and saves data/injury-names.json,
// which the browser uses for live lookups.
let namesP;
export function injuryNames(samplePlayerId) {
  if (!namesP) {
    namesP = (typeof window === 'undefined'
      ? fetch(`https://www.fotmob.com/players/${samplePlayerId || 616170}/player`, { headers: { 'User-Agent': headers['User-Agent'], 'Accept-Language': 'en-US,en;q=0.9' } }).then((r) => r.text()).then((html) => Object.fromEntries([...html.matchAll(/"(injury_\d+)":"([^"]{2,60})"/g)].map((m) => [m[1], m[2]])))
      : fetch('data/injury-names.json').then((r) => (r.ok ? r.json() : {})))
      .catch(() => ({}));
  }
  return namesP;
}

// Starting XIs with pitch positions. type: FotMob's lineupType ('lastStarting11' before team news,
// 'predicted', otherwise the announced lineup).
const xi = (t) => ({
  formation: t.formation || null,
  starters: (t.starters || []).map((p) => ({ name: p.name, number: p.shirtNumber || '', gk: p.positionId === 11, x: p.verticalLayout?.x ?? 0.5, y: p.verticalLayout?.y ?? 0.5 })),
  subs: (t.subs || []).slice(0, 12).map((p) => p.name),
});
export function lineupOf(lu) {
  if (!lu || (lu.homeTeam?.starters || []).length < 11 || (lu.awayTeam?.starters || []).length < 11) return null;
  return { type: lu.lineupType || null, home: xi(lu.homeTeam), away: xi(lu.awayTeam) };
}

// { home: [...], away: [...], matchId, source } or null when FotMob has no such match.
export async function absencesFor(e, signal) {
  const m = await findMatch(e, signal);
  if (!m) return null;
  const md = await getJson(`${BASE}/matchDetails?matchId=${m.id}`, signal);
  const lu = md?.content?.lineup || {};
  const sample = (lu.homeTeam?.unavailable || lu.awayTeam?.unavailable || [])[0]?.id;
  const names = await injuryNames(sample);
  return {
    source: 'FotMob', matchId: m.id, fetchedAt: Date.now(),
    lineupType: lu.lineupType || null,
    lineup: lineupOf(lu),
    home: (lu.homeTeam?.unavailable || []).map((p) => player(p, names)),
    away: (lu.awayTeam?.unavailable || []).map((p) => player(p, names)),
  };
}
