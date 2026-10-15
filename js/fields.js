// Field events: golf tournaments and NASCAR / IndyCar races, where one of many wins rather than one
// of two. Pure parsers and models (the build fetches, fieldview.js draws):
//
//   golf    ESPN leaderboards. Each player's strength is how many strokes per round he beats the
//           field by, from this week's completed rounds and the tour's previous four events (shrunk
//           toward the field when there are few rounds). The rest of the tournament is simulated
//           hole by hole in aggregate (per-round spread SD_ROUND strokes) from each player's
//           current score, so before round 1 the chances come from form alone and on Sunday
//           afternoon mostly from the leaderboard. Ties for the lead go to a playoff (coin flip).
//   racing  season standings (wins, top 5s, top 10s per start, points per start): a strength per
//           driver and simulated finishing orders (Plackett-Luce). Rougher than golf: no practice
//           or qualifying pace, and no track type.

export const SD_ROUND = 2.9;
const SIMS = 12000;

// Mulberry32: reproducible draws, so a build gives the same chances for the same data.
function rng(seed) {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (u) => { const a = Math.max(1e-12, u()), b = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); };
export const toPar = (s) => (s == null || s === '' ? null : /^E$/i.test(String(s).trim()) ? 0 : Number.isFinite(Number(s)) ? Number(s) : null);

// ---------- golf ----------
// Holes played in a round: the hole-by-hole scores when the feed has them; otherwise estimated from
// the strokes (no 18-hole round is under 55; about four strokes a hole), so a round in progress is
// never taken for a finished one.
const holesOf = (r) => (Array.isArray(r.linescores) && r.linescores.length ? Math.min(18, r.linescores.length) : r.value >= 55 ? 18 : Math.max(1, Math.min(17, Math.round(r.value / 4))));
// One ESPN golf event → { id, name, start, end, state, round, field: [...] }.
export function parseGolf(ev, tour) {
  const c = ev?.competitions?.[0];
  if (!c) return null;
  const round = c.status?.period || 0, end = Date.parse(ev.endDate || ev.date);
  // ESPN marks a day's play complete as "post" mid-tournament ("Round 1 - Play Complete").
  let state = c.status?.type?.state || ev.status?.type?.state || 'pre';
  if (state === 'post' && round < 4 && end > Date.now() && !c.status?.type?.completed) state = 'in';
  const field = (c.competitors || []).map((x) => {
    const rounds = (x.linescores || []).filter((r) => Number.isFinite(r.value) && r.value > 0).map((r) => ({
      n: r.period, strokes: r.value, toPar: toPar(r.displayValue), holes: holesOf(r),
    }));
    return { id: String(x.id), name: x.athlete?.displayName || x.athlete?.fullName || '?', country: x.athlete?.flag?.alt || '', pos: x.order || null, toPar: toPar(x.score), rounds };
  });
  return {
    id: `golf-${tour}-${ev.id}`, sport: 'golf', tour, name: ev.name, start: Date.parse(ev.date), end,
    state, round, detail: c.status?.type?.shortDetail || c.status?.type?.detail || '', field,
  };
}

// Strokes per round each player beat the field by, from finished events (full rounds only).
export function golfForm(events) {
  const sum = new Map();
  for (const e of events) {
    for (let n = 1; n <= 4; n++) {
      const rs = e.field.map((p) => ({ p, r: p.rounds.find((r) => r.n === n && r.holes === 18) })).filter((x) => x.r);
      if (rs.length < 10) continue;
      const avg = rs.reduce((a, x) => a + x.r.strokes, 0) / rs.length;
      for (const { p, r } of rs) { const s = sum.get(p.id) || { n: 0, d: 0, name: p.name }; s.n++; s.d += avg - r.strokes; sum.set(p.id, s); }
    }
  }
  return sum;
}

