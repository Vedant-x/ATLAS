// Build source (run by scripts/pages.mjs): TheSportsDB: darts, snooker, handball, volleyball, table tennis, badminton, boxing ….
import { get, log } from '../lib.mjs';
import { TSDB, TSDB_SPORTS, TSDB_TTL, tsdbEvent, tsdbRecords, tsdbStart, tsdbState, dueReads, slim, packResult, unpackResult } from '../../js/sportsdb.js';

// Read a little at a time (sportsdb.js dueReads): every read is cached with its time in
// data/sportsdb.json and a build makes only the reads that are due, up to TSDB_BUDGET (default 24,
// about a minute at one request every 2.5 s). A refused read (429: the free key is shared) ends this
// build's reads at once; the rest wait for the next build. CI sets TSDB_BUDGET=0: test builds only
// reuse the live site's cache and leave the shared key to the live build.
export const TSDB_BUDGET = Number(process.env.TSDB_BUDGET ?? 24);
export let tsdbFile = null;
export async function sportsdb() {
  let prev = null;
  try {
    const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', 'sportsdb.json'), { signal: AbortSignal.timeout(15000) });
    prev = r.ok ? await r.json() : null;
  } catch { /* first build, or the site is unreachable: start an empty cache */ }
  const now = Date.now();
  const iso = (off) => new Date(now + off * 864e5).toISOString().slice(0, 10);
  const days = [-1, 0, 1, 2, 3];
  const dayPath = (def, d) => `eventsday.php?d=${d}&s=${encodeURIComponent(def.tsdb)}`;
  const dayReads = TSDB_SPORTS.flatMap((def) => days.map((off) => ({ path: dayPath(def, iso(off)), ttl: off <= 0 ? TSDB_TTL.recent : TSDB_TTL.ahead, def })));
  // Keep only what is still wanted: this window's day lists, competitions read in the last 2 weeks.
  const cache = {};
  for (const [k, v] of Object.entries(prev?.cache || {})) if (dayReads.some((w) => w.path === k) || (!k.startsWith('eventsday') && v.at > now - 14 * 864e5)) cache[k] = v;
  let last = 0, calls = 0, failed = 0, limited = false;
  const read = async (path) => {
    if (limited) return undefined;
    const gap = 2500 - (Date.now() - last);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    last = Date.now(); calls++;
    try { return JSON.parse(await get(`${TSDB}${path}`, { headers: { Accept: 'application/json' } })); } catch (e) {
      failed++;
      if (/^429\b/.test(e.message)) { limited = true; log(`  TheSportsDB: rate limited after ${calls - 1} reads; the rest next build`); } else if (failed <= 3) log(`  TheSportsDB ${path}: ${e.message}`);
      return undefined;
    }
  };
  let budget = TSDB_BUDGET;
  for (const w of dueReads(cache, dayReads, now, budget)) {
    const j = await read(w.path);
    if (j === undefined) { if (limited) break; continue; }
    cache[w.path] = { at: Date.now(), events: (j?.events || []).filter((x) => !w.def.only || w.def.only.test(`${x.strLeague || ''} ${x.strEvent || ''}`)).map(slim) };
    budget--;
  }
  // Fixtures from the day lists; the busiest competitions seen there get their season read.
  const raw = new Map(), leagues = new Map(), counts = {};
  for (const w of dayReads) for (const x of cache[w.path]?.events || []) {
    if (!raw.has(x.idEvent)) { raw.set(x.idEvent, { x, def: w.def }); counts[w.def.sport] = (counts[w.def.sport] || 0) + 1; }
    if (x.idLeague && !leagues.has(x.idLeague)) leagues.set(x.idLeague, w.def);
  }
  const busy = [...leagues.keys()].map((id) => [id, [...raw.values()].filter((r) => r.x.idLeague === id).length]).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([id]) => id);
  const lookups = busy.map((id) => ({ path: `lookupleague.php?id=${id}`, ttl: TSDB_TTL.league }));
  for (const w of dueReads(cache, lookups, now, budget)) {
    const j = await read(w.path);
    if (j === undefined) { if (limited) break; continue; }
    cache[w.path] = { at: Date.now(), season: j?.leagues?.[0]?.strCurrentSeason || null };
    budget--;
  }
  const seasonPath = (id) => `season:${id}`;
  const seasons = busy.map((id) => ({ path: seasonPath(id), ttl: TSDB_TTL.season, id }));
  for (const w of dueReads(cache, seasons, now, budget)) {
    const season = cache[`lookupleague.php?id=${w.id}`]?.season;
    let j = season ? await read(`eventsseason.php?id=${w.id}&s=${encodeURIComponent(season)}`) : null;
    if (!j?.events?.length && !limited) j = await read(`eventspastleague.php?id=${w.id}`);
    if (j === undefined) { if (limited) break; continue; } // refused or failed: try again next build
    const list = j?.events || [];
    const lo = now - 864e5, hi = now + 4 * 864e5;
    cache[w.path] = { at: Date.now(), past: list.filter((x) => tsdbState(x) === 'final' && tsdbStart(x) > now - 180 * 864e5).map(packResult), events: list.filter((x) => { const t = tsdbStart(x); return t >= lo && t <= hi; }).map(slim) };
    budget--;
  }
  const past = [];
  for (const id of busy) {
    const c = cache[seasonPath(id)];
    if (!c) continue;
    past.push(...(c.past || []).map(unpackResult));
    for (const x of c.events || []) if (!raw.has(x.idEvent)) raw.set(x.idEvent, { x, def: leagues.get(id) });
  }
  const records = tsdbRecords([...past, ...[...raw.values()].map((r) => r.x)]);
  const events = [...raw.values()].map(({ x, def }) => tsdbEvent(x, def, records)).filter((e) => e && !e.final && (e.live || e.start > now - 3 * 36e5));
  // The first builds after the switch: fixtures from the old single-read file until the cache fills.
  if (!prev?.cache && Array.isArray(prev?.events)) for (const e of prev.events) if (e.start > now - 3 * 36e5 && !events.some((x) => x.id === e.id)) events.push(e);
  const oldest = Math.min(...dayReads.map((w) => cache[w.path]?.at || 0));
  log(`TheSportsDB: ${events.length} upcoming or live fixtures (${TSDB_SPORTS.map((d) => `${d.sport} ${counts[d.sport] || 0}`).join(', ')}), ${events.filter((e) => e.stats.homeRecord && e.stats.awayRecord).length} with both records, ${past.length} results from ${busy.filter((id) => cache[seasonPath(id)]).length} competitions; ${calls} reads this build (${failed} refused), ${oldest ? `oldest day list ${Math.round((now - oldest) / 6e4)} min old` : `${dayReads.filter((w) => !cache[w.path]).length} of ${dayReads.length} day lists not read yet`}`);
  tsdbFile = { fetchedAt: now, cache };
  tsdbStatus = { calls, failed, limited, oldest };
  if (calls && failed === calls && !Object.keys(cache).length) throw new Error('every request failed');
  return events;
}
export let tsdbStatus = null;
