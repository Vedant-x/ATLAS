// Stake guidance from a bankroll the viewer types in (kept in this browser only). Quarter Kelly on
// ATLAS's chance, capped at 2% of the bankroll on a single and 1% on a multi, and nothing at all
// where ATLAS sees no edge at the price: a likely pick at a short price is still a losing bet on
// average if the price is too short.
export const CAP_SINGLE = 0.02;
export const CAP_MULTI = 0.01;
export const EXPOSURE_WARN = 0.05; // a stake above 5% of the bankroll gets a warning

const round = (x) => (x >= 100 ? Math.round(x) : Math.round(x * 100) / 100);

export function suggestStake(bankroll, p, odds, { legs = 1 } = {}) {
  const cap = legs > 1 ? CAP_MULTI : CAP_SINGLE;
  if (!(bankroll > 0) || !(odds > 1) || !(p > 0 && p < 1)) return { amount: 0, frac: 0, cap, edge: false };
  const quarterKelly = Math.max(0, (p * odds - 1) / (odds - 1)) / 4;
  if (quarterKelly <= 0) return { amount: 0, frac: 0, cap, edge: false };
  const frac = Math.min(quarterKelly, cap);
  return { amount: round(bankroll * frac), frac, cap, edge: true, capped: quarterKelly > cap };
}

// True when a stake is a large share of the bankroll.
export const overExposed = (bankroll, stake) => bankroll > 0 && stake > bankroll * EXPOSURE_WARN;
