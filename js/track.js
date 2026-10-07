// Track record: which picks ATLAS publishes, how they are graded from final scores, and the summary
// statistics shown on the Record page. Pure functions, shared by the build (scripts/record.mjs) and
// the browser.
import { applyModel, bankers } from './intel.js';
import { bankerSlips } from './picks.js';
import { localDay } from './engine.js';

export const MIN_ODDS = 1.3;
// The shortlist's price range: short-priced favourites only. The record, the shortlist and the
// Bankers page all use it, so every recorded pick is one the shortlist showed.
export const MAX_ODDS = 1.8;
// What the public record counts: shortlist picks (rated 60%+, odds MIN_ODDS to MAX_ODDS). Value spots
// and longer prices saved before this rule stay in the history file (and still teach the track-record
// correction) but are counted separately, whatever their result.
export const inRecord = (h) => h.type === 'banker' && h.odds >= MIN_ODDS && h.odds <= MAX_ODDS;
// Stamped on every recorded pick, so results can be split by the model that made them.
// 2026.10.1: calibrated chance everywhere, legs feed calibration, shared slip policy.
// 2026.10.2: venue records, starting pitchers and soccer absences in the model; spread lines move
//   with the modelled win chance; track-record correction per sport and market; varied pick lists.
export const MODEL_VERSION = '2026.10.2';

// Market families the track record learns from: winner, 1X2 result, spread/handicap, totals.
export const familyOf = (market = '') => (/^Total/.test(market) ? 'total' : market === 'Spread' ? 'spread' : market === 'Match Result' ? 'result' : 'winner');

// Self-correcting accuracy: per market family, how the settled picks did against their estimates.
// A family that lands less often than estimated gets its probabilities scaled down (so it needs a
// stronger estimate to qualify); one that beats its estimates gets a small lift. The weight grows
// with the number of settled picks, so a few results can't swing it. Every graded multiplier leg
// counts too (each is a single prediction with its own result), so the model learns from more data.
// Penalties bite harder than rewards: an overconfident market costs more than a modest one gains.
// Each family is also tracked per sport ("hockey:spread"): a hockey +1.5 puck line and a soccer
// handicap behave differently, so once a sport has enough settled picks in a family, its own record
// is used instead of the all-sports one.
export function calibration(history = []) {
  const out = {};
  const add = (market, p, status, sport) => {
    if (status !== 'won' && status !== 'lost') return;
    for (const key of [familyOf(market), sport ? `${sport}:${familyOf(market)}` : null].filter(Boolean)) {
      const r = (out[key] ||= { n: 0, won: 0, exp: 0 });
      r.n++; r.won += status === 'won' ? 1 : 0; r.exp += p;
    }
  };
  for (const h of history) {
    // Always the model's own (uncalibrated) estimate, so the correction never feeds on itself.
    if (h.type === 'multi') for (const l of h.legs || []) add(l.market, l.pRaw ?? l.p, l.status, l.sport);
    else add(h.market, h.p, h.status, h.sport);
  }
  for (const r of Object.values(out)) {
    r.hit = r.won / r.n; r.expected = r.exp / r.n;
    const w = r.n / (r.n + 12), d = r.hit / r.expected - 1;
    r.factor = Math.max(0.8, Math.min(1.05, 1 + (d < 0 ? 2 : 1.2) * w * d));
  }
  return out;
}
const SPORT_MIN = 8; // settled picks before a sport's own record replaces the all-sports one
export const calibrated = (p, market, cal, sport) => {
  const own = sport ? cal?.[`${sport}:${familyOf(market)}`] : null;
  return Math.min(0.99, p * ((own?.n >= SPORT_MIN ? own : cal?.[familyOf(market)])?.factor ?? 1));
};

// One probability per selection, everywhere: the model estimate after the track-record check
// (calibrated). Cards, slips, the assistant and the official record all use these two functions, so a
// pick shows the same chance wherever it appears. Each row keeps the market's margin-free chance
// (fair) and the uncalibrated model estimate (pRaw) alongside, for transparency.
const withCal = (b, cal) => { const p = calibrated(b.p, b.market, cal, b.event?.sport); return { ...b, pRaw: b.p, p, ev: p * b.odds - 1 }; };

