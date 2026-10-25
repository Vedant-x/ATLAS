// Track record: which picks ATLAS publishes, how they are graded from final scores, and the summary
// statistics shown on the Record page. Pure functions, shared by the build (scripts/record.mjs) and
// the browser.
import { ZONES, dayStartAt, dayKey } from './tz.js';
import { applyModel, bankers } from './intel.js';
import { boxStats, gradeProp } from './props.js';
import { bankerSlips, legPool } from './picks.js';
import { localDay } from './engine.js';
import { selectionId, dueForRead, gradable } from './settle.js';
import { recommendation } from './recommendation.js';
import { drifting } from './movement.js';

export const MIN_ODDS = 1.3;
// The shortlist's price range: short-priced favourites only. The record, the shortlist and the
// Bankers page all use it, so every recorded pick is one the shortlist showed.
export const MAX_ODDS = 1.8;
// What the public record counts: shortlist picks (rated 60%+, odds MIN_ODDS to MAX_ODDS). Value spots
// and longer prices saved before this rule stay in the history file (and still teach the track-record
// correction) but are counted separately, whatever their result.
export const inRecord = (h) => h.type === 'banker' && h.odds >= MIN_ODDS && h.odds <= MAX_ODDS;
// No pick or slip leg below FLOOR_ODDS anywhere ATLAS recommends.
export const FLOOR_ODDS = 1.2;
// What a price is worth against the sharp market: price x fair chance - 1, from the lower of two ways
// of taking the sharp book's margin off (an even split; the power method, where its own prices are
// held), so a long price is never made to look better than it is.
export const edgeAt = (b, price) => Math.min(price * b.fair - 1, Number.isFinite(b.fairPow) ? price * b.fairPow - 1 : Infinity);
// The price a pick is taken at: Stake's (the book ATLAS's users bet at) where it was read within
// sharpAge and clears `need` against the fair odds, else the board's own.
const freshAt = (t, now = Date.now()) => !(t && now - t > VALUE.sharpAge);
// When a match's fair chance was read: the sharp line laid over its price, else the quotes of the
// many-bookmaker price it carries (the consensus comes with them).
const refAt = (e) => e?.sharpAt ?? (e?.oddsSource === 'the-odds-api' ? e.priceAt : null);
// Drifting (movement.js): the board's price 3%+ longer than the first seen, the market moving against
// the pick. It only sets a value bet aside while the fair odds are older than driftTrust: a sharp line
// read since already holds the move.
const moved = (b) => drifting(b.odds, b.open) && !(refAt(b.event) > Date.now() - VALUE.driftTrust);
export const takePrice = (b, need) => (b.consensus && b.stake > 1 && freshAt(b.event?.stakeAt) && edgeAt(b, b.stake) >= need && edgeAt(b, b.stake) <= VALUE.maxEdge ? { ...b, odds: b.stake, book: 'Stake', atStake: true } : b);

