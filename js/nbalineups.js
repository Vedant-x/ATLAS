// The NBA's own starting lineups: the daily lineups feed behind nba.com's "Today's Lineups"
// (stats.nba.com). Each team's five starters with their positions, "Expected" (the league's
// projection) until the team confirms them shortly before tip-off, and each player's roster status.
// Games are listed by US Eastern date; tomorrow's file appears during the day. Pure, for tests.
import { TEAMS } from './nbainjury.js';

export const LINEUPS_URL = (ymd) => `https://stats.nba.com/js/data/leaders/00_daily_lineups_${String(ymd).replace(/-/g, '')}.json`;
export const LINEUP_HEADERS = { Referer: 'https://www.nba.com/', Origin: 'https://www.nba.com' };

const side = (t) => {
  const players = (t?.players || []).map((p) => ({ id: p.personId != null ? String(p.personId) : null, name: p.playerName || `${p.firstName || ''} ${p.lastName || ''}`.trim(), pos: p.position || '', confirmed: /^confirmed$/i.test(p.lineupStatus || ''), active: !/^inactive$/i.test(p.rosterStatus || '') }))
    .filter((p) => p.name);
  return { abbr: t?.teamAbbreviation || null, team: TEAMS[t?.teamAbbreviation] || null, players, confirmed: players.length >= 5 && players.every((p) => p.confirmed) };
};

// The feed's games: [{ gameId, home: { abbr, team, players, confirmed }, away: {…} }].
export const parseLineups = (j) => (j?.games || []).map((g) => ({ gameId: g.gameId, home: side(g.homeTeam), away: side(g.awayTeam) })).filter((g) => g.home.team && g.away.team);

const norm = (s) => String(s || '').toLowerCase().replace(/^los angeles clippers$/, 'la clippers').replace(/[^a-z0-9]/g, '');
// Onto the board's NBA games (by the two teams, either way round, within a day): e.nbaLineups =
// { home, away, at } (players, confirmed). Returns how many games gained them.
export function applyLineups(events, games, { at = Date.now(), now = Date.now() } = {}) {
  let n = 0;
  for (const e of events) {
    if (e.leaguePath !== 'basketball/nba' || e.final || !(e.start > now - 4 * 36e5) || e.start > now + 36 * 36e5) continue;
    const g = games.find((x) => norm(x.home.team) === norm(e.home) && norm(x.away.team) === norm(e.away)) || games.find((x) => norm(x.home.team) === norm(e.away) && norm(x.away.team) === norm(e.home));
    if (!g) continue;
    const same = norm(g.home.team) === norm(e.home);
    e.nbaLineups = { home: same ? g.home : g.away, away: same ? g.away : g.home, at };
    n++;
  }
  return n;
}
