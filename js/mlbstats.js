// MLB starting pitchers from the official MLB Stats API (statsapi.mlb.com: free, no key, CORS open).
// Builds the same "starter report" shape the NPB/KBO scrapers produce, so one card renders all three.
const API = 'https://statsapi.mlb.com/api/v1';
const json = async (path, signal) => {
  const r = await fetch(`${API}${path}`, { signal });
  if (!r.ok) throw new Error(`MLB ${r.status}`);
  return r.json();
};
const n = (v) => (v == null || v === '' || /^[-.]+$/.test(String(v)) ? null : Number(v));
const outsOf = (ip) => { const [w, f = '0'] = String(ip ?? '0').split('.'); return Number(w) * 3 + Number(f); };

// One pitching line in the shared shape (strings kept as the source prints them).
export function line(s = {}) {
  const outs = s.outs ?? outsOf(s.inningsPitched);
  const per9 = (x) => (outs ? ((Number(x) * 27) / outs).toFixed(2) : null);
  return {
    g: s.gamesPitched ?? s.gamesPlayed ?? null, gs: s.gamesStarted ?? null, w: s.wins ?? null, l: s.losses ?? null, sv: s.saves ?? null,
    ip: s.inningsPitched ?? null, h: s.hits ?? null, r: s.runs ?? null, er: s.earnedRuns ?? null, hr: s.homeRuns ?? null,
    bb: s.baseOnBalls ?? null, so: s.strikeOuts ?? null, era: s.era ?? null, whip: s.whip ?? null,
    k9: s.strikeoutsPer9Inn ?? per9(s.strikeOuts), bb9: s.walksPer9Inn ?? per9(s.baseOnBalls), hr9: s.homeRunsPer9 ?? per9(s.homeRuns),
    kbb: s.strikeoutWalkRatio && !/-/.test(s.strikeoutWalkRatio) ? s.strikeoutWalkRatio : null,
    avg: s.avg ?? null, ops: s.ops ?? null, pitches: s.numberOfPitches ?? null,
    ppStart: s.gamesStarted && s.numberOfPitches ? Math.round(s.numberOfPitches / s.gamesStarted) : null,
    gbfb: s.groundOutsToAirouts ?? null,
  };
}

// ERA/WHIP/K9 over a set of game lines (used for last-3 / last-5 form).
export function formOf(games) {
  const t = games.reduce((a, g) => ({ outs: a.outs + outsOf(g.ip), er: a.er + (n(g.er) || 0), h: a.h + (n(g.h) || 0), bb: a.bb + (n(g.bb) || 0), so: a.so + (n(g.so) || 0) }), { outs: 0, er: 0, h: 0, bb: 0, so: 0 });
  if (!t.outs) return null;
  return { games: games.length, ip: `${Math.floor(t.outs / 3)}.${t.outs % 3}`, era: ((t.er * 27) / t.outs).toFixed(2), whip: (((t.h + t.bb) * 3) / t.outs).toFixed(2), k9: ((t.so * 27) / t.outs).toFixed(2) };
}

const daysSince = (date, now = Date.now()) => (date ? Math.floor((now - Date.parse(`${date}T12:00:00Z`)) / 864e5) : null);

// Schedule with probable pitchers for a date range (YYYY-MM-DD).
export async function mlbSchedule(from, to, signal) {
  const j = await json(`/schedule?sportId=1&startDate=${from}&endDate=${to}&hydrate=probablePitcher`, signal);
  return (j.dates || []).flatMap((d) => d.games).map((g) => ({
    pk: g.gamePk, start: Date.parse(g.gameDate), type: g.gameType, desc: g.seriesDescription || '',
    home: { id: g.teams.home.team.id, name: g.teams.home.team.name, pitcher: g.teams.home.probablePitcher || null },
    away: { id: g.teams.away.team.id, name: g.teams.away.team.name, pitcher: g.teams.away.probablePitcher || null },
  }));
}

