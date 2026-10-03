// Track record update, run by the Pages build after scripts/pages.mjs:
//   node scripts/record.mjs <history.json> <events.json> <out.json>
// Records ATLAS's official picks for matches starting soon, grades finished ones from ESPN final
// scores, saves the history file (kept on the track-record branch) and writes the public copy.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { selectPicks, addPicks, gradePick, resultFromSummary } from '../js/track.js';

const [historyPath = 'track/picks.json', eventsPath = 'dist/pages/data/index.json', outPath = 'dist/pages/data/track.json'] = process.argv.slice(2);
const now = Date.now();
const log = (...a) => console.log(...a);

let history = [];
try { history = JSON.parse(await readFile(historyPath, 'utf8')); } catch { log('Track record: starting a new history'); }
const { events = [] } = JSON.parse(await readFile(eventsPath, 'utf8'));

const before = history.length;
history = addPicks(history, selectPicks(events, now));
log(`Track record: ${history.length - before} new pick(s), ${history.length} total`);

// Grade picks whose match should be over (2h+ after start). One summary request per match.
const due = history.filter((h) => h.status === 'pending' && h.start < now - 2 * 36e5);
const byMatch = Object.groupBy ? Object.groupBy(due, (h) => `${h.leaguePath}|${h.compId}`) : due.reduce((m, h) => ((m[`${h.leaguePath}|${h.compId}`] ||= []).push(h), m), {});
let graded = 0, voided = 0, failed = 0;
for (const [key, picks] of Object.entries(byMatch)) {
  const [leaguePath, compId] = key.split('|');
  let r;
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/summary?event=${compId}`, { signal: AbortSignal.timeout(12000) });
    r = res.ok ? resultFromSummary(await res.json()) : { done: false };
  } catch { failed++; continue; }
  for (const p of picks) {
    if (r.void || (!r.done && p.start < now - 4 * 864e5)) { p.status = 'void'; voided++; continue; }
    if (!r.done) continue;
    const g = gradePick(p, r);
    p.status = g || 'void';
    p.score = `${r.homeScore ?? '?'}-${r.awayScore ?? '?'}`;
    p.gradedAt = now;
    if (g) graded++; else voided++;
  }
}
log(`Track record: graded ${graded}, voided ${voided}, lookups failed ${failed}, still pending ${history.filter((h) => h.status === 'pending').length}`);

await mkdir(dirname(historyPath), { recursive: true });
await writeFile(historyPath, JSON.stringify(history));
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ updatedAt: now, picks: history }));
