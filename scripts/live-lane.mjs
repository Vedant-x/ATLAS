// Fast lane for NPB/KBO live scores (their sites block browsers). Run every minute by the deploy
// workflow between rebuilds; writes live.json, which the workflow pushes to the live-data branch.
//   node scripts/live-lane.mjs <out.json>
import { writeFile } from 'node:fs/promises';
import { parseNpbScoreboard, kboLive } from '../js/asia-live.js';

const out = process.argv[2] || 'live.json';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };
const asia = new Date(Date.now() + 9 * 36e5); // JST and KST share UTC+9
const ymd = asia.toISOString().slice(0, 10).replaceAll('-', '');
const games = [];
try {
  const html = await (await fetch(`https://npb.jp/games/${ymd.slice(0, 4)}/`, { headers: UA, signal: AbortSignal.timeout(10000) })).text();
  games.push(...parseNpbScoreboard(html));
} catch (e) { console.log('NPB live failed', e.message); }
try {
  const res = await fetch('https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx', Origin: 'https://www.koreabaseball.com' },
    body: `leId=1&srId=0%2C1%2C3%2C4%2C5%2C6%2C7%2C8%2C9&date=${ymd}`,
  });
  games.push(...kboLive((await res.json()).game || []));
} catch (e) { console.log('KBO live failed', e.message); }
await writeFile(out, JSON.stringify({ at: Date.now(), games }));
console.log(`live lane: ${games.length} games, ${games.filter((g) => g.status === 'live').length} live`);
