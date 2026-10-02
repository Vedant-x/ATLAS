// "Self intelligence": a light model layered on the market price.
// The market is the strongest single predictor, so the model starts from the de-vigged price and nudges it
// toward each side's season record and recent form. Disagreement between the two shows up as value (EV).
import { devig } from './engine.js';

const MARKET_WEIGHT = 0.8;

// "12-3" or "8-2-4" (W-D-L for soccer, W-L-OTL for hockey: treat the 3rd number as losses).
function recordRate(summary, soccer) {
  const n = String(summary || '').split('-').map(Number);
  if (n.length < 2 || n.some((x) => !Number.isFinite(x))) return null;
  const [w, a, b = 0] = n;
  const games = w + a + b;
  if (!games) return null;
  const draws = soccer ? a : 0;
  // Laplace smoothing keeps early-season records from swinging the model.
  return (w + 0.5 * draws + 1) / (games + 2);
}

function formRate(form) {
  if (!form?.length) return null;
  const pts = form.reduce((s, r) => s + (r === 'W' ? 1 : r === 'D' ? 0.5 : 0), 0);
  return (pts + 1) / (form.length + 2);
}

function strength(e, side) {
  const soccer = e.sport === 'football';
  const rec = recordRate(e.stats?.[`${side}Record`], soccer);
  const frm = formRate(e.stats?.[`${side}Form`]);
  if (rec == null && frm == null) return null;
  if (rec == null) return frm;
  if (frm == null) return rec;
  return 0.6 * rec + 0.4 * frm;
}

// Adds `model` probabilities to the winner/result market of each event (mutates events).
// The market price is a far stronger signal than a season record, so the record/form view may only
// nudge the price: a small step in log-odds space, capped at MAX_SHIFT. Without the cap, records
// (which understate how lopsided mismatches are) make nearly every longshot look like value.
const MAX_SHIFT = 0.08;
const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
export function applyModel(events) {
  for (const e of events) {
    const m = e.markets?.find((x) => x.name === 'Winner' || x.name === 'Match Result');
    if (!m) continue;
    const sh = strength(e, 'home'), sa = strength(e, 'away');
    if (sh == null || sa == null) continue;
    const { outcomes } = devig(m);
    const drawP = outcomes.find((o) => o.name === 'Draw')?.fair ?? 0;
    const shareH = sh ** 2 / (sh ** 2 + sa ** 2);
    const nudged = outcomes.map((o) => {
      if (o.name === 'Draw') return o.fair;
      const stat = (o.name === e.home ? shareH : 1 - shareH) * (1 - drawP);
      const shift = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, (1 - MARKET_WEIGHT) * (logit(stat) - logit(o.fair))));
      return sigmoid(logit(o.fair) + shift);
    });
    // Renormalise the two sides so the market still sums to 1 with the draw unchanged.
    const sides = nudged.reduce((t, p, i) => t + (outcomes[i].name === 'Draw' ? 0 : p), 0);
    m.outcomes.forEach((o, i) => {
      o.model = +(outcomes[i].name === 'Draw' ? drawP : (nudged[i] / sides) * (1 - drawP)).toFixed(4);
    });
  }
  return events;
}

// Strongest favourites across every sport: what the dashboard calls bankers.
export function bankers(events, { min = 0.7, limit = 24 } = {}) {
  const out = [];
  for (const e of events) {
    if (!e.markets?.length) continue;
    for (const m of e.markets) {
      const { outcomes } = devig(m);
      outcomes.forEach((o, i) => {
        const p = m.outcomes[i].model ?? o.fair;
        if (p < min) return;
        out.push({ event: e, market: m.name, pick: o.name, odds: o.odds, p, ev: p * o.odds - 1,
          agree: m.outcomes[i].model == null ? null : m.outcomes[i].model >= o.fair });
      });
    }
  }
  return out.sort((a, b) => b.p - a.p).slice(0, limit);
}

// Where the model rates a side clearly higher than the price does.
export function valueSpots(events, { minEdge = 0.03, limit = 12 } = {}) {
  const out = [];
  for (const e of events) {
    for (const m of e.markets || []) {
      m.outcomes.forEach((o) => {
        if (o.model == null || o.odds > 5) return; // longshot "edges" are mostly model noise
        const ev = o.model * o.odds - 1;
        if (ev >= minEdge) out.push({ event: e, market: m.name, pick: o.name, odds: o.odds, p: o.model, ev });
      });
    }
  }
  return out.sort((a, b) => b.ev - a.ev).slice(0, limit);
}
