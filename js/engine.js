// Probability + slip-building engine.
// Odds are decimal. "Fair" probability = bookmaker implied probability with the margin (vig) removed.

// The fair (margin-free) chance of each outcome. Where the market carries a consensus chance from
// many bookmakers (oddsapi.js: Pinnacle's, or the median's, margin removed), that is the fair
// chance, and the odds are the best price on offer; otherwise the market's own prices, margin removed.
export function devig(market) {
  const inv = market.outcomes.map((o) => 1 / o.odds);
  const book = inv.reduce((a, b) => a + b, 0);
  const cons = market.outcomes.every((o) => Number.isFinite(o.cons) && o.cons > 0);
  return {
    margin: book - 1,
    outcomes: market.outcomes.map((o, i) => ({ ...o, fair: cons ? o.cons : inv[i] / book })),
  };
}

// A sharp book's prices, margin removed by the power method: each implied chance raised to the same
// power k so they add up to 1. Books load more of their margin onto the longer prices (the
// favourite-longshot bias); an even split leaves a long price's chance too high, so a long price at
// another book looks better than it is. Prices in, fair chances out (same order); null if unusable.
export function powerDevig(prices) {
  const inv = prices.map((x) => 1 / x);
  if (inv.length < 2 || !inv.every((x) => x > 0 && x < 1)) return null;
  const sum = (k) => inv.reduce((a, x) => a + x ** k, 0);
  // sum(k) falls as k grows: bracket the k where it is 1, then halve the bracket.
  let lo = 1, hi = 1;
  while (sum(hi) > 1) hi *= 2;
  while (sum(lo) < 1) lo /= 2;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (sum(mid) > 1) lo = mid; else hi = mid; }
  const k = (lo + hi) / 2;
  return inv.map((x) => +(x ** k).toFixed(4));
}

// Each side's chance to win outright (the model's where it has one), from the match-winner market.
export function winChances(ev) {
  const m = (ev.markets || []).find((x) => x.name === 'Winner' || x.name === 'Match Result' || x.name === 'Moneyline');
  if (!m) return null;
  const { outcomes } = devig(m);
  const at = (team) => { const i = m.outcomes.findIndex((o) => o.name === team); return i < 0 ? null : m.outcomes[i].model ?? outcomes[i].fair; };
  const home = at(ev.home), away = at(ev.away);
  return home == null || away == null ? null : { home, away };
}
// A plus handicap on the side less likely to win (Rays +1.5, Getafe +0.5): it lands often, but it is
// a bet on the losing team hanging on, and a single blow-out loses it. The shortlist and the slips
// leave these out and back the favourite, the total or the winner instead.
export function underdogCushion(ev, market, pick) {
  if (market !== 'Spread') return false;
  const team = pick.startsWith(ev.home) ? 'home' : pick.startsWith(ev.away) ? 'away' : null;
  const line = Number(String(pick).slice(String(team === 'home' ? ev.home : ev.away).length));
  if (!team || !(line > 0)) return false;
  const w = winChances(ev);
  return !w || w[team] < w[team === 'home' ? 'away' : 'home'];
}

// Every selectable leg across all events, with its fair probability and edge.
// Edge > 0 only when our model probability beats the price; otherwise we use the fair price.
export function allLegs(events) {
  const legs = [];
  for (const ev of events) {
    for (const m of ev.markets) {
      const { margin, outcomes } = devig(m);
      // The sharp book's margin off by the power method too, where its own prices are held.
      const pow = m.outcomes.every((x) => x.pin > 1) ? powerDevig(m.outcomes.map((x) => x.pin)) : null;
      for (const [i, o] of outcomes.entries()) {
        const p = o.model ?? o.fair;
        // The market reference behind the leg (a sharp or many-book fair chance) and when it and the
        // leg's own price were read, so a slip can be held to the same price rule as a single.
        const consensus = Number.isFinite(m.outcomes[i].cons);
        legs.push({
          eventId: ev.id,
          sport: ev.sport,
          start: ev.start,
          match: `${ev.home} vs ${ev.away}`,
          market: m.name,
          pick: o.name,
          odds: o.odds,
          p,
          margin,
          ev: p * o.odds - 1,
          cushion: underdogCushion(ev, m.name, o.name),
          ...(consensus ? { consensus: true, fair: o.fair, ...(pow ? { fairPow: pow[i] } : {}), refAt: ev.sharpAt ?? (ev.oddsSource === 'the-odds-api' ? ev.priceAt : null) ?? null } : {}),
          quoteAt: ev.priceAt ?? ev.fetchedAt ?? null,
          ...(m.outcomes[i].stake > 1 ? { stake: m.outcomes[i].stake, stakeAt: ev.stakeAt ?? null } : {}),
        });
      }
    }
  }
  return legs;
}

