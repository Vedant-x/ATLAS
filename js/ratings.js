// ATLAS ratings: an Elo rating for every team and player ATLAS has seen play, from its own results
// history (js/results.js), in every sport and league ESPN covers. For most sports there is no public
// rating at all (cricket, rugby, volleyball, handball, college sports, lower leagues, tennis below the
// top), so this is the analysis those matches otherwise lack. Also from the same history: days of rest
// before a match, the last meetings between the two sides, and recent form where the feed gives none.
//
// Each sport has its own home advantage and update size; goal and point sports also weigh the margin.
// Tennis keeps an overall rating and one per surface (surface from the tournament, tennisabstract.js)
// and uses half of each. While rating, every match is first predicted from the ratings before it, so
// the history also says how good the ratings are (Brier score per sport, against a coin flip's 0.25).
import { surfaceOf } from './tennisabstract.js';
import { normClub } from './clubelo.js';

export const START = 1500;
export const TRUST_GAMES = 10; // results each side needs before a rating is used
const P = {
  football: { k: 20, home: 65, margin: true, draws: true }, hockey: { k: 14, home: 35, margin: true }, basketball: { k: 18, home: 70, margin: true },
  americanfootball: { k: 24, home: 50, margin: true }, baseball: { k: 5, home: 24 }, tennis: { k: 32, home: 0 }, cricket: { k: 24, home: 60 },
  rugby: { k: 26, home: 60, margin: true }, volleyball: { k: 22, home: 40 }, handball: { k: 18, home: 60, margin: true }, esports: { k: 28, home: 0 },
  aussierules: { k: 22, home: 60, margin: true }, default: { k: 20, home: 50 },
};
export const params = (sport) => P[sport] || P.default;

// Whose rating: ESPN ids where the feed has them, the name otherwise. Soccer clubs share one id space
// across competitions (league and cups rate together); other sports are rated within their league.
const scopeOf = (sport, lg) => (sport === 'football' ? 'soccer' : lg);
export const keyOf = (sport, lg, id, name) => `${scopeOf(sport, lg)}|${id ? `#${id}` : `n:${normClub(name)}`}`;

const expect = (d) => 1 / (1 + 10 ** (-d / 400));
const marginMult = (m) => Math.min(3, 1 + Math.log(1 + Math.abs(m)));

export function rate(history) {
  const r = new Map(), surf = new Map(), last = new Map(), meets = new Map(), recent = new Map();
  const quality = {};
  const get = (m, k) => m.get(k) || { r: START, n: 0 };
  for (const g of [...history].sort((a, b) => a.t - b.t)) {
    if (g.sport === 'tennis' && g.draw && g.draw !== 'Singles') continue;
    const pr = params(g.sport);
    const kh = keyOf(g.sport, g.lg, g.hid, g.h), ka = keyOf(g.sport, g.lg, g.aid, g.a);
    const H = get(r, kh), A = get(r, ka);
    const surface = g.sport === 'tennis' ? surfaceOf({ tournament: g.tour }, g.t) : null;
    const Hs = surface ? get(surf, `${kh}|${surface}`) : null, As = surface ? get(surf, `${ka}|${surface}`) : null;
    const diff = (surface ? (H.r + Hs.r) / 2 - (A.r + As.r) / 2 : H.r - A.r) + pr.home;
    const e = expect(diff);
    const s = g.w === 'home' ? 1 : g.w === 'away' ? 0 : 0.5;
    // How well the ratings called it, once both sides had enough results to be trusted.
    if (H.n >= TRUST_GAMES && A.n >= TRUST_GAMES && s !== 0.5) {
      const q = (quality[g.sport] ||= { n: 0, brier: 0, right: 0 });
      q.n++; q.brier += (e - s) ** 2; q.right += (e >= 0.5) === (s === 1) ? 1 : 0;
    }
    const mm = pr.margin && Number.isFinite(g.hs) && Number.isFinite(g.as) ? marginMult(g.hs - g.as) : 1;
    // New sides move faster, so a rating settles within a dozen results.
    const kOf = (n) => pr.k * mm * Math.max(1, 2.5 - n / 8);
    // The home side gains what the away side loses (each scaled by its own experience).
    r.set(kh, { r: H.r + kOf(H.n) * (s - e), n: H.n + 1 });
    r.set(ka, { r: A.r - kOf(A.n) * (s - e), n: A.n + 1 });
    if (surface) {
      const es = expect((Hs.r - As.r) + pr.home);
      surf.set(`${kh}|${surface}`, { r: Hs.r + kOf(Hs.n) * (s - es), n: Hs.n + 1 });
      surf.set(`${ka}|${surface}`, { r: As.r - kOf(As.n) * (s - es), n: As.n + 1 });
    }
    for (const [k, res] of [[kh, s === 1 ? 'W' : s === 0 ? 'L' : 'D'], [ka, s === 0 ? 'W' : s === 1 ? 'L' : 'D']]) {
      last.set(k, g.t);
      const l = recent.get(k) || []; l.push(res); if (l.length > 5) l.shift(); recent.set(k, l);
    }
    const pair = [kh, ka].sort().join('~');
    const ml = meets.get(pair) || []; ml.push({ t: g.t, h: g.h, a: g.a, hs: g.hs, as: g.as, w: g.w }); if (ml.length > 5) ml.shift(); meets.set(pair, ml);
  }
  for (const q of Object.values(quality)) { q.brier /= q.n; q.right /= q.n; }
  return { r, surf, last, meets, recent, quality };
}

