// In-play chances for "Current bets": each side's chance to win from the score, the time left and the
// pre-match market (its margin-free chance, the best prior the record found: ATLAS's own estimate
// added nothing over it). No live prices are read (the build cannot refresh them by the second), so a
// live pick comes with its fair odds: a live price above them is worth taking, one below them is the
// bookmaker's cut. Never recorded (no price was taken).
//  - Football: goals as two Poisson processes whose rates are fitted to the pre-match 1X2, scaled
//    to the minutes left; the 90-minute result (extra time does not count).
//  - Basketball and American football: the final margin as a normal variable whose mean is the
//    pre-match expected margin times the share left, plus the current margin.
//  - Ice hockey: goals as Poisson processes fitted to the pre-match winner price; a regulation tie
//    goes to overtime, won with the pre-match lean.
import { devig } from './engine.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const normCdf = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const normInv = (p) => { let lo = -8, hi = 8; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (normCdf(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; };
const MAXG = 12;
// Poisson probabilities of 0..MAXG goals.
const poisVec = (l) => { const v = [Math.exp(-l)]; for (let i = 1; i <= MAXG; i++) v.push(v[i - 1] * l / i); return v; };
// P(home ahead), P(level), P(away ahead) at the end, from goals still to come.
function resultFrom(lh, la, dh = 0) {
  const ph = poisVec(lh), pa = poisVec(la);
  let h = 0, d = 0, a = 0;
  for (let i = 0; i <= MAXG; i++) for (let j = 0; j <= MAXG; j++) {
    const q = ph[i] * pa[j], m = dh + i - j;
    if (m > 0) h += q; else if (m < 0) a += q; else d += q;
  }
  const s = h + d + a;
  return { home: h / s, draw: d / s, away: a / s };
}
// Goal rates matching the pre-match 1X2 (least squares: a coarse grid, then a fine one around the
// best point; cached per match).
const fitCache = new Map();
export function fitRates(pH, pD, pA, key = null) {
  if (key && fitCache.has(key)) return fitCache.get(key);
  let best = null;
  const scan = (h0, h1, a0, a1, step) => {
    for (let lh = h0; lh <= h1 + 1e-9; lh += step) for (let la = a0; la <= a1 + 1e-9; la += step) {
      if (lh <= 0 || la <= 0) continue;
      const r = resultFrom(lh, la), err = (r.home - pH) ** 2 + (r.draw - pD) ** 2 + (r.away - pA) ** 2;
      if (!best || err < best.err) best = { lh, la, err };
    }
  };
  scan(0.2, 3.6, 0.2, 3.6, 0.1);
  scan(best.lh - 0.1, best.lh + 0.1, best.la - 0.1, best.la + 0.1, 0.02);
  if (key) fitCache.set(key, best);
  return best;
}

// Regulation length and periods per league (minutes).
const CLOCK = {
  'basketball/nba': [4, 12], 'basketball/wnba': [4, 10], 'basketball/mens-college-basketball': [2, 20], 'basketball/womens-college-basketball': [4, 10],
  'football/nfl': [4, 15], 'football/college-football': [4, 15], 'hockey/nhl': [3, 20],
};
const SIGMA = { 'basketball/nba': 12.5, 'basketball/wnba': 11, 'basketball/mens-college-basketball': 11, 'basketball/womens-college-basketball': 12, 'football/nfl': 13.5, 'football/college-football': 15.5 };
const mmss = (s) => { const m = /^(\d+):(\d{2})/.exec(String(s || '')); return m ? Number(m[1]) + Number(m[2]) / 60 : null; };
// Share of regulation still to play (0 at the end), or null when the clock can't be read.
export function shareLeft(e) {
  if (e.sport === 'football') {
    const txt = `${e.displayClock || ''} ${e.clock || ''}`;
    if (/\bHT\b|half ?time/i.test(txt)) return 0.5;
    const m = /(\d+)'/.exec(txt) || /^(\d+)/.exec(String(e.displayClock || ''));
    return m ? clamp(1 - Number(m[1]) / 90, 0, 1) : null;
  }
  const c = CLOCK[e.leaguePath] || (e.sport === 'basketball' ? [4, 10] : e.sport === 'hockey' ? [3, 20] : null);
  const left = mmss(e.displayClock), per = Number(e.period);
  if (!c || left == null || !(per >= 1)) return null;
  const [n, len] = c, total = n * len;
  if (per > n) return clamp(left / total, 0, 1); // overtime: what is left of it
  return clamp(((n - per) * len + left) / total, 0, 1);
}
export const scoreOf = (e) => { const m = /(\d+)\s*[–-]\s*(\d+)/.exec(String(e.score || '')); return m ? [Number(m[1]), Number(m[2])] : null; };
// The pre-match margin-free chances (the market's): a price read after kick-off already holds the
// score, so it is no prior.
function prior(e) {
  const m = (e.markets || []).find((x) => /^(Winner|Match Result|Moneyline)$/.test(x.name));
  if (!m || m.outcomes.length < 2) return null;
  const read = e.priceAt ?? e.sharpAt ?? null;
  if (Number.isFinite(read) && read > e.start + 5 * 6e4) return null;
  const { outcomes } = devig(m);
  const at = (name) => outcomes.find((o) => o.name === name)?.fair;
  const home = at(e.home), away = at(e.away), draw = at('Draw');
  return home > 0 && away > 0 ? { home, away, draw: draw || 0, market: m.name } : null;
}

