// NHL starting goalies from Daily Faceoff (dailyfaceoff.com/starting-goalies), the usual public
// source: for each game, each side's expected starter and how sure the report is (Confirmed, Likely,
// Unconfirmed). The goalie is the biggest single factor in a hockey game, and no other free feed
// says who starts. The page embeds its data as JSON (Next.js); any record in it with a home and an
// away goalie name is read, so a reshuffled page still reads, and an unreadable one gives nothing.
import { normClub } from './clubelo.js';

export const DF_GOALIES = 'https://www.dailyfaceoff.com/starting-goalies';

export function nextData(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''));
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}

// Every { home team, away team, home goalie, away goalie, statuses } record found in the data.
export function goalieGames(data) {
  const out = [];
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x.homeGoalieName && x.awayGoalieName && x.homeTeamName && x.awayTeamName) {
      out.push({ home: x.homeTeamName, away: x.awayTeamName, homeGoalie: x.homeGoalieName, awayGoalie: x.awayGoalieName,
        homeStatus: x.homeNewsStrengthName || x.homeGoalieStatus || null, awayStatus: x.awayNewsStrengthName || x.awayGoalieStatus || null, date: x.date || x.gameDate || null });
      return;
    }
    Object.values(x).forEach(walk);
  };
  walk(data);
  return out;
}

// Same team: the full names match, or one ends with the other's last word ("Maple Leafs" / "Toronto Maple Leafs").
const sameTeam = (a, b) => { const x = normClub(a), y = normClub(b); return x === y || x.endsWith(y) || y.endsWith(x) || x.split(' ').at(-1) === y.split(' ').at(-1); };

// Starters onto upcoming NHL matches. Returns how many got them.
export function applyGoalies(events, games, at = Date.now()) {
  let n = 0;
  for (const e of events) {
    if (e.leaguePath !== 'hockey/nhl' || e.live || !(e.start > at - 36e5)) continue;
    const g = games.find((x) => sameTeam(x.home, e.home) && sameTeam(x.away, e.away));
    if (!g) continue;
    e.goalies = { home: { name: g.homeGoalie, status: g.homeStatus }, away: { name: g.awayGoalie, status: g.awayStatus }, source: 'Daily Faceoff', at };
    n++;
  }
  return n;
}
export const confirmed = (s) => /confirm/i.test(s || '');
