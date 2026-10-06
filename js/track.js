// Track record: which picks ATLAS publishes, how they are graded from final scores, and the summary
// statistics shown on the Record page. Pure functions, shared by the build (scripts/record.mjs) and
// the browser.
import { applyModel, bankers, valueSpots } from './intel.js';
import { bankerSlips } from './picks.js';

export const MIN_ODDS = 1.3;

// Market families the track record learns from: winner, 1X2 result, spread/handicap, totals.
export const familyOf = (market = '') => (/^Total/.test(market) ? 'total' : market === 'Spread' ? 'spread' : market === 'Match Result' ? 'result' : 'winner');

// Self-correcting accuracy: per market family, how the settled picks did against their estimates.
// A family that lands less often than estimated gets its probabilities scaled down (so it needs a
// stronger estimate to qualify); one that beats its estimates gets a small lift. The weight grows
// with the number of settled picks, so a few results can't swing it. Every graded multiplier leg
// counts too (each is a single prediction with its own result), so the model learns from more data.
// Penalties bite harder than rewards: an overconfident market costs more than a modest one gains.
export function calibration(history = []) {
  const out = {};
  const add = (market, p, status) => {
    if (status !== 'won' && status !== 'lost') return;
    const r = (out[familyOf(market)] ||= { n: 0, won: 0, exp: 0 });
    r.n++; r.won += status === 'won' ? 1 : 0; r.exp += p;
  };
  for (const h of history) {
    if (h.type === 'multi') for (const l of h.legs || []) add(l.market, l.p, l.status);
    else add(h.market, h.p, h.status);
  }
  for (const r of Object.values(out)) {
    r.hit = r.won / r.n; r.expected = r.exp / r.n;
    const w = r.n / (r.n + 12), d = r.hit / r.expected - 1;
    r.factor = Math.max(0.8, Math.min(1.05, 1 + (d < 0 ? 2 : 1.2) * w * d));
  }
  return out;
}
export const calibrated = (p, market, cal) => Math.min(0.99, p * (cal?.[familyOf(market)]?.factor ?? 1));

// Official picks for matches starting in the next `hours`: bankers (estimated 60%+) and value spots
// (model 3%+ above the price), all at odds of at least MIN_ODDS. Locked at the first price seen.
export function selectPicks(events, now = Date.now(), hours = 12, history = []) {
  const soon = applyModel(events.filter((e) => !e.live && e.compId && e.start > now && e.start < now + hours * 36e5));
  const cal = calibration(history);
  const keep = (b) => calibrated(b.p, b.market, cal) >= 0.6;
  const row = (type) => (b) => ({
    key: `${b.event.id}|${b.market}|${b.pick}`, type, eventId: b.event.id, leaguePath: b.event.leaguePath, compId: b.event.compId,
    sport: b.event.sport, league: b.event.league, home: b.event.home, away: b.event.away, start: b.event.start,
    market: b.market, pick: b.pick, odds: b.odds, p: +b.p.toFixed(4), recordedAt: now, status: 'pending',
  });
  return [
    ...bankers(soon, { min: 0.6, minOdds: MIN_ODDS, limit: 40 }).filter(keep).map(row('banker')),
    ...valueSpots(soon, { minEdge: 0.03, minOdds: MIN_ODDS, limit: 40 }).map(row('value')),
    ...multiPicks(events, now, history),
  ];
}

