// Formula 1: the race weekend on now (or next), driver form, the ATLAS race model and the circuit map.
// Schedule, results and standings come from Jolpica (the Ergast successor), session classifications
// from ESPN, team colours and the circuit outline from OpenF1 (car position data from a real lap).
// The build (scripts/pages.mjs) assembles data/f1.json; the pure functions here are tested.

export const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
export const OPENF1 = 'https://api.openf1.org/v1';
export const ESPN_F1 = 'https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard';

const at = (d) => (d?.date ? Date.parse(`${d.date}T${d.time || '12:00:00Z'}`) : NaN);
const SESSIONS = [['FirstPractice', 'Practice 1', 'FP1'], ['SecondPractice', 'Practice 2', 'FP2'], ['ThirdPractice', 'Practice 3', 'FP3'], ['SprintQualifying', 'Sprint Qualifying', 'SQ'], ['Sprint', 'Sprint', 'Sprint'], ['Qualifying', 'Qualifying', 'Qual']];
export const SESSION_LENGTH = { FP1: 60, FP2: 60, FP3: 60, SQ: 45, Sprint: 45, Qual: 60, Race: 120 }; // minutes (race: allow 2h)

// Sessions of a Jolpica race object, in order, with start times.
export function sessionsOf(race) {
  const out = SESSIONS.filter(([k]) => race[k]).map(([k, name, code]) => ({ code, name, start: at(race[k]) }));
  out.push({ code: 'Race', name: 'Grand Prix', start: at(race) });
  return out.filter((s) => Number.isFinite(s.start)).sort((a, b) => a.start - b.start);
}

// The weekend to show: the first race not finished more than 6 hours ago. A new Grand Prix takes
// over by itself once the previous one is done.
export function currentRace(races = [], now = Date.now()) {
  return races.find((r) => at(r) + 6 * 36e5 > now) || null;
}

// Per-driver form from this season's race and qualifying results (Jolpica Races[].Results / QualifyingResults).
export function driverForm(raceRows = [], qualiRows = []) {
  const by = new Map();
  const row = (d) => {
    if (!by.has(d.driverId)) by.set(d.driverId, { id: d.driverId, finishes: [], qualis: [], dnf: 0, starts: 0 });
    return by.get(d.driverId);
  };
  for (const race of raceRows) {
    for (const r of race.Results || []) {
      const x = row(r.Driver);
      x.starts++;
      const classified = /^\d+$/.test(r.positionText) && (r.status === 'Finished' || /Lap/.test(r.status || ''));
      if (!classified) x.dnf++;
      x.finishes.push({ round: Number(race.round), pos: classified ? Number(r.position) : null });
    }
  }
  for (const race of qualiRows) for (const q of race.QualifyingResults || []) row(q.Driver).qualis.push({ round: Number(race.round), pos: Number(q.position) });
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  for (const x of by.values()) {
    x.finishes.sort((a, b) => a.round - b.round); x.qualis.sort((a, b) => a.round - b.round);
    const fin = x.finishes.filter((f) => f.pos != null).map((f) => f.pos);
    x.avgFinish = avg(fin);
    x.avgFinish5 = avg(x.finishes.slice(-5).filter((f) => f.pos != null).map((f) => f.pos));
    x.avgQuali5 = avg(x.qualis.slice(-5).map((q) => q.pos));
    x.last5 = x.finishes.slice(-5).map((f) => (f.pos == null ? 'DNF' : String(f.pos)));
    // DNF rate shrunk toward the grid's typical ~8% so two retirements early on don't dominate.
    x.dnfRate = (x.dnf + 0.08 * 6) / (x.starts + 6);
  }
  return by;
}

// Expected finishing position from form (lower is better); the starting grid dominates once known.
export function expectedPosition(f, grid = null, field = 20) {
  const parts = [[f?.avgFinish5, 0.45], [f?.avgFinish, 0.3], [f?.avgQuali5, 0.25]].filter(([v]) => v != null);
  const form = parts.length ? parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0) : field * 0.65;
  return grid ? 0.6 * grid + 0.4 * form : form;
}