// The history's view of each upcoming match: both sides' ratings (tennis: blended with the surface),
// rest days, last meetings, and form where the feed gave none. Returns how many matches got ratings.
export function annotate(events, R, now = Date.now()) {
  let n = 0;
  for (const e of events) {
    if (e.sport === 'tennis' && e.tennis?.draw && e.tennis.draw !== 'Singles') continue;
    const ids = e.sport === 'tennis' ? { home: e.tennis?.home?.id, away: e.tennis?.away?.id } : e.teamIds || {};
    const kh = keyOf(e.sport, e.leaguePath, ids.home, e.home), ka = keyOf(e.sport, e.leaguePath, ids.away, e.away);
    const H = R.r.get(kh), A = R.r.get(ka);
    const surface = e.sport === 'tennis' ? surfaceOf(e.tennis, e.start) : null;
    const blend = (k, x) => { const s = surface && R.surf.get(`${k}|${surface}`); return s?.n >= 3 ? Math.round((x.r + s.r) / 2) : Math.round(x.r); };
    if (H && A) {
      e.atlas = { home: { r: blend(kh, H), n: H.n }, away: { r: blend(ka, A), n: A.n }, ...(surface ? { surface } : {}) };
      if (H.n >= TRUST_GAMES && A.n >= TRUST_GAMES) n++;
    }
    const st = (e.stats ||= {});
    const rest = (k) => (R.last.has(k) && R.last.get(k) < e.start ? Math.floor((e.start - R.last.get(k)) / 864e5) : null);
    const rh = rest(kh), ra = rest(ka);
    if (rh != null) st.homeRest = rh;
    if (ra != null) st.awayRest = ra;
    if (!st.homeForm?.length && R.recent.get(kh)?.length >= 3) st.homeForm = R.recent.get(kh).slice();
    if (!st.awayForm?.length && R.recent.get(ka)?.length >= 3) st.awayForm = R.recent.get(ka).slice();
    const m = R.meets.get([kh, ka].sort().join('~'));
    if (m?.length) e.h2hRecent = m.slice().reverse();
  }
  return n;
}

// The home side's chance from two ratings (soccer splits off a draw, as for ClubElo).
export function ratingWin(sport, home, away, { neutral = false } = {}) {
  const pr = params(sport);
  const p = expect(home - away + (neutral ? 0 : pr.home));
  if (!pr.draws) return { home: p, draw: 0, away: 1 - p };
  const draw = Math.max(0.12, 0.28 * (1 - 1.3 * Math.abs(p - 0.5)));
  const h = Math.max(0.02, p - draw / 2), a = Math.max(0.02, 1 - p - draw / 2), t = h + draw + a;
  return { home: h / t, draw: draw / t, away: a / t };
}
