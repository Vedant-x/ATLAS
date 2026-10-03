// In-play estimate: the pre-match model, run only over the time still left, on top of the current
// score. Goal/run sports use the pre-match scoring rates (Poisson) scaled to the time remaining;
// points sports use the pre-match margin and spread (normal) scaled the same way.
import { analyse, normCdf } from './models.js';

const LEN = { // minutes per period × periods (baseball counts half-innings)
  football: [45, 2], hockey: [20, 3], basketball: [12, 4], americanfootball: [15, 4], rugby: [40, 2], aussierules: [20, 4], baseball: [1, 18],
};

export function parseScore(s) {
  const m = String(s || '').match(/(\d+)\s*[–-]\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
const mmss = (c) => { const m = String(c || '').match(/(\d+):(\d+)/); return m ? Number(m[1]) + Number(m[2]) / 60 : null; };

// Share of the game still to play (0..1), or null when the clock can't be read.
export function remaining(e) {
  const clock = String(e.clock || ''), sport = e.sport;
  if (sport === 'football') {
    if (/\bHT\b|half ?time/i.test(clock)) return 0.5;
    const min = Number((String(e.displayClock || '').match(/^(\d+)/) || clock.match(/(\d+)'/) || [])[1]);
    if (!Number.isFinite(min)) return null;
    return Math.max(0.01, (90 - min) / 90);
  }
  if (sport === 'baseball') {
    const inning = Number(e.period) || Number((clock.match(/(\d+)(st|nd|rd|th)/) || [])[1]);
    if (!inning) return null;
    let halves = (inning - 1) * 2 + (/bot|bottom|mid/i.test(clock) ? 1 : 0) + (/end|mid/i.test(clock) ? 1 : 0);
    if (/end/i.test(clock) && !/bot/i.test(clock)) halves = inning * 2;
    return Math.max(0.02, (18 - halves) / 18);
  }
  const L = LEN[sport];
  if (!L) return null;
  let [len, periods] = L;
  if (sport === 'basketball' && /WNBA/.test(e.league)) len = 10;
  if (sport === 'basketball' && /NCAA|College/i.test(e.league)) { len = 20; periods = 2; }
  const p = Number(e.period), left = mmss(e.displayClock) ?? mmss(clock);
  if (!p) return null;
  if (/half/i.test(clock) && periods >= 4) return 0.5;
  if (/end of|end/i.test(clock) && left == null) return Math.max(0.01, (periods - p) / periods);
  if (p > periods) return 0.02; // overtime
  const elapsed = (p - 1) * len + (len - (left ?? len / 2));
  return Math.max(0.01, 1 - elapsed / (len * periods));
}

const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };

// { home, draw?, away, left, score } or null when it can't be estimated.
export function liveWin(e, a = analyse(e)) {
  if (!e.live) return null;
  const sc = parseScore(e.score);
  const left = remaining(e);
  if (!sc || left == null) return null;
  const [hs, as] = sc, lead = hs - as;
  if (a.kind === 'poisson' && a.params?.lambdaHome != null) {
    const lh = a.params.lambdaHome * left, la = a.params.lambdaAway * left;
    let h = 0, d = 0, w = 0;
    for (let i = 0; i <= 15; i++) for (let j = 0; j <= 15; j++) {
      const p = pois(i, lh) * pois(j, la), m = lead + i - j;
      if (m > 0) h += p; else if (m === 0) d += p; else w += p;
    }
    const t = h + d + w;
    if (e.sport === 'football') return { home: h / t, draw: d / t, away: w / t, left, score: sc };
    return { home: (h + d / 2) / t, away: (w + d / 2) / t, left, score: sc }; // OT / extra innings: level games split
  }
  if (a.kind === 'normal' && a.params?.sigma) {
    const mu = a.params.margin * left, sd = a.params.sigma * Math.sqrt(left);
    const home = normCdf((lead + mu) / Math.max(sd, 0.5));
    return { home, away: 1 - home, left, score: sc };
  }
  return null;
}
