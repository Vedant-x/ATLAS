// Track record: which picks ATLAS publishes, how they are graded from final scores, and the summary
// statistics shown on the Record page. Pure functions, shared by the build (scripts/record.mjs) and
// the browser.
import { applyModel, bankers, valueSpots } from './intel.js';

export const MIN_ODDS = 1.3;

// Official picks for matches starting in the next `hours`: bankers (estimated 60%+) and value spots
// (model 3%+ above the price), all at odds of at least MIN_ODDS. Locked at the first price seen.
export function selectPicks(events, now = Date.now(), hours = 12) {
  const soon = applyModel(events.filter((e) => !e.live && e.compId && e.start > now && e.start < now + hours * 36e5));
  const row = (type) => (b) => ({
    key: `${b.event.id}|${b.market}|${b.pick}`, type, eventId: b.event.id, leaguePath: b.event.leaguePath, compId: b.event.compId,
    sport: b.event.sport, league: b.event.league, home: b.event.home, away: b.event.away, start: b.event.start,
    market: b.market, pick: b.pick, odds: b.odds, p: +b.p.toFixed(4), recordedAt: now, status: 'pending',
  });
  return [
    ...bankers(soon, { min: 0.6, minOdds: MIN_ODDS, limit: 40 }).map(row('banker')),
    ...valueSpots(soon, { minEdge: 0.03, minOdds: MIN_ODDS, limit: 40 }).map(row('value')),
  ];
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

// Summary statistics for the Record page. Profit is in units at a flat 1-unit stake.
export function summarize(history) {
  const graded = history.filter((h) => h.status === 'won' || h.status === 'lost' || h.status === 'push');
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
    since: Number.isFinite(firstAt) ? firstAt : null, all: stat(graded), byType: group((h) => h.type), bySport: group((h) => h.sport), buckets,
    pending: history.filter((h) => h.status === 'pending').sort((a, b) => a.start - b.start),
    recent: graded.slice().sort((a, b) => b.start - a.start).slice(0, 40),
  };
}