// A varied list instead of the same bet type again and again: one pick per match, and no market
// family (winner, result, spread, total) may take more than 40% of the list, nor one sport more than
// half, while other qualifying picks exist. On a thin board the caps loosen to half and two thirds;
// past that the list is simply shorter: fewer picks rather than the same bet type over and over.
export function diversify(list, limit, { familyShare = 0.4, sportShare = 0.5 } = {}) {
  const out = [], seen = new Set(), fam = {}, sp = {};
  for (const [fs, ss] of [[familyShare, sportShare], [0.5, 0.67]]) {
    const capF = Math.max(2, Math.ceil(limit * fs)), capS = Math.max(2, Math.ceil(limit * ss));
    for (const b of list) {
      if (out.length >= limit) break;
      const id = b.event?.id ?? b.eventId;
      if (seen.has(id)) continue;
      const f = familyOf(b.market), s = b.event?.sport ?? b.sport;
      if ((fam[f] || 0) >= capF || (sp[s] || 0) >= capS) continue;
      out.push(b); seen.add(id); fam[f] = (fam[f] || 0) + 1; sp[s] = (sp[s] || 0) + 1;
    }
  }
  return out;
}
export function rankedBankers(events, { cal = null, min = 0.6, minOdds = 1, maxOdds = MAX_ODDS, limit = 10, mix = true } = {}) {
  const all = bankers(events, { min: min * 0.9, minOdds, limit: Math.max(200, limit * 12) }).filter((b) => b.odds <= maxOdds).map((b) => withCal(b, cal))
    .filter((b) => b.p >= min).sort((x, y) => y.p - x.p);
  return (mix ? diversify(all, limit) : all.slice(0, limit)).sort((x, y) => y.p - x.p);
}

// Official picks for matches starting in the next `hours`: the shortlist's bankers (rated 60%+ at
// odds MIN_ODDS to MAX_ODDS), plus the multiplier slips, which keep their own records. Locked at the first price seen. `p` is the model's
// own estimate (what calibration learns from); `shown` is the calibrated chance the site displayed.
export function selectPicks(events, now = Date.now(), hours = 12, history = []) {
  const soon = applyModel(events.filter((e) => !e.live && e.compId && e.start > now && e.start < now + hours * 36e5));
  const cal = calibration(history);
  const row = (type) => (b) => ({
    key: `${b.event.id}|${b.market}|${b.pick}`, type, eventId: b.event.id, leaguePath: b.event.leaguePath, compId: b.event.compId,
    sport: b.event.sport, league: b.event.league, home: b.event.home, away: b.event.away, start: b.event.start,
    market: b.market, pick: b.pick, odds: b.odds, p: +b.pRaw.toFixed(4), shown: +b.p.toFixed(4), fair: b.fair == null ? null : +b.fair.toFixed(4),
    recordedAt: now, status: 'pending', model: MODEL_VERSION,
  });
  return [
    ...rankedBankers(soon, { cal, min: 0.6, minOdds: MIN_ODDS, maxOdds: MAX_ODDS, limit: 40 }).map(row('banker')),
    ...multiPicks(events, now, history),
  ];
}

// One slip policy for the pages and the official record: which matches a target may use and how
// close the total must land. The record saves the top slip under exactly this policy, and the pages
// show that saved slip as "today's official slip" (alternatives below it follow the viewer's filters).
export const MULTI_TARGETS = [2, 3, 4, 5, 10, 20, 100, 1000];
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
    const best = bankerSlips(slipWindow(pool, target, now), target, { count: 1, tolerance: slipPolicy(target).tolerance, cal })[0];
    if (!best) continue;
    const legs = best.legs.map((l) => { const e = byId.get(l.eventId); return { eventId: e.id, leaguePath: e.leaguePath, compId: e.compId, sport: e.sport, league: e.league, home: e.home, away: e.away, start: e.start, market: l.market, pick: l.pick, odds: l.odds, p: +l.p.toFixed(4), pRaw: +(l.pRaw ?? l.p).toFixed(4), status: 'pending' }; });
    out.push({
      key: `multi|${day}|${target}x`, type: 'multi', target, legs, eventId: legs[0].eventId, sport: 'multi', league: `${target}x multiplier`,
      home: `${legs.length}-leg ${target}x slip`, away: '', start: Math.max(...legs.map((l) => l.start)), market: `${target}x multiplier`,
      pick: legs.map((l) => l.pick).join(' + '), odds: +best.odds.toFixed(2), p: +best.p.toFixed(4), recordedAt: now, status: 'pending', model: MODEL_VERSION,
    });
  }
  return out;
}

// A multiplier is lost as soon as one leg loses; won once every leg is settled with no loss (pushed or
// void legs drop out and the odds shrink accordingly); void if every leg is void. A leg whose result
// could not be found stays "unresolved" and so does the slip: it is never counted as void or won.
export function settleMulti(m) {
  if (m.legs.some((l) => l.status === 'lost')) return { status: 'lost' };
  if (m.legs.some((l) => l.status === 'pending')) return { status: 'pending' };
  if (m.legs.some((l) => l.status === 'unresolved')) return { status: 'unresolved' };
  const won = m.legs.filter((l) => l.status === 'won');
  if (!won.length) return { status: 'void' };
  return { status: 'won', odds: +won.reduce((x, l) => x * l.odds, 1).toFixed(2) };
}

// Add new picks to the history (first price wins; a pick already recorded is never changed).
export function addPicks(history, picks) {
  const seen = new Set(history.map((h) => h.key));
  const fresh = picks.filter((p) => !seen.has(p.key) && seen.add(p.key));
  return [...history, ...fresh];
}

