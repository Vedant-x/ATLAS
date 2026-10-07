// "Self intelligence": a light model layered on the market price.
// The market is the strongest single predictor, so the model starts from the de-vigged price and nudges it
// toward each side's season record and recent form. Disagreement between the two shows up as value (EV).
import { devig, underdogCushion } from './engine.js';
import { propLabel, propMarket } from './props.js';
import { normCdf } from './models.js';

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
  // Season record, the same record at this venue (home team at home, away team on the road) and the
  // last five results. Each is smoothed; whatever is available is blended.
  const rec = recordRate(e.stats?.[`${side}Record`] || e.records?.[side]?.total, soccer);
  const venue = recordRate(e.records?.[side]?.[side === 'home' ? 'home' : 'road'] || (side === 'away' ? e.records?.away?.away : null), soccer);
  const frm = formRate(e.stats?.[`${side}Form`]);
  const parts = [[rec, 0.45], [venue, 0.25], [frm, 0.3]].filter(([v]) => v != null);
  if (!parts.length) return null;
  return parts.reduce((t, [v, w]) => t + v * w, 0) / parts.reduce((t, [, w]) => t + w, 0);
}

// Starting pitcher quality (baseball): season ERA blended with the last three starts, against the
// league's typical ERA. +0.3 is a clearly better than average starter, -0.3 a clearly worse one.
const LEAGUE_ERA = { MLB: 4.1, NPB: 3.1, KBO: 4.4 };
function starterQuality(e, side) {
  if (e.sport !== 'baseball') return null;
  const r = (e.probables || []).find((x) => x.side === side && x.report)?.report;
  const season = parseFloat(r?.season?.era), recent = parseFloat(r?.form3?.era);
  if (!Number.isFinite(season) && !Number.isFinite(recent)) return null;
  const era = Number.isFinite(season) && Number.isFinite(recent) ? 0.7 * season + 0.3 * recent : Number.isFinite(season) ? season : recent;
  const avg = LEAGUE_ERA[r.league] || LEAGUE_ERA[e.league] || 4.1;
  return Math.max(-0.6, Math.min(0.6, (avg - era) / avg));
}

// Adds `model` probabilities to each event's markets (mutates events). The market price is the
// strongest single predictor, so the model starts from the margin-free price and nudges it with the
// evidence ATLAS holds: records (season, venue, recent form), starting pitchers and soccer absences.
// The combined nudge is a small step in log-odds space, capped at MAX_SHIFT: without the cap, records
// (which understate how lopsided mismatches are) make nearly every longshot look like value.
// The nudged win chance is then carried through to the spread lines (and the score model behind
// them), so a handicap's estimate moves with the match instead of simply repeating its own price.
const MAX_SHIFT = 0.1;
const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function evidenceShift(e, homeShare) {
  let s = 0;
  const inputs = [];
  const sh = strength(e, 'home'), sa = strength(e, 'away');
  if (sh != null && sa != null) { s += (1 - MARKET_WEIGHT) * (logit(sh ** 2 / (sh ** 2 + sa ** 2)) - logit(homeShare)); inputs.push('records'); }
  const qh = starterQuality(e, 'home'), qa = starterQuality(e, 'away');
  if (qh != null && qa != null) { s += 0.25 * (qh - qa); inputs.push('starting pitchers'); }
  const ab = e.absences;
  if (e.sport === 'football' && Array.isArray(ab?.home) && Array.isArray(ab?.away)) {
    const d = ab.away.length - ab.home.length;
    if (d) { s += clamp(0.012 * d, -0.05, 0.05); inputs.push('absences'); }
  }
  return { s: clamp(s, -MAX_SHIFT, MAX_SHIFT), inputs };
}

