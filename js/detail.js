// Match detail: ESPN summary + player overviews, normalised into the sections the dossier renders.
import { fetchSummary, fetchAthlete } from './espn.js';
import { absencesFor } from './fotmob.js';

const cache = new Map();
export const detailFor = (id) => cache.get(id);

const num = (v) => (v == null || v === '' ? null : Number(v));

function sideOf(teamId, header) {
  const c = header?.competitions?.[0]?.competitors?.find((x) => String(x.team?.id ?? x.id) === String(teamId));
  return c?.homeAway || null;
}

function teamStats(box, header) {
  const teams = box?.teams || [];
  const sides = {};
  for (const t of teams) sides[t.homeAway || sideOf(t.team?.id, header)] = t.statistics || [];
  const groups = new Map();
  const add = (group, s, side) => {
    if (!groups.has(group)) groups.set(group, new Map());
    const key = s.name || s.abbreviation || s.label;
    const row = groups.get(group).get(key) || { label: s.displayName || s.label || s.abbreviation || key, abbr: s.abbreviation || '' };
    row[side] = s.displayValue ?? s.value;
    if (s.rankDisplayValue) row[`${side}Rank`] = s.rankDisplayValue;
    groups.get(group).set(key, row);
  };
  for (const side of ['home', 'away']) {
    for (const s of sides[side] || []) {
      if (Array.isArray(s.stats)) s.stats.forEach((x) => add(s.displayName || s.name, x, side)); // grouped (baseball)
      else add('Team', s, side);
    }
  }
  return [...groups.entries()].map(([group, rows]) => ({ group, rows: [...rows.values()].filter((r) => r.home != null || r.away != null) })).filter((g) => g.rows.length);
}

function injuries(list, header) {
  const out = { home: [], away: [] };
  for (const t of list || []) {
    const side = sideOf(t.team?.id, header);
    if (!side) continue;
    out[side] = (t.injuries || []).map((x) => ({
      name: x.athlete?.displayName || '', pos: x.athlete?.position?.abbreviation || '',
      status: x.status || x.type?.description || '', type: x.details?.type || '', detail: x.details?.detail && x.details.detail !== 'Not Specified' ? x.details.detail : '',
      side: x.details?.side && x.details.side !== 'Not Specified' ? x.details.side : '', returnDate: x.details?.returnDate || null, date: x.date || null,
    }));
  }
  return out;
}

function leaders(list, header) {
  const out = { home: [], away: [] };
  for (const t of list || []) {
    const side = sideOf(t.team?.id, header);
    if (!side) continue;
    out[side] = (t.leaders || []).map((c) => {
      const l = c.leaders?.[0];
      return l ? { cat: c.displayName || c.name, name: l.athlete?.displayName || '', pos: l.athlete?.position?.abbreviation || '', value: l.displayValue || l.summary || '' } : null;
    }).filter(Boolean);
  }
  return out;
}

function lastFive(list, header) {
  const out = { home: [], away: [] };
  for (const t of list || []) {
    const side = sideOf(t.team?.id, header);
    if (!side) continue;
    out[side] = (t.events || []).map((g) => ({ date: g.gameDate, atVs: g.atVs, opp: g.opponent?.displayName || g.opponent?.abbreviation || '', score: g.score, result: g.gameResult, comp: g.leagueAbbreviation || g.competitionName || '' }));
  }
  return out;
}

function series(list) {
  return (list || []).map((s) => ({
    title: s.title || s.seriesLabel || 'Head to head', summary: s.summary || s.seriesScore || '',
    games: (s.events || []).map((g) => {
      const cs = g.competitors || [];
      const h = cs.find((c) => c.homeAway === 'home'), a = cs.find((c) => c.homeAway === 'away');
      return { date: g.date, home: h?.team?.displayName || '', away: a?.team?.displayName || '', hs: h?.score, as: a?.score, state: g.statusType?.state || g.status, winner: h?.winner ? 'home' : a?.winner ? 'away' : null };
    }),
  })).filter((s) => s.games.length || s.summary);
}

function standings(st, header) {
  const ids = (header?.competitions?.[0]?.competitors || []).map((c) => String(c.team?.id ?? c.id));
  const groups = (st?.groups || []).map((g) => ({
    name: g.header || st.header || '',
    entries: (g.standings?.entries || []).map((en) => ({
      team: en.team, id: String(en.id), ours: ids.includes(String(en.id)),
      stats: Object.fromEntries((en.stats || []).map((s) => [s.abbreviation || s.shortDisplayName || s.name, s.displayValue ?? s.summary])),
    })),
  }));
  const relevant = groups.filter((g) => g.entries.some((e) => e.ours));
  return relevant.length ? relevant : groups.slice(0, 1);
}

function goalies(g) {
  if (!g) return null;
  const conv = (t) => (t?.athletes || []).map((a) => ({ name: a.displayName, stats: Object.fromEntries((a.statistics || []).map((s) => [s.abbreviation, s.displayValue])) }));
  return { home: conv(g.homeTeam), away: conv(g.awayTeam) };
}

