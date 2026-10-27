// Cohort report (model recovery, step 1): every published pick in the record, split by list, model
// version and, for slips, size and number of legs, with what each cohort actually returned.
//   node scripts/cohort.mjs track/picks.json > docs/cohort-report.md
// Per cohort: settled count, won-lost, void/push, unique events and days covered, average accepted
// odds, flat-stake profit per pick (won: settled odds - 1; lost: -1; void, push and did-not-play: 0),
// ROI with a 95% interval from a bootstrap that resamples whole days (picks on the same day share
// news, models and often matches, so they are not independent), forecast error (Brier) of the chance
// shown against the market's own chance on the same picks where it was recorded, and the share of
// picks that beat their closing price. Unresolved and pending picks are counted, never graded.
import { readFile } from 'node:fs/promises';

const file = process.argv[2] || 'track/picks.json';
const history = JSON.parse(await readFile(file, 'utf8'));
const SETTLED = new Set(['won', 'lost']);
const ZERO = new Set(['void', 'push', 'dnp']);
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const profitOf = (h) => (h.status === 'won' ? (h.settledOdds ?? h.odds) - 1 : h.status === 'lost' ? -1 : 0);

// A seeded generator, so the report is the same on every run of the same record.
let seed = 20261027;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
function dayBootstrap(list, reps = 2000) {
  const byDay = new Map();
  for (const h of list) { const d = dayOf(h.start ?? h.recordedAt); (byDay.get(d) || byDay.set(d, []).get(d)).push(h); }
  const days = [...byDay.values()];
  if (days.length < 5) return null;
  const rois = [];
  for (let r = 0; r < reps; r++) {
    let p = 0, n = 0;
    for (let i = 0; i < days.length; i++) for (const h of days[Math.floor(rand() * days.length)]) { p += profitOf(h); n++; }
    if (n) rois.push(p / n);
  }
  rois.sort((a, b) => a - b);
  return [rois[Math.floor(reps * 0.025)], rois[Math.floor(reps * 0.975)]];
}
const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? '–' : `${(x * 100).toFixed(d)}%`);
const sgn = (x, d = 1) => (x == null || !Number.isFinite(x) ? '–' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`);
function stats(list) {
  const settled = list.filter((h) => SETTLED.has(h.status));
  const won = settled.filter((h) => h.status === 'won').length;
  const profit = settled.reduce((s, h) => s + profitOf(h), 0);
  const withFair = settled.filter((h) => Number.isFinite(h.fair ?? h.refP));
  const y = (h) => (h.status === 'won' ? 1 : 0);
  const shown = (h) => h.shown ?? h.p;
  const closing = settled.filter((h) => h.close > 1 && h.odds > 1);
  const starts = list.map((h) => h.start ?? h.recordedAt).filter(Number.isFinite);
  return {
    n: list.length, settled: settled.length, won, lost: settled.length - won,
    zero: list.filter((h) => ZERO.has(h.status)).length, open: list.filter((h) => ['pending', 'postponed', 'disputed'].includes(h.status)).length,
    unresolved: list.filter((h) => h.status === 'unresolved').length,
    events: new Set(list.flatMap((h) => (h.legs ? h.legs.map((l) => l.eventId) : [h.eventId]))).size,
    days: new Set(starts.map(dayOf)).size, from: starts.length ? dayOf(Math.min(...starts)) : '–', to: starts.length ? dayOf(Math.max(...starts)) : '–',
    avgOdds: settled.length ? settled.reduce((s, h) => s + h.odds, 0) / settled.length : null,
    hit: settled.length ? won / settled.length : null, expected: settled.length ? settled.reduce((s, h) => s + shown(h), 0) / settled.length : null,
    profit, roi: settled.length ? profit / settled.length : null, ci: settled.length >= 30 ? dayBootstrap(settled) : null,
    brierShown: withFair.length ? withFair.reduce((s, h) => s + (shown(h) - y(h)) ** 2, 0) / withFair.length : null,
    brierMarket: withFair.length ? withFair.reduce((s, h) => s + ((h.refP ?? h.fair) - y(h)) ** 2, 0) / withFair.length : null, nFair: withFair.length,
    beatClose: closing.length ? closing.filter((h) => h.odds > h.close).length / closing.length : null, nClose: closing.length,
  };
}
const LIST = { best: 'Best bets', edge: 'Value bets', banker: 'Shortlist bankers (retired)', safe: 'Surest (retired)', two: 'Singles near 2.00 (retired)', model: 'Model-only picks (retired)', value: 'Value spots (retired)', probe: 'Probes (unseen)', botd: 'Banker of the day (retired)' };
const cohortOf = (h) => {
  if (h.type === 'multi') {
    const legs = h.legs?.length || 0;
    const name = h.target === 'potd' ? 'Parlay of the day' : `${h.target}x slips`;
    return `${name} · ${legs === 1 ? '1 leg (a single)' : `${legs} legs`}`;
  }
  return `${LIST[h.type] || h.type}${h.type === 'edge' ? (h.atStake ? ' · at Stake' : ' · other bookmakers') : ''}`;
};
const groups = (f) => { const m = new Map(); for (const h of history) { const k = f(h); (m.get(k) || m.set(k, []).get(k)).push(h); } return [...m.entries()].sort((a, b) => b[1].length - a[1].length); };

const row = (k, s) => `| ${k} | ${s.settled} | ${s.won}–${s.lost} | ${s.zero} / ${s.open} / ${s.unresolved} | ${s.events} | ${s.days} (${s.from} to ${s.to}) | ${s.avgOdds ? s.avgOdds.toFixed(2) : '–'} | ${pct(s.hit)} vs ${pct(s.expected)} | ${s.profit.toFixed(2)}u | ${sgn(s.roi)}${s.ci ? ` (${sgn(s.ci[0])} to ${sgn(s.ci[1])})` : ''} | ${s.brierShown == null ? '–' : `${s.brierShown.toFixed(3)} vs ${s.brierMarket.toFixed(3)} (${s.nFair})`} | ${s.beatClose == null ? '–' : `${pct(s.beatClose, 0)} (${s.nClose})`} |`;
const HEAD = '| Cohort | Settled | Won–lost | Void·push / open / unresolved | Events | Days | Avg odds | Hit vs shown | Profit | ROI (95%, day bootstrap) | Brier shown vs market (n) | Beat close (n) |\n|---|---|---|---|---|---|---|---|---|---|---|---|';
const table = (f) => `${HEAD}\n${groups(f).map(([k, l]) => row(k, stats(l))).join('\n')}`;

const all = stats(history);
const times = history.map((h) => h.recordedAt).filter(Number.isFinite);
const out = [
  '# Cohort report',
  '',
  `Generated from the track record (${file}): ${history.length} records saved ${times.length ? `${dayOf(Math.min(...times))} to ${dayOf(Math.max(...times))}` : ''}; ${all.settled} settled, ${all.zero} void, push or did-not-play, ${all.open} still open, ${all.unresolved} unresolved (counted, never graded). Flat stakes of 1 unit; a lost pick is -1, a won pick its settled odds - 1. ROI intervals resample whole days, so picks from the same day are not treated as independent; none is given below 30 settled picks or 5 days. Brier compares the chance ATLAS showed with the market's own chance on the same picks, where the record kept it (lower is better). These are descriptions of what happened, not evidence of an edge.`,
  '',
  '## By list and slip type',
  '',
  table(cohortOf),
  '',
  '## By list, slip type and model version',
  '',
  table((h) => `${cohortOf(h)} · ${h.model || 'before 2026.10.1'}`),
  '',
  '## Settlement audit',
  '',
  `Statuses across every record and slip leg: ${Object.entries(history.flatMap((h) => [h.status, ...(h.legs || []).map((l) => `leg ${l.status}`)]).reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(' · ')}.`,
  '',
];
console.log(out.join('\n'));
