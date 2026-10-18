// Picks for matches no bookmaker in our feeds prices (most tennis, cricket, college sports, lower
// leagues). ATLAS's own model rates them from real evidence: rankings, ClubElo, season records and
// form, starting pitchers, ESPN's matchup predictor. A match with nothing but home advantage to go on
// is never a pick.
//
// Such a pick has no price, so it is shown as the side ATLAS favours and the fair odds (1 / chance):
// "worth it at X or better" at your own bookmaker. Its record is kept apart from the priced shortlist
// (type 'model'), judged on hit rate against its own forecasts, never on profit.
//
// Until a sport has 30 settled model picks, the chance is pulled a quarter of the way back toward
// 50/50: an unpriced model has not earned full trust. After that, the sport's own record scales it.
import { winProbs, analyse } from './models.js';

export const MODEL_MIN = 0.6; // the favoured side's chance (after the trust adjustment) to be a pick
const TRUST_MIN = 30, SHRINK = 0.75;

// Per sport, how settled model picks did against their own (unadjusted) forecasts.
export function modelRecord(history = []) {
  const out = {};
  for (const h of history) {
    if (h.type !== 'model' || (h.status !== 'won' && h.status !== 'lost')) continue;
    const r = (out[h.sport] ||= { n: 0, won: 0, exp: 0 });
    r.n++; r.won += h.status === 'won' ? 1 : 0; r.exp += h.p;
  }
  return out;
}

// The chance shown for a model-only pick: its own record once it has one, a cautious pull to 50/50 before.
export function modelChance(p, sport, record = {}) {
  const r = record[sport];
  if (r?.n >= TRUST_MIN && r.exp > 0) return Math.min(0.97, Math.max(0.03, p * (r.won / r.exp)));
  return 0.5 + (p - 0.5) * SHRINK;
}

// Model-only picks among `events` (unpriced, not live, starting within `hours`), best first, one per match.
export function modelPicks(events, { now = Date.now(), hours = 48, record = {}, min = MODEL_MIN } = {}) {
  const out = [];
  for (const e of events) {
    if (e.live || e.markets?.length || !(e.start > now) || e.start > now + hours * 36e5) continue;
    const w = winProbs(e);
    if (w.confidence !== 'medium') continue; // evidence, not the home-advantage baseline
    const side = w.home >= w.away ? 'home' : 'away';
    const pRaw = w[side];
    const p = modelChance(pRaw, e.sport, record);
    if (p < min) continue;
    const a = analyse(e);
    out.push({
      event: e, market: w.draw > 0 ? 'Match Result' : 'Winner', pick: side === 'home' ? e.home : e.away, side,
      p, pRaw, fairOdds: +(1 / p).toFixed(2), basis: a.basis, priced: false, modelOnly: true,
    });
  }
  return out.sort((x, y) => y.p - x.p);
}
