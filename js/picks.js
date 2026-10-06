// How ATLAS turns probabilities into bets people can actually place.
//  - coherentBets: one to three picks for a match that all tell the same story (one side, one goals
//    direction), never hedges like "home wins" next to "away +1.5" or "over 3.5" next to "under 5.5".
//  - bankerSlips: accumulators built from many high-probability legs (bankers around 1.05-1.6) rather
//    than a few long shots. For a target T it picks the legs that give the most win chance per unit
//    of odds (maximise the product of probabilities for the product of odds), so 1000x might be
//    forty 1.2s, and 2x two or three short favourites.
import { devig, allLegs } from './engine.js';
import { calibrated } from './track.js';

const norm = (s) => String(s || '').toLowerCase();

// Which side (if any) a pick backs: 'home' | 'away' | 'draw' | null. Yes/No markets about one team
// ("Lakers wins a set: No") count for the other team.
export function sideOf(e, market, pick) {
  const h = norm(e.home), a = norm(e.away), m = norm(market), p = norm(pick);
  if (p === 'draw') return 'draw';
  const inPick = (t) => p.includes(t), inMarket = (t) => m.includes(t);
  let side = inPick(h) && !inPick(a) ? 'home' : inPick(a) && !inPick(h) ? 'away' : null;
  if (!side && (p === 'yes' || p === 'no')) {
    const s = inMarket(h) && !inMarket(a) ? 'home' : inMarket(a) && !inMarket(h) ? 'away' : null;
    if (s) side = p === 'yes' ? s : s === 'home' ? 'away' : 'home';
  }
  if (side && /or draw/.test(p)) return side === 'home' ? 'home-or-draw' : 'away-or-draw';
  return side;
}

// Goals/points direction of a pick: 'over' | 'under' | null (both-teams-to-score counts as goals).
export function directionOf(market, pick) {
  const m = norm(market), p = norm(pick);
  if (/^over\b/.test(p) || (/total|over/.test(m) && p === 'yes')) return 'over';
  if (/^under\b/.test(p) || (/total|over/.test(m) && p === 'no')) return 'under';
  if (/both teams/.test(m)) return p === 'yes' ? 'over' : p === 'no' ? 'under' : null;
  return null;
}

const isResult = (m) => /winner|match result|result|double chance|handicap|spread|run line|puck line|draw no bet|map handicap|set handicap/i.test(m);

// One coherent view of a match: the side the model leans to, and (separately) the goals direction,
// then at most one result pick, one goals pick and one value pick that agree with both.
export function coherentBets(e, a, { cal = null, max = 3 } = {}) {
  const cands = [];
  for (const m of e.markets || []) {
    const d = devig(m);
    d.outcomes.forEach((o, i) => {
      const p = m.outcomes[i].model ?? o.fair;
      cands.push({ market: m.name, pick: o.name, p, q: calibrated(p, m.name, cal), odds: o.odds, book: true, ev: p * o.odds - 1 });
    });
  }
  for (const g of a.groups || []) for (const m of g.markets) for (const o of m.outcomes) {
    if (o.p > 0 && o.p < 1) cands.push({ market: m.name, pick: o.name, p: o.p, q: o.p, odds: o.fair, book: false, ev: 0 });
  }
  const w = a.win || {};
  const lean = (w.draw || 0) > Math.max(w.home || 0, w.away || 0) ? 'draw' : (w.home || 0) >= (w.away || 0) ? 'home' : 'away';
  const okSide = (c) => {
    const s = sideOf(e, c.market, c.pick);
    if (!s) return true;
    if (s === lean) return true;
    if (s === 'home-or-draw') return lean === 'home' || lean === 'draw';
    if (s === 'away-or-draw') return lean === 'away' || lean === 'draw';
    return false;
  };
  const playable = (c) => c.odds >= 1.2 && c.q >= 0.5 && c.q <= 0.93 && okSide(c);
  const out = [];
  // 1. Result pick for the lean side (the strongest by estimated chance; bookmaker prices first on ties).
  const result = cands.filter((c) => playable(c) && isResult(c.market) && sideOf(e, c.market, c.pick)).sort((x, y) => y.q - x.q || y.book - x.book)[0];
  if (result) out.push({ label: 'Main pick', ...result, why: result.book ? 'bookmaker price, margin removed' : 'ATLAS model' });
  // 2. One goals/points pick in a single direction (never an over next to an under).
  const goals = cands.filter((c) => playable(c) && directionOf(c.market, c.pick) && !sideOf(e, c.market, c.pick) && c.q >= 0.58).sort((x, y) => y.q - x.q || y.book - x.book)[0];
  if (goals) out.push({ label: e.sport === 'tennis' || e.sport === 'esports' ? 'Sets / maps' : 'Goals / points', ...goals, why: 'from the expected score model' });
  // 3. A value pick only if it agrees with both: same side, same direction, different market.
  const dir = goals ? directionOf(goals.market, goals.pick) : null;
  const value = cands.filter((c) => c.book && c.ev >= 0.03 && c.odds <= 4 && okSide(c) && (!directionOf(c.market, c.pick) || directionOf(c.market, c.pick) === dir) && !out.some((x) => x.market === c.market))
    .sort((x, y) => y.ev - x.ev)[0];
  if (value) out.push({ label: 'Value', ...value, why: `model ${(value.p * 100).toFixed(0)}% vs price ${(100 / value.odds).toFixed(0)}%: +${(value.ev * 100).toFixed(1)}% edge` });
  return { lean, picks: out.slice(0, max) };
}

