// European leagues from their own public feeds (the ones their websites use):
//   EuroLeague and EuroCup basketball (api-live.euroleague.net): the whole season's schedule and
//     results; records and last-five form are counted from the games played. No prices.
//   Liiga, Finland's top hockey league (liiga.fi): the season's games with Veikkaus 1X2 prices
//     (regulation time), each team's table position and records counted from the results.
// Pure parsers, so they can be tested; the build (scripts/pages.mjs) fetches.

export const EUROLEAGUE = (comp, season) => `https://api-live.euroleague.net/v2/competitions/${comp}/seasons/${comp}${season}/games`;
export const LIIGA = (season) => `https://liiga.fi/api/v2/games?tournament=runkosarja&season=${season}`;

// The season code: a season starting in the autumn of year Y is "Y" for EuroLeague and "Y+1" for Liiga.
export const euroSeason = (now = Date.now()) => { const d = new Date(now); return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; };

const formPush = (r, res) => { r.form.push(res); if (r.form.length > 5) r.form.shift(); };
const recText = (r) => (r ? (r.d ? `${r.w}-${r.d}-${r.l}` : `${r.w}-${r.l}`) : null);

// ---------- EuroLeague / EuroCup ----------
const clubName = (side) => side?.club?.name || side?.club?.editorialName || side?.club?.abbreviatedName || side?.name || null;
const clubKey = (side) => side?.club?.code || clubName(side);
export function euroRecords(games) {
  const rec = {};
  for (const g of [...games].filter((x) => x.played && Number.isFinite(x.local?.score) && Number.isFinite(x.road?.score)).sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate))) {
    const h = g.local.score, a = g.road.score;
    if (h === a) continue;
    for (const [k, won] of [[clubKey(g.local), h > a], [clubKey(g.road), a > h]]) {
      const r = (rec[k] ||= { w: 0, l: 0, d: 0, form: [] });
      if (won) r.w++; else r.l++;
      formPush(r, won ? 'W' : 'L');
    }
  }
  return rec;
}
export function euroEvent(g, { comp, league, path }, records = {}, now = Date.now()) {
  const home = clubName(g.local), away = clubName(g.road), start = Date.parse(g.utcDate || `${g.date}Z`);
  if (!home || !away || !Number.isFinite(start)) return null;
  const live = !g.played && start < now && start > now - 3 * 36e5 && /live|playing|progress/i.test(String(g.gameStatus || ''));
  return {
    id: `atlas_${comp.toLowerCase()}-${g.identifier || g.gameCode}`, sport: 'basketball', league, leaguePath: path, group: 'Europe',
    home, away, start, live, final: Boolean(g.played),
    score: (g.played || live) && Number.isFinite(g.local?.score) ? `${g.local.score} – ${g.road.score}` : null, clock: g.played ? 'Final' : '',
    venue: g.venue?.name || null, neutral: Boolean(g.isNeutralVenue), markets: [], lineups: null, probables: [],
    stats: { homeRecord: recText(records[clubKey(g.local)]), awayRecord: recText(records[clubKey(g.road)]), homeForm: records[clubKey(g.local)]?.form || null, awayForm: records[clubKey(g.road)]?.form || null },
    logos: { home: g.local?.club?.images?.crest || null, away: g.road?.club?.images?.crest || null },
    note: g.roundName || g.roundAlias || null, source: league, fetchedAt: now,
    sourceUrl: comp === 'E' ? 'https://www.euroleaguebasketball.net/euroleague/game-center/' : 'https://www.euroleaguebasketball.net/eurocup/game-center/',
  };
}

// ---------- Liiga ----------
const odd = (x) => (Number(x) > 100 ? +(Number(x) / 100).toFixed(2) : null); // Veikkaus prices in hundredths
export function liigaRecords(games) {
  const rec = {};
  for (const g of [...games].filter((x) => x.ended).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const h = g.homeTeam?.goals, a = g.awayTeam?.goals;
    if (!Number.isFinite(h) || !Number.isFinite(a)) continue;
    const reg = /REGULAR/i.test(g.finishedType || '');
    for (const [t, won] of [[g.homeTeam.teamName, h > a], [g.awayTeam.teamName, a > h]]) {
      const r = (rec[t] ||= { w: 0, l: 0, d: 0, otl: 0, form: [] });
      if (won) r.w++; else if (reg) r.l++; else r.otl++;
      formPush(r, won ? 'W' : 'L');
    }
  }
  return rec;
}
export function liigaEvent(g, records = {}, now = Date.now()) {
  const home = g.homeTeam?.teamName, away = g.awayTeam?.teamName, start = Date.parse(g.start);
  if (!home || !away || !Number.isFinite(start) || g.ended) return null;
  const live = Boolean(g.started && !g.ended);
  const ge = g.gamblingEvent || {};
  const h = odd(ge.homeTeamOdds), d = odd(ge.tieOdds), a = odd(ge.awayTeamOdds);
  const priced = !live && h && d && a && h < 30 && a < 30;
  const rec = (t) => { const r = records[t]; return r ? `${r.w}-${r.l}-${r.otl}` : null; };
  return {
    id: `atlas_liiga-${g.id}`, sport: 'hockey', league: 'Liiga', leaguePath: 'atlas/liiga', group: 'Europe',
    home, away, start, live, score: live ? `${g.homeTeam.goals ?? 0} – ${g.awayTeam.goals ?? 0}` : null,
    clock: live ? (g.currentPeriod ? `Period ${g.currentPeriod}` : 'Live') : '', period: live ? g.currentPeriod || null : null,
    venue: g.iceRink?.name || null, lineups: null, probables: [],
    // Regulation-time 1X2 from Veikkaus. Not entered in the official record (no compId): the record
    // grades from final scores including overtime.
    markets: priced ? [{ name: 'Match Result', outcomes: [{ name: home, odds: h }, { name: 'Draw', odds: d }, { name: away, odds: a }] }] : [],
    bookmaker: priced ? 'Veikkaus' : null,
    stats: { homeRecord: rec(home), awayRecord: rec(away), homeForm: records[home]?.form || null, awayForm: records[away]?.form || null, homeRank: g.homeTeam?.ranking || null, awayRank: g.awayTeam?.ranking || null },
    logos: { home: g.homeTeam?.logos?.darkBg || g.homeTeam?.logos?.lightBg || null, away: g.awayTeam?.logos?.darkBg || g.awayTeam?.logos?.lightBg || null },
    note: g.gameWeek ? `Round ${g.gameWeek}` : null, source: 'Liiga', fetchedAt: now, sourceUrl: `https://liiga.fi/fi/ottelut/${g.season}/runkosarja/${g.id}`,
  };
}
