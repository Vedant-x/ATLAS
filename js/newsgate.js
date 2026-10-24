// NBA news gate. In the settled record, NBA game picks made hours before tip-off whose price then
// drifted (19 of 34 with a known closing price) won 32% against the 67% their price implied: late
// injury and rest news moved the price after the pick. Picks still come early (visitors in Asia
// bet the evening before, 6+ hours ahead; teams file the injury report by 5 pm the day before), but
// no NBA pick (game line, prop or slip leg) is made while a key player's status is unresolved
// (newsPending, set by the build from the league's official injury report and ESPN's). The drift guard (movement.js) drops a
// pick whose price moves against it before the bet.
export const newsHold = (e) => e?.leaguePath === 'basketball/nba' && !e.live && (e.newsPending?.length || 0) > 0;

// The build's side: a key player (one of a team's season leaders) listed as questionable, doubtful,
// day-to-day or a game-time decision leaves the game waiting on news. Returns the names.
const PENDING = /^(questionable|doubtful|day-to-day|game[- ]time|gtd)/i;
export function pendingNews(injuries, leaderIds) {
  const out = [];
  for (const side of ['home', 'away']) for (const x of injuries?.[side] || []) if (PENDING.test(x.status || '') && leaderIds.has(String(x.id))) out.push(x.name);
  return out;
}
