// Track record update, run by the Pages build after scripts/pages.mjs:
//   node scripts/record.mjs <history.json> <events.json> <out.json> [audit.json]
// Records ATLAS's official picks for matches starting soon, grades finished ones from ESPN final
// scores (confirmed from an independent second source where one covers the league, js/results2.js), saves the history file (kept on the track-record branch) and writes the public copy.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { selectPicks, addPicks, updateClosing, gradePick, resultFromSummary, resultFromScoreboard, resultFromBo3, settleMulti, duePicks, observations } from '../js/track.js';
import { applyRead, selectionId, awaitingConfirm, independentlyConfirmed } from '../js/settle.js';
import { secondReader } from '../js/results2.js';
import { BO3, BO3_GAMES } from '../js/esports.js';

const [historyPath = 'track/picks.json', eventsPath = 'dist/pages/data/index.json', outPath = 'dist/pages/data/track.json', auditPath = 'track/audit.json'] = process.argv.slice(2);
const now = Date.now();
const log = (...a) => console.log(...a);

// The history is the record of every published pick: a history that exists but cannot be read must
// stop the build (nothing is published, the next run tries again), never start over from empty.
// TRACK_REQUIRED=1 (set by the workflow when the track-record branch exists) makes a missing file
// an error too.
let history = [];
try {
  history = JSON.parse(await readFile(historyPath, 'utf8'));
  if (!Array.isArray(history)) throw new Error('not a list of picks');
} catch (err) {
  if (err.code === 'ENOENT' && process.env.TRACK_REQUIRED !== '1') log('Track record: starting a new history');
  else { console.error(`Track record: the saved history could not be loaded (${err.message}). Stopping so no published pick is lost.`); process.exit(1); }
}
const { events = [] } = JSON.parse(await readFile(eventsPath, 'utf8'));
// The settlement audit log: append-only (every change to a result that was already final, with the
// old and new result, the source and the reason). A log that exists but cannot be read stops the
// run, like the history.
let audit = [];
try { audit = JSON.parse(await readFile(auditPath, 'utf8')); if (!Array.isArray(audit)) throw new Error('not a list'); }
catch (err) { if (err.code !== 'ENOENT') { console.error(`Track record: the audit log could not be loaded (${err.message}). Stopping.`); process.exit(1); } }
const auditBefore = audit.length;
// Canonical selection ids for records saved before they existed (computed, never guessed).
for (const h of history) { if (!h.sel && h.type !== 'multi') { const id = selectionId(h); if (id) h.sel = id; } for (const l of h.legs || []) if (!l.sel) { const id = selectionId(l); if (id) l.sel = id; } }

const before = history.length;
history = addPicks(history, selectPicks(events, now, 12, history));
log(`Track record: ${history.length - before} new pick(s), ${history.length} total`);
log(`Track record: closing prices updated for ${updateClosing(history, events, now)} pending pick(s)/leg(s)`);

