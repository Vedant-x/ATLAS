// Build source (run by scripts/pages.mjs): Golf and motor racing (field events, data/fields.json).
import { get, log } from '../lib.mjs';
import { parseGolf, golfForm, golfChances, parseStandings, raceChances, raceResult } from '../../js/fields.js';

// Golf: each tour's event this week from ESPN, with form from the tour's previous four events.
// Racing: NASCAR Cup and IndyCar, the next (or last) race and the season standings.
export const GOLF_TOURS = [['pga', 'PGA Tour'], ['lpga', 'LPGA Tour'], ['eur', 'DP World Tour'], ['champions-tour', 'PGA Tour Champions']];
export const RACING = [['nascar-premier', 'NASCAR Cup Series'], ['nascar-secondary', "NASCAR O'Reilly Series"], ['nascar-truck', 'NASCAR Truck Series'], ['irl', 'IndyCar Series']];
export async function fields() {
  const S = 'https://site.api.espn.com/apis/site/v2/sports';
  const getJson = async (u) => JSON.parse(await get(u));
  const ymd8 = (t) => new Date(t).toISOString().slice(0, 10).replaceAll('-', '');
  const golf = [], racing = [];
  for (const [tour, tourName] of GOLF_TOURS) {
    try {
      const cur = parseGolf((await getJson(`${S}/golf/${tour}/scoreboard`)).events?.[0], tour);
      if (!cur || cur.state === 'post' && cur.end < Date.now() - 2 * 864e5) { log(`Golf ${tour}: no current event`); continue; }
      const past = [];
      for (const w of [1, 2, 3, 4]) {
        try {
          const e = parseGolf((await getJson(`${S}/golf/${tour}/scoreboard?dates=${ymd8(cur.start - w * 7 * 864e5 + 3 * 864e5)}`)).events?.[0], tour);
          if (e && e.id !== cur.id && e.state === 'post' && e.field.length >= 30 && !past.some((x) => x.id === e.id)) past.push(e);
        } catch { /* skip that week */ }
      }
      const form = golfForm(past);
      const players = golfChances(cur, form);
      golf.push({ tour, tourName, id: cur.id, name: cur.name, start: cur.start, end: cur.end, state: cur.state, round: cur.round, detail: cur.detail,
        fieldSize: cur.field.length, formEvents: past.map((e) => e.name), players: players.slice(0, 60) });
      const top = players.slice(0, 3).map((p) => `${p.name} ${(p.win * 100).toFixed(1)}%${p.toPar != null && cur.state !== 'pre' ? ` (${p.toPar})` : ''}`).join(', ');
      log(`Golf ${tour}: ${cur.name} (${cur.state}, round ${cur.round}), ${cur.field.length} players, form from ${past.length} events (${form.size} players rated); favourites ${top || '-'}`);
    } catch (err) { log(`Golf ${tour} failed: ${err.message}`); }
  }
  for (const [series, seriesName] of RACING) {
    try {
      const sb = await getJson(`${S}/racing/${series}/scoreboard`);
      const ev = sb.events?.[0];
      const st = await getJson(`https://site.api.espn.com/apis/v2/sports/racing/${series}/standings`);
      const entries = st?.children?.[0]?.standings?.entries || [];
      if (entries[0]) log(`  ${series} standings stats: ${(entries[0].stats || []).filter((x) => (x.name || x.abbreviation) && (x.displayValue ?? x.value) != null).map((x) => `${x.name || x.abbreviation}=${x.displayValue ?? x.value}`).join(' ')}`);
      const drivers = parseStandings(st);
      const state = ev?.competitions?.[0]?.status?.type?.state || ev?.status?.type?.state || 'pre';
      const next = ev && state !== 'post' ? { name: ev.name, start: Date.parse(ev.date), state } : null;
      const last = ev && state === 'post' ? raceResult(ev) : null;
      const chances = raceChances(drivers);
      racing.push({ series, seriesName, next, last, season: st?.children?.[0]?.standings?.season || null, drivers: chances.slice(0, 40) });
      log(`Racing ${series}: ${next ? `next ${next.name} ${new Date(next.start).toISOString()}` : last ? `last ${last.name}: ${last.top.slice(0, 3).join(', ')}` : 'no race'}; ${drivers.length} drivers in standings; favourites ${chances.slice(0, 3).map((d) => `${d.name} ${(d.win * 100).toFixed(1)}%`).join(', ') || '-'}`);
    } catch (err) { log(`Racing ${series} failed: ${err.message}`); }
  }
  // MotoGP, Moto2 and Moto3 from the championship's own results feed.
  try {
    const M = 'https://api.motogp.pulselive.com/motogp/v1';
    const seasons = await getJson(`${M}/results/seasons`);
    const cur = seasons.find((x) => x.current) || seasons[0];
    const cats = await getJson(`${M}/results/categories?seasonUuid=${cur.id}`);
    const next = (await getJson(`${M}/results/events?seasonUuid=${cur.id}&isFinished=false`)).filter((e) => !e.test).sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))[0];
    for (const c of cats) {
      const name = String(c.name || '').replace(/™/g, '').trim();
      const st = await getJson(`${M}/results/standings?seasonUuid=${cur.id}&categoryUuid=${c.id}`);
      const drivers = (st.classification || []).map((r, i) => ({ id: String(r.rider?.id || i), name: r.rider?.full_name || [r.rider?.name, r.rider?.surname].filter(Boolean).join(' ') || '?', pos: r.position ?? i + 1, points: r.points ?? null, starts: null, wins: r.race_wins ?? null, top5: r.podiums ?? null, top10: null }));
      const chances = raceChances(drivers);
      racing.push({ series: `motogp-${name.toLowerCase()}`, seriesName: name, next: next ? { name: next.sponsored_name || next.name, start: Date.parse(`${next.date_end}T12:00:00Z`), state: next.status === 'NOT-STARTED' ? 'pre' : 'in' } : null, last: null, season: cur.year, drivers: chances.slice(0, 40) });
      log(`Racing ${name}: ${drivers.length} riders in standings; next ${next?.name || '-'} (${next?.date_start || '-'}); favourites ${chances.slice(0, 3).map((d) => `${d.name} ${(d.win * 100).toFixed(1)}%`).join(', ')}`);
    }
  } catch (err) { log(`MotoGP failed: ${err.message}`); }
  return { updatedAt: Date.now(), golf, racing };
}
