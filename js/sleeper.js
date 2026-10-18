// NFL injury report from Sleeper's public player list (api.sleeper.app/v1/players/nfl, no key): each
// player's team, position and injury status (Out, Doubtful, Questionable, IR, PUP...). ESPN's NFL
// match feed carries no injury list, so this is the NFL's team news. The full list is about 5 MB and
// Sleeper asks for it at most about once a day, so the build keeps only the injured players
// (data/nfl-injuries.json) and refreshes it every few hours.
export const SLEEPER_NFL = 'https://api.sleeper.app/v1/players/nfl';

// ESPN's NFL team names → Sleeper's team codes.
export const NFL_TEAMS = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
};

// Only players with an injury status, grouped by team: { [team]: [{ name, pos, status, detail }] }.
export function injuredByTeam(players) {
  const out = {};
  for (const p of Object.values(players || {})) {
    if (!p?.team || !p.injury_status || p.active === false) continue;
    (out[p.team] ||= []).push({ name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' '), pos: p.position || '', status: p.injury_status, detail: p.injury_body_part || '' });
  }
  return out;
}

// The report onto NFL matches as their injury list (never over one already there). at: when the
// report was read, so readiness can tell its age. Returns how many matches got one.
export function applyNflInjuries(events, report) {
  if (!report?.teams || !report.at) return 0;
  let n = 0;
  for (const e of events) {
    if (e.leaguePath !== 'football/nfl' || e.injuries) continue;
    const h = NFL_TEAMS[e.home], a = NFL_TEAMS[e.away];
    if (!h || !a) continue;
    const list = (code) => (report.teams[code] || []).map((p) => ({ name: p.name, status: p.status, type: p.status, detail: [p.pos, p.detail].filter(Boolean).join(' · ') }));
    e.injuries = { home: list(h), away: list(a), at: report.at, source: 'Sleeper' };
    n++;
  }
  return n;
}
