// Probability + slip-building engine.
// Odds are decimal. "Fair" probability = bookmaker implied probability with the margin (vig) removed.

export function devig(market) {
  const inv = market.outcomes.map((o) => 1 / o.odds);
  const book = inv.reduce((a, b) => a + b, 0);
  return {
    margin: book - 1,
    outcomes: market.outcomes.map((o, i) => ({ ...o, fair: inv[i] / book })),
  };
}

// Every selectable leg across all events, with its fair probability and edge.
// Edge > 0 only when our model probability beats the price; otherwise we use the fair price.
export function allLegs(events) {
  const legs = [];
  for (const ev of events) {
    for (const m of ev.markets) {
      const { margin, outcomes } = devig(m);
      for (const o of outcomes) {
        const p = o.model ?? o.fair;
        legs.push({
          eventId: ev.id,
          sport: ev.sport,
          match: `${ev.home} vs ${ev.away}`,
          market: m.name,
          pick: o.name,
          odds: o.odds,
          p,
          margin,
          ev: p * o.odds - 1,
        });
      }
    }
  }
  return legs;
}

// Events still to start today in the viewer's local time (live games are out: their stored prices are pre-match).
export const localDay = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA');
export function todayEvents(events, now = Date.now()) {
  const today = localDay(now);
  return events.filter((e) => !e.live && e.start > now && localDay(e.start) === today);
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
