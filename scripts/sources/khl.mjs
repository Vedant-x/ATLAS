// Build source (run by scripts/pages.mjs): KHL.
import { get, log } from '../lib.mjs';
import { KHL_API, khlEvent, khlRecords } from '../../js/khl.js';

// The KHL's app feed (khl.api.webcaster.pro): the next 7 days in one-day windows (the feed returns at
// most 16 games per request), plus the season's results so far for each club's record and form.
export async function khl() {
  const getJson = async (u) => JSON.parse(await get(u));
  const now = Math.floor(Date.now() / 1000), day = 86400;
  const seen = new Map();
  for (let d = -0.5; d < 7; d += 1) {
    const list = await getJson(`${KHL_API}events_v2?q[start_at_gt_time_from_unixtime]=${Math.floor(now + d * day)}&q[start_at_lt_time_from_unixtime]=${Math.floor(now + (d + 1) * day)}&order_direction=asc`);
    for (const x of list) seen.set(x.event.id, x);
  }
  const finished = [];
  for (let page = 1; page <= 30; page++) {
    const list = await getJson(`${KHL_API}events_v2?q[start_at_lt_time_from_unixtime]=${now}&order_direction=desc&page=${page}`);
    if (!list.length) break;
    finished.push(...list);
    if (list.some((x) => x.event.stage_name && !/2026\/2027|2026-2027/.test(x.event.stage_name))) break; // previous season reached
  }
  const season = finished.filter((x) => /2026\/2027|2026-2027/.test(x.event.stage_name || ''));
  const records = khlRecords(season);
  const events = [...seen.values()].filter((x) => x.event.game_state_key !== 'finished').map((x) => khlEvent(x, records));
  log(`KHL: ${events.length} games in the next 7 days (${events.filter((e) => e.live).length} live), records from ${season.length} results`);
  if (!events.length) throw new Error('no fixtures returned');
  return events;
}