// Win / top-5 / top-10 / top-20 chances for every player still in the event.
export function golfChances(event, form = new Map(), { sims = SIMS, seed = 11, shrink = 6 } = {}) {
  const totalRounds = 4;
  // This week's completed rounds count toward strength too.
  const week = golfForm([event]);
  const maxRounds = Math.max(0, ...event.field.map((p) => p.rounds.length));
  // Out: a player with two or more fewer rounds than the leaders after the cut (round 3 on).
  const alive = event.field.filter((p) => !(maxRounds >= 3 && p.rounds.length <= maxRounds - 2));
  const players = alive.map((p) => {
    const f = form.get(p.id), w = week.get(p.id);
    const n = (f?.n || 0) + (w?.n || 0), d = (f?.d || 0) + (w?.d || 0);
    const strength = n ? d / (n + shrink) : 0; // strokes per round better than the field
    const played = p.rounds.reduce((a, r) => a + r.holes, 0);
    const left = Math.max(0, totalRounds * 18 - played);
    return { ...p, strength, formRounds: f?.n || 0, now: p.toPar ?? 0, left };
  });
  if (!players.length) return [];
  const u = rng(seed);
  const tally = players.map(() => ({ win: 0, t5: 0, t10: 0, t20: 0 }));
  const fin = new Float64Array(players.length);
  const idx = players.map((_, i) => i);
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < players.length; i++) {
      const p = players[i], r = p.left / 18;
      fin[i] = p.now + (r ? -p.strength * r + gauss(u) * SD_ROUND * Math.sqrt(r) : 0) + u() * 1e-6;
    }
    idx.sort((a, b) => fin[a] - fin[b]);
    tally[idx[0]].win++;
    for (let k = 0; k < Math.min(20, idx.length); k++) { const t = tally[idx[k]]; if (k < 5) t.t5++; if (k < 10) t.t10++; t.t20++; }
  }
  return players.map((p, i) => ({ id: p.id, name: p.name, country: p.country, pos: p.pos, toPar: p.toPar, rounds: p.rounds.map((r) => r.strokes), left: p.left, strength: +p.strength.toFixed(2), formRounds: p.formRounds,
    win: tally[i].win / sims, top5: tally[i].t5 / sims, top10: tally[i].t10 / sims, top20: tally[i].t20 / sims }))
    .sort((a, b) => b.win - a.win || (a.toPar ?? 99) - (b.toPar ?? 99));
}

// ---------- racing ----------
const statOf = (entry, ...names) => {
  for (const s of entry?.stats || []) {
    const k = String(s.name || s.abbreviation || s.type || '').toLowerCase();
    if (names.includes(k)) { const v = Number(s.value ?? s.displayValue); if (Number.isFinite(v)) return v; }
  }
  return null;
};
// ESPN racing standings → [{ id, name, pos, points, starts, wins, top5, top10 }].
export function parseStandings(j) {
  const entries = j?.children?.[0]?.standings?.entries || j?.standings?.entries || [];
  return entries.map((e, i) => ({
    id: String(e.athlete?.id || e.team?.id || i), name: e.athlete?.displayName || e.athlete?.fullName || e.team?.displayName || '?',
    pos: statOf(e, 'rank', 'position') ?? i + 1, points: statOf(e, 'points', 'championshippts', 'pts'),
    starts: statOf(e, 'starts', 'races', 'events'), wins: statOf(e, 'wins', 'w'), top5: statOf(e, 'top5', 'top5s', 'top5finishes'), top10: statOf(e, 'top10', 'top10s', 'top10finishes'),
  }));
}

// Strength from the season so far; chances from simulated finishing orders.
export function raceChances(drivers, { sims = SIMS, seed = 5, field = 40 } = {}) {
  const maxPts = Math.max(1, ...drivers.map((d) => d.points || 0));
  const list = drivers.slice(0, field).map((d) => {
    const st = Math.max(1, d.starts || 0);
    const rate = d.starts ? ((d.wins || 0) * 3 + (d.top5 || 0) * 1.2 + (d.top10 || 0) * 0.5 + 0.5) / (st + 4) : 0;
    const pts = (d.points || 0) / maxPts;
    return { ...d, w: Math.exp(2.2 * pts + 1.6 * rate) };
  });
  if (!list.length) return [];
  const u = rng(seed);
  const tally = list.map(() => ({ win: 0, t3: 0, t5: 0, t10: 0 }));
  for (let s = 0; s < sims; s++) {
    // Plackett-Luce via exponential race times: time = -ln(U) / weight, order by time.
    const order = list.map((d, i) => [i, -Math.log(Math.max(1e-12, u())) / d.w]).sort((a, b) => a[1] - b[1]);
    for (let k = 0; k < Math.min(10, order.length); k++) { const t = tally[order[k][0]]; if (k === 0) t.win++; if (k < 3) t.t3++; if (k < 5) t.t5++; t.t10++; }
  }
  return list.map((d, i) => ({ id: d.id, name: d.name, pos: d.pos, points: d.points, starts: d.starts, wins: d.wins, top5: d.top5, top10: d.top10,
    win: tally[i].win / sims, podium: tally[i].t3 / sims, top5p: tally[i].t5 / sims, top10p: tally[i].t10 / sims })).sort((a, b) => b.win - a.win);
}

// Last race's finishing order from an ESPN racing scoreboard event.
export function raceResult(ev) {
  const c = ev?.competitions?.[0];
  if (!c || c.status?.type?.state !== 'post') return null;
  const top = [...(c.competitors || [])].sort((a, b) => (a.order || 99) - (b.order || 99)).slice(0, 5).map((x) => x.athlete?.displayName || '?');
  return top.length ? { name: ev.name, date: Date.parse(ev.date), top } : null;
}
