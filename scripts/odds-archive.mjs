// Appends this build's changed prices to the odds archive on the track-record branch (js/archive.js).
//   node scripts/odds-archive.mjs dist/pages/data/index.json track/odds
// Files: odds/YYYY-MM-DD.jsonl (one row per line, by build day in UTC) and odds/last.json (each
// market's last prices kept, so only changes are written). A day's file past MAX_DAY_MB stops growing
// for that day, with a warning, so a feed sending different prices on every build cannot bloat the
// branch.
import { readFile, writeFile, appendFile, mkdir, stat } from 'node:fs/promises';
import { archiveRows } from '../js/archive.js';

const [indexFile = 'dist/pages/data/index.json', dir = 'track/odds'] = process.argv.slice(2);
const MAX_DAY_MB = 25;
const { events = [], fetchedAt } = JSON.parse(await readFile(indexFile, 'utf8'));
await mkdir(dir, { recursive: true });
let last = {};
try { last = JSON.parse(await readFile(`${dir}/last.json`, 'utf8')); } catch { /* first run */ }
const at = fetchedAt || Date.now();
const file = `${dir}/${new Date(at).toISOString().slice(0, 10)}.jsonl`;
const size = await stat(file).then((s) => s.size, () => 0);
if (size > MAX_DAY_MB * 1e6) {
  console.log(`::warning::Odds archive: ${file} is over ${MAX_DAY_MB} MB; nothing more is kept today`);
} else {
  const rows = archiveRows(events, last, at);
  if (rows.length) await appendFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await writeFile(`${dir}/last.json`, JSON.stringify(last));
  console.log(`Odds archive: ${rows.length} market(s) changed of ${Object.keys(last).length} tracked; ${file} ${((size + rows.reduce((s, r) => s + JSON.stringify(r).length + 1, 0)) / 1e6).toFixed(2)} MB`);
}