// Grade picks whose match should be over (2h+ after start). One summary request per match.
const due = duePicks(history, now);
// At most MAX_LOOKUPS matches per run, the oldest first: a backlog (legs of slips that had already
// lost, which were once left ungraded) clears over a few runs instead of flooding ESPN at once.
const MAX_LOOKUPS = Number(process.env.RECORD_MAX_LOOKUPS) || 150;
const grouped = Object.groupBy ? Object.groupBy(due, (h) => `${h.leaguePath}|${h.compId}`) : due.reduce((m, h) => ((m[`${h.leaguePath}|${h.compId}`] ||= []).push(h), m), {});
// Waiting results first, then confirming reads, then old unresolved ones; the oldest first in each.
const rank = (list) => (list.some((p) => p.status === 'pending' || p.status === 'disputed' || p.status === 'postponed') ? 0 : list.some((p) => p.status !== 'unresolved') ? 1 : 2);
const byMatch = Object.fromEntries(Object.entries(grouped).sort((a, b) => rank(a[1]) - rank(b[1]) || Math.min(...a[1].map((p) => p.start)) - Math.min(...b[1].map((p) => p.start))).slice(0, MAX_LOOKUPS));
if (Object.keys(grouped).length > MAX_LOOKUPS) log(`Track record: ${Object.keys(grouped).length - MAX_LOOKUPS} match(es) left for the next run`);
const counts = {};
let failed = 0;
// Esports series are graded from bo3.gg in one request for all of them.
const bo3 = new Map();
// bo3.gg answers for one game at a time (without a discipline it returns CS2 only), 100 ids a request.
for (const [d, g] of Object.entries(BO3_GAMES)) {
  const ids = Object.keys(byMatch).filter((k) => k.startsWith(`${g.path}|`)).map((k) => k.split('|')[1]);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const res = await fetch(`${BO3}/matches?page[limit]=100&filter[matches.discipline_id][eq]=${d}&filter[matches.id][in]=${chunk.join(',')}`, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 ATLAS track record' } });
      if (res.ok) for (const m of (await res.json()).results || []) bo3.set(String(m.id), m);
      else failed += chunk.length;
    } catch { failed += chunk.length; }
  }
}
// ESPN scoreboards by date, for fights and tennis matches (fetched once per league and day).
const boards = new Map();
const board = (leaguePath, day) => {
  const k = `${leaguePath}|${day}`;
  if (!boards.has(k)) boards.set(k, fetch(`https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/scoreboard?dates=${day}`, { signal: AbortSignal.timeout(12000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return boards.get(k);
};
const ymdOf = (t) => new Date(t).toISOString().slice(0, 10).replaceAll('-', '');
// The confirming read comes from an independent second source where one covers the league
// (js/results2.js): the league's own feed, or FotMob for soccer. Not found there: ESPN again.
const second = secondReader(async (url) => {
  // The NBA's and WNBA's CDN serves its files to its own site's pages.
  const site = /cdn\.(w?nba)\.com/.exec(url)?.[1];
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Accept: 'application/json', ...(site ? { Referer: `https://www.${site}.com/`, Origin: `https://www.${site}.com` } : {}) };
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
});
const secondStats = {};
const tally = (src, k) => { (secondStats[src] ||= { agree: 0, disagree: 0, 'not found': 0, failed: 0 })[k]++; };
// One read per pick: a result, postponed, void, or nothing to grade yet (settle.js decides what that
// means for this record: settle, confirm, dispute, wait, or mark unresolved).
const readOf = (p, r) => (r.postponed ? { postponed: true } : r.void ? { void: true, reason: 'event cancelled or abandoned' }
  : !r.done ? { status: null } : { status: gradePick(p, r), score: `${r.homeScore ?? '?'}-${r.awayScore ?? '?'}` });
const apply = (p, read, source) => { const what = applyRead(p, read, { now, source, audit }); counts[what] = (counts[what] || 0) + 1; return what; };
for (const [key, picks] of Object.entries(byMatch)) {
  const [leaguePath, compId] = key.split('|');
  // Second source: for results waiting to be confirmed, and for disputed ones (read after ESPN, so a
  // dispute settles only when both sources agree).
  // Voids (postponed or cancelled) stay with ESPN: a second source only ever reports a played result.
  const wants = picks.filter((p) => !p.prop && p.status !== 'void' && (awaitingConfirm(p) || p.status === 'disputed'));
  const alt = wants.length ? await second(wants[0]) : null;
  if (alt?.failed) tally(alt.source, 'failed');
  else if (alt && !alt.result) tally(alt.source, 'not found');
  const altReads = new Map();
  if (alt?.result) for (const p of wants) { const read = readOf(p, alt.result); if (read.status != null) altReads.set(p, read); else tally(alt.source, 'not found'); }
  const primary = picks.filter((p) => !(altReads.has(p) && awaitingConfirm(p)));
  if (primary.length) {
    let r, source;
    if (leaguePath.startsWith('atlas/')) { r = resultFromBo3(bo3.get(compId)); source = 'bo3.gg'; }
    else if (/^(mma|tennis)\//.test(leaguePath)) {
      // The day it was due and the days either side (cards and sessions run past midnight UTC).
      const t = picks[0].start, days = [...new Set([t - 864e5, t, t + 864e5].map(ymdOf))];
      const sbs = await Promise.all(days.map((d) => board(leaguePath, d)));
      if (sbs.every((x) => x == null)) { failed++; r = null; }
      else { r = sbs.map((sb) => resultFromScoreboard(sb, compId)).find((x) => x.done || x.void || x.postponed) || { done: false }; source = 'ESPN scoreboard'; }
    } else try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/summary?event=${compId}`, { signal: AbortSignal.timeout(12000) });
      r = res.ok ? resultFromSummary(await res.json()) : { done: false };
      source = 'ESPN summary';
    } catch { failed++; r = null; }
    if (r) for (const p of primary) apply(p, readOf(p, r), source);
  }
  for (const [p, read] of altReads) {
    if (awaitingConfirm(p)) tally(alt.source, read.status === p.status ? 'agree' : 'disagree');
    apply(p, read, alt.source);
  }
}
// Settle multiplier slips whose legs are all in (or one has lost).
let multis = 0;
for (const m of history.filter((h) => h.type === 'multi' && h.status !== 'void')) {
  const r = settleMulti(m);
  const settledOdds = r.odds && r.odds !== m.odds ? r.odds : undefined;
  if (r.status === m.status && settledOdds === m.settledOdds) continue;
  if (r.status === 'pending' && m.status === 'pending') continue;
  // A slip whose result changes after it was settled (a leg corrected or confirmed differently) is
  // logged like any other correction. The quoted odds stay; pushed legs give settledOdds.
  if (['won', 'lost', 'void'].includes(m.status) && m.status !== r.status) audit.push({ at: now, sel: null, key: m.key, from: m.status, to: r.status, source: 'legs', reason: 'leg results changed' });
  m.status = r.status; m.gradedAt = now; multis++;
  if (settledOdds) m.settledOdds = settledOdds; else delete m.settledOdds;
  m.score = m.legs.map((l) => l.status).join(' · ');
}
if (multis) log(`Track record: ${multis} multiplier slip(s) settled or updated`);
if (Object.keys(secondStats).length) log(`Track record: second source (confirming reads): ${Object.entries(secondStats).map(([k, v]) => `${k} agree ${v.agree}, disagree ${v.disagree}, not found ${v['not found']}, failed ${v.failed}`).join('; ')}`);
for (const [name, err] of Object.entries(second.errors)) log(`Track record: second source ${name} failed: ${err}`);
{
  const recs = [...history.filter((h) => h.type !== 'multi'), ...history.filter((h) => h.type === 'multi').flatMap((m) => m.legs || [])];
  const fin = recs.filter((h) => ['won', 'lost', 'push', 'void', 'dnp'].includes(h.status));
  log(`Track record: ${fin.filter(independentlyConfirmed).length} of ${fin.length} final result(s) confirmed by an independent second source, ${fin.filter((h) => h.confirmedAt && !independentlyConfirmed(h)).length} by a second read of the same source`);
}
const { conflicts } = observations(history);
log(`Track record: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing read'}; lookups failed ${failed}; still pending ${history.filter((h) => h.status === 'pending').length}; disputed ${history.filter((h) => h.status === 'disputed').length}; copies disagreeing ${conflicts.length}; corrections logged ${audit.length - auditBefore}`);

await mkdir(dirname(historyPath), { recursive: true });
await writeFile(historyPath, JSON.stringify(history));
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ updatedAt: now, picks: history, corrections: audit.slice(-200), conflicts }));
await mkdir(dirname(auditPath), { recursive: true });
await writeFile(auditPath, JSON.stringify(audit));