// Each side's live chance, or null (not live, no prior, no score or clock).
export function liveChance(e) {
  if (!e?.live) return null;
  const pr = prior(e), sc = scoreOf(e), r = shareLeft(e);
  if (!pr || !sc || r == null) return null;
  const [hs, as] = sc, dh = hs - as;
  if (e.sport === 'football' && pr.draw > 0) {
    const f = fitRates(pr.home, pr.draw, pr.away, `${e.id}|${pr.home}|${pr.draw}`);
    return { ...resultFrom(f.lh * r, f.la * r, dh), share: r, market: pr.market };
  }
  if (e.sport === 'hockey') {
    // Rates for about 6 goals a game, split so the winner price is matched (overtime with the lean).
    const tot = 6.2, ot = 0.5 + (pr.home - 0.5) * 0.5;
    const win = (s) => { const x = resultFrom(tot * s / 2, tot * (1 - s) / 2); return x.home + x.draw * ot; };
    let lo = 0.05, hi = 0.95; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (win(m) < pr.home / (pr.home + pr.away)) lo = m; else hi = m; }
    const s = (lo + hi) / 2, x = resultFrom(tot * s / 2 * r, tot * (1 - s) / 2 * r, dh);
    const home = x.home + x.draw * ot;
    return { home, away: 1 - home, draw: 0, share: r, market: pr.market };
  }
  const sigma = SIGMA[e.leaguePath] || (e.sport === 'basketball' ? 12 : e.sport === 'americanfootball' ? 14 : null);
  if (!sigma) return null;
  const pHome = pr.home / (pr.home + pr.away), mu = sigma * normInv(clamp(pHome, 0.01, 0.99));
  const home = r <= 0 ? (dh > 0 ? 1 : dh < 0 ? 0 : 0.5) : normCdf((dh + mu * r) / (sigma * Math.sqrt(r)));
  return { home, away: 1 - home, draw: 0, share: r, market: pr.market };
}

// Current bets, live part: in each live match, the likeliest result if it is min (60% by default; the
// page asks from 50%) to 97% likely (above
// that, no price is worth the bet), with its fair odds. Likeliest first.
export function liveBets(events, { min = 0.6, max = 0.97, limit = 20 } = {}) {
  const out = [];
  for (const e of events) {
    const c = liveChance(e);
    if (!c) continue;
    const opts = [['home', e.home], ['away', e.away], ...(c.draw ? [['draw', 'Draw']] : [])].map(([k, name]) => ({ k, name, p: c[k] })).sort((a, b) => b.p - a.p);
    const top = opts[0];
    if (!(top.p >= min && top.p <= max)) continue;
    out.push({ event: e, market: c.market, pick: top.name, p: top.p, fairOdds: +(1 / top.p).toFixed(2), share: c.share, score: e.score, clock: e.clock || e.displayClock || '' });
  }
  return out.sort((a, b) => b.p - a.p).slice(0, limit);
}