// Everything worth knowing about one starter before a game against `oppId`.
export async function pitcherReport(id, { oppId, oppName, season = new Date().getFullYear(), signal } = {}) {
  const safe = (p) => p.catch(() => null);
  const [ppl, main, post, vs, tx] = await Promise.all([
    safe(json(`/people/${id}`, signal)),
    safe(json(`/people/${id}/stats?stats=season,career,gameLog,statSplits,yearByYear&group=pitching&season=${season}&sitCodes=h,a,vl,vr`, signal)),
    safe(json(`/people/${id}/stats?stats=season,gameLog&group=pitching&season=${season}&gameType=P`, signal)),
    oppId ? safe(json(`/people/${id}/stats?stats=vsTeamTotal&group=pitching&opposingTeamId=${oppId}`, signal)) : null,
    safe(json(`/transactions?playerId=${id}&startDate=${season - 2}-01-01&endDate=${season}-12-31`, signal)),
  ]);
  const p = ppl?.people?.[0] || {};
  const of = (j, type) => j?.stats?.find((s) => s.type?.displayName === type)?.splits || [];
  const seasonS = of(main, 'season')[0]?.stat, careerS = of(main, 'career')[0]?.stat, postS = of(post, 'season')[0]?.stat;
  const logs = [...of(main, 'gameLog'), ...of(post, 'gameLog')].map((g) => ({
    date: g.date, opp: g.opponent?.name || '', ha: g.isHome ? 'vs' : '@', post: g.gameType && g.gameType !== 'R',
    start: Boolean(g.stat?.gamesStarted), result: g.stat?.wins ? 'W' : g.stat?.losses ? 'L' : g.stat?.saves ? 'SV' : '',
    ip: g.stat?.inningsPitched, h: g.stat?.hits, er: g.stat?.earnedRuns, bb: g.stat?.baseOnBalls, so: g.stat?.strikeOuts, hr: g.stat?.homeRuns, pitches: g.stat?.numberOfPitches,
  })).sort((a, b) => b.date.localeCompare(a.date));
  const starts = logs.filter((g) => g.start);
  const recent = (starts.length >= 3 ? starts : logs).slice(0, 6);
  const split = (code) => of(main, 'statSplits').find((s) => s.split?.code === code)?.stat;
  const splits = [['h', 'Home'], ['a', 'Away'], ['vl', 'vs LHB'], ['vr', 'vs RHB']].map(([c, label]) => { const s = split(c); return s ? { label, ip: s.inningsPitched, era: s.era, whip: s.whip, avg: s.avg, ops: s.ops, so: s.strikeOuts, bb: s.baseOnBalls } : null; }).filter(Boolean);
  const vsS = vs?.stats?.[0]?.splits?.[0]?.stat;
  const years = of(main, 'yearByYear').filter((y) => y.sport?.id === 1 || !y.sport).slice(-5).reverse().map((y) => ({ year: y.season, team: y.team?.name || '', ...line(y.stat) }));
  const injuries = (tx?.transactions || []).filter((t) => /injured list|rehab|disabled list/i.test(`${t.typeDesc} ${t.description}`))
    .slice(-6).reverse().map((t) => ({ date: t.date, text: t.description }));
  return {
    league: 'MLB', id, name: p.fullName || '', team: p.currentTeam?.name || '',
    throws: p.pitchHand?.code || null, age: p.currentAge ?? null, height: p.height || null, weight: p.weight ? `${p.weight} lb` : null,
    born: p.birthDate || null, debut: p.mlbDebutDate || null,
    season: seasonS ? { label: `${season} regular season`, ...line(seasonS) } : null,
    post: postS ? { label: `${season} postseason`, ...line(postS) } : null,
    career: careerS ? { label: 'Career (MLB)', ...line(careerS) } : null,
    years, recent, splits,
    form3: formOf(starts.slice(0, 3)), form5: formOf(starts.slice(0, 5)),
    rest: daysSince(logs[0]?.date), lastDate: logs[0]?.date || null,
    vsOpp: vsS ? { opp: oppName || '', g: vsS.gamesPlayed, pa: vsS.plateAppearances, avg: vsS.avg, ops: vsS.ops, hr: vsS.homeRuns, so: vsS.strikeOuts, bb: vsS.baseOnBalls } : null,
    injuries,
    source: `https://www.mlb.com/player/${id}`, sourceLabel: 'MLB.com profile',
  };
}

// Attach MLB Stats API starter reports to ESPN MLB events (matched by kickoff ±12h and team names).
export async function enrichMlb(events, { signal, schedule } = {}) {
  const mlb = events.filter((e) => e.leaguePath === 'baseball/mlb' && !e.live);
  if (!mlb.length) return 0;
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const from = day(Math.min(...mlb.map((e) => e.start)) - 864e5), to = day(Math.max(...mlb.map((e) => e.start)) + 864e5);
  const games = schedule || await mlbSchedule(from, to, signal);
  let n = 0;
  for (const e of mlb) {
    const g = games.find((x) => Math.abs(x.start - e.start) < 12 * 36e5 && x.home.name === e.home && x.away.name === e.away);
    if (!g) continue;
    e.mlbGamePk = g.pk;
    if (g.desc) e.note = e.note || g.desc;
    const reps = await Promise.all(['home', 'away'].map(async (side) => {
      const pp = g[side].pitcher;
      if (!pp) return null;
      const other = g[side === 'home' ? 'away' : 'home'];
      const report = await pitcherReport(pp.id, { oppId: other.id, oppName: other.name, signal }).catch(() => null);
      return report && { side, name: report.name || pp.fullName, role: 'SP', report };
    }));
    const got = reps.filter(Boolean);
    if (got.length) { e.probables = [...got, ...(e.probables || []).filter((p) => !got.some((r) => r.side === p.side))]; n += got.length; }
  }
  return n;
}
