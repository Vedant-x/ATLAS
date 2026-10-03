// ATLAS market models: from the prices we have (winner, total, spread) derive the full market set.
//   Goal sports (football, hockey, baseball): Poisson model fitted to the price → score grid, BTTS,
//     alternate totals, handicaps, team totals, exact goals, clean sheets.
//   Points sports (basketball, NFL): normal margin model → alternate spreads/totals, margin bands.
//   Tennis: per-set probability → set betting and total sets.
// Every derived number is a model fair price, not a bookmaker quote, and the UI labels it so.
import { devig } from './engine.js';

// ---------- maths ----------
const LN_FACT = [0];
for (let i = 1; i < 60; i++) LN_FACT[i] = LN_FACT[i - 1] + Math.log(i);
export const poisson = (k, l) => (l <= 0 ? (k === 0 ? 1 : 0) : Math.exp(k * Math.log(l) - l - LN_FACT[k]));

export function normCdf(x) {
  // Abramowitz-Stegun 7.1.26, |error| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

function bisect(f, lo, hi, target, iters = 50) {
  // f increasing on [lo, hi]
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------- reading prices ----------
function priceView(event) {
  const view = { win: null, total: null, spread: null, source: 'none' };
  for (const m of event.markets || []) {
    const d = devig(m);
    if (m.name === 'Winner' || m.name === 'Match Result') {
      const get = (n) => d.outcomes.find((o) => o.name === n);
      const draw = get('Draw');
      const home = get(event.home) || d.outcomes[0];
      const away = get(event.away) || d.outcomes[d.outcomes.length - 1];
      const mp = (o) => m.outcomes.find((x) => x.name === o.name)?.model ?? o.fair;
      view.win = { home: mp(home), draw: draw ? mp(draw) : 0, away: mp(away) };
      view.source = 'market';
    } else if (/^Total /.test(m.name)) {
      const line = parseFloat(m.name.slice(6));
      const over = d.outcomes.find((o) => /^Over/i.test(o.name));
      if (over && Number.isFinite(line) && !view.total) view.total = { line, over: over.fair };
    } else if (/^Spread/.test(m.name) && Number.isFinite(m.line)) {
      const home = d.outcomes[0];
      view.spread = { line: m.line, home: home.fair }; // line from the home side, e.g. -7.5
    }
  }
  return view;
}

// Record/form fallback when no bookmaker prices exist (NPB, KBO, cricket, lower leagues).
function rate(summary, soccer) {
  const n = String(summary || '').split('-').map(Number);
  if (n.length < 2 || n.some((x) => !Number.isFinite(x))) return null;
  const [w, a, b = 0] = n;
  const g = w + a + b;
  return g ? (w + (soccer ? 0.5 * a : 0) + 1) / (g + 2) : null;
}
function formRate(f) {
  if (!f?.length) return null;
  return (f.reduce((s, r) => s + (r === 'W' ? 1 : r === 'D' ? 0.5 : 0), 0) + 1) / (f.length + 2);
}
// Ranking points behave close to Bradley-Terry strengths (exponent < 1 keeps upsets plausible):
// #1 (~11,000 pts) vs #50 (~1,200) comes out near 88%. Ranks alone use a square-root ratio.
export function tennisRankWin(t) {
  const ph = Number(t.home?.points), pa = Number(t.away?.points), rh = Number(t.home?.rank), ra = Number(t.away?.rank);
  let p = null, note = null;
  if (ph > 0 && pa > 0) { p = ph ** 0.9 / (ph ** 0.9 + pa ** 0.9); note = `ranking #${rh || '?'} (${ph} pts) vs #${ra || '?'} (${pa} pts)`; }
  else if (rh > 0 && ra > 0) { p = 1 / (1 + (rh / ra) ** 0.5); note = `world ranking #${rh} vs #${ra}`; }
  else if (rh > 0 || ra > 0) { p = rh > 0 ? 0.66 : 0.34; note = `only ${rh > 0 ? 'the first' : 'the second'} player is ranked (#${rh || ra})`; }
  return p == null ? null : { p: Math.min(0.97, Math.max(0.03, p)), note };
}

function baselineWin(event) {
  const soccer = event.sport === 'football';
  const st = event.stats || {};
  const sh = [rate(st.homeRecord, soccer), formRate(st.homeForm)].filter((x) => x != null);
  const sa = [rate(st.awayRecord, soccer), formRate(st.awayForm)].filter((x) => x != null);
  const homeAdv = event.neutral ? 1 : ({ football: 1.12, basketball: 1.08, americanfootball: 1.06, hockey: 1.05, baseball: 1.04, cricket: 1.2 }[event.sport] ?? 1);
  let pHome = 0.5 * homeAdv / (0.5 * homeAdv + 0.5);
  let confidence = 'low';
  if (sh.length && sa.length) {
    const a = (sh.reduce((x, y) => x + y) / sh.length) ** 2 * homeAdv;
    const b = (sa.reduce((x, y) => x + y) / sa.length) ** 2;
    pHome = a / (a + b);
    confidence = 'medium';
  }
  // Baseball: the starting-pitcher matchup moves the line. Each run of ERA difference shifts the
  // log-odds by 0.12 (capped), a conservative read of how much starters swing a single game.
  let starterNote = null;
  if (event.sport === 'baseball') {
    const era = (side) => { const p = event.probables?.find((x) => x.side === side); return Number((p?.report || p?.pitching)?.season?.era); };
    const eh = era('home'), ea = era('away');
    if (Number.isFinite(eh) && Number.isFinite(ea)) {
      const shift = Math.max(-0.35, Math.min(0.35, 0.12 * (ea - eh)));
      pHome = 1 / (1 + Math.exp(-(Math.log(pHome / (1 - pHome)) + shift)));
      confidence = 'medium';
      starterNote = `starter ERA ${eh.toFixed(2)} vs ${ea.toFixed(2)}`;
    }
  }
  // Tennis has no bookmaker price in the feed: use the official rankings (points when we have them).
  if (event.sport === 'tennis' && event.tennis) {
    const t = tennisRankWin(event.tennis);
    if (t) return { win: { home: t.p, draw: 0, away: 1 - t.p }, confidence: 'medium', starterNote: t.note };
  }
  // Multi-day cricket (Tests, first-class) is often drawn.
  const multiDay = event.sport === 'cricket' && /test|first-class/i.test(`${event.format || ''} ${event.note || ''}`);
  const draw = soccer ? 0.26 * (1 - Math.abs(pHome - 0.5)) : multiDay ? 0.3 : 0;
  return { win: { home: pHome * (1 - draw), draw, away: (1 - pHome) * (1 - draw) }, confidence, starterNote };
}

// ---------- Poisson (goals / runs) ----------
const GOAL_DEFAULTS = { football: 2.65, hockey: 6.0, baseball: 8.8 };
const MAXG = { football: 10, hockey: 12, baseball: 22 };

function grid(lh, la, n) {
  const ph = Array.from({ length: n + 1 }, (_, k) => poisson(k, lh));
  const pa = Array.from({ length: n + 1 }, (_, k) => poisson(k, la));
  const g = ph.map((x) => pa.map((y) => x * y));
  const total = g.reduce((s, row) => s + row.reduce((t, p) => t + p, 0), 0); // renormalise the truncated tail
  return g.map((row) => row.map((p) => p / total));
}
function outcome3(g) {
  let h = 0, d = 0, a = 0;
  g.forEach((row, i) => row.forEach((p, j) => { if (i > j) h += p; else if (i === j) d += p; else a += p; }));
  return { h, d, a };
}
const pOver = (T, line) => {
  let under = 0;
  for (let k = 0; k <= Math.floor(line); k++) under += poisson(k, T);
  return 1 - under;
};

export function fitPoisson(win, total, sport) {
  const n = MAXG[sport] || 10;
  const twoWay = sport !== 'football'; // hockey/baseball winner prices include OT/extras: split ties 50/50
  const T = total ? bisect((t) => pOver(t, total.line), 0.2, 30, total.over) : GOAL_DEFAULTS[sport] || 2.6;
  const target = twoWay ? win.home / (win.home + win.away) : win.home - win.away;
  const fitS = (Tt) => bisect((s) => {
    const o = outcome3(grid(Math.max(0.02, (Tt + s) / 2), Math.max(0.02, (Tt - s) / 2), n));
    return twoWay ? o.h + o.d / 2 : o.h - o.a;
  }, -Tt + 0.05, Tt - 0.05, target, 40);
  let Tfit = T, s = fitS(T);
  if (!total && sport === 'football' && win.draw > 0) {
    // No total line: choose the goal expectancy that reproduces the priced draw chance.
    Tfit = bisect((t) => -outcome3(grid((t + fitS(t)) / 2, (t - fitS(t)) / 2, n)).d, 0.8, 5.5, -win.draw, 30);
    s = fitS(Tfit);
  }
  const lh = Math.max(0.02, (Tfit + s) / 2), la = Math.max(0.02, (Tfit - s) / 2);
  return { lh, la, T: Tfit, g: grid(lh, la, n), n };
}

function poissonMarkets(e, fit) {
  const { g, lh, la, n } = fit;
  const sum = (pred) => g.reduce((s, row, i) => s + row.reduce((t, p, j) => t + (pred(i, j) ? p : 0), 0), 0);
  const o3 = outcome3(g);
  const unit = { football: 'goals', hockey: 'goals', baseball: 'runs' }[e.sport];
  const H = e.home, A = e.away;
  const groups = [];
  const two = (name, p, yes = 'Yes', no = 'No') => ({ name, outcomes: [{ name: yes, p }, { name: no, p: 1 - p }] });

  groups.push({ group: 'Result', markets: [
    { name: e.sport === 'football' ? 'Match result (90 min)' : 'Regulation result', outcomes: [{ name: H, p: o3.h }, { name: 'Draw', p: o3.d }, { name: A, p: o3.a }] },
    { name: 'Double chance', outcomes: [{ name: `${H} or draw`, p: o3.h + o3.d }, { name: `${A} or draw`, p: o3.a + o3.d }, { name: `${H} or ${A}`, p: o3.h + o3.a }], overlap: true },
    { name: 'Draw no bet', outcomes: [{ name: H, p: o3.h / (o3.h + o3.a) }, { name: A, p: o3.a / (o3.h + o3.a) }] },
  ] });

  const base = Math.round(fit.T * 2) / 2;
  const lines = e.sport === 'football' ? [0.5, 1.5, 2.5, 3.5, 4.5, 5.5] : [-2, -1, 0, 1, 2].map((d) => base + d - (Number.isInteger(base + d) ? 0.5 : 0));
  groups.push({ group: `Total ${unit}`, markets: [...new Set(lines)].filter((l) => l > 0).map((l) => {
    const p = sum((i, j) => i + j > l);
    return { name: `Over/Under ${l}`, outcomes: [{ name: `Over ${l}`, p }, { name: `Under ${l}`, p: 1 - p }] };
  }) });

  const hc = e.sport === 'football' ? [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5] : [-2.5, -1.5, 1.5, 2.5];
  groups.push({ group: e.sport === 'baseball' ? 'Run line' : e.sport === 'hockey' ? 'Puck line' : 'Handicap', markets: hc.map((h) => {
    const p = sum((i, j) => i + h > j);
    return { name: `${H} ${h > 0 ? '+' : ''}${h}`, outcomes: [{ name: `${H} ${h > 0 ? '+' : ''}${h}`, p }, { name: `${A} ${-h > 0 ? '+' : ''}${-h}`, p: 1 - p }] };
  }) });

  const tt = (l) => l + 0.5;
  groups.push({ group: `Team ${unit}`, markets: [
    ...[0, 1, 2].map((k) => { const l = tt(Math.max(0, Math.round(lh) - 1 + k)); const p = 1 - Array.from({ length: Math.floor(l) + 1 }, (_, x) => poisson(x, lh)).reduce((a, b) => a + b); return { name: `${H} over/under ${l}`, outcomes: [{ name: 'Over', p }, { name: 'Under', p: 1 - p }] }; }),
    ...[0, 1, 2].map((k) => { const l = tt(Math.max(0, Math.round(la) - 1 + k)); const p = 1 - Array.from({ length: Math.floor(l) + 1 }, (_, x) => poisson(x, la)).reduce((a, b) => a + b); return { name: `${A} over/under ${l}`, outcomes: [{ name: 'Over', p }, { name: 'Under', p: 1 - p }] }; }),
  ] });

  if (e.sport === 'football' || e.sport === 'hockey') {
    groups.push({ group: 'Specials', markets: [
      two('Both teams to score', sum((i, j) => i > 0 && j > 0)),
      two(`${H} clean sheet`, sum((i, j) => j === 0)),
      two(`${A} clean sheet`, sum((i, j) => i === 0)),
      two(`${H} win to nil`, sum((i, j) => i > j && j === 0)),
      two(`${A} win to nil`, sum((i, j) => j > i && i === 0)),
      two('Result & both score: ' + H, sum((i, j) => i > j && j > 0)),
      { name: 'Odd/even total', outcomes: [{ name: 'Odd', p: sum((i, j) => (i + j) % 2 === 1) }, { name: 'Even', p: sum((i, j) => (i + j) % 2 === 0) }] },
    ] });
  }
  const exactMax = e.sport === 'baseball' ? 14 : e.sport === 'hockey' ? 9 : 6;
  const exact = Array.from({ length: exactMax + 1 }, (_, k) => ({ name: k === exactMax ? `${k}+` : String(k), p: k === exactMax ? sum((i, j) => i + j >= k) : sum((i, j) => i + j === k) }));
  groups.push({ group: `Exact total ${unit}`, markets: [{ name: `Exact ${unit}`, outcomes: exact, overlap: true }] });

  // Margin bands
  const bands = e.sport === 'baseball' ? [[1, 1], [2, 2], [3, 4], [5, 99]] : [[1, 1], [2, 2], [3, 99]];
  groups.push({ group: 'Winning margin', markets: [{ name: 'Winning margin (regulation)', overlap: true, outcomes: [
    ...bands.map(([a, b]) => ({ name: `${H} by ${b === 99 ? a + '+' : a === b ? a : a + '-' + b}`, p: sum((i, j) => i - j >= a && i - j <= b) })),
    { name: 'Draw', p: o3.d },
    ...bands.map(([a, b]) => ({ name: `${A} by ${b === 99 ? a + '+' : a === b ? a : a + '-' + b}`, p: sum((i, j) => j - i >= a && j - i <= b) })),
  ] }] });

  // Correct score grid (top-left of the matrix is enough to show)
  const show = e.sport === 'baseball' ? 10 : e.sport === 'hockey' ? 7 : 5;
  const cells = [];
  for (let i = 0; i <= show; i++) for (let j = 0; j <= show; j++) cells.push({ h: i, a: j, p: g[i][j] });
  const top = [...cells].sort((a, b) => b.p - a.p).slice(0, 8);
  return { groups, grid: { size: show, cells, top }, params: { lambdaHome: lh, lambdaAway: la, total: fit.T, unit } };
}

// ---------- Normal margin (points) ----------
const SIGMA = { basketball: 12.5, americanfootball: 13.5, rugby: 14, aussierules: 32 };
const POINT_DEFAULTS = { basketball: 222, americanfootball: 44, rugby: 46, aussierules: 165 };

function normalModel(e, win, total, spread) {
  const sigma = (e.league === 'WNBA' ? 11 : e.league === 'NCAAF' ? 16 : SIGMA[e.sport]) || 13;
  const pHome = win.home / (win.home + win.away);
  const mu = spread ? -spread.line : sigma * bisect((z) => normCdf(z), -4, 4, clamp(pHome, 0.001, 0.999));
  const T = total?.line ?? POINT_DEFAULTS[e.sport] ?? 200;
  const tSigma = { basketball: 18, rugby: 13, aussierules: 24 }[e.sport] || 10;
  const H = e.home, A = e.away;
  const pMargin = (x) => 1 - normCdf((x - mu) / sigma); // P(home margin > x)
  const pTotal = (x) => 1 - normCdf((x - T) / tSigma);
  const step = e.sport === 'basketball' ? 2.5 : 3;
  const groups = [];
  groups.push({ group: 'Winner', markets: [{ name: 'Moneyline', outcomes: [{ name: H, p: pMargin(0) }, { name: A, p: 1 - pMargin(0) }] }] });
  const base = Math.round(mu * 2) / 2;
  groups.push({ group: 'Alternate spreads', markets: [-3, -2, -1, 0, 1, 2, 3].map((k) => {
    const line = base + k * step + (Number.isInteger(base + k * step) ? 0.5 : 0);
    const p = pMargin(line);
    const hName = `${H} ${line > 0 ? '-' : '+'}${Math.abs(line)}`;
    return { name: hName, outcomes: [{ name: hName, p }, { name: `${A} ${line > 0 ? '+' : '-'}${Math.abs(line)}`, p: 1 - p }] };
  }) });
  const tb = Math.round(T) + 0.5;
  groups.push({ group: 'Alternate totals', markets: [-3, -2, -1, 0, 1, 2, 3].map((k) => {
    const l = tb + k * (e.sport === 'basketball' ? 5 : 3);
    const p = pTotal(l);
    return { name: `Over/Under ${l}`, outcomes: [{ name: `Over ${l}`, p }, { name: `Under ${l}`, p: 1 - p }] };
  }) });
  const hT = (T + mu) / 2, aT = (T - mu) / 2, teamSigma = tSigma / Math.SQRT2 + 2;
  groups.push({ group: 'Team totals', markets: [[H, hT], [A, aT]].flatMap(([n, t]) => [-1, 0, 1].map((k) => {
    const l = Math.round(t) + 0.5 + k * (e.sport === 'basketball' ? 4 : 3);
    const p = 1 - normCdf((l - t) / teamSigma);
    return { name: `${n} over/under ${l}`, outcomes: [{ name: 'Over', p }, { name: 'Under', p: 1 - p }] };
  })) });
  const bands = e.sport === 'basketball' ? [[1, 5], [6, 10], [11, 15], [16, 20], [21, 99]] : [[1, 6], [7, 13], [14, 20], [21, 99]];
  const band = (a, b, sign) => (sign > 0 ? pMargin(a - 0.5) - pMargin(b + 0.5) : normCdf((-a + 0.5 - mu) / sigma) - normCdf((-b - 0.5 - mu) / sigma));
  const marginOutcomes = [
    ...bands.map(([a, b]) => ({ name: `${H} ${b === 99 ? a + '+' : a + '-' + b}`, p: band(a, b, 1) })),
    ...bands.map(([a, b]) => ({ name: `${A} ${b === 99 ? a + '+' : a + '-' + b}`, p: band(a, b, -1) })),
  ];
  const mSum = marginOutcomes.reduce((t, o) => t + o.p, 0); // no ties: spread the continuity mass back
  marginOutcomes.forEach((o) => { o.p /= mSum; });
  groups.push({ group: 'Winning margin', markets: [{ name: 'Winning margin', overlap: true, outcomes: marginOutcomes }] });
  groups.push({ group: 'Specials', markets: [
    { name: `Decided by ${e.sport === 'basketball' ? '5' : '3'} or fewer`, outcomes: [{ name: 'Yes', p: band(1, e.sport === 'basketball' ? 5 : 3, 1) + band(1, e.sport === 'basketball' ? 5 : 3, -1) }, { name: 'No', p: 1 - band(1, e.sport === 'basketball' ? 5 : 3, 1) - band(1, e.sport === 'basketball' ? 5 : 3, -1) }] },
    { name: 'Blowout (15+ either way)', outcomes: [{ name: 'Yes', p: pMargin(14.5) + normCdf((-14.5 - mu) / sigma) }, { name: 'No', p: 1 - pMargin(14.5) - normCdf((-14.5 - mu) / sigma) }] },
  ] });
  const dist = Array.from({ length: 41 }, (_, i) => {
    const x = Math.round(mu) - 20 + i;
    return { x, p: normCdf((x + 0.5 - mu) / sigma) - normCdf((x - 0.5 - mu) / sigma) };
  });
  return { groups, dist, params: { margin: mu, sigma, total: T, homePoints: hT, awayPoints: aT } };
}

// ---------- Tennis ----------
const SLAMS = /australian open|roland garros|french open|wimbledon|us open/i;
function tennisModel(e, win) {
  const bo5 = e.tennis?.bestOf ? e.tennis.bestOf === 5 : SLAMS.test(e.league || '') && !/wta|women/i.test(e.league || '');
  const pm = win.home / (win.home + win.away);
  const matchP = bo5 ? (q) => q ** 3 * (1 + 3 * (1 - q) + 6 * (1 - q) ** 2) : (q) => q * q * (3 - 2 * q);
  const q = bisect(matchP, 0.001, 0.999, clamp(pm, 0.001, 0.999));
  const r = 1 - q, H = e.home, A = e.away;
  const sets = bo5
    ? [['3-0', q ** 3], ['3-1', 3 * q ** 3 * r], ['3-2', 6 * q ** 3 * r * r], ['2-3', 6 * r ** 3 * q * q], ['1-3', 3 * r ** 3 * q], ['0-3', r ** 3]]
    : [['2-0', q * q], ['2-1', 2 * q * q * r], ['1-2', 2 * r * r * q], ['0-2', r * r]];
  const decider = bo5 ? 6 * q ** 3 * r * r + 6 * r ** 3 * q * q : 2 * q * q * r + 2 * r * r * q;
  return {
    groups: [
      { group: 'Set betting', markets: [{ name: `Set score (best of ${bo5 ? 5 : 3})`, overlap: true, outcomes: sets.map(([n, p]) => ({ name: `${n[0] > n[2] ? H : A} ${n}`, p })) }] },
      { group: 'Sets', markets: [
        { name: 'Match goes the distance', outcomes: [{ name: 'Yes', p: decider }, { name: 'No', p: 1 - decider }] },
        { name: `${H} wins a set`, outcomes: [{ name: 'Yes', p: 1 - (bo5 ? r ** 3 : r * r) }, { name: 'No', p: bo5 ? r ** 3 : r * r }] },
        { name: `${A} wins a set`, outcomes: [{ name: 'Yes', p: 1 - (bo5 ? q ** 3 : q * q) }, { name: 'No', p: bo5 ? q ** 3 : q * q }] },
        { name: `${H} handicap -1.5 sets`, outcomes: [{ name: 'Yes', p: bo5 ? q ** 3 + 3 * q ** 3 * r : q * q }, { name: 'No', p: 1 - (bo5 ? q ** 3 + 3 * q ** 3 * r : q * q) }] },
      ] },
    ],
    params: { setWin: q, bestOf: bo5 ? 5 : 3 },
  };
}

// ESPN's matchup predictor gives two-way win shares; soccer gets a draw share carved out.
function predictorWin(e) {
  const t = e.predictor.home + e.predictor.away || 1;
  const h = e.predictor.home / t;
  const draw = e.sport === 'football' ? 0.26 * (1 - Math.abs(h - 0.5)) : 0;
  return { home: h * (1 - draw), draw, away: (1 - h) * (1 - draw) };
}

// Quick 1X2 view for lists: no derived markets.
export function winProbs(event) {
  const v = priceView(event);
  if (v.win) return { ...v.win, confidence: 'high' };
  if (event.predictor) return { ...predictorWin(event), confidence: 'medium' };
  const b = baselineWin(event);
  return { ...b.win, confidence: b.confidence };
}

// ---------- entry point ----------
export function analyse(event) {
  const view = priceView(event);
  let win = view.win, confidence = 'high', basis = 'Bookmaker price, margin removed';
  if (!win && event.predictor) {
    win = predictorWin(event); confidence = 'medium'; basis = 'ESPN matchup predictor (no bookmaker price)';
  }
  if (!win) {
    const b = baselineWin(event);
    win = b.win; confidence = b.confidence;
    basis = b.starterNote ? `ATLAS model: ${event.sport === 'tennis' ? '' : 'home advantage + '}${b.starterNote}${event.stats?.homeRecord ? ' + records' : ''} (no bookmaker price)` : b.confidence === 'medium' ? 'ATLAS model from season record and form (no bookmaker price)' : 'ATLAS baseline: home advantage only, too little data';
  }
  const out = { win, confidence, basis, groups: [], grid: null, dist: null, params: {} };
  if (['football', 'hockey', 'baseball'].includes(event.sport)) {
    const fit = fitPoisson(win, view.total, event.sport);
    Object.assign(out, poissonMarkets(event, fit), { kind: 'poisson' });
  } else if (['basketball', 'americanfootball', 'rugby', 'aussierules'].includes(event.sport)) {
    Object.assign(out, normalModel(event, win, view.total, view.spread), { kind: 'normal' });
  } else if (event.sport === 'tennis') {
    Object.assign(out, tennisModel(event, win), { kind: 'tennis' });
  } else {
    out.kind = 'binary';
    out.groups = [{ group: 'Winner', markets: [{ name: 'Winner', outcomes: [{ name: event.home, p: win.home / (win.home + win.away) }, { name: event.away, p: win.away / (win.home + win.away) }] }] }];
  }
  // Fair odds for every derived outcome.
  for (const g of out.groups) for (const m of g.markets) for (const o of m.outcomes) o.fair = o.p > 0 ? 1 / o.p : Infinity;
  out.marketCount = out.groups.reduce((s, g) => s + g.markets.length, 0);
  return out;
}

// Kelly fraction for a price at probability p (0 when there is no edge).
export const kelly = (p, odds) => Math.max(0, (p * odds - 1) / (odds - 1));
