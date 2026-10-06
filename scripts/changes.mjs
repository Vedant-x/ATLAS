// Evidence timeline: compares this build's matches with the previous build's and records every
// material change (starter announced or replaced, confirmed lineups, new absences, price moves,
// start-time moves) with what it was before, what it is now, the source, when it was seen and whether
// the forecast moved with it. Kept on the track-record branch so the history survives between builds;
// the last 48 hours are published for the site (data/changes.json).
//
//   node scripts/changes.mjs <dir with snapshot.json + changes.json> <index.json> <public changes.json>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { snapshot, diff } from '../js/changelog.js';

const [dir = 'track', indexPath = 'dist/pages/data/index.json', outPath = 'dist/pages/data/changes.json'] = process.argv.slice(2);
const read = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const now = Date.now();
const index = read(indexPath, { events: [] });
const prev = read(`${dir}/snapshot.json`, {});
let log = read(`${dir}/changes.json`, []);

// Matches still to come (or just started) within three days: the ones research is about.
const relevant = (index.events || []).filter((e) => e.start > now - 3 * 36e5 && e.start < now + 72 * 36e5 && e.sport !== 'efootball');
const snap = {};
let added = 0;
for (const e of relevant) {
  const s = snapshot(e);
  snap[e.id] = s;
  if (e.live) continue; // live score changes are not research evidence
  for (const c of diff(e, prev[e.id], s, now).filter((x) => !x.liveOnly)) {
    log.push({
      id: `${e.id}|${now}|${log.length}`, eventId: e.id, at: now, kind: c.kind, text: c.text,
      before: c.before ?? null, after: c.after ?? null, source: c.source || null, forecast: c.forecast || 'none',
      sport: e.sport, league: e.league, home: e.home, away: e.away, start: e.start,
    });
    added++;
  }
}
// Keep 7 days on the branch; publish 48 hours.
log = log.filter((c) => c.at > now - 7 * 864e5).slice(-4000);
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/snapshot.json`, JSON.stringify(snap));
writeFileSync(`${dir}/changes.json`, JSON.stringify(log));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ updatedAt: now, firstRun: !Object.keys(prev).length, changes: log.filter((c) => c.at > now - 48 * 36e5).slice(-1500) }));
console.log(`Changes: ${added} new, ${log.length} kept, ${relevant.length} matches watched${Object.keys(prev).length ? '' : ' (first run: baseline only)'}`);