function lineups(rosters) {
  const out = {};
  for (const r of rosters || []) {
    const starters = (r.roster || []).filter((p) => p.starter);
    if (!starters.length) continue;
    out[r.homeAway] = { formation: r.formation || null, players: starters.map((p) => ({ name: p.athlete?.displayName || '', pos: p.position?.abbreviation || '', jersey: p.jersey || '' })) };
  }
  return Object.keys(out).length ? out : null;
}

// ESPN athlete overview → { title, season: [{label, value}], career, log: [{date, opp, result, cells}] , labels, note }
function athlete(ov) {
  if (!ov) return null;
  const st = ov.statistics;
  const split = (n) => st?.splits?.find((s) => new RegExp(n, 'i').test(s.displayName));
  const line = (s) => (s ? st.labels.map((l, i) => ({ label: l, value: s.stats[i] })) : null);
  const g = ov.gameLog?.statistics?.[0];
  const log = (g?.events || []).slice(0, 5).map((ev) => {
    const meta = ov.gameLog.events?.[ev.eventId] || {};
    return { date: meta.gameDate, opp: `${meta.atVs || ''} ${meta.opponent?.abbreviation || meta.opponent?.displayName || ''}`.trim(), result: `${meta.gameResult || ''} ${meta.score || ''}`.trim(), cells: ev.stats };
  });
  const note = ov.rotowire?.headline || ov.news?.[0]?.headline || null;
  return { title: st?.displayName || 'Stats', season: line(split('regular|season') || st?.splits?.[0]), career: line(split('career')), labels: g?.labels || [], log, note };
}

export async function loadDetail(e) {
  if (cache.has(e.id)) return cache.get(e.id);
  try { return await build(e); } catch (err) {
    // Cache the failure so the page shows a message instead of refetching forever.
    const d = { ok: false, error: String(err?.message || err) };
    cache.set(e.id, d);
    return d;
  }
}

async function build(e) {
  if (!e.leaguePath || e.leaguePath.startsWith('atlas/')) {
    const d = { ok: true, native: true };
    cache.set(e.id, d);
    return d;
  }
  const sm = await fetchSummary(e);
  const header = sm.header;
  const pred = sm.predictor;
  const predictor = pred ? {
    home: num(pred.homeTeam?.gameProjection) / 100, away: num(pred.awayTeam?.gameProjection) / 100,
  } : null;
  const pc = (sm.pickcenter || [])[0];
  const d = {
    ok: true,
    predictor: predictor && Number.isFinite(predictor.home) ? predictor : null,
    venue: sm.gameInfo?.venue ? { name: sm.gameInfo.venue.fullName, city: [sm.gameInfo.venue.address?.city, sm.gameInfo.venue.address?.state || sm.gameInfo.venue.address?.country].filter(Boolean).join(', '), grass: sm.gameInfo.venue.grass, indoor: sm.gameInfo.venue.indoor } : null,
    weather: sm.gameInfo?.weather ? { temp: sm.gameInfo.weather.temperature, high: sm.gameInfo.weather.highTemperature, gust: sm.gameInfo.weather.gust, precip: sm.gameInfo.weather.precipitation, cond: sm.gameInfo.weather.displayValue || null } : null,
    officials: (sm.gameInfo?.officials || []).map((o) => `${o.displayName} (${o.position?.displayName || ''})`).slice(0, 4),
    injuries: injuries(sm.injuries, header),
    // ESPN only reports injuries for some sports; for the rest an empty list means "no data", not "no injuries".
    injuryFeed: (sm.injuries || []).some((t) => t.injuries?.length) ? 'ESPN' : null,
    absences: e.absences || null,
    teamStats: teamStats(sm.boxscore, header),
    leaders: leaders(sm.leaders, header),
    last5: lastFive(sm.lastFiveGames, header),
    series: series(sm.seasonseries),
    standings: sm.standings ? standings(sm.standings, header) : [],
    goalies: goalies(sm.goalies),
    lineups: lineups(sm.rosters),
    ats: (sm.againstTheSpread || []).map((t) => ({ side: sideOf(t.team?.id, header), records: (t.records || []).map((r) => `${r.description || r.type}: ${r.summary}`) })).filter((t) => t.side),
    line: pc ? { provider: pc.provider?.name, details: pc.details, spread: pc.spread, total: pc.overUnder } : null,
    news: (sm.news?.articles || []).slice(0, 4).map((a) => ({ headline: a.headline, desc: a.description, url: a.links?.web?.href })),
    probables: [],
  };
  // Soccer: who is out comes from FotMob (snapshot first, live lookup otherwise).
  if (e.leaguePath?.startsWith('soccer/') && !d.absences) d.absences = await absencesFor(e, AbortSignal.timeout(12000)).catch(() => null);
  // Season / career / recent-game lines for every probable starter (pitchers, goalies).
  d.probables = await Promise.all((e.probables || []).filter((p) => p.id).map(async (p) => {
    try { return { ...p, profile: athlete(await fetchAthlete(e.leaguePath, p.id)) }; } catch { return { ...p, profile: null }; }
  }));
  cache.set(e.id, d);
  return d;
}