// Calendar date in IST, whatever the device's clock zone.
export const localDay = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
// The dashboard window: matches starting in the next `hours` (12 by default), so the board never
// shows fixtures days away and never goes empty just because the date is about to change. Live
// games are out: their stored prices are pre-match.
export const WINDOW_HOURS = 12;
export function todayEvents(events, now = Date.now(), hours = WINDOW_HOURS) {
  return events.filter((e) => !e.live && e.start > now && e.start <= now + hours * 36e5);
}

// Find combinations (one leg per event) whose total odds land near `target`,
// ranked by combined probability. Returns up to `count` non-overlapping slips.
export function buildSlips(events, target, { count = 5, maxLegs = 4, tolerance = 0.12, minOdds = 1.08 } = {}) {
  const legs = allLegs(events)
    .filter((l) => l.odds >= Math.max(1.08, minOdds) && l.odds <= target * (1 + tolerance))
    .sort((a, b) => b.ev - a.ev || b.p - a.p)
    .slice(0, 220);

  const lo = target * (1 - tolerance);
  const hi = target * (1 + tolerance);
  const found = [];
  let budget = 400000;

  const dfs = (start, chosen, odds, p, used) => {
    if (--budget < 0) return;
    if (odds >= lo && odds <= hi && chosen.length) {
      found.push({ legs: [...chosen], odds, p });
    }
    if (chosen.length >= maxLegs || odds > hi) return;
    for (let i = start; i < legs.length; i++) {
      const l = legs[i];
      if (used.has(l.eventId)) continue;
      const nextOdds = odds * l.odds;
      if (nextOdds > hi) continue;
      // Prune: even the remaining legs at max odds can't reach lo.
      if (chosen.length + 1 === maxLegs && nextOdds < lo) continue;
      used.add(l.eventId);
      chosen.push(l);
      dfs(i + 1, chosen, nextOdds, p * l.p, used);
      chosen.pop();
      used.delete(l.eventId);
    }
  };
  if (maxLegs <= 4) dfs(0, [], 1, 1, new Set());
  else found.push(...sampleSlips(legs, lo, hi, maxLegs));

  found.sort((a, b) => b.p * b.odds - a.p * a.odds || b.p - a.p);

  // Keep slips that don't reuse the same events, so the 5 suggestions are distinct.
  const picked = [];
  const usedEvents = new Set();
  for (const s of found) {
    if (s.legs.some((l) => usedEvents.has(l.eventId))) continue;
    picked.push(s);
    s.legs.forEach((l) => usedEvents.add(l.eventId));
    if (picked.length === count) break;
  }
  // Event pool too small: allow slips that share at most half their events with any pick.
  const key = (l) => `${l.eventId}|${l.market}|${l.pick}`;
  for (const s of found) {
    if (picked.length >= count) break;
    const keys = new Set(s.legs.map(key));
    const tooClose = picked.some((p) => p.legs.filter((l) => keys.has(key(l))).length > s.legs.length / 2);
    if (!tooClose) picked.push(s);
  }
  return picked;
}

// Long accumulators: exhaustive search explodes, so build many random slips leg by leg.
function sampleSlips(legs, lo, hi, maxLegs, tries = 6000) {
  const pool = legs.filter((l) => l.odds <= 4);
  const out = [];
  for (let t = 0; t < tries; t++) {
    const used = new Set();
    const chosen = [];
    let odds = 1, p = 1;
    for (let guard = 0; guard < 60 && odds < lo && chosen.length < maxLegs; guard++) {
      const l = pool[Math.floor(Math.random() * pool.length)];
      if (used.has(l.eventId) || odds * l.odds > hi) continue;
      used.add(l.eventId);
      chosen.push(l);
      odds *= l.odds;
      p *= l.p;
    }
    if (odds >= lo && odds <= hi) out.push({ legs: chosen, odds, p });
  }
  return out;
}

export const pct = (p) => `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`;

// Order for every list of bets: the list's own ranking, soonest start first, or latest first.
// `startOf(item)` gives the start time (bets carry their event; slip legs their own start).
export const ORDERS = [['asc', 'Soonest first'], ['desc', 'Latest first'], ['rank', 'Best first']];
export function orderByTime(list, order = 'rank', startOf = (b) => b.event?.start ?? b.start ?? 0) {
  if (order !== 'asc' && order !== 'desc') return list;
  const dir = order === 'asc' ? 1 : -1;
  return list.map((b, i) => ({ b, i, t: startOf(b) || 0 })).sort((x, y) => dir * (x.t - y.t) || x.i - y.i).map((x) => x.b);
}
