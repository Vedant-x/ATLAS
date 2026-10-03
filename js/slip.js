// Bet slip: legs picked anywhere on the site. Kept in localStorage (per browser) when available.
const KEY = 'atlas-slip-v1';
let legs = [];
let stake = 10;
const subs = new Set();

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  if (Array.isArray(saved.legs)) legs = saved.legs;
  if (Number.isFinite(saved.stake)) stake = saved.stake;
} catch { /* storage blocked: slip lives for this visit only */ }

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ legs, stake })); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export const slip = {
  get legs() { return legs; },
  get stake() { return stake; },
  set stake(v) { stake = Math.max(0, Number(v) || 0); save(); },
  has: (key) => legs.some((l) => l.key === key),
  toggle(leg) {
    if (legs.some((l) => l.key === leg.key)) legs = legs.filter((l) => l.key !== leg.key);
    else legs = [...legs, { ...leg, addedAt: Date.now() }]; // addedAt: prices go stale
    save();
    return legs.some((l) => l.key === leg.key);
  },
  remove(key) { legs = legs.filter((l) => l.key !== key); save(); },
  clear() { legs = []; save(); },
  subscribe(f) { subs.add(f); return () => subs.delete(f); },
  summary() {
    const odds = legs.reduce((a, l) => a * l.odds, 1);
    const p = legs.reduce((a, l) => a * l.p, 1);
    const events = new Map();
    legs.forEach((l) => events.set(l.eventId, (events.get(l.eventId) || 0) + 1));
    const correlated = [...events.values()].some((n) => n > 1);
    const derived = legs.some((l) => l.derived);
    return { odds, p, ev: p * odds - 1, payout: stake * odds, correlated, derived, n: legs.length };
  },
  text() {
    const s = this.summary();
    return [...legs.map((l) => `${l.pick} @ ${l.odds.toFixed(2)} (${l.market} · ${l.match})`),
      `Total ${s.odds.toFixed(2)}x · win chance ${(s.p * 100).toFixed(2)}%`].join('\n');
  },
};
