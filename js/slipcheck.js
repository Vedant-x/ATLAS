// Slip analyser: what a combination really rests on. For the legs in the slip:
//   - dependencies: legs from the same match. Two player props are measured from the games both
//     players played (how often both landed, against how often they would if unrelated); any other
//     same-match pair is named as dependent but not measurable, and the combined chance says so.
//   - the combined chance: the product of the legs, adjusted by the measured pairs (shrunk toward
//     "unrelated" when the shared sample is small), against the slip's break-even;
//   - the weakest leg, and what the slip looks like without each leg;
//   - evidence limits: legs priced by ATLAS rather than a bookmaker, props without game history.
// Pure analysis (analyseSlip) plus its HTML (slipCheck), so it can be tested.
import { valueOf, rowsOf } from './playerdata.js';

const SHRINK = 10; // shared games' worth of "unrelated" a measured pair is pulled toward

// Joint history of two prop legs from the players' game logs: games both played (same game id).
export function jointHistory(a, b, logs) {
  const pa = logs?.[`${a.prop.league}|${a.prop.id}`], pb = logs?.[`${b.prop.league}|${b.prop.id}`];
  if (!pa || !pb) return null;
  const sport = pa.s;
  const rb = new Map(rowsOf(pb).filter((r) => r._ev).map((r) => [r._ev, r]));
  let n = 0, ha = 0, hb = 0, both = 0;
  for (const r of rowsOf(pa)) {
    const s = r._ev && rb.get(r._ev);
    if (!s) continue;
    const va = valueOf(sport, a.prop.type, r), vb = valueOf(sport, b.prop.type, s);
    if (va == null || vb == null) continue;
    n++;
    const x = va >= a.prop.target, y = vb >= b.prop.target;
    ha += x; hb += y; both += x && y;
  }
  return n ? { n, ha, hb, both } : null;
}

// How much more (or less) likely two legs are to land together than if unrelated, from their joint
// history: lift = P(both) / (P(a) P(b)) in the shared games, shrunk toward 1 by sample size.
export function pairLift(j) {
  if (!j || j.n < 6) return null;
  const pa = j.ha / j.n, pb = j.hb / j.n, pj = j.both / j.n;
  const indep = pa * pb;
  if (!(indep > 0)) return null;
  const raw = (pj + 0.5 / j.n) / (indep + 0.5 / j.n);
  return +(1 + (raw - 1) * (j.n / (j.n + SHRINK))).toFixed(3);
}

export function analyseSlip(legs, { logs = null } = {}) {
  const n = legs.length;
  const odds = legs.reduce((a, l) => a * l.odds, 1);
  const product = legs.reduce((a, l) => a * l.p, 1);
  // Dependencies: every pair of legs from the same match.
  const pairs = [];
  for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) {
    const a = legs[i], b = legs[k];
    if (a.eventId !== b.eventId) continue;
    const pair = { a, b, kind: 'unmeasured', lift: null, joint: null };
    if (a.prop && b.prop && a.prop.id === b.prop.id && a.prop.type === b.prop.type) {
      // The same stat for the same player at two lines: the higher line implies the lower one.
      pair.kind = 'nested';
      pair.lift = Math.min(a.p, b.p) / (a.p * b.p);
    } else if (a.prop && b.prop) {
      pair.joint = jointHistory(a, b, logs);
      pair.lift = pairLift(pair.joint);
      pair.kind = pair.lift != null ? 'measured' : 'thin';
    }
    pairs.push(pair);
  }
  let adjusted = product;
  for (const p of pairs) if (p.lift != null) adjusted *= p.lift;
  adjusted = Math.min(adjusted, Math.min(...legs.map((l) => l.p)));
  const uncertain = pairs.some((p) => p.kind === 'unmeasured' || p.kind === 'thin');
  const weakest = legs.reduce((w, l) => (!w || l.p < w.p ? l : w), null);
  const without = legs.map((l) => ({ leg: l, odds: odds / l.odds, p: adjusted / l.p }));
  const limits = [];
  const derived = legs.filter((l) => l.derived).length;
  if (derived) limits.push(`${derived} leg${derived > 1 ? 's are' : ' is'} priced by ATLAS, not a bookmaker: no one is offering that exact price`);
  const bare = legs.filter((l) => l.prop && logs && !logs[`${l.prop.league}|${l.prop.id}`]).length;
  if (bare) limits.push(`${bare} prop leg${bare > 1 ? 's have' : ' has'} no game history: the chance is the price's own`);
  if (uncertain) limits.push('same-match legs ATLAS cannot measure: the combined chance is uncertain, not just the number shown');
  return { n, odds, product, adjusted, breakEven: 1 / odds, pairs, uncertain, weakest, without, limits };
}

const pc = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const short = (l) => l.pick;

export function slipCheck(legs, { logs, esc }) {
  if (legs.length < 2) return '';
  const a = analyseSlip(legs, { logs });
  const d = a.adjusted < 0.01 ? 2 : 1;
  const verdict = a.adjusted > a.breakEven ? '<span class="pos">above</span>' : '<span class="neg">below</span>';
  const pairs = a.pairs.map((p) => {
    const names = `${esc(short(p.a))} + ${esc(short(p.b))}`;
    if (p.kind === 'nested') return `<li><b>${names}</b>: the same stat at two lines; the higher line already implies the lower one, so the pair is only as likely as the harder leg.</li>`;
    if (p.kind === 'measured') {
      const j = p.joint, indep = (j.ha / j.n) * (j.hb / j.n);
      return `<li><b>${names}</b>: both landed in ${j.both} of ${j.n} games they played together (${pc(j.both / j.n)}); if unrelated, ${pc(indep)}. ${p.lift > 1.03 ? 'They tend to land together' : p.lift < 0.97 ? 'One tends to come at the other\'s expense' : 'Little sign they move together'} (×${p.lift.toFixed(2)} applied, shrunk for sample size).</li>`;
    }
    if (p.kind === 'thin') return `<li><b>${names}</b>: ${p.joint ? `only ${p.joint.n} shared game${p.joint.n === 1 ? '' : 's'}` : 'no shared games on record'}: too few to measure how they move together.</li>`;
    return `<li><b>${names}</b>: same match, so they depend on the same game; ATLAS cannot measure by how much.</li>`;
  }).join('');
  return `<div class="slip-an">
    <h4>Slip check</h4>
    <p>Combined chance <b>${pc(a.adjusted, d)}</b>${Math.abs(a.adjusted - a.product) > 1e-4 ? ` <small>(${pc(a.product, d)} if every leg were unrelated)</small>` : ''} · break-even ${pc(a.breakEven, d)} · the estimate is ${verdict} it${a.uncertain ? ' <small class="warn">(uncertain: see below)</small>' : ''}.</p>
    ${pairs ? `<h5>Legs that depend on each other</h5><ul>${pairs}</ul>` : '<p class="muted">No two legs share a match: they settle independently.</p>'}
    <p><b>Weakest leg:</b> ${esc(short(a.weakest))} (${pc(a.weakest.p)}).</p>
    <h5>Without each leg</h5>
    <table class="tbl tight"><tbody>${a.without.map((w) => `<tr><td>${esc(short(w.leg))}</td><td class="num">${w.odds.toFixed(2)}x</td><td class="num">${pc(Math.min(1, w.p), w.p < 0.01 ? 2 : 1)}</td></tr>`).join('')}</tbody></table>
    ${a.limits.length ? `<h5>Evidence limits</h5><ul class="warn">${a.limits.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  </div>`;
}
