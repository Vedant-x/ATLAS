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
    source: 'WTA', period: `${s.AggregateData?.TournamentYear || 'this'} season`, matches: s.MatchCount,
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

// ---------- The men's numbers ----------
// The ATP's own site and app refuse requests from servers, and ESPN keeps no per-match statistics
// for the tour, so the men's figures come from the last full season of ATP match data with serve
// statistics: TML-Database (github.com/Tennismylife/TML-Database, kept in Jeff Sackmann's format),
// whose 2026 file stops in January. Shown as the 2025 season, never as this season's form.
export const TML = (file) => `https://raw.githubusercontent.com/Tennismylife/TML-Database/master/${file}`;
export const TML_FILES = ['2025.csv', '2026.csv'];
// Every player with 5+ matches with statistics: name → figures (the same fields as wtaStats), and
// the tour's averages across all of them.
export function atpTable(csvs, { period = '2025 season (latest ATP match data)' } = {}) {
  const sum = {};
  const add = (name, me, opp) => {
    const s = (sum[name] ||= { m: 0, svpt: 0, in1: 0, won1: 0, won2: 0, gms: 0, bpS: 0, bpF: 0, ace: 0, df: 0, rpt: 0, rwon: 0, rgms: 0, brk: 0, bpC: 0, bpO: 0 });
    s.m++; s.svpt += me.svpt; s.in1 += me.in1; s.won1 += me.won1; s.won2 += me.won2; s.gms += me.gms; s.bpS += me.bpS; s.bpF += me.bpF; s.ace += me.ace; s.df += me.df;
    s.rpt += opp.svpt; s.rwon += opp.svpt - opp.won1 - opp.won2; s.rgms += opp.gms; s.brk += opp.bpF - opp.bpS; s.bpC += opp.bpF - opp.bpS; s.bpO += opp.bpF;
  };
  for (const csv of csvs) {
    const lines = String(csv || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) continue;
    const head = lines[0].split(',');
    const at = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
    const side = (c, p) => ({ svpt: +c[at[`${p}_svpt`]], in1: +c[at[`${p}_1stIn`]], won1: +c[at[`${p}_1stWon`]], won2: +c[at[`${p}_2ndWon`]], gms: +c[at[`${p}_SvGms`]], bpS: +c[at[`${p}_bpSaved`]], bpF: +c[at[`${p}_bpFaced`]], ace: +c[at[`${p}_ace`]], df: +c[at[`${p}_df`]] });
    for (const line of lines.slice(1)) {
      const c = line.split(',');
      const w = side(c, 'w'), l = side(c, 'l');
      if (!(w.svpt > 0 && l.svpt > 0 && w.gms > 0 && l.gms > 0) || [w, l].some((x) => Object.values(x).some((v) => !Number.isFinite(v)))) continue;
      add(nameKey(c[at.winner_name]), w, l);
      add(nameKey(c[at.loser_name]), l, w);
    }
  }
  const all = Object.values(sum);
  const tot = (k) => all.reduce((a, s) => a + s[k], 0);
  const tour = all.length ? { servePts: +((tot('won1') + tot('won2')) / tot('svpt')).toFixed(4), retPts: +(tot('rwon') / tot('rpt')).toFixed(4), held: +(1 - (tot('bpF') - tot('bpS')) / tot('gms')).toFixed(4), broke: +(tot('brk') / tot('rgms')).toFixed(4) } : null;
  const players = {};
  for (const [name, s] of Object.entries(sum)) {
    if (s.m < 5) continue;
    players[name] = { source: 'ATP match data (TML-Database)', period, matches: s.m, firstIn: ratio(s.in1, s.svpt), firstWon: ratio(s.won1, s.in1), secondWon: ratio(s.won2, s.svpt - s.in1),
      servePts: ratio(s.won1 + s.won2, s.svpt), held: +(1 - (s.bpF - s.bpS) / s.gms).toFixed(4), retPts: ratio(s.rwon, s.rpt), broke: ratio(s.brk, s.rgms),
      bpSaved: ratio(s.bpS, s.bpF), bpConv: ratio(s.bpC, s.bpO), aces: +(s.ace / s.m).toFixed(1), dfs: +(s.df / s.m).toFixed(1), tour };
  }
  return { players, tour, count: Object.keys(players).length };
}