// Small deterministic PRNG so the published numbers don't wobble between builds.
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Monte Carlo race: Plackett-Luce order (strength = exp(-K · expected position)) plus retirements.
// Returns per-driver chances to win, podium, top 6, points (top 10) and the head-to-head table.
export function simulateRace(drivers, { sims = 20000, K = 0.6, seed = 7 } = {}) {
  const n = drivers.length;
  const r = rng(seed);
  const logw = drivers.map((d) => -K * d.expected);
  const win = new Float64Array(n), pod = new Float64Array(n), top6 = new Float64Array(n), pts = new Float64Array(n), sumPos = new Float64Array(n);
  const ahead = Array.from({ length: n }, () => new Float64Array(n));
  const team = new Map();
  const key = new Float64Array(n), idx = Array.from({ length: n }, (_, i) => i);
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < n; i++) {
      const g = -Math.log(-Math.log(r() || 1e-12)); // Gumbel trick → Plackett-Luce order
      key[i] = r() < drivers[i].dnfRate ? -1e9 + logw[i] : logw[i] + g;
    }
    idx.sort((a, b) => key[b] - key[a]);
    for (let p = 0; p < n; p++) {
      const i = idx[p];
      sumPos[i] += p + 1;
      if (p === 0) { win[i]++; team.set(drivers[i].team, (team.get(drivers[i].team) || 0) + 1); }
      if (p < 3) pod[i]++;
      if (p < 6) top6[i]++;
      if (p < 10) pts[i]++;
      for (let q = p + 1; q < n; q++) ahead[i][idx[q]]++;
    }
  }
  const out = drivers.map((d, i) => ({ ...d, win: win[i] / sims, podium: pod[i] / sims, top6: top6[i] / sims, points: pts[i] / sims, avgPos: sumPos[i] / sims }));
  out.sort((a, b) => b.win - a.win || a.avgPos - b.avgPos);
  // Teammate battles.
  const h2h = [];
  const seen = new Set();
  drivers.forEach((d, i) => drivers.forEach((e, j) => {
    if (i >= j || d.team !== e.team || seen.has(d.team)) return;
    seen.add(d.team);
    h2h.push({ team: d.team, a: d.name, b: e.name, pA: ahead[i][j] / sims, pB: ahead[j][i] / sims });
  }));
  const teams = [...team.entries()].map(([name, w]) => ({ name, win: w / sims })).sort((a, b) => b.win - a.win);
  return { drivers: out, h2h, teams, sims };
}

// Circuit outline from OpenF1 location samples of one lap: closed, ~240 points, centred and scaled
// to fit ±1, with the transform kept so live car positions can be placed on the same map.
export function normalizeTrack(locs = [], target = 240) {
  const pts = locs.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => [p.x, p.y]);
  if (pts.length < 40) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const scale = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 || 1;
  const step = Math.max(1, Math.floor(pts.length / target));
  const out = [];
  for (let i = 0; i < pts.length; i += step) out.push([+((pts[i][0] - cx) / scale).toFixed(4), +((pts[i][1] - cy) / scale).toFixed(4)]);
  return { points: out, transform: { cx, cy, scale } };
}

// ESPN session classification (FP/Qual/Sprint/Race): status and the order of the top drivers.
export function espnSessions(ev) {
  return (ev?.competitions || []).map((c) => ({
    code: c.type?.abbreviation || '', start: Date.parse(c.date), state: c.status?.type?.state || 'pre', detail: c.status?.type?.shortDetail || '',
    order: [...(c.competitors || [])].sort((a, b) => (a.order || 99) - (b.order || 99)).map((x) => ({ name: x.athlete?.displayName || '', pos: x.order || null, winner: Boolean(x.winner) })).filter((x) => x.name),
  }));
}

// Is a session in progress right now (by schedule)?
export function liveSession(sessions = [], now = Date.now()) {
  return sessions.find((s) => now >= s.start - 5 * 6e4 && now <= s.start + (SESSION_LENGTH[s.code] || 90) * 6e4 + 30 * 6e4) || null;
}