// Result of one pick from the final score: 'won' | 'lost' | 'push' | null (can't grade this market).
export function gradePick(p, r) {
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
  if (/postpon|cancel|abandon|forfeit|suspend/i.test(`${st.name} ${st.description}`)) return { void: true };
  if (!st.completed) return { done: false };
  const side = (k) => c.competitors?.find((x) => x.homeAway === k) || {};
  const h = side('home'), a = side('away');
  const winner = h.winner ? 'home' : a.winner ? 'away' : null;
  return { done: true, homeScore: h.score, awayScore: a.score, winner: winner || (h.score != null && h.score === a.score ? 'draw' : null) };
}

// Forecast quality beyond hit rate: Brier score (mean squared error of the chance shown; lower is
// better) and, on picks where the margin-free market chance was saved, the same score for the market
// as a baseline. ATLAS only adds something if its score beats the market's.
// Closing line: until a match starts, every build stores the latest bookmaker price for each pending
// pick (and each leg of a pending slip). The last one saved before kick-off is the closing price, the
// benchmark for whether ATLAS's saved price was better or worse than where the market finished.
export function updateClosing(history, events, now = Date.now()) {
  const byId = new Map(events.map((e) => [e.id, e]));
  const price = (r) => { const e = byId.get(r.eventId); return e && !e.live ? e.markets?.find((m) => m.name === r.market)?.outcomes?.find((o) => o.name === r.pick)?.odds : null; };
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
export function summarize(history) {
  const settledAll = history.filter((h) => h.status === 'won' || h.status === 'lost' || h.status === 'push');
  const graded = settledAll.filter(inRecord);
  const outside = settledAll.filter((h) => h.type !== 'multi' && !inRecord(h));
  const multis = settledAll.filter((h) => h.type === 'multi');
  const slipsOf = (ts) => history.filter((h) => h.type === 'multi' && ts.includes(h.target)).sort((a, b) => b.start - a.start);
  const stat = (list) => {
    const won = list.filter((h) => h.status === 'won'), lost = list.filter((h) => h.status === 'lost');
    const settled = won.length + lost.length;
    const profit = won.reduce((s, h) => s + h.odds - 1, 0) - lost.length;
    return {
      picks: list.length, won: won.length, lost: lost.length, push: list.length - settled,
      hitRate: settled ? won.length / settled : null,
      expected: settled ? [...won, ...lost].reduce((s, h) => s + (h.shown ?? h.p), 0) / settled : null,
      profit: +profit.toFixed(2), roi: settled ? profit / settled : null,
      avgOdds: settled ? [...won, ...lost].reduce((s, h) => s + h.odds, 0) / settled : null,
      ...brier([...won, ...lost]),
      ...closing([...won, ...lost]),
    };
  };
  const group = (f) => Object.entries(graded.reduce((m, h) => ((m[f(h)] ||= []).push(h), m), {})).map(([k, l]) => ({ key: k, ...stat(l) })).sort((a, b) => b.picks - a.picks);
  // Calibration: do picks we called 60-70% land 60-70% of the time?
  const buckets = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.01]].map(([lo, hi]) => {
    const P = (h) => h.shown ?? h.p;
    const l = graded.filter((h) => h.status !== 'push' && P(h) >= lo && P(h) < hi);
    return { label: `${Math.round(lo * 100)}–${hi > 1 ? 100 : Math.round(hi * 100)}%`, n: l.length, predicted: l.length ? l.reduce((s, h) => s + P(h), 0) / l.length : null, actual: l.length ? l.filter((h) => h.status === 'won').length / l.length : null };
  });
  const firstAt = history.reduce((t, h) => Math.min(t, h.recordedAt || Infinity), Infinity);
  return {
    since: Number.isFinite(firstAt) ? firstAt : null, all: stat(graded), multi: stat(multis), byTarget: MULTI_TARGETS.map((t) => ({ key: `${t}x`, target: t, ...stat(multis.filter((m) => m.target === t)), slips: slipsOf([t]).slice(0, 12) })),
    mega: { ...stat(multis.filter((m) => m.target >= 100)), slips: slipsOf([100, 1000]).slice(0, 12) },
    byType: group((h) => h.type), bySport: group((h) => h.sport), byFamily: group((h) => familyOf(h.market)), byModel: group((h) => h.model || 'before 2026.10.1'), buckets,
    pending: history.filter((h) => h.status === 'pending' && inRecord(h)).sort((a, b) => a.start - b.start),
    unresolved: history.filter((h) => h.status === 'unresolved' && inRecord(h)).length,
    outside: stat(outside),
    recent: graded.slice().sort((a, b) => b.start - a.start).slice(0, 40),
  };
}

// Final result of a bo3.gg series (esports): map score and winner, or { done: false } / { void: true }.
export function resultFromBo3(m) {
  if (!m) return { done: false };
  if (m.status === 'canceled' || m.status === 'cancelled') return { void: true };
  if (m.status !== 'finished' && m.status !== 'defwin') return { done: false };
  const winner = m.winner_team_id == null ? null : String(m.winner_team_id) === String(m.team1_id) ? 'home' : 'away';
  return { done: true, homeScore: m.team1_score, awayScore: m.team2_score, winner };
}

