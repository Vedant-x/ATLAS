// Tennis serve and return numbers (review item 21). The women's come from the WTA's own API
// (api.wtatennis.com: each player's season figures and the tour's averages); the men's from
// Ultimate Tennis Statistics, whose tables are kept current from the ATP's match data. Per player:
// first serves in, points won behind the first and second serve, service games held, return points
// and return games won, break points saved and converted, aces and double faults per match.
// From two players' numbers, the chance each holds serve and wins the match (a point-by-point
// model: one's serve points won against the other's return, measured from the tour's average).
// Pure, for tests: the build fetches.

export const WTA = 'https://api.wtatennis.com/tennis';
export const WTA_RANKED = (page) => `${WTA}/players/ranked?page=${page}&pageSize=100&type=rankSingles&sort=asc&name=&metric=SINGLES`;
export const WTA_YEAR = (id, year) => `${WTA}/players/${id}/year/${year}`;

export const nameKey = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// The rankings pages: name → { id, rank }.
export function wtaIds(pages) {
  const m = new Map();
  for (const page of pages) for (const r of Array.isArray(page) ? page : []) if (r?.player?.id) m.set(nameKey(r.player.fullName || `${r.player.firstName} ${r.player.lastName}`), { id: String(r.player.id), rank: r.ranking ?? null });
  return m;
}

const pct = (x) => (Number.isFinite(Number(x)) && x !== null ? +(Number(x) / 100).toFixed(4) : null);
const ratio = (a, b) => (Number(b) > 0 ? +(Number(a) / Number(b)).toFixed(4) : null);
// One player's season from the WTA's year figures; tour: the tour's averages, for reference.
export function wtaStats(j) {
  const s = j?.stats;
  if (!s || !(s.MatchCount > 0)) return null;
  const servePts = Number(s.First_Serves_Played) + Number(s.Second_Serves_Played);
  const retPts = Number(s.First_Serve_Return_Chances) + Number(s.Second_Return_Chances);
  const a = s.AggregateData || {};
  return {
    source: 'WTA', matches: s.MatchCount,
    firstIn: pct(s.first_serve_percent), firstWon: pct(s.first_serve_won_percent), secondWon: pct(s.second_serve_won_percent),
    servePts: ratio(Number(s.First_Serves_Won) + Number(s.Second_Serves_Won), servePts), held: pct(s.service_games_won_percent),
    retPts: pct(s.return_points_won_percent) ?? ratio(Number(s.First_Return_Won) + Number(s.Second_Return_Won), retPts), broke: pct(s.return_games_won_percent),
    bpSaved: pct(s.breakpoint_saved_percent), bpConv: pct(s.breakpoint_converted_percent),
    aces: +(Number(s.Aces) / s.MatchCount).toFixed(1), dfs: +(Number(s.Double_Faults) / s.MatchCount).toFixed(1),
    tour: { servePts: pct(a.AverageServicePointsWonPercent), retPts: pct(a.AverageReturnPointsWonPercent), held: pct(a.AverageServiceGamesWonPercent), broke: pct(a.AverageReturnGamesWonPercent) },
  };
}

// ---------- The point-by-point model ----------
// A game on serve, won with point chance p.
export function holdChance(p) {
  const q = 1 - p;
  return p ** 4 * (1 + 4 * q + 10 * q * q) + (20 * p ** 3 * q ** 3 * p * p) / (1 - 2 * p * q);
}
// A tiebreak (first to 7, two clear), A serving first with point chances pa (A serving), pb (B serving).
function tiebreak(pa, pb) {
  const memo = new Map();
  const win = (a, b) => {
    if (a >= 7 && a - b >= 2) return 1;
    if (b >= 7 && b - a >= 2) return 0;
    if (a >= 6 && b >= 6 && a === b) { // from 6-6 on, two points at a time: one on each serve
      const w = pa * (1 - pb), l = (1 - pa) * pb;
      return w / (w + l);
    }
    const k = `${a},${b}`;
    if (memo.has(k)) return memo.get(k);
    const n = a + b, aServes = n % 4 === 0 || n % 4 === 3; // A, B, B, A, A, B, B …
    const p = aServes ? pa : 1 - pb;
    const v = p * win(a + 1, b) + (1 - p) * win(a, b + 1);
    memo.set(k, v);
    return v;
  };
  return win(0, 0);
}
// A set, A serving first: games alternate; 6-6 goes to a tiebreak.
function setChance(ha, hb, pa, pb) {
  const memo = new Map();
  const win = (a, b) => {
    if (a >= 6 && a - b >= 2) return 1;
    if (b >= 6 && b - a >= 2) return 0;
    if (a === 7) return 1;
    if (b === 7) return 0;
    if (a === 6 && b === 6) return tiebreak(pa, pb);
    const k = `${a},${b}`;
    if (memo.has(k)) return memo.get(k);
    const aServes = (a + b) % 2 === 0;
    const g = aServes ? ha : 1 - hb;
    const v = g * win(a + 1, b) + (1 - g) * win(a, b + 1);
    memo.set(k, v);
    return v;
  };
  return win(0, 0);
}
// Each player's point chance on serve: their serve points won, less how much better than the
// tour's the other returns. Then the hold chances, a set (either may serve first) and the match.
export function matchModel(A, B, { bestOf = 3 } = {}) {
  const tour = A?.tour?.retPts != null ? A.tour : B?.tour || {};
  if (A?.servePts == null || B?.servePts == null || A.retPts == null || B.retPts == null || tour.retPts == null) return null;
  const clamp = (x) => Math.min(0.85, Math.max(0.35, x));
  const pa = clamp(A.servePts - (B.retPts - tour.retPts)), pb = clamp(B.servePts - (A.retPts - tour.retPts));
  const ha = holdChance(pa), hb = holdChance(pb);
  const s = (setChance(ha, hb, pa, pb) + 1 - setChance(hb, ha, pb, pa)) / 2;
  const t = 1 - s;
  const match = bestOf === 5 ? s ** 3 * (1 + 3 * t + 6 * t * t) : s * s * (1 + 2 * t);
  return { pa: +pa.toFixed(3), pb: +pb.toFixed(3), holdA: +ha.toFixed(3), holdB: +hb.toFixed(3), set: +s.toFixed(3), match: +match.toFixed(3) };
}