export function applyModel(events) {
  for (const e of events) {
    const m = e.markets?.find((x) => x.name === 'Winner' || x.name === 'Match Result');
    if (!m) continue;
    const { outcomes } = devig(m);
    const iH = outcomes.findIndex((o) => o.name === e.home), iA = outcomes.findIndex((o) => o.name === e.away);
    if (iH < 0 || iA < 0) continue;
    const drawP = outcomes.find((o) => o.name === 'Draw')?.fair ?? 0;
    const pH = outcomes[iH].fair, pA = outcomes[iA].fair, share = pH / (pH + pA);
    const { s, inputs } = evidenceShift(e, share);
    if (!inputs.length) continue;
    const share2 = sigmoid(logit(share) + s);
    m.outcomes.forEach((o, i) => { o.model = +(i === iH ? share2 * (1 - drawP) : i === iA ? (1 - share2) * (1 - drawP) : drawP).toFixed(4); });
    m.modelInputs = inputs;
    propagate(e, { home: pH, draw: drawP, away: pA }, { home: share2 * (1 - drawP), draw: drawP, away: (1 - share2) * (1 - drawP) }, inputs);
  }
  return events;
}

// Carries a change in the win chance through to the spread lines, with a normal model of the
// winning margin: its spread is set by the expected total (goals/runs: the variance of a score
// difference is about the total; points sports use their known spread). The model's win chance moves
// the centre of that margin, and only the resulting change is applied to the margin-free spread price,
// so the approximation's own quirks never leak into the estimate: price + (model view - price view).
// Closed form, so it costs microseconds per match even on a full board.
const POINTS_SIGMA = { basketball: 12.5, americanfootball: 13.5, rugby: 14, aussierules: 32 };
const GOAL_TOTAL = { football: 2.6, hockey: 6, baseball: 8.6, efootball: 3.4 };
const probit = (p) => { let lo = -6, hi = 6; for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (normCdf(mid) < p) lo = mid; else hi = mid; } return (lo + hi) / 2; };
function propagate(e, base, model, inputs) {
  const spreads = (e.markets || []).filter((m) => m.name === 'Spread' && Number.isFinite(m.line) && m.outcomes?.length === 2);
  if (!spreads.length) return;
  let sg = POINTS_SIGMA[e.sport];
  if (e.league === 'WNBA') sg = 11; else if (e.league === 'NCAAF') sg = 16;
  if (!sg && GOAL_TOTAL[e.sport]) {
    const line = parseFloat((e.markets.find((m) => /^Total /.test(m.name))?.name || '').slice(6));
    sg = Math.sqrt(Number.isFinite(line) && line > 0 ? line : GOAL_TOTAL[e.sport]);
  }
  if (!sg) return;
  const mu = (w) => sg * probit(clamp(w.home / (w.home + w.away), 0.001, 0.999));
  const mb = mu(base), mm = mu(model);
  const cover = (h) => [1 - normCdf((-h - mb) / sg), 1 - normCdf((-h - mm) / sg)]; // P(home margin + line > 0)
  if (!cover) return;
  for (const m of spreads) {
    const fair = devig(m).outcomes[0].fair;
    const [pb, pm] = cover(m.line);
    const home = clamp(fair + (pm - pb), 0.01, 0.99);
    m.outcomes[0].model = +home.toFixed(4);
    m.outcomes[1].model = +(1 - home).toFixed(4);
    m.modelInputs = inputs;
  }
}

// Strongest favourites across every sport: what the dashboard calls bankers.
export function bankers(events, { min = 0.7, limit = 24, minOdds = 1, cushions = false } = {}) {
  const out = [];
  for (const e of events) {
    for (const m of e.markets || []) {
      const { outcomes } = devig(m);
      outcomes.forEach((o, i) => {
        const p = m.outcomes[i].model ?? o.fair;
        if (p < min || o.odds < minOdds) return;
        if (!cushions && underdogCushion(e, m.name, o.name)) return; // never "the losing side +1.5"
        out.push({ event: e, market: m.name, pick: o.name, odds: o.odds, p, fair: o.fair, ev: p * o.odds - 1,
          agree: m.outcomes[i].model == null ? null : m.outcomes[i].model >= o.fair });
      });
    }
    // Player props (milestones, anytime scorers): one-way prices, chance net of the margin.
    for (const pr of e.props || []) {
      if (pr.p < min || pr.odds < minOdds) continue;
      out.push({ event: e, market: propMarket(pr), pick: propLabel(pr), odds: pr.odds, p: pr.p, fair: pr.p, ev: pr.p * pr.odds - 1, agree: null,
        prop: { id: pr.id, type: pr.type, target: pr.target } });
    }
  }
  return out.sort((a, b) => b.p - a.p).slice(0, limit);
}

