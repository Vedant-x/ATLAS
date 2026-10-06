// Track record update, run by the Pages build after scripts/pages.mjs:
//   node scripts/record.mjs <history.json> <events.json> <out.json>
// Records ATLAS's official picks for matches starting soon, grades finished ones from ESPN final
// scores, saves the history file (kept on the track-record branch) and writes the public copy.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { selectPicks, addPicks, gradePick, resultFromSummary, resultFromBo3, settleMulti } from '../js/track.js';
import { BO3 } from '../js/esports.js';

const [historyPath = 'track/picks.json', eventsPath = 'dist/pages/data/index.json', outPath = 'dist/pages/data/track.json'] = process.argv.slice(2);
const now = Date.now();
const log = (...a) => console.log(...a);

let history = [];
try { history = JSON.parse(await readFile(historyPath, 'utf8')); } catch { log('Track record: starting a new history'); }
const { events = [] } = JSON.parse(await readFile(eventsPath, 'utf8'));

const before = history.length;
history = addPicks(history, selectPicks(events, now, 12, history));
log(`Track record: ${history.length - before} new pick(s), ${history.length} total`);

// Grade picks whose match should be over (2h+ after start). One summary request per match.
// Singles plus the legs of pending multiplier slips are graded the same way.
const due = [
  ...history.filter((h) => h.status === 'pending' && h.type !== 'multi' && h.start < now - 2 * 36e5),
  ...history.filter((h) => h.status === 'pending' && h.type === 'multi').flatMap((m) => m.legs.filter((l) => l.status === 'pending' && l.start < now - 2 * 36e5)),
];
const byMatch = Object.groupBy ? Object.groupBy(due, (h) => `${h.leaguePath}|${h.compId}`) : due.reduce((m, h) => ((m[`${h.leaguePath}|${h.compId}`] ||= []).push(h), m), {});
let graded = 0, voided = 0, failed = 0, unresolved = 0;
// Esports series are graded from bo3.gg in one request for all of them.
const bo3 = new Map();
const bo3Ids = Object.keys(byMatch).filter((k) => /^atlas\/(cs2|valorant|lol|dota2)\|/.test(k)).map((k) => k.split('|')[1]);
if (bo3Ids.length) {
  try {
    const res = await fetch(`${BO3}/matches?page[limit]=100&filter[matches.id][in]=${bo3Ids.join(',')}`, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 ATLAS track record' } });
    if (res.ok) for (const m of (await res.json()).results || []) bo3.set(String(m.id), m);
  } catch { failed += bo3Ids.length; }
}
for (const [key, picks] of Object.entries(byMatch)) {
  const [leaguePath, compId] = key.split('|');
  let r;
  if (leaguePath.startsWith('atlas/')) r = resultFromBo3(bo3.get(compId));
  else try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/summary?event=${compId}`, { signal: AbortSignal.timeout(12000) });
    r = res.ok ? resultFromSummary(await res.json()) : { done: false };
  } catch { failed++; continue; }
  for (const p of picks) {
    // Void only when the event itself was voided (cancelled/abandoned). A result we could not find
    // after 4 days, or a market we cannot grade, is "unresolved": kept visible, never counted.
    if (r.void) { p.status = 'void'; voided++; continue; }
    if (!r.done) { if (p.start < now - 4 * 864e5) { p.status = 'unresolved'; unresolved++; } continue; }
    const g = gradePick(p, r);
    p.status = g || 'unresolved';
    p.score = `${r.homeScore ?? '?'}-${r.awayScore ?? '?'}`;
    p.gradedAt = now;
    if (g) graded++; else unresolved++;
  }
}
// Settle multiplier slips whose legs are all in (or one has lost).
let multis = 0;
for (const m of history.filter((h) => h.type === 'multi' && h.status === 'pending')) {
  const r = settleMulti(m);
  if (r.status === 'pending') continue;
  m.status = r.status; m.gradedAt = now; multis++;
  if (r.odds) m.odds = r.odds;
  m.score = m.legs.map((l) => l.status).join(' · ');
}
if (multis) log(`Track record: settled ${multis} multiplier slip(s)`);
log(`Track record: graded ${graded}, voided ${voided}, unresolved ${unresolved}, lookups failed ${failed}, still pending ${history.filter((h) => h.status === 'pending').length}`);

await mkdir(dirname(historyPath), { recursive: true });
await writeFile(historyPath, JSON.stringify(history));
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ updatedAt: now, picks: history }));