// Best bets: the likeliest winners at a fair price or better, odds 1.20 to 2.50: the price taken (Stake's
// where it clears, else the board's) is at least the fair odds by the sharp market (Pinnacle, margin
// off) or the median of many bookmakers. One bookmaker's own price is never enough: it sits below
// the fair odds by that bookmaker's margin. Up to 24 Oct, picks priced that way won 65.4% at average
// odds 1.41, where 71.0% was needed (555 picks, -9.1%). Likeliest first, spread across sports and bet
// types. Its own record.
export const BEST = { minOdds: 1.2, maxOdds: 2.5, min: 0.55 };
// Best bets before model 2026.10.15 took one bookmaker's own price: a different list from the one
// since, so it is retired with its own final record (Results), and the list's record starts again.
export const BEST_SINCE = '2026.10.15';
const versionBefore = (v, ref) => {
  const a = String(v).split('.').map(Number), r = ref.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, r.length); i++) if ((a[i] || 0) !== (r[i] || 0)) return (a[i] || 0) < (r[i] || 0);
  return false;
};
export const oldBest = (h) => h.type === 'best' && Boolean(h.model) && versionBefore(h.model, BEST_SINCE);
export function bestBets(events, { cal = null, limit = 10 } = {}) {
  const list = rankedBankers(events.filter(gradable), { cal, min: BEST.min, minOdds: 1, maxOdds: Infinity, limit: 2000, mix: false })
    .filter((b) => b.consensus && freshAt(refAt(b.event))).map((b) => takePrice(b, 0))
    .filter((b) => b.odds >= BEST.minOdds && b.odds <= BEST.maxOdds && edgeAt(b, b.odds) >= 0 && edgeAt(b, b.odds) <= VALUE.maxEdge)
    // The return shown is the sharp market's (what qualifies the pick); the chance is ATLAS's.
    .map((b) => ({ ...b, ev: edgeAt(b, b.odds), edge: edgeAt(b, b.odds) }))
    .sort((x, y) => Number(Boolean(y.atStake)) - Number(Boolean(x.atStake)) || y.p - x.p);
  return diversify(list, limit).sort((x, y) => y.p - x.p);
}
// When no Best bet qualifies: the likeliest winners nearest a fair price (55%+, odds 1.20 to 2.50, a
// sharp fair chance read within sharpAge), the better of Stake's and the board's price, smallest cut
// first. Shown as the nearest misses with what each costs on average (ev below 0); never recorded.
export function nearBest(events, { cal = null, limit = 5 } = {}) {
  const list = rankedBankers(events.filter(gradable), { cal, min: BEST.min, minOdds: 1, maxOdds: Infinity, limit: 2000, mix: false })
    .filter((b) => b.consensus && freshAt(refAt(b.event)))
    .map((b) => (b.stake > 1 && freshAt(b.event.stakeAt) && b.stake >= b.odds ? { ...b, odds: b.stake, book: 'Stake', atStake: true } : b))
    .filter((b) => b.odds >= BEST.minOdds && b.odds <= BEST.maxOdds && edgeAt(b, b.odds) <= VALUE.maxEdge)
    .map((b) => ({ ...b, ev: edgeAt(b, b.odds), edge: edgeAt(b, b.odds), near: true }))
    .sort((x, y) => y.edge - x.edge);
  return diversify(list, limit);
}
// When no value bet qualifies: Stake's prices nearest the bar (each price's distance from the fair
// odds against the distance it needs), best first. The same checks as valueBets but the bar; never
// recorded.
export function nearValue(events, { cal = null, limit = 5 } = {}) {
  const list = bankers(events.filter((e) => !e.live && gradable(e)), { min: 0, limit: Infinity })
    .filter((b) => b.consensus && b.fair >= VALUE.stakeMinFair && b.stake > 1 && freshAt(b.event.stakeAt) && b.stake <= VALUE.stakeMaxOdds && !blockedSegment(cal, b.event.sport, b.market) && freshAt(refAt(b.event)))
    // moved: set aside as the market moves against it (shown with that reason, below the rest).
    .map((b) => ({ ...b, moved: moved(b), odds: b.stake, book: 'Stake', atStake: true, pRaw: b.p, p: Math.min(b.fair, b.fairPow ?? 1), edge: edgeAt(b, b.stake), ev: edgeAt(b, b.stake), need: valueNeed(b), near: true }))
    .filter((b) => b.edge <= VALUE.maxEdge)
    .sort((x, y) => Number(x.moved) - Number(y.moved) || (y.edge - y.need) - (x.edge - x.need));
  return diversify(list, limit, { familyShare: 0.6, sportShare: 0.6 });
}
// Value bets: prices above the sharp market's own fair odds. With many bookmakers (oddsapi.js) the
// fair chance is Pinnacle's with its margin removed (the sharpest book), or the books' median; a best
// price at least VALUE.min above 1 / fair is one the market as a whole calls too long. Such edges are
// small (a few percent), and real only at the bookmaker quoting the price: takeAt is the lowest price
// still worth taking anywhere. The chance shown is the market's, not ATLAS's: in the record, picks
// ATLAS rated 10-20 points above the market landed slightly below the market's own chance.
// sharpAge: a sharp line laid over another feed's price (overlayOdds, football-data) is a reference
// only while fresh; an older one may just be a line the market has since moved past.
// At Stake: where Stake's own price (oddspapi.js) clears the fair odds, it is the price taken and
// recorded (atStake): the book ATLAS's users bet at, so the record is what they could have had. At
// Stake the range runs to long prices (a 12%+ chance, odds to 10): measured on 25 Oct, Stake's margin
// was lightest there (median 3.6% under the fair odds below a 30% chance, 5.9% at 50%+), and every
// Stake price over the fair odds was a draw or an underdog.
// need: 2% (3% from a median of books) at a 30%+ chance, one point more for every 5 points of chance
// below 30% (4% at 20%): a long price's fair chance is the less certain. An edge over maxEdge is taken
// for a data error (another match, a stale or suspended price), never a pick.
export const VALUE = { min: 0.02, minMedian: 0.03, minFair: 0.3, minOdds: 1.25, maxOdds: 4, sharpAge: 10 * 36e5, stakeMinFair: 0.12, stakeMaxOdds: 10, maxEdge: 0.12, driftTrust: 3 * 36e5 };
export const valueNeed = (b) => (/^Pinnacle/.test(b.consensusFrom || '') ? VALUE.min : VALUE.minMedian) + 0.2 * Math.max(0, VALUE.minFair - b.fair);
export function valueBets(events, { cal = null, limit = 10 } = {}) {
  const need = valueNeed;
  const inRange = (b) => (b.atStake ? b.fair >= VALUE.stakeMinFair && b.odds <= VALUE.stakeMaxOdds : b.fair >= VALUE.minFair && b.odds <= VALUE.maxOdds) && b.odds >= VALUE.minOdds;
  const list = bankers(events.filter((e) => !e.live && gradable(e)), { min: 0, limit: Infinity })
    .filter((b) => b.consensus && b.fair >= VALUE.stakeMinFair && !blockedSegment(cal, b.event.sport, b.market) && !moved(b) && freshAt(refAt(b.event)))
    .map((b) => takePrice(b, need(b)))
    .filter(inRange)
    // wide: the typical price across books also beats the fair odds, so the value does not hang on
    // one bookmaker. Value at Stake comes first, then wide, then the biggest edge.
    .map((b) => ({ ...b, pRaw: b.p, p: b.fair, edge: edgeAt(b, b.odds), ev: edgeAt(b, b.odds), takeAt: +((1 + need(b)) / Math.min(b.fair, b.fairPow ?? 1)).toFixed(2), wide: b.med > 1 ? edgeAt(b, b.med) >= need(b) : null }))
    .filter((b) => b.edge >= need(b) && b.edge <= VALUE.maxEdge)
    .sort((x, y) => Number(Boolean(y.atStake)) - Number(Boolean(x.atStake)) || Number(Boolean(y.wide)) - Number(Boolean(x.wide)) || y.edge - x.edge);
  return diversify(list, limit, { familyShare: 0.6, sportShare: 0.6 });
}
// Stamped on every recorded pick, so results can be split by the model that made them.
// 2026.10.1: calibrated chance everywhere, legs feed calibration, shared slip policy.
// 2026.10.2: venue records, starting pitchers and soccer absences in the model; spread lines move
//   with the modelled win chance; track-record correction per sport and market; varied pick lists.
// 2026.10.3: no plus handicaps on the side less likely to win ("Rays +1.5"); handicaps capped at a
//   quarter of the shortlist.
// 2026.10.4: player props (DraftKings milestones and anytime scorers via ESPN) as their own bet type,
//   graded from the box score.
// 2026.10.5: player props use each player's last 10 games (blended with the price), not the price
//   alone; UFC bouts priced from ESPN's core odds feed.
// 2026.10.6: player props from the last 20 games (recent ones weighted more, a count model next to
//   the hit rate, the venue split), with last season filling short early-season logs.
// 2026.10.7: a teammate out (or doubtful) tonight moves his teammates' props by how they did in the
//   games he missed (from both players' game logs, shrunk for small samples).
// 2026.10.8: the shown chance blends ATLAS's estimate with the price's, by a weight learned per sport
//   and market from the settled picks (lower Brier score on the newer 40% when fitted on the older 60%).
// 2026.10.9: bet types whose results fell clearly short of their prices are held back; multipliers
//   use fewer, longer legs (cap grows with the target, two legs minimum); a separate safest tier
//   (1.04-1.25, 85%+).
// 2026.10.10: nothing below 1.20; the surest tier is 1.20-1.40 where ATLAS does not claim to beat
//   the price (those land most often).
// 2026.10.11: a price 3%+ longer than the first one seen (drifting: the market moving against the
//   pick) is left out; Value bets (the best price 2%+ above the sharp market's fair odds) are recorded
//   as their own type; player props on main lines and common types only.
// 2026.10.12: NBA picks wait while a key player's status is unresolved; props of players on the
//   injury report are left out (newsgate.js).
// 2026.10.13: two lists (Best bets, Value bets), 2x / 3x slips and the parlay of the day; shortlist
//   bankers, Surest, Near 2.00, model-only picks, 4x+ and mega slips retired; no chance shown more
//   than 3 points above the price's own; unseen probes keep blocked bet types measured.
// 2026.10.14: Stake's own price (OddsPapi) on the main football leagues; a value bet whose Stake price
//   clears the fair odds is taken and recorded at Stake's price, and listed first.
// 2026.10.15: Best bets only at or above the sharp market's fair odds (one bookmaker's own price no
//   longer counts); value at Stake runs to long prices with a bar that rises with the odds; the fair
//   chance is the lower of an even split and the power method; edges over 12% are data errors; a
//   drifting price is set aside only while the sharp line is 3+ hours old.
export const MODEL_VERSION = '2026.10.15';

// Market families the track record learns from: winner, 1X2 result, spread/handicap, totals.
export const familyOf = (market = '') => (/^Player /.test(market) ? 'prop' : /^Total/.test(market) ? 'total' : market === 'Spread' ? 'spread' : market === 'Match Result' ? 'result' : 'winner');

