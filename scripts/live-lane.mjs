// Fast lane for live scores from sites that block browsers: NPB, KBO, esports (bo3.gg) and eSoccer
// (EsportsBattle). Run every 20 seconds by the deploy workflow between rebuilds; writes live.json,
// which the workflow pushes to the live-data branch for the site to poll.
//   node scripts/live-lane.mjs <out.json>
import { writeFile } from 'node:fs/promises';
import { parseNpbScoreboard, kboLive } from '../js/asia-live.js';
import { BO3, ESB, bo3Live, esbLive } from '../js/esports.js';
import { KHL_API, khlLive } from '../js/khl.js';

const out = process.argv[2] || 'live.json';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };
const get = async (u, opt = {}) => {
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(10000), ...opt, ...(opt.headers ? { headers: { ...UA, ...opt.headers } } : {}) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};
const asia = new Date(Date.now() + 9 * 36e5); // JST and KST share UTC+9
const ymd = asia.toISOString().slice(0, 10).replaceAll('-', '');
const games = [];
const lanes = [
  ['NPB', async () => parseNpbScoreboard(await get(`https://npb.jp/games/${ymd.slice(0, 4)}/`))],
  ['KBO', async () => kboLive(JSON.parse(await get('https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx', Origin: 'https://www.koreabaseball.com' },
    body: `leId=1&srId=0%2C1%2C3%2C4%2C5%2C6%2C7%2C8%2C9&date=${ymd}`,
  })).game || [])],
  // KHL: games from 6 hours ago to the next hour (live ones and those just finished).
  ['KHL', async () => {
    const now = Math.floor(Date.now() / 1000);
    return JSON.parse(await get(`${KHL_API}events_v2?q[start_at_gt_time_from_unixtime]=${now - 6 * 3600}&q[start_at_lt_time_from_unixtime]=${now + 3600}&order_direction=asc`)).map(khlLive);
  }],
  // Every live series plus the ones that finished in the last hours (so they leave the board).
  ['bo3.gg', async () => {
    const [cur, fin] = await Promise.all([
      get(`${BO3}/matches?page[limit]=100&filter[matches.status][in]=current&with=games`),
      get(`${BO3}/matches?page[limit]=60&sort=-end_date&filter[matches.status][in]=finished,canceled,defwin&with=games`),
    ]);
    return [...JSON.parse(cur).results, ...JSON.parse(fin).results].map(bo3Live);
  }],
  ['eSoccer', async () => {
    const d = (off) => new Date(Date.now() + off * 864e5).toISOString().slice(0, 10);
    const t = [];
    for (let page = 1; page <= 8; page++) { // listed by start time: stop once past the next few minutes
      const j = JSON.parse(await get(`${ESB}/tournaments?page=${page}&dateFrom=${d(0)}&dateTo=${d(1)}`));
      t.push(...(j.tournaments || []));
      if (page >= (j.totalPages || 1) || Date.parse(t.at(-1)?.start_date) > Date.now() + 10 * 6e4) break;
    }
    const live = t.filter((x) => x.status_id === 3 || (x.status_id !== 4 && Date.parse(x.start_date) < Date.now() + 5 * 6e4));
    const lists = await Promise.all(live.slice(0, 8).map((x) => get(`${ESB}/tournaments/${x.id}/matches`).then(JSON.parse).catch(() => [])));
    return lists.flat().filter((m) => m.status_id === 2 || (m.status_id === 3 && Date.parse(m.date) > Date.now() - 60 * 6e4)).map(esbLive);
  }],
];
const counts = await Promise.all(lanes.map(async ([name, run]) => {
  try { const g = await run(); games.push(...g); return `${name} ${g.filter((x) => x.status === 'live').length}`; } catch (e) { return `${name} failed (${e.message})`; }
}));
await writeFile(out, JSON.stringify({ at: Date.now(), games }));
console.log(`live lane: ${games.length} entries · live: ${counts.join(', ')}`);
