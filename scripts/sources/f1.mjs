// Build source (run by scripts/pages.mjs): Formula 1.
import { get, log } from '../lib.mjs';
import { JOLPICA, OPENF1, ESPN_F1, currentRace, sessionsOf, driverForm, expectedPosition, simulateRace, normalizeTrack, espnSessions } from '../../js/f1.js';

// The weekend on now (or next): sessions, classification, driver form, the race model, team colours
// and the circuit map. Written to data/f1.json; the site switches to the next Grand Prix by itself.
export async function f1(prevF1) {
  const J = async (path) => JSON.parse(await get(`${JOLPICA}/${path}`));
  // OpenF1 rate-limits bursts (HTTP 429): pause and retry.
  const O = async (path) => {
    for (let i = 0; ; i++) {
      try { return JSON.parse(await get(`${OPENF1}/${path}`)); } catch (e) { if (i >= 3 || !/^429/.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 2500 * (i + 1))); }
    }
  };
  // Jolpica pages results 100 rows at a time and may split one race across pages: merge by round.
  const allRows = async (path) => {
    const out = [];
    for (let off = 0; off < 3000; off += 100) {
      const j = await J(`${path}?limit=100&offset=${off}`);
      for (const r of j.MRData.RaceTable.Races) {
        const ex = out.find((x) => x.round === r.round);
        if (ex) { ex.Results = [...(ex.Results || []), ...(r.Results || [])]; ex.QualifyingResults = [...(ex.QualifyingResults || []), ...(r.QualifyingResults || [])]; } else out.push(r);
      }
      if (off + 100 >= Number(j.MRData.total)) break;
    }
    return out;
  };
  const calendar = (await J('current.json')).MRData.RaceTable.Races;
  const race = currentRace(calendar);
  if (!race) { log('F1: season over, no upcoming race'); return null; }
  const [results, qualis, ds, cs] = await Promise.all([allRows('current/results.json'), allRows('current/qualifying.json'), J('current/driverStandings.json'), J('current/constructorStandings.json')]);
  const standings = ds.MRData.StandingsTable.StandingsLists[0]?.DriverStandings || [];
  const constructors = (cs.MRData.StandingsTable.StandingsLists[0]?.ConstructorStandings || []).map((c) => ({ pos: Number(c.position), name: c.Constructor.name, points: Number(c.points), wins: Number(c.wins) }));
  const form = driverForm(results, qualis);

  // This weekend's sessions: schedule from Jolpica, status and classification from ESPN.
  let espn = [];
  try {
    const j = JSON.parse(await get(`${ESPN_F1}?dates=${race.date.replaceAll('-', '')}`));
    const ev = (j.events || []).find((e) => Math.abs(Date.parse(e.date) - Date.parse(race.date)) < 5 * 864e5);
    espn = espnSessions(ev);
  } catch (e) { log('F1: ESPN sessions failed', e.message); }
  const sessions = sessionsOf(race).map((s) => {
    const m = espn.find((x) => x.code === s.code || (s.code === 'Race' && x.code === 'Race') || Math.abs(x.start - s.start) < 30 * 6e4);
    return { ...s, state: m?.state || (Date.now() > s.start + 3 * 36e5 ? 'post' : 'pre'), detail: m?.detail || '', top: (m?.order || []).slice(0, 10).map((x) => x.name) };
  });

  // Starting grid once qualifying is in (Jolpica first, ESPN's qualifying order as a fallback).
  const grid = new Map();
  try { for (const q of (await J(`${race.season}/${race.round}/qualifying.json`)).MRData.RaceTable.Races[0]?.QualifyingResults || []) grid.set(q.Driver.driverId, Number(q.position)); } catch { /* not yet */ }
  const qualEspn = sessions.find((s) => s.code === 'Qual' && s.state === 'post');

  const drivers = standings.map((d) => {
    const name = `${d.Driver.givenName} ${d.Driver.familyName}`;
    let g = grid.get(d.Driver.driverId) || null;
    if (!g && qualEspn?.top.length) { const i = qualEspn.top.findIndex((n) => n.toLowerCase().endsWith(d.Driver.familyName.toLowerCase())); if (i >= 0) g = i + 1; }
    const f = form.get(d.Driver.driverId);
    return {
      id: d.Driver.driverId, code: d.Driver.code || d.Driver.familyName.slice(0, 3).toUpperCase(), number: d.Driver.permanentNumber || null, name, family: d.Driver.familyName,
      team: d.Constructors?.[0]?.name || '', points: Number(d.points), pos: Number(d.position), wins: Number(d.wins), grid: g,
      avgFinish: f?.avgFinish ?? null, avgFinish5: f?.avgFinish5 ?? null, avgQuali5: f?.avgQuali5 ?? null, last5: f?.last5 || [], dnfRate: f?.dnfRate ?? 0.08,
    };
  }).filter((d) => form.get(d.id)?.starts); // drivers who raced this season
  drivers.forEach((d) => { d.expected = expectedPosition(d, d.grid, drivers.length); });
  const model = simulateRace(drivers);

  // OpenF1: this meeting's sessions (for live timing), team colours and the circuit outline.
  let meeting = null, track = null, colours = {};
  try {
    const first = sessions[0].start, last = sessions.at(-1).start;
    const ses = await O(`sessions?year=${race.season}`);
    const mine = ses.filter((x) => Date.parse(x.date_start) > first - 6 * 36e5 && Date.parse(x.date_start) < last + 6 * 36e5);
    if (mine.length) meeting = { key: mine[0].meeting_key, circuitKey: mine[0].circuit_key, circuit: mine[0].circuit_short_name, sessions: mine.map((x) => ({ key: x.session_key, name: x.session_name, start: Date.parse(x.date_start), end: Date.parse(x.date_end) })) };
    for (const d of await O('drivers?session_key=latest')) if (d.last_name) colours[d.last_name.toLowerCase()] = { colour: /^[0-9a-f]{6}$/i.test(d.team_colour || '') ? `#${d.team_colour}` : null, number: d.driver_number, headshot: d.headshot_url || null };
  } catch (e) { log('F1: OpenF1 meeting/drivers failed', e.message); }
  drivers.forEach((d) => { const c = colours[d.family.toLowerCase()]; if (c) Object.assign(d, { colour: c.colour, number: c.number ?? d.number, headshot: c.headshot }); });
  model.drivers.forEach((d) => { const x = drivers.find((y) => y.id === d.id); Object.assign(d, { colour: x.colour, number: x.number, headshot: x.headshot }); });

  if (meeting?.circuitKey && prevF1?.track?.circuitKey === meeting.circuitKey) track = prevF1.track; // drawn before: keep it
  else if (meeting?.circuitKey) {
    try {
      const past = (await O(`sessions?circuit_key=${meeting.circuitKey}`)).filter((x) => Date.parse(x.date_end) < Date.now() - 36e5).sort((a, b) => (a.session_name === 'Race') - (b.session_name === 'Race') || Date.parse(a.date_start) - Date.parse(b.date_start));
      const src = past.at(-1);
      if (src) {
        const laps = (await O(`laps?session_key=${src.session_key}&lap_number=${src.session_name === 'Race' ? 8 : 4}`)).filter((l) => l.lap_duration && !l.is_pit_out_lap).sort((a, b) => a.lap_duration - b.lap_duration);
        const lap = laps[0];
        if (lap) {
          const a = new Date(Date.parse(lap.date_start)).toISOString(), b = new Date(Date.parse(lap.date_start) + lap.lap_duration * 1000).toISOString();
          const n = normalizeTrack(await O(`location?session_key=${src.session_key}&driver_number=${lap.driver_number}&date>${a}&date<${b}`));
          if (n) track = { ...n, circuitKey: meeting.circuitKey, from: `${src.session_name}, ${new Date(Date.parse(src.date_start)).getUTCFullYear()} (OpenF1 car data)`, lapSeconds: lap.lap_duration };
        }
      }
    } catch (e) { log('F1: circuit map failed', e.message); }
  }

  const lastRace = results.at(-1);
  const out = {
    updatedAt: Date.now(), season: race.season, round: Number(race.round), rounds: calendar.length,
    race: { name: race.raceName, circuit: race.Circuit.circuitName, circuitId: race.Circuit.circuitId, locality: race.Circuit.Location.locality, country: race.Circuit.Location.country, start: sessions.at(-1).start, url: race.url, sessions },
    drivers: model.drivers, h2h: model.h2h, teams: model.teams, sims: model.sims, gridKnown: drivers.some((d) => d.grid),
    standings: drivers.slice().sort((a, b) => a.pos - b.pos).map((d) => ({ pos: d.pos, name: d.name, team: d.team, points: d.points, wins: d.wins, colour: d.colour })), constructors,
    lastRace: lastRace ? { name: lastRace.raceName, round: Number(lastRace.round), podium: (lastRace.Results || []).slice(0, 3).map((r) => `${r.Driver.givenName} ${r.Driver.familyName}`) } : null,
    upcoming: calendar.filter((r) => Date.parse(r.date) > Date.parse(race.date)).slice(0, 5).map((r) => ({ round: Number(r.round), name: r.raceName, date: r.date, locality: r.Circuit.Location.locality })),
    meeting, track,
  };
  log(`F1: ${out.race.name} (round ${out.round}), ${drivers.length} drivers, favourite ${model.drivers[0]?.name} ${(model.drivers[0]?.win * 100).toFixed(0)}%, grid ${out.gridKnown ? 'known' : 'not yet'}, circuit map ${track ? `${track.points.length} points` : 'missing'}`);
  return out;
}