// Self-correcting accuracy: per market family, how the settled picks did against their estimates.
// A family that lands less often than estimated gets its probabilities scaled down (so it needs a
// stronger estimate to qualify); one that beats its estimates gets a small lift. The weight grows
// with the number of settled picks, so a few results can't swing it. Every graded multiplier leg
// counts too (each is a single prediction with its own result), so the model learns from more data.
// Penalties bite harder than rewards: an overconfident market costs more than a modest one gains.
// Each family is also tracked per sport ("hockey:spread"): a hockey +1.5 puck line and a soccer
// handicap behave differently, so once a sport has enough settled picks in a family, its own record
// is used instead of the all-sports one.
//
// Market blend: the record also learns how far to trust ATLAS's estimate against the price. For each
// family (and sport + family) the settled forecasts give the weight w that scored best (lowest Brier
// score) for  shown = market + w x (ATLAS - market),  where market is the price's chance less a
// typical margin. w = 1 keeps ATLAS's estimate; w = 0 is the price alone. The fitted weight is pulled
// toward 1 by BLEND_PRIOR forecasts' worth, so it moves only as far as the results justify. The
// over/under-confidence factor is then measured again on the blended chances.
export const MARGIN = 0.045;
export const marketChance = (odds) => (odds > 1 ? Math.min(0.97, 1 / odds / (1 + MARGIN)) : null);
const BLEND_PRIOR = 40;
const blendOf = (p, odds, w) => { const m = marketChance(odds); return m == null ? p : m + w * (p - m); };
// down / up: how hard a shortfall or a surplus moves it (the raw estimate is penalised twice as hard;
// the blended one, already pulled toward the price, symmetrically).
const factorOf = (n, won, exp, down = 2, up = 1.2) => {
  const w = n / (n + 12), d = won / n / (exp / n) - 1;
  return Math.max(0.8, Math.min(1.05, 1 + (d < 0 ? down : up) * w * d));
};
function fitBlend(obs) {
  const priced = obs.filter((o) => o.odds > 1);
  if (priced.length < 10) return null;
  let best = 1, score = Infinity;
  for (let i = 0; i <= 20; i++) {
    const w = i / 20;
    const s = priced.reduce((a, o) => a + (blendOf(o.p, o.odds, w) - o.y) ** 2, 0);
    if (s < score - 1e-9) { score = s; best = w; }
  }
  const n = priced.length, w = (n * best + BLEND_PRIOR) / (n + BLEND_PRIOR);
  const bl = priced.map((o) => blendOf(o.p, o.odds, w));
  const brier = (f) => priced.reduce((a, o, i) => a + (f(o, i) - o.y) ** 2, 0) / n;
  return {
    w: +w.toFixed(3), fitted: best, priced: n,
    blendFactor: factorOf(n, priced.reduce((a, o) => a + o.y, 0), bl.reduce((a, x) => a + x, 0), 1, 1),
    brier: { model: brier((o) => o.p), market: brier((o) => marketChance(o.odds)), blend: brier((o, i) => bl[i]) },
  };
}

