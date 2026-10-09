// Esports. CS2, Valorant, League of Legends and Dota 2 come from bo3.gg (fixtures, live map scores,
// team rankings and a bookmaker's prices); FIFA / EA FC eSoccer comes from EsportsBattle (8-minute
// player-vs-player matches, played round the clock). Neither site allows browser requests, so the
// build and the minute-by-minute live lane read them. Pure parsers, shared by both and tested.

export const BO3 = 'https://api.bo3.gg/api/v1';
export const ESB = 'https://football.esportsbattle.com/api';
export const BO3_GAMES = {
  1: { path: 'atlas/cs2', game: 'Counter-Strike 2', slug: 'cs2' },
  2: { path: 'atlas/valorant', game: 'Valorant', slug: 'valorant' },
  3: { path: 'atlas/lol', game: 'League of Legends', slug: 'lol' },
  4: { path: 'atlas/dota2', game: 'Dota 2', slug: 'dota2' },
};
export const LANE_PATHS = ['atlas/npb', 'atlas/kbo', 'atlas/khl', 'atlas/esoccer', ...Object.values(BO3_GAMES).map((g) => g.path)];

const MAP = (s) => String(s || '').replace(/^de_/, '').replace(/^\w/, (c) => c.toUpperCase());
const price = (x) => (Number(x) > 1.01 ? +Number(x).toFixed(3) : null);

// Map-by-map results oriented home/away, and the live line ("Map 2 · Mirage").
export function bo3Maps(m) {
  return [...(m.games || [])].sort((a, b) => a.number - b.number).map((g) => {
    const wid = g.winner_team_clan?.team_id ?? g.winner_team_clan?.team?.id;
    const homeWon = wid != null ? String(wid) === String(m.team1_id) : null;
    const done = g.status === 'finished';
    return {
      n: g.number, map: MAP(g.map_name) || null, status: done ? 'final' : g.status === 'current' ? 'live' : 'pre',
      winner: done && homeWon != null ? (homeWon ? 'home' : 'away') : null,
      score: done && g.winner_clan_score != null ? (homeWon ? `${g.winner_clan_score} – ${g.loser_clan_score}` : `${g.loser_clan_score} – ${g.winner_clan_score}`) : null,
    };
  });
}

function bo3Clock(m, maps) {
  const cur = maps.find((x) => x.status === 'live');
  if (cur) return `Map ${cur.n}${cur.map ? ` · ${cur.map}` : ''}`;
  return m.status === 'current' ? `Best of ${m.bo_type}` : '';
}

// The prices bo3.gg shows (a bookmaker's, margin included): series winner and total maps.
function bo3Markets(m, home, away) {
  const b = m.bet_updates;
  if (!b) return [];
  const out = [];
  const h = b.team_1?.active !== false && price(b.team_1?.coeff), a = b.team_2?.active !== false && price(b.team_2?.coeff);
  if (h && a) out.push({ name: 'Winner', outcomes: [{ name: home, odds: h }, { name: away, odds: a }] });
  const add = (k) => (b.additional_markets || []).find((x) => x.bet_type === k && x.active !== false);
  const ov = add('total_maps_over_2_5'), un = add('total_maps_under_2_5');
  if (m.bo_type === 3 && price(ov?.coeff) && price(un?.coeff)) out.push({ name: 'Total 2.5', outcomes: [{ name: 'Over 2.5', odds: price(ov.coeff) }, { name: 'Under 2.5', odds: price(un.coeff) }] });
  return out;
}

// bo3.gg match list → ATLAS events. Lower-tier matches are kept only when a bookmaker prices them.
export function parseBo3(results = [], now = Date.now()) {
  const out = [];
  for (const m of results) {
    const g = BO3_GAMES[m.discipline_id];
    const home = m.team1?.name, away = m.team2?.name;
    if (!g || !home || !away || m.status === 'finished' || m.status === 'canceled' || m.status === 'cancelled' || m.status === 'defwin') continue;
    const start = Date.parse(m.start_date);
    if (!Number.isFinite(start) || start > now + 4 * 864e5 || (m.status !== 'current' && start < now - 6 * 36e5)) continue;
    const tier = String(m.tier || m.tournament?.tier || '').toLowerCase();
    const markets = bo3Markets(m, home, away);
    if (!['s', 'a', 'b'].includes(tier) && !markets.length) continue;
    const live = m.status === 'current';
    const maps = bo3Maps(m);
    out.push({
      id: `esports-bo3-${m.id}`, compId: String(m.id), sport: 'esports', leaguePath: g.path, league: m.tournament?.name || g.game, group: g.game,
      home, away, start, neutral: true, live,
      score: live ? `${m.team1_score ?? 0} – ${m.team2_score ?? 0}` : null, clock: live ? bo3Clock(m, maps) : '', period: null,
      bestOf: m.bo_type || null, markets, bookmaker: markets.length ? 'Bookmaker price via bo3.gg' : null,
      stats: { homeRank: m.team1?.rank || null, awayRank: m.team2?.rank || null },
      esports: { game: g.game, tier: tier.toUpperCase() || null, maps, tournament: m.tournament?.name || null },
      probables: [], lineups: null, source: 'bo3.gg', sourceUrl: `https://bo3.gg/${g.slug}/matches/${m.slug}`, fetchedAt: now,
    });
  }
  return out;
}

