// Personal betting filters, saved in this browser: minimum odds per pick, preferred sports, and
// whether picks must have a real bookmaker price. Applied to bankers, value spots, multiplier slips,
// the home shortlist and the assistant's suggestions.
const KEY = 'atlas-prefs-v1';
export const DEFAULT_PREFS = { minOdds: 1.3, sports: [], pricedOnly: false };
const subs = new Set();
let cur = { ...DEFAULT_PREFS };
try { cur = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* storage blocked: defaults */ }

export const prefs = {
  get: () => cur,
  set(patch) {
    cur = { ...cur, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* ignore */ }
    subs.forEach((f) => f(cur));
  },
  subscribe(f) { subs.add(f); return () => subs.delete(f); },
  // Stable string for cache keys.
  sig: () => `${cur.minOdds}|${cur.sports.join(',')}|${cur.pricedOnly ? 1 : 0}`,
};

// Events allowed by the sport preference (empty list = every sport).
export const prefEvents = (events, p = cur) => (p.sports.length ? events.filter((e) => p.sports.includes(e.sport)) : events);
