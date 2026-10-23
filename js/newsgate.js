// NBA news gate. In the settled record, NBA game picks made hours before tip-off whose price then
// drifted (19 of 34 with a known closing price) won 32% against the 67% their price implied: late
// injury and rest news moved the price after the pick. So no NBA pick (game line, prop or slip leg)
// is made until NBA_LEAD before tip-off, when most of the day's injury report is out, nor while a
// key player's status is still unresolved (newsPending, set by the build from ESPN's injury report).
export const NBA_LEAD = 90 * 6e4;
export const newsHold = (e, now = Date.now()) => e?.leaguePath === 'basketball/nba' && !e.live
  && (e.start - now > NBA_LEAD || (e.newsPending?.length || 0) > 0);

// The build's side: a key player (one of a team's season leaders) listed as questionable, doubtful,
// day-to-day or a game-time decision leaves the game waiting on news. Returns the names.
const PENDING = /^(questionable|doubtful|day-to-day|game[- ]time|gtd)/i;
export function pendingNews(injuries, leaderIds) {
  const out = [];
  for (const side of ['home', 'away']) for (const x of injuries?.[side] || []) if (PENDING.test(x.status || '') && leaderIds.has(String(x.id))) out.push(x.name);
  return out;
}