// Live lane entry for a bo3.gg match (current or just finished).
export function bo3Live(m) {
  const maps = bo3Maps(m);
  const status = m.status === 'current' ? 'live' : m.status === 'finished' || m.status === 'defwin' ? 'final' : m.status === 'canceled' || m.status === 'cancelled' ? 'cancelled' : 'pre';
  return { id: `esports-bo3-${m.id}`, status, score: status === 'pre' ? null : `${m.team1_score ?? 0} – ${m.team2_score ?? 0}`, clock: status === 'live' ? bo3Clock(m, maps) : status === 'final' ? 'Final' : '', maps };
}

// ---------- eSoccer (EsportsBattle) ----------
// Match status: 1 scheduled, 2 in play, 3 finished.
const esbName = (p) => `${p.team?.token_international || p.team?.token || 'Team'} (${p.nickname})`;
const esbLeague = (t) => String(t?.token_international || t?.token || 'eSoccer').replace(/\s*\d{4}-\d{2}-\d{2}\s*$/, '');

// Player form from finished matches: games, W/D/L, goals for/against.
export function esbForm(matches = []) {
  const f = new Map();
  const add = (p, gf, ga) => {
    const r = f.get(p.nickname) || { g: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
    r.g++; r.gf += gf; r.ga += ga; if (gf > ga) r.w++; else if (gf < ga) r.l++; else r.d++;
    f.set(p.nickname, r);
  };
  for (const m of matches) {
    if (m.status_id !== 3) continue;
    const a = Number(m.participant1?.score), b = Number(m.participant2?.score);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    add(m.participant1, a, b); add(m.participant2, b, a);
  }
  return f;
}

export function parseEsb(tournaments = [], now = Date.now(), form = new Map()) {
  const out = [];
  for (const { tournament: t, matches } of tournaments) {
    for (const m of matches || []) {
      if (m.status_id === 3 || !m.participant1 || !m.participant2) continue;
      const start = Date.parse(m.date);
      if (!Number.isFinite(start) || start > now + 75 * 6e4 || (m.status_id !== 2 && start < now - 20 * 6e4)) continue; // matches run every few minutes: the next 75 are plenty
      const live = m.status_id === 2;
      const fh = form.get(m.participant1.nickname), fa = form.get(m.participant2.nickname);
      out.push({
        id: `esoccer-${m.id}`, compId: String(m.id), sport: 'efootball', leaguePath: 'atlas/esoccer', league: `eSoccer Battle · ${esbLeague(t)}`, group: 'eSoccer',
        home: esbName(m.participant1), away: esbName(m.participant2), start, neutral: true, live,
        score: live ? `${m.participant1.score ?? 0} – ${m.participant2.score ?? 0}` : null, clock: live ? 'In play' : '', period: null,
        markets: [], stats: { homePlayer: fh || null, awayPlayer: fa || null },
        esb: { tournamentId: t?.id, console: m.console?.token_international || null, home: m.participant1.nickname, away: m.participant2.nickname },
        probables: [], lineups: null, source: 'EsportsBattle', sourceUrl: 'https://football.esportsbattle.com/', fetchedAt: now,
      });
    }
  }
  return out;
}

export function esbLive(m) {
  const status = m.status_id === 2 ? 'live' : m.status_id === 3 ? 'final' : 'pre';
  const ht = m.participant1?.prevPeriodsScores?.[0] != null ? `HT ${m.participant1.prevPeriodsScores[0]} – ${m.participant2?.prevPeriodsScores?.[0] ?? 0}` : '';
  return { id: `esoccer-${m.id}`, status, score: status === 'pre' ? null : `${m.participant1?.score ?? 0} – ${m.participant2?.score ?? 0}`, clock: status === 'live' ? (ht ? `2nd half · ${ht}` : 'In play') : status === 'final' ? 'Final' : '' };
}
