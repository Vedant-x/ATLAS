// How ATLAS turns probabilities into bets people can actually place.
//  - coherentBets: one to three picks for a match that all tell the same story (one side, one goals
//    direction), never hedges like "home wins" next to "away +1.5" or "over 3.5" next to "under 5.5".
//  - bankerSlips: accumulators built from many high-probability legs (bankers around 1.05-1.6) rather
//    than a few long shots. For a target T it picks the legs that give the most win chance per unit
//    of odds (maximise the product of probabilities for the product of odds), so 1000x might be
//    forty 1.2s, and 2x two or three short favourites.
import { devig, allLegs } from './engine.js';
import { propLabel, propMarket } from './props.js';
import { calibrated, blockedSegment } from './track.js';

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
export function coherentBets(e, a, { cal = null, max = 3, preferBook = false } = {}) {
  const cands = [];
  for (const m of e.markets || []) {
    const d = devig(m);
    d.outcomes.forEach((o, i) => {
      const p = m.outcomes[i].model ?? o.fair;
      { const q = calibrated(p, m.name, cal, e.sport, o.odds); cands.push({ market: m.name, pick: o.name, p, q, fair: o.fair, odds: o.odds, book: true, ev: q * o.odds - 1 }); }
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
  const result = cands.filter((c) => playable(c) && isResult(c.market) && sideOf(e, c.market, c.pick)).sort((x, y) => (preferBook ? y.book - x.book : 0) || y.q - x.q || y.book - x.book)[0];
  if (result) out.push({ label: 'Main pick', ...result, why: result.book ? 'bookmaker price, margin removed' : 'ATLAS model' });
  // 2. One goals/points pick in a single direction (never an over next to an under).
  const goals = cands.filter((c) => playable(c) && directionOf(c.market, c.pick) && !sideOf(e, c.market, c.pick) && c.q >= 0.58).sort((x, y) => y.q - x.q || y.book - x.book)[0];
  if (goals) out.push({ label: e.sport === 'tennis' || e.sport === 'esports' ? 'Sets / maps' : 'Goals / points', ...goals, why: 'from the expected score model' });
  // 3. A value pick only if it agrees with both: same side, same direction, different market.
  const dir = goals ? directionOf(goals.market, goals.pick) : null;
  const value = cands.filter((c) => c.book && c.ev >= 0.03 && c.odds <= 4 && okSide(c) && (!directionOf(c.market, c.pick) || directionOf(c.market, c.pick) === dir) && !out.some((x) => x.market === c.market))
    .sort((x, y) => y.ev - x.ev)[0];
  if (value) out.push({ label: 'Value', ...value, why: `ATLAS ${(value.q * 100).toFixed(0)}% vs break-even ${(100 / value.odds).toFixed(0)}%: +${(value.ev * 100).toFixed(1)}% edge` });
  return { lean, picks: out.slice(0, max) };
}

// ---------- accumulators from bankers ----------
// Most win chance per unit of odds: r = -ln p / ln odds (smaller is better). A fair 1.25 leg (p 0.8)
// scores 1.0; legs the model rates above their price score below 1.
const ratio = (l) => -Math.log(Math.max(1e-9, l.p)) / Math.log(l.odds);

// Player props as slip legs (one-way prices; chance net of the margin).
const propLegs = (events) => events.filter((e) => !e.live).flatMap((e) => (e.props || []).map((pr) => ({
  eventId: e.id, sport: e.sport, start: e.start, match: `${e.home} vs ${e.away}`, market: propMarket(pr), pick: propLabel(pr),
  odds: pr.odds, p: pr.p, margin: 0.05, ev: pr.p * pr.odds - 1, prop: { id: String(pr.id), league: e.leaguePath?.split('/')[1], type: pr.type, target: pr.target },
})));
export function legPool(events, { minP = 0.55, minOdds = 1.04, maxOdds = 1.6, cal = null, positiveOnly = false } = {}) {
  const best = new Map();
  for (const l of [...allLegs(events.filter((e) => e.markets?.length && !e.live)), ...propLegs(events)]) {
    const p = calibrated(l.p, l.market, cal, l.sport, l.derived ? null : l.odds);
    // A banker is a clear favourite at a fair-ish price: short odds and an estimate close to the price.
    if (l.cushion || l.odds < minOdds || l.odds > maxOdds || p < minP || p * l.odds < (positiveOnly ? 1.000001 : 0.93) || blockedSegment(cal, l.sport, l.market)) continue;
    const leg = { ...l, pRaw: l.p, p };
    const cur = best.get(l.eventId);
    if (!cur || ratio(leg) < ratio(cur)) best.set(l.eventId, leg);
  }
  return [...best.values()].sort((x, y) => ratio(x) - ratio(y));
}

// Up to `count` slips near `target` built from the pool, each using its own legs where possible.
// minOdds / maxOdds (per leg) and positiveOnly are the viewer's or the question's hard rules: the
// fallbacks below widen the search but never past them.
export function bankerSlips(events, target, { count = 5, tolerance = 0.1, cal = null, minOdds = 1.2, maxOdds = null, positiveOnly = false } = {}) {
  // Fewer, longer legs: every leg pays the bookmaker's margin again, so for the same total odds two
  // legs at 1.73 keep more of the true chance than four at 1.32. The longest leg allowed grows with
  // the target (about its square root, so a slip has two legs or more), and legs are ranked by
  // chance per unit of odds, which with the price-blended chance favours legs that carry little
  // margin. The chance floor follows the price (a 2.2 leg can't be a 70% leg). If the board is thin,
  // a slightly wider band.
  const cap = Math.min(2.6, Math.max(1.5, Math.sqrt(target) * 1.1));
  for (const [minP, bandMax, tol] of [[0.4, cap, tolerance], [0.4, cap, Math.max(tolerance, 0.15)], [0.35, Math.max(cap, 2.2), 0.2]]) {
    // The user's minimum odds per leg is a hard rule: never relaxed by the fallbacks.
    const lo = Math.max(1.04, minOdds);
    const hi = Math.min(Math.max(bandMax, lo + 0.15), maxOdds ?? Infinity);
    if (hi < lo) return [];
    const pool = legPool(events, { minP, maxOdds: hi, cal, minOdds: lo, positiveOnly });
    // Mixed bet types first (no market family over half the legs); one type only if that is all
    // the board allows.
    const out = buildFrom(pool, target, count, tol, true);
    if (out.length) return out;
    const any = buildFrom(pool, target, count, tol, false);
    if (any.length) return any;
  }
  return [];
}

const familyOfMarket = (m = '') => (/^Player /.test(m) ? 'prop' : /^Total/.test(m) ? 'total' : m === 'Spread' ? 'spread' : m === 'Match Result' ? 'result' : 'winner');
function buildFrom(pool, target, count, tolerance, mix = false) {
  // Land on the target, not well short of it: the band below is half as wide as the band above.
  const lo = target * (1 - tolerance / 2), hi = target * (1 + tolerance);
  const slips = [];
  const used = new Set();
  for (let k = 0; k < count; k++) {
    const avail = pool.filter((l) => !used.has(l.eventId));
    const src = avail.length ? avail : pool;
    const legs = [];
    let odds = 1;
    // Legs are treated as independent, so two legs may not involve the same team (e.g. a team playing
    // twice in the window, or a tournament path): their results would be linked.
    const teams = new Set();
    const teamsOf = (l) => String(l.match || '').split(' vs ').map((t) => t.trim().toLowerCase()).filter(Boolean);
    const fam = {};
    // With mix on, a family may hold at most half the legs (two is always allowed).
    const crowded = (l) => mix && (fam[familyOfMarket(l.market)] || 0) >= 2 && (fam[familyOfMarket(l.market)] || 0) + 1 > (legs.length + 1) / 2;
    const clash = (l) => teamsOf(l).some((t) => teams.has(t)) || crowded(l);
    const take = (l) => { legs.push(l); odds *= l.odds; teamsOf(l).forEach((t) => teams.add(t)); fam[familyOfMarket(l.market)] = (fam[familyOfMarket(l.market)] || 0) + 1; };
    for (const l of src) {
      if (odds >= lo) break;
      if (clash(l)) continue;
      // A multiplier has two legs at least: a first leg that alone reaches the target is skipped.
      if (!legs.length && l.odds >= lo) continue;
      const need = target / odds;
      if (l.odds > need * (1 + tolerance)) {
        // This leg overshoots: finish with the best-ratio leg that lands inside the band, if any.
        const fit = legs.length ? src.filter((x) => !legs.includes(x) && !clash(x) && odds * x.odds >= lo && odds * x.odds <= hi).sort((x, y) => ratio(x) - ratio(y))[0] : null;
        if (fit) { take(fit); break; }
        continue;
      }
      take(l);
    }
    if (odds < lo || odds > hi || legs.length < 2) break;
    const p = legs.reduce((s, l) => s * l.p, 1);
    if (slips.some((s) => s.legs.length === legs.length && s.legs.every((l, i) => l.eventId === legs[i].eventId))) break;
    slips.push({ legs, odds, p, ev: p * odds - 1 });
    legs.forEach((l) => used.add(l.eventId));
  }
  return slips;
}