// One observation per forecast: the same pick recorded as a single and again as a slip leg (or in
// several slips) is one prediction with one result. Its forecast is the first record's, always the
// model's own (uncalibrated) estimate so the correction never feeds on itself; its result comes from
// whichever copy has been settled, so a copy still pending (a leg the grader had not reached) never
// hides a settled one. Copies that disagree (one won, one lost) are left out and listed in
// `conflicts` for a look.
export function observations(history = []) {
  const by = new Map(), list = [], conflicts = [];
  const take = (r, p) => {
    const k = r.sel || selectionId(r);
    const o = k && by.get(k);
    // shown: the chance displayed when it was first published; known: when its result was last set
    // (a correction moves it later), so an evaluation never trains on a result not yet known.
    if (!o) { const n = { key: k, market: r.market, p, shown: r.shown ?? null, sport: r.sport, odds: r.odds, at: r.at, start: r.start, known: null, results: new Set() }; if (k) by.set(k, n); list.push(n); }
    const t = o || list[list.length - 1];
    if (r.status === 'won' || r.status === 'lost' || r.status === 'push') {
      t.results.add(r.status);
      const when = r.gradedAt ?? (Number.isFinite(r.start) ? r.start + 6 * 36e5 : null);
      if (when != null) t.known = Math.max(t.known ?? 0, when);
    }
  };
  // Oldest record first (not file order), so a rebuilt or reordered history gives the same forecasts.
  const rows = [];
  for (const h of history) {
    if (h.type === 'model') continue; // unpriced model picks keep their own record (retired 23 Oct 2026; never part of the calibration)
    if (h.type === 'multi') for (const l of h.legs || []) rows.push([h.recordedAt ?? 0, l, l.pRaw ?? l.p]);
    else rows.push([h.recordedAt ?? 0, h, h.p]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  for (const [at, r, p] of rows) take({ ...r, at }, p);
  const out = [];
  for (const o of list) {
    if (o.results.size > 1) { conflicts.push(o.key); continue; }
    const st = [...o.results][0];
    out.push({ ...o, status: st === 'won' || st === 'lost' ? st : 'pending' });
  }
  return { list: out, conflicts };
}

// Everything waiting on a result whose match should be over (2h+ after its start): singles, and every
// pending leg of every multiplier slip, whatever the slip's own status. A slip is lost as soon as one
// leg loses, but its other legs are still forecasts with results of their own (the calibration and
// the per-market record learn from them), so they keep being graded.
export function duePicks(history, now = Date.now()) {
  const ended = (x) => dueForRead(x, now);
  return [
    ...history.filter((h) => h.type !== 'multi' && ended(h)),
    ...history.filter((h) => h.type === 'multi').flatMap((m) => (m.legs || []).filter(ended)),
  ];
}

export function calibration(history = []) {
  return calibrationFrom(observations(canonicalOrder(history)).list);
}
// The calibration fitted on a list of observations (observations().list), so the out-of-sample check
// below can fit it on earlier results only.
function calibrationFrom(list) {
  const out = {}, obs = {};
  const add = (market, p, status, sport, odds) => {
    if (status !== 'won' && status !== 'lost') return;
    for (const key of [familyOf(market), sport ? `${sport}:${familyOf(market)}` : null].filter(Boolean)) {
      const r = (out[key] ||= { n: 0, won: 0, exp: 0 });
      r.n++; r.won += status === 'won' ? 1 : 0; r.exp += p;
      (obs[key] ||= []).push({ p, odds, y: status === 'won' ? 1 : 0 });
    }
  };
  for (const o of list) add(o.market, o.p, o.status, o.sport, o.odds);
  for (const [key, r] of Object.entries(out)) {
    r.hit = r.won / r.n; r.expected = r.exp / r.n;
    r.factor = factorOf(r.n, r.won, r.exp);
    const b = fitBlend(obs[key]);
    if (b) Object.assign(r, b);
    // Guard: a sport's bet type whose settled picks landed clearly less often than their own prices
    // implied (25+ priced results, z <= -2) is left out of the shortlist and the slips until the
    // record recovers. Today's example: hockey +1.5 puck lines, 50% landed against 68% implied.
    if (key.includes(':')) {
      const pr = obs[key].filter((o) => marketChance(o.odds) != null);
      const imp = pr.reduce((a, o) => a + marketChance(o.odds), 0), v = pr.reduce((a, o) => { const m = marketChance(o.odds); return a + m * (1 - m); }, 0);
      const won = pr.reduce((a, o) => a + o.y, 0);
      r.implied = pr.length ? imp / pr.length : null;
      r.z = v > 0 ? (won - imp) / Math.sqrt(v) : 0;
      r.blocked = pr.length >= GUARD_MIN && r.z <= GUARD_Z;
    }
  }
  return out;
}
const GUARD_MIN = 25, GUARD_Z = -2;
// Out-of-sample check (walk-forward): the calibration is fitted only on results known before a week
// starts (matches that started at least 6 hours before it), then scored on that week's forecasts;
// repeated week by week. Nothing from a week (results, closing prices) is used to fit the forecasts
// that week is scored on. Brier score and log loss (lower is better) for ATLAS's own estimate, the
// calibrated chance the site showed, and the price's chance less an assumed MARGIN. Weeks with fewer
// than `minTrain` earlier results are skipped.
export function walkForward(history, { step = 7 * 864e5, minTrain = 50 } = {}) {
  const obs = observations(canonicalOrder(history)).list.filter((o) => (o.status === 'won' || o.status === 'lost') && Number.isFinite(o.at) && o.odds > 1).sort((a, b) => a.at - b.at);
  if (!obs.length) return null;
  const clip = (q) => Math.min(0.99, Math.max(0.01, q));
  const score = () => ({ n: 0, raw: 0, shown: 0, market: 0, llRaw: 0, llShown: 0, llMarket: 0, nPub: 0, pub: 0, pubMarket: 0 });
  const add = (t, o, cal) => {
    const y = o.status === 'won' ? 1 : 0, f = { raw: clip(o.p), shown: clip(calibrated(o.p, o.market, cal, o.sport, o.odds)), market: clip(marketChance(o.odds)) };
    t.n++;
    for (const k of ['raw', 'shown', 'market']) { t[k] += (f[k] - y) ** 2; t[`ll${k[0].toUpperCase()}${k.slice(1)}`] += -Math.log(y ? f[k] : 1 - f[k]); }
    // The chance actually published at the time, scored as it was (no recalibration).
    if (Number.isFinite(o.shown)) { t.nPub++; t.pub += (clip(o.shown) - y) ** 2; t.pubMarket += (f.market - y) ** 2; }
  };
  const total = score(), weeks = [];
  for (let w0 = obs[0].at + step; w0 <= obs.at(-1).at; w0 += step) {
    // Only results known before the week starts (graded, and not corrected since).
    const train = obs.filter((o) => (o.known ?? (o.start ?? o.at) + 6 * 36e5) < w0);
    const test = obs.filter((o) => o.at >= w0 && o.at < w0 + step);
    if (train.length < minTrain || !test.length) continue;
    const cal = calibrationFrom(train), wk = score();
    for (const o of test) { add(wk, o, cal); add(total, o, cal); }
    weeks.push({ from: w0, train: train.length, ...wk });
  }
  const avg = (t) => (t.n ? { n: t.n, brier: { raw: t.raw / t.n, shown: t.shown / t.n, market: t.market / t.n }, logLoss: { raw: t.llRaw / t.n, shown: t.llShown / t.n, market: t.llMarket / t.n },
    published: t.nPub ? { n: t.nPub, brier: t.pub / t.nPub, market: t.pubMarket / t.nPub } : null } : null);
  return { total: avg(total), weeks: weeks.map((w) => ({ from: w.from, train: w.train, ...avg(w) })), margin: MARGIN };
}

// Is this sport's bet type held back by the guard above?
export const blockedSegment = (cal, sport, market) => Boolean(sport && cal?.[`${sport}:${familyOf(market)}`]?.blocked);
const SPORT_MIN = 30; // settled forecasts before a sport's own record replaces the all-sports one
// The chance the site shows. With the price (odds) known and a learned blend, the estimate is first
// blended with the price's chance, then the blended record's factor applied; without either, the
// estimate is only scaled by its record.
// Never more than CLAIM above the price's own chance: in the record, picks ATLAS rated 10-20 points
// above the market landed below the market (66.7% against 68.6%), and every list that claimed more
// than its price lost more than the margin. A chance with no price (odds unknown) is not capped.
export const CLAIM = 0.03;
export const calibrated = (p, market, cal, sport, odds) => {
  const own = sport ? cal?.[`${sport}:${familyOf(market)}`] : null;
  const r = own?.n >= SPORT_MIN ? own : cal?.[familyOf(market)];
  const m = marketChance(odds);
  const q = r?.w != null && m != null ? blendOf(p, odds, r.w) * (r.blendFactor ?? 1) : p * (r?.factor ?? 1);
  return Math.min(0.99, Math.max(0.01, m != null ? Math.min(q, m + CLAIM) : q));
};

// A player prop with the chance the site shows (the props pages, player research, the assistant and
// slips): the model's estimate after the same track-record check, keeping the raw one as pRaw.
// market: the prop's market name (props.js propMarket).
export const shownProp = (x, market, cal, sport) => ({ ...x, pRaw: x.pRaw ?? x.p, p: calibrated(x.pRaw ?? x.p, market, cal, sport, x.odds) });

// The calibration's version: how many settled forecasts it was fitted on (one per family key).
// The calibration a chance was shown with: its size and a fingerprint of its contents, so a
// correction that changes a result (but not the count) still gives a new version.
const fnv = (s) => { let h = 0x811c9dc5; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
export const calVersionOf = (cal) => `cal-${Object.entries(cal || {}).filter(([k]) => !k.includes(':')).reduce((a, [, r]) => a + (r.n || 0), 0)}-${fnv(JSON.stringify(Object.entries(cal || {}).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, r]) => [k, r.n, r.factor, r.w, r.blendFactor, r.blocked])))}`;
// How many settled forecasts of this kind the shown chance rests on (the sport's own record once it
// is used, else the all-sports one).
export const calSize = (cal, sport, market) => { const own = sport ? cal?.[`${sport}:${familyOf(market)}`] : null; return (own?.n >= 30 ? own : cal?.[familyOf(market)])?.n ?? 0; };
// The recommendation object (recommendation.js) for a ranked pick, with this model's version and the
// calibration it was shown with: the same pick at the same quote gets the same id on every surface.
export const recommendationFor = (b, cal, extra = {}) => recommendation(b, { modelVersion: MODEL_VERSION, calibrationVersion: calVersionOf(cal), calN: calSize(cal, (b.event || b.e)?.sport, b.market), ...extra });

// One probability per selection, everywhere: the model estimate after the track-record check
// (calibrated). Cards, slips, the assistant and the official record all use these two functions, so a
// pick shows the same chance wherever it appears. Each row keeps the market's margin-free chance
// (fair) and the uncalibrated model estimate (pRaw) alongside, for transparency.
const withCal = (b, cal) => { const p = calibrated(b.p, b.market, cal, b.event?.sport, b.derived ? null : b.odds);return { ...b, pRaw: b.p, p, ev: p * b.odds - 1 }; };

// A varied list instead of the same bet type again and again: one pick per match, and no market
// family (winner, result, total) may take more than 40% of the list (handicaps: under a quarter), nor one sport more than
// half, while other qualifying picks exist. On a thin board the caps loosen to half and two thirds;
// past that the list is simply shorter: fewer picks rather than the same bet type over and over.
export function diversify(list, limit, { familyShare = 0.4, sportShare = 0.5 } = {}) {
  const out = [], seen = new Set(), fam = {}, sp = {};
  for (const [fs, ss] of [[familyShare, sportShare], [0.5, 0.67]]) {
    const capS = Math.max(2, Math.ceil(limit * ss));
    // Handicaps are the smallest share: winners and totals carry the list.
    const capOf = (f) => Math.max(f === 'spread' ? 1 : 2, Math.ceil(limit * (f === 'spread' ? fs * 0.6 : fs)));
    for (const b of list) {
      if (out.length >= limit) break;
      const id = b.event?.id ?? b.eventId;
      if (seen.has(id)) continue;
      const f = familyOf(b.market), s = b.event?.sport ?? b.sport;
      if ((fam[f] || 0) >= capOf(f) || (sp[s] || 0) >= capS) continue;
      out.push(b); seen.add(id); fam[f] = (fam[f] || 0) + 1; sp[s] = (sp[s] || 0) + 1;
    }
  }
  return out;
}
// Three ways to rank, because they disagree: 'likely' (highest chance in the odds range, what the
// record tracks), 'value' (ATLAS's chance above the price's break-even, best edge first; nothing
// qualifies when every price is below the estimate) and 'evidence' (60%+ picks whose match has every
// input its sport needs confirmed, `ready(event)` true).
export function rankedBankers(events, { cal = null, min = 0.6, minOdds = 1, maxOdds = MAX_ODDS, limit = 10, mix = true, mode = 'likely', ready = null } = {}) {
  const ok = (b) => !blockedSegment(cal, b.event?.sport, b.market) && !drifting(b.odds, b.open);
  if (mode === 'value') {
    const v = bankers(events, { min: 0.4, minOdds, limit: 2000 }).filter((b) => b.odds <= 3 && ok(b)).map((b) => withCal(b, cal))
      .filter((b) => b.ev > 0 && b.p >= 0.45).sort((x, y) => y.ev - x.ev);
    return (mix ? diversify(v, limit) : v.slice(0, limit)).sort((x, y) => y.ev - x.ev);
  }
  const all = bankers(events, { min: min * 0.9, minOdds, limit: Math.max(200, limit * 12) }).filter((b) => b.odds <= maxOdds && ok(b)).map((b) => withCal(b, cal))
    .filter((b) => b.p >= min && (mode !== 'evidence' || !ready || ready(b.event))).sort((x, y) => y.p - x.p);
  return (mix ? diversify(all, limit) : all.slice(0, limit)).sort((x, y) => y.p - x.p);
}

// Probes: Best-bets candidates in a bet type the guard has blocked, recorded but never shown, so the
// blocked type keeps being measured and can earn its way back (without them a block was permanent:
// no new picks, no new results).
export function probePicks(events, { cal = null, limit = 10 } = {}) {
  if (!cal) return [];
  return bankers(events.filter(gradable), { min: BEST.min * 0.9, minOdds: 1, limit: 2000 })
    .filter((b) => b.consensus && freshAt(refAt(b.event)) && blockedSegment(cal, b.event?.sport, b.market) && !drifting(b.odds, b.open)).map((b) => withCal(takePrice(b, 0), cal))
    // Judged on the price's own chance: the shown chance carries the blocked type's penalty, which
    // would keep it out for good. The same price rule as Best bets.
    .filter((b) => b.pRaw >= BEST.min && b.odds >= BEST.minOdds && b.odds <= BEST.maxOdds && edgeAt(b, b.odds) >= 0 && edgeAt(b, b.odds) <= VALUE.maxEdge).sort((x, y) => y.pRaw - x.pRaw).slice(0, limit);
}

// Official picks for matches starting in the next `hours`: the shortlist's bankers (rated 60%+ at
// odds MIN_ODDS to MAX_ODDS), plus the multiplier slips, which keep their own records. Locked at the first price seen. `p` is the model's
// own estimate (what calibration learns from); `shown` is the calibrated chance the site displayed.
export function selectPicks(events, now = Date.now(), hours = 12, history = []) {
  const soon = applyModel(events.filter((e) => !e.live && e.compId && e.start > now && e.start < now + hours * 36e5));
  const cal = calibration(history);
  // The calibration a forecast was shown with: the number of settled forecasts it was fitted on.
  const calVersion = calVersionOf(cal);
  const quote = (e) => ({ book: e.bookmaker || null, oddsSource: e.oddsSource || null, quoteType: e.quoteType || (e.markets?.length ? 'bookmaker' : null), priceAt: e.priceAt ?? null });
  const row = (type) => (b) => ({ sel: selectionId({ eventId: b.event.id, market: b.market, pick: b.pick, prop: b.prop }), ...quote(b.event), calVersion,
    ...(() => { const r = recommendationFor(b, cal, { now, mode: type, publishedAt: now }); return { recommendationId: r.recommendationId, forecastId: r.forecastId, generatedAt: r.forecastGeneratedAt, uncertaintyRange: r.uncertaintyRange }; })(),
    // The surest list keeps its own record, so its key differs from the same pick on the shortlist.
    key: `${['safe', 'best', 'two', 'edge', 'probe'].includes(type) ? `${type}|` : ''}${b.event.id}|${b.market}|${b.pick}`, type, eventId: b.event.id, leaguePath: b.event.leaguePath, compId: b.event.compId,
    sport: b.event.sport, league: b.event.league, home: b.event.home, away: b.event.away, start: b.event.start,
    market: b.market, pick: b.pick, odds: b.odds, p: +b.pRaw.toFixed(4), shown: +b.p.toFixed(4), fair: b.fair == null ? null : +b.fair.toFixed(4),
    recordedAt: now, status: 'pending', model: MODEL_VERSION, ...(b.prop ? { prop: b.prop } : {}),
    // Value bets: the bookmaker quoting the price and the first price seen for it.
    ...(type === 'edge' ? { bestBook: b.book || null, open: b.open ?? null, ...(b.atStake ? { atStake: true } : {}) } : {}),
  });
  // What the site shows is what is recorded: Best bets, Value bets, 2x / 3x slips and the parlay of
  // the day (plus unseen probes). The shortlist bankers, Surest, Near 2.00 and model-only picks were
  // retired on 23 Oct 2026; their history stays in the record.
  return [
    ...bestBets(soon, { cal, limit: 20 }).map(row('best')),
    ...valueBets(soon, { cal, limit: 20 }).map(row('edge')),
    ...probePicks(soon, { cal, limit: 10 }).map(row('probe')),
    ...multiPicks(events, now, history),
    ...potdPicks(events, now, history),
  ];
}

// Parlay of the day: one slip a day at total odds 1.70 to 2.00, built from the legs with the most
// chance per unit of odds (the same leg ranking as the multipliers), each leg at a price no shorter
// than its fair odds where the board allows. A day runs from 12:00 to 12:00 in the chosen time zone;
// the record saves the first slip of each day and the pages show that saved slip all day.
export const POTD = { min: 1.7, max: 2.0, minOdds: 1.04, maxLegs: 6 };
// The record saves the parlay of the day for these zones (any zone in tz.js can be shown live).
export const POTD_ZONES = { IST: { offset: 330, tz: 'Asia/Kolkata' }, GMT: { offset: 0, tz: 'UTC' } };
export function potdDay(now = Date.now(), zone = 'IST') {
  const start = dayStartAt(now, ZONES[zone] ? zone : 'IST', 12), end = dayStartAt(start + 30 * 36e5, ZONES[zone] ? zone : 'IST', 12);
  return { key: dayKey(start, ZONES[zone] ? zone : 'IST'), start, end };
}
export function parlayOfDay(events, { now = Date.now(), zone = 'IST', cal = null } = {}) {
  const { end } = potdDay(now, zone);
  const pool = applyModel(events.filter((e) => e.compId && e.markets?.length && !e.live && e.start > now + 30 * 6e4 && e.start < end));
  // Every combination of 2 to 6 of the best legs (most chance per unit of odds, one per match, no
  // team twice) whose total lands in 1.70 to 2.00; the one most likely to win. Legs at a price no
  // shorter than their fair odds first; any banker legs only if no such slip exists.
  for (const positiveOnly of [true, false]) {
    const legs = legPool(pool, { minP: 0.55, minOdds: POTD.minOdds, maxOdds: 1.6, cal, positiveOnly }).slice(0, 24);
    const teams = (l) => String(l.match || '').split(' vs ').map((t) => t.trim().toLowerCase());
    let best = null;
    const walk = (from, picked, odds, p) => {
      if (picked.length >= 2 && odds >= POTD.min && odds <= POTD.max && (!best || p > best.p)) best = { legs: picked, odds, p, ev: p * odds - 1, fairOnly: positiveOnly };
      if (picked.length === POTD.maxLegs || odds > POTD.max) return;
      for (let i = from; i < legs.length; i++) {
        const l = legs[i];
        if (picked.some((x) => teams(x).some((t) => teams(l).includes(t)))) continue;
        walk(i + 1, [...picked, l], odds * l.odds, p * l.p);
      }
    };
    walk(0, [], 1, 1);
    if (best) return best;
  }
  return null;
}
export function potdPicks(events, now = Date.now(), history = []) {
  const cal = calibration(history);
  const out = [];
  for (const zone of Object.keys(POTD_ZONES)) {
    const slip = parlayOfDay(events, { now, zone, cal });
    if (!slip) continue;
    const byId = new Map(events.map((e) => [e.id, e]));
    const legs = slip.legs.map((l) => { const e = byId.get(l.eventId); return { sel: selectionId({ eventId: e.id, market: l.market, pick: l.pick, prop: l.prop }), eventId: e.id, leaguePath: e.leaguePath, compId: e.compId, sport: e.sport, league: e.league, home: e.home, away: e.away, start: e.start, market: l.market, pick: l.pick, odds: l.odds, p: +l.p.toFixed(4), pRaw: +(l.pRaw ?? l.p).toFixed(4), status: 'pending', book: e.bookmaker || null, priceAt: e.priceAt ?? null, ...(l.prop ? { prop: l.prop } : {}) }; });
    out.push({
      key: `multi|${potdDay(now, zone).key}|potd-${zone}`, type: 'multi', target: 'potd', zone, legs, eventId: legs[0].eventId, sport: 'multi', league: 'Parlay of the day',
      home: `${legs.length}-leg parlay of the day`, away: '', start: Math.max(...legs.map((l) => l.start)), market: 'Parlay of the day',
      pick: legs.map((l) => l.pick).join(' + '), odds: +slip.odds.toFixed(2), p: +slip.p.toFixed(4), recordedAt: now, status: 'pending', model: MODEL_VERSION, fairOnly: slip.fairOnly,
    });
  }
  return out;
}

// One slip policy for the pages and the official record: which matches a target may use and how
// close the total must land. The record saves the top slip under exactly this policy, and the pages
// show that saved slip as "today's official slip" (alternatives below it follow the viewer's filters).
// Only 2x and 3x slips are offered. The longer ones were retired on 23 Oct 2026 after their record:
// 4x 2-15, 5x 0-18, 10x 1-17, 20x 0-17, 100x 0-18, 1000x 0-18 (their history stays on the Results page).
export const MULTI_TARGETS = [2, 3];
export const RETIRED_TARGETS = [4, 5, 10, 20, 100, 1000];
// Below 10x every leg starts in the next 12 hours; 10x and bigger may use any match in the next 7 days.
export const BIG_TARGET = 10;
export const slipPolicy = (target) => ({ hours: target >= BIG_TARGET ? 168 : 12, tolerance: target <= 20 ? 0.08 : 0.12 });
export const slipWindow = (events, target, now = Date.now()) => events.filter((e) => !e.live && e.start > now && e.start <= now + slipPolicy(target).hours * 36e5);
export function multiPicks(events, now = Date.now(), history = []) {
  const pool = applyModel(events.filter((e) => e.compId && e.markets?.length && e.start > now + 30 * 6e4));
  const byId = new Map(pool.map((e) => [e.id, e]));
  const cal = calibration(history);
  const day = localDay(now); // IST calendar day: one official slip per target per day
  const out = [];
  for (const target of MULTI_TARGETS) {
    const best = bankerSlips(slipWindow(pool, target, now), target, { count: 1, tolerance: slipPolicy(target).tolerance, cal, minOdds: FLOOR_ODDS })[0];
    if (!best) continue;
    const legs = best.legs.map((l) => { const e = byId.get(l.eventId); return { sel: selectionId({ eventId: e.id, market: l.market, pick: l.pick, prop: l.prop }), eventId: e.id, leaguePath: e.leaguePath, compId: e.compId, sport: e.sport, league: e.league, home: e.home, away: e.away, start: e.start, market: l.market, pick: l.pick, odds: l.odds, p: +l.p.toFixed(4), pRaw: +(l.pRaw ?? l.p).toFixed(4), status: 'pending', book: e.bookmaker || null, priceAt: e.priceAt ?? null, ...(l.prop ? { prop: l.prop } : {}) }; });
    out.push({
      key: `multi|${day}|${target}x`, type: 'multi', target, legs, eventId: legs[0].eventId, sport: 'multi', league: `${target}x multiplier`,
      home: `${legs.length}-leg ${target}x slip`, away: '', start: Math.max(...legs.map((l) => l.start)), market: `${target}x multiplier`,
      pick: legs.map((l) => l.pick).join(' + '), odds: +best.odds.toFixed(2), p: +best.p.toFixed(4), recordedAt: now, status: 'pending', model: MODEL_VERSION,
    });
  }
  return out;
}

// A multiplier is lost as soon as one leg loses; won once every leg is settled with no loss (pushed or
// void and did-not-play legs drop out and the odds shrink accordingly); void if every leg is void;
// a postponed or disputed leg keeps it pending. A leg whose result
// could not be found stays "unresolved" and so does the slip: it is never counted as void or won.
export function settleMulti(m) {
  if (m.legs.some((l) => l.status === 'lost')) return { status: 'lost' };
  if (m.legs.some((l) => ['pending', 'postponed', 'disputed'].includes(l.status))) return { status: 'pending' };
  if (m.legs.some((l) => l.status === 'unresolved')) return { status: 'unresolved' };
  const won = m.legs.filter((l) => l.status === 'won');
  if (!won.length) return { status: 'void' };
  return { status: 'won', odds: +won.reduce((x, l) => x * l.odds, 1).toFixed(2) };
}

// Add new picks to the history (first price wins; a pick already recorded is never changed).
// A pick seen again later keeps its first price and forecast; the later ones are kept beside it as
// snapshots (time, price, forecast), the last 24 that changed, so the record shows how it moved.
export function addPicks(history, picks) {
  const byKey = new Map(history.map((h) => [h.key, h]));
  const fresh = [];
  for (const p of picks) {
    const h = byKey.get(p.key);
    if (!h) { byKey.set(p.key, p); fresh.push(p); continue; }
    if (h.status !== 'pending' || h.type === 'multi') continue;
    const last = h.snapshots?.at(-1) || { odds: h.odds, p: h.p };
    if (last.odds !== p.odds || Math.abs(last.p - p.p) >= 0.005) h.snapshots = [...(h.snapshots || []), { at: p.recordedAt, odds: p.odds, p: p.p }].slice(-24);
  }
  return [...history, ...fresh];
}

// Result of one pick from the final score: 'won' | 'lost' | 'push' | null (can't grade this market).
export function gradePick(p, r) {
  if (p.prop) return gradeProp(p.prop, String(p.leaguePath || '').split('/')[0], r.box);
  const hs = Number(r.homeScore), as = Number(r.awayScore);
  const scored = Number.isFinite(hs) && Number.isFinite(as);
  if (p.market === 'Winner' || p.market === 'Match Result') {
    let winner = r.winner; // 'home' | 'away' | 'draw' (from the feed's winner flags, needed for tennis/MMA)
    if (!winner && scored) winner = hs > as ? 'home' : hs < as ? 'away' : 'draw';
    if (!winner) return null;
    const side = p.pick === 'Draw' ? 'draw' : p.pick === p.home ? 'home' : p.pick === p.away ? 'away' : null;
    if (!side) return null;
    return side === winner ? 'won' : 'lost';
  }
  if (!scored) return null;
  const tot = /^Total ([\d.]+)$/.exec(p.market);
  if (tot) {
    const line = Number(tot[1]), sum = hs + as;
    if (sum === line) return 'push';
    return (p.pick.startsWith('Over') ? sum > line : sum < line) ? 'won' : 'lost';
  }
  if (p.market === 'Spread') {
    const m = /^(.*) ([+-]?[\d.]+)$/.exec(p.pick);
    if (!m) return null;
    const side = m[1] === p.home ? 'home' : m[1] === p.away ? 'away' : null;
    if (!side) return null;
    const margin = (side === 'home' ? hs - as : as - hs) + Number(m[2]);
    return margin === 0 ? 'push' : margin > 0 ? 'won' : 'lost';
  }
  return null;
}

// Final result from an ESPN summary response, or { done: false } / { void: true }.
export function resultFromSummary(sm) {
  const c = sm?.header?.competitions?.[0];
  if (!c) return { done: false };
  const st = c.status?.type || {};
  // Postponed or suspended: the match may still be played (settle.js waits, then voids). Cancelled,
  // abandoned or forfeited: void now.
  if (/postpon|suspend|delay/i.test(`${st.name} ${st.description}`)) return { postponed: true };
  if (/cancel|abandon|forfeit/i.test(`${st.name} ${st.description}`)) return { void: true };
  if (!st.completed) return { done: false };
  // Fights and tennis matches may list no home/away: the first competitor is home, as on the board.
  const cs = c.competitors || [];
  const h = cs.find((x) => x.homeAway === 'home') || cs[0] || {}, a = cs.find((x) => x.homeAway === 'away') || cs[1] || {};
  const winner = h.winner ? 'home' : a.winner ? 'away' : null;
  const b = boxStats(sm), box = b.listed.size ? { box: b } : {}; // player stats, for props
  return { done: true, homeScore: h.score, awayScore: a.score, winner: winner || (h.score != null && h.score === a.score ? 'draw' : null), ...box };
}

// Forecast quality beyond hit rate: Brier score (mean squared error of the chance shown; lower is
// better) and, on picks where the margin-free market chance was saved, the same score for the market
// as a baseline. ATLAS only adds something if its score beats the market's.
// Closing line: until a match starts, every build stores the latest bookmaker price for each pending
// pick (and each leg of a pending slip). The last one saved before kick-off is the closing price, the
// benchmark for whether ATLAS's saved price was better or worse than where the market finished.
export function updateClosing(history, events, now = Date.now()) {
  const byId = new Map(events.map((e) => [e.id, e]));
  const price = (r) => {
    const e = byId.get(r.eventId);
    if (!e || e.live) return null;
    if (r.prop) return e.props?.find((x) => x.id === r.prop.id && x.type === r.prop.type && x.target === r.prop.target)?.odds;
    return e.markets?.find((m) => m.name === r.market)?.outcomes?.find((o) => o.name === r.pick)?.odds;
  };
  let n = 0;
  for (const h of history) {
    if (h.status !== 'pending') continue;
    for (const r of h.type === 'multi' ? h.legs : [h]) {
      if (!(r.start > now)) continue;
      const o = price(r);
      if (Number.isFinite(o) && o > 1) { r.close = +o.toFixed(3); r.closeAt = now; n++; }
    }
  }
  return n;
}
// Price obtained vs closing price: average edge (saved odds / closing odds - 1) and how often the saved
// price was better. Context for the record, not proof of profit.
function closing(list) {
  const c = list.filter((h) => h.close > 1 && h.odds > 1);
  return { clvN: c.length, clv: c.length ? c.reduce((s, h) => s + h.odds / h.close - 1, 0) / c.length : null, beatClose: c.length ? c.filter((h) => h.odds > h.close).length / c.length : null };
}
function brier(list) {
  const y = (h) => (h.status === 'won' ? 1 : 0);
  const withMkt = list.filter((h) => h.fair != null);
  return {
    brier: list.length ? list.reduce((s, h) => s + ((h.shown ?? h.p) - y(h)) ** 2, 0) / list.length : null,
    brierN: withMkt.length,
    brierModel: withMkt.length ? withMkt.reduce((s, h) => s + ((h.shown ?? h.p) - y(h)) ** 2, 0) / withMkt.length : null,
    brierMarket: withMkt.length ? withMkt.reduce((s, h) => s + (h.fair - y(h)) ** 2, 0) / withMkt.length : null,
  };
}

// Summary statistics for the Record page. Profit is in units at a flat 1-unit stake. The main record
// covers single picks only; every multiplier target and the mega slips keep
// a separate record of their own (byTarget), shown on their own pages.
// A fixed order (start, then key) for everything summed, so a rebuilt or reordered history gives the
// same totals to the last digit.
const canonicalOrder = (history) => [...history].sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || String(a.key).localeCompare(String(b.key)));
export function summarize(history) {
  history = canonicalOrder(history);
  const settledAll = history.filter((h) => h.status === 'won' || h.status === 'lost' || h.status === 'push');
  const graded = settledAll.filter(inRecord);
  // botd: the banker of the day, recorded briefly (19-20 Oct) before it was retired; kept out of every list.
  const outside = settledAll.filter((h) => !['multi', 'safe', 'model', 'best', 'two', 'edge', 'probe', 'botd'].includes(h.type) && !inRecord(h));
  // The lists the site shows today (Best bets and Value bets): the headline record. Everything else
  // is either a slip (its own record) or retired (kept below, with its final record).
  const isLive = (h) => (h.type === 'best' && !oldBest(h)) || h.type === 'edge';
  const live = settledAll.filter(isLive);
  const best = settledAll.filter((h) => h.type === 'best' && !oldBest(h));
  const models = settledAll.filter((h) => h.type === 'model');
  const safe = settledAll.filter((h) => h.type === 'safe');
  const multis = settledAll.filter((h) => h.type === 'multi');
  const slipsOf = (ts) => history.filter((h) => h.type === 'multi' && ts.includes(h.target)).sort((a, b) => b.start - a.start);
  const stat = (list) => {
    const won = list.filter((h) => h.status === 'won'), lost = list.filter((h) => h.status === 'lost');
    const settled = won.length + lost.length;
    const profit = won.reduce((s, h) => s + (h.settledOdds ?? h.odds) - 1, 0) - lost.length;
    return {
      picks: list.length, won: won.length, lost: lost.length, push: list.length - settled,
      hitRate: settled ? won.length / settled : null,
      expected: settled ? [...won, ...lost].reduce((s, h) => s + (h.shown ?? h.p), 0) / settled : null,
      profit: +profit.toFixed(2), roi: settled ? profit / settled : null,
      // 95% interval of the ROI from the spread of the per-pick returns (normal approximation).
      roiCI: settled >= 10 ? (() => { const r = [...won.map((h) => (h.settledOdds ?? h.odds) - 1), ...lost.map(() => -1)], m = profit / settled; const sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (settled - 1)); return [m - 1.96 * sd / Math.sqrt(settled), m + 1.96 * sd / Math.sqrt(settled)]; })() : null,
      avgOdds: settled ? [...won, ...lost].reduce((s, h) => s + h.odds, 0) / settled : null,
      ...brier([...won, ...lost]),
      ...closing([...won, ...lost]),
    };
  };
  const group = (f, list = live) => Object.entries(list.reduce((m, h) => ((m[f(h)] ||= []).push(h), m), {})).map(([k, l]) => ({ key: k, ...stat(l) })).sort((a, b) => b.picks - a.picks);
  // Calibration: do picks we called 60-70% land 60-70% of the time?
  const buckets = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.01]].map(([lo, hi]) => {
    const P = (h) => h.shown ?? h.p;
    const l = live.filter((h) => h.status !== 'push' && P(h) >= lo && P(h) < hi);
    return { label: `${Math.round(lo * 100)}–${hi > 1 ? 100 : Math.round(hi * 100)}%`, n: l.length, predicted: l.length ? l.reduce((s, h) => s + P(h), 0) / l.length : null, actual: l.length ? l.filter((h) => h.status === 'won').length / l.length : null };
  });
  const firstAt = history.reduce((t, h) => Math.min(t, h.recordedAt || Infinity), Infinity);
  return {
    since: Number.isFinite(firstAt) ? firstAt : null, all: stat(graded), multi: stat(multis), byTarget: MULTI_TARGETS.map((t) => ({ key: `${t}x`, target: t, ...stat(multis.filter((m) => m.target === t)), slips: slipsOf([t]).slice(0, 12) })),
    mega: { ...stat(multis.filter((m) => m.target >= 100)), slips: slipsOf([100, 1000]).slice(0, 12) },
    potd: { ...stat(multis.filter((m) => m.target === 'potd')), slips: slipsOf(['potd']).slice(0, 14) },
    live: stat(live),
    byType: group((h) => h.type, graded), bySport: group((h) => h.sport), byFamily: group((h) => familyOf(h.market)), byModel: group((h) => h.model || 'before 2026.10.1'), buckets,
    pending: history.filter((h) => h.status === 'pending' && (isLive(h) || (h.type === 'multi' && (MULTI_TARGETS.includes(h.target) || h.target === 'potd')))).sort((a, b) => a.start - b.start),
    unresolved: history.filter((h) => h.status === 'unresolved' && isLive(h)).length,
    // Retired on 23 Oct 2026 (Best bets at one bookmaker's price: 25 Oct), each with its final record
    // (they lost money; the reason they were cut).
    retired: [['Best bets at one bookmaker\'s price (to 25 Oct)', stat(settledAll.filter(oldBest))], ['Shortlist bankers (odds 1.30-1.80)', stat(graded)], ['Surest (odds 1.20-1.40)', stat(safe)], ['Singles near 2.00', stat(settledAll.filter((h) => h.type === 'two'))],
      ['Model-only picks (no price)', stat(models)], ['4x to 20x slips', stat(multis.filter((m) => [4, 5, 10, 20].includes(m.target)))], ['Mega slips (100x, 1000x)', stat(multis.filter((m) => m.target >= 100))]]
      .map(([name, st]) => ({ name, ...st })).filter((r) => r.won + r.lost),
    outside: stat(outside), safe: stat(safe), best: stat(best), two: stat(settledAll.filter((h) => h.type === 'two')), edge: stat(settledAll.filter((h) => h.type === 'edge')),
    // Model-only picks (no price): hit rate against forecast and Brier only; their "odds" are fair
    // odds, so profit means nothing for them and is not shown.
    model: { ...stat(models), bySport: Object.entries(models.reduce((m, h) => ((m[h.sport] ||= []).push(h), m), {})).map(([k, l]) => ({ key: k, ...stat(l) })).sort((a, b) => b.picks - a.picks) },
    recent: live.slice().sort((a, b) => b.start - a.start).slice(0, 40),
  };
}

// Final result of a bo3.gg series (esports): map score and winner, or { done: false } / { void: true }.
// Final result for one competition from an ESPN scoreboard (MMA fights and tennis matches: their
// records carry the fight's or match's own id, which the summary endpoint does not take; the summary
// wants the whole card's or tournament's id).
export function resultFromScoreboard(sb, compId) {
  const c = (sb?.events || []).flatMap((e) => [...(e.competitions || []), ...(e.groupings || []).flatMap((g) => g.competitions || [])]).find((x) => String(x.id) === String(compId));
  if (!c) return { done: false };
  return resultFromSummary({ header: { competitions: [c] } });
}

export function resultFromBo3(m) {
  if (!m) return { done: false };
  if (m.status === 'canceled' || m.status === 'cancelled') return { void: true };
  if (m.status !== 'finished' && m.status !== 'defwin') return { done: false };
  const winner = m.winner_team_id == null ? null : String(m.winner_team_id) === String(m.team1_id) ? 'home' : 'away';
  return { done: true, homeScore: m.team1_score, awayScore: m.team2_score, winner };
}