// ---------- accumulators from bankers ----------
// Most win chance per unit of odds: r = -ln p / ln odds (smaller is better). A fair 1.25 leg (p 0.8)
// scores 1.0; legs the model rates above their price score below 1.
const ratio = (l) => -Math.log(Math.max(1e-9, l.p)) / Math.log(l.odds);

export function legPool(events, { minP = 0.55, minOdds = 1.04, maxOdds = 1.6, cal = null } = {}) {
  const best = new Map();
  for (const l of allLegs(events.filter((e) => e.markets?.length && !e.live))) {
    const p = calibrated(l.p, l.market, cal);
    // A banker is a clear favourite at a fair-ish price: short odds and an estimate close to the price.
    if (l.odds < minOdds || l.odds > maxOdds || p < minP || p * l.odds < 0.93) continue;
    const leg = { ...l, p };
    const cur = best.get(l.eventId);
    if (!cur || ratio(leg) < ratio(cur)) best.set(l.eventId, leg);
  }
  return [...best.values()].sort((x, y) => ratio(x) - ratio(y));
}

// Up to `count` slips near `target` built from the pool, each using its own legs where possible.
export function bankerSlips(events, target, { count = 5, tolerance = 0.1, cal = null, minOdds = 1.04 } = {}) {
  // Strictest first (every leg rated 70%+ after the track-record check); if the board is thin, allow
  // slightly weaker or longer legs and a wider band so the page is never empty while there are
  // priced favourites.
  const short = target <= 2.5 ? 1.7 : target <= 10 ? 1.6 : 1.5;
  for (const [minP, maxOdds, tol] of [[0.7, short, tolerance], [0.62, short, tolerance], [0.6, target <= 10 ? 1.9 : 1.7, Math.max(tolerance, 0.15)], [0.55, 2.2, 0.2]]) {
    const out = buildFrom(legPool(events, { minP, maxOdds, cal, minOdds: Math.max(1.04, Math.min(minOdds, maxOdds - 0.15)) }), target, count, tol);
    if (out.length) return out;
  }
  return [];
}

function buildFrom(pool, target, count, tolerance) {
  // Land on the target, not well short of it: the band below is half as wide as the band above.
  const lo = target * (1 - tolerance / 2), hi = target * (1 + tolerance);
  const slips = [];
  const used = new Set();
  for (let k = 0; k < count; k++) {
    const avail = pool.filter((l) => !used.has(l.eventId));
    const src = avail.length ? avail : pool;
    const legs = [];
    let odds = 1;
    for (const l of src) {
      if (odds >= lo) break;
      const need = target / odds;
      if (l.odds > need * (1 + tolerance)) {
        // This leg overshoots: finish with the best-ratio leg that lands inside the band, if any.
        const fit = src.filter((x) => !legs.includes(x) && odds * x.odds >= lo && odds * x.odds <= hi).sort((x, y) => ratio(x) - ratio(y))[0];
        if (fit) { legs.push(fit); odds *= fit.odds; break; }
        continue;
      }
      legs.push(l); odds *= l.odds;
    }
    if (odds < lo || odds > hi || !legs.length) break;
    const p = legs.reduce((s, l) => s * l.p, 1);
    if (slips.some((s) => s.legs.length === legs.length && s.legs.every((l, i) => l.eventId === legs[i].eventId))) break;
    slips.push({ legs, odds, p, ev: p * odds - 1 });
    legs.forEach((l) => used.add(l.eventId));
  }
  return slips;
}