// The day's official multiplier and mega slips (2x up to 1000x), built from bankers exactly as the site
// shows them (picks.js), from bookmaker-priced matches in the next 18 hours (36 for 100x+), locked
// once per UTC day and graded leg by leg.
export const MULTI_TARGETS = [2, 3, 4, 5, 10, 20, 100, 1000];
export function multiPicks(events, now = Date.now(), history = []) {
  const pool = applyModel(events.filter((e) => !e.live && e.compId && e.markets?.length && e.start > now + 30 * 6e4 && e.start < now + 36 * 36e5));
  const byId = new Map(pool.map((e) => [e.id, e]));
  const cal = calibration(history);
  const day = new Date(now).toISOString().slice(0, 10);
  const out = [];
  for (const target of MULTI_TARGETS) {
    const near = target >= 100 ? pool : pool.filter((e) => e.start < now + 18 * 36e5);
    const best = bankerSlips(near, target, { count: 1, tolerance: target >= 100 ? 0.15 : 0.1, cal })[0];
    if (!best) continue;
    const legs = best.legs.map((l) => { const e = byId.get(l.eventId); return { eventId: e.id, leaguePath: e.leaguePath, compId: e.compId, sport: e.sport, league: e.league, home: e.home, away: e.away, start: e.start, market: l.market, pick: l.pick, odds: l.odds, p: +l.p.toFixed(4), status: 'pending' }; });
    out.push({
      key: `multi|${day}|${target}x`, type: 'multi', target, legs, eventId: legs[0].eventId, sport: 'multi', league: `${target}x multiplier`,
      home: `${legs.length}-leg ${target}x slip`, away: '', start: Math.max(...legs.map((l) => l.start)), market: `${target}x multiplier`,
      pick: legs.map((l) => l.pick).join(' + '), odds: +best.odds.toFixed(2), p: +best.p.toFixed(4), recordedAt: now, status: 'pending',
    });
  }
  return out;
}

// A multiplier is lost as soon as one leg loses; won once every leg is settled with no loss (pushed or
// void legs drop out and the odds shrink accordingly); void if every leg is void.
export function settleMulti(m) {
  if (m.legs.some((l) => l.status === 'lost')) return { status: 'lost' };
  if (m.legs.some((l) => l.status === 'pending')) return { status: 'pending' };
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

// Summary statistics for the Record page. Profit is in units at a flat 1-unit stake. The main record
// covers single picks only (bankers and value spots); every multiplier target and the mega slips keep
// a separate record of their own (byTarget), shown on their own pages.
export function summarize(history) {
  const settledAll = history.filter((h) => h.status === 'won' || h.status === 'lost' || h.status === 'push');
  const graded = settledAll.filter((h) => h.type !== 'multi');
  const multis = settledAll.filter((h) => h.type === 'multi');
  const slipsOf = (ts) => history.filter((h) => h.type === 'multi' && ts.includes(h.target)).sort((a, b) => b.start - a.start);
  const stat = (list) => {
    const won = list.filter((h) => h.status === 'won'), lost = list.filter((h) => h.status === 'lost');
    const settled = won.length + lost.length;
    const profit = won.reduce((s, h) => s + h.odds - 1, 0) - lost.length;
    return {
      picks: list.length, won: won.length, lost: lost.length, push: list.length - settled,
      hitRate: settled ? won.length / settled : null,
      expected: settled ? [...won, ...lost].reduce((s, h) => s + h.p, 0) / settled : null,
      profit: +profit.toFixed(2), roi: settled ? profit / settled : null,
      avgOdds: settled ? [...won, ...lost].reduce((s, h) => s + h.odds, 0) / settled : null,
    };
  };
  const group = (f) => Object.entries(graded.reduce((m, h) => ((m[f(h)] ||= []).push(h), m), {})).map(([k, l]) => ({ key: k, ...stat(l) })).sort((a, b) => b.picks - a.picks);
  // Calibration: do picks we called 60-70% land 60-70% of the time?
  const buckets = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.01]].map(([lo, hi]) => {
    const l = graded.filter((h) => h.status !== 'push' && h.p >= lo && h.p < hi);
    return { label: `${Math.round(lo * 100)}–${hi > 1 ? 100 : Math.round(hi * 100)}%`, n: l.length, predicted: l.length ? l.reduce((s, h) => s + h.p, 0) / l.length : null, actual: l.length ? l.filter((h) => h.status === 'won').length / l.length : null };
  });
  const firstAt = history.reduce((t, h) => Math.min(t, h.recordedAt || Infinity), Infinity);
  return {
    since: Number.isFinite(firstAt) ? firstAt : null, all: stat(graded), multi: stat(multis), byTarget: MULTI_TARGETS.map((t) => ({ key: `${t}x`, target: t, ...stat(multis.filter((m) => m.target === t)), slips: slipsOf([t]).slice(0, 12) })),
    mega: { ...stat(multis.filter((m) => m.target >= 100)), slips: slipsOf([100, 1000]).slice(0, 12) },
    byType: group((h) => h.type), bySport: group((h) => h.sport), byFamily: group((h) => familyOf(h.market)), buckets,
    pending: history.filter((h) => h.status === 'pending' && h.type !== 'multi').sort((a, b) => a.start - b.start),
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

