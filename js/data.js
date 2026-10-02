// Data layer. Order of preference:
//   1. ESPN live scoreboards, fetched from the browser (js/espn.js)
//   2. data/odds.json, a snapshot the scheduled GitHub Action writes (same shape as `makeEvent`)
//   3. Simulated DEMO fixtures, so the UI still works offline. Demo odds are NOT real prices.
import { fetchAll } from './espn.js';

export const SPORTS = [
  { id: 'football', name: 'Football', icon: '⚽', color: '#d2ff00' },
  { id: 'americanfootball', name: 'NFL', icon: '🏈', color: '#ff9f43' },
  { id: 'basketball', name: 'Basketball', icon: '🏀', color: '#ff7a1a' },
  { id: 'tennis', name: 'Tennis', icon: '🎾', color: '#9dff5c' },
  { id: 'cricket', name: 'Cricket', icon: '🏏', color: '#4fd1ff' },
  { id: 'hockey', name: 'Ice Hockey', icon: '🏒', color: '#b08cff' },
  { id: 'mma', name: 'MMA', icon: '🥊', color: '#ff3d6e' },
  { id: 'baseball', name: 'Baseball', icon: '⚾', color: '#ffd84d' },
  { id: 'esports', name: 'Esports', icon: '🎮', color: '#00ffc3' },
];

const TEAMS = {
  football: ['Arsenal', 'Real Madrid', 'Bayern', 'Inter', 'PSG', 'Liverpool', 'Barcelona', 'Napoli', 'Dortmund', 'Benfica', 'Atlético', 'Man City'],
  basketball: ['Celtics', 'Nuggets', 'Lakers', 'Bucks', 'Knicks', 'Thunder', 'Suns', 'Heat', 'Warriors', 'Mavericks'],
  tennis: ['Sinner', 'Alcaraz', 'Djokovic', 'Zverev', 'Medvedev', 'Rune', 'Fritz', 'Ruud', 'Sabalenka', 'Swiatek', 'Gauff', 'Rybakina'],
  cricket: ['India', 'Australia', 'England', 'South Africa', 'New Zealand', 'Pakistan', 'Sri Lanka', 'Afghanistan'],
  hockey: ['Oilers', 'Panthers', 'Rangers', 'Avalanche', 'Stars', 'Bruins', 'Leafs', 'Hurricanes'],
  mma: ['Makhachev', 'Topuria', 'Pereira', 'Du Plessis', 'Aspinall', 'Pantoja', 'Edwards', "O'Malley"],
  baseball: ['Dodgers', 'Yankees', 'Braves', 'Phillies', 'Astros', 'Orioles', 'Mariners', 'Padres'],
  esports: ['T1', 'G2', 'NaVi', 'FaZe', 'Vitality', 'Gen.G', 'Spirit', 'MOUZ'],
};
const LEAGUE = {
  football: 'Champions League', basketball: 'NBA', tennis: 'ATP / WTA', cricket: 'ICC',
  hockey: 'NHL', mma: 'UFC', baseball: 'MLB', esports: 'CS2 / LoL',
};
const DRAWS = new Set(['football', 'hockey', 'cricket']);

// Small deterministic PRNG so the demo is stable within a day.
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const priced = (probs, margin = 0.05) =>
  probs.map((p) => +Math.max(1.01, 1 / (p * (1 + margin))).toFixed(2));

function lineup(r, team, sport) {
  const pos = {
    football: ['GK', 'RB', 'CB', 'CB', 'LB', 'CM', 'CM', 'CAM', 'RW', 'LW', 'ST'],
    basketball: ['PG', 'SG', 'SF', 'PF', 'C'],
    hockey: ['G', 'D', 'D', 'C', 'LW', 'RW'],
    baseball: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'],
    cricket: ['BAT', 'BAT', 'BAT', 'BAT', 'WK', 'AR', 'AR', 'BOWL', 'BOWL', 'BOWL', 'BOWL'],
    esports: ['IGL', 'AWP', 'ENTRY', 'SUP', 'LURK'],
  }[sport];
  if (!pos) return null;
  return pos.map((p, i) => ({
    pos: p,
    name: `${team.slice(0, 3).toUpperCase()} #${i + 1}`,
    rating: +(6 + r() * 3.5).toFixed(1),
    status: r() < 0.08 ? 'doubt' : 'fit',
  }));
}

function makeEvent(sport, i, r, now) {
  const pool = TEAMS[sport];
  const a = Math.floor(r() * pool.length);
  let b = Math.floor(r() * pool.length);
  if (b === a) b = (b + 1) % pool.length;
  const home = pool[a], away = pool[b];

  const strength = 0.25 + r() * 0.5; // home win share before draw
  const draw = DRAWS.has(sport) ? 0.18 + r() * 0.12 : 0;
  const pH = (1 - draw) * strength, pA = (1 - draw) * (1 - strength);
  const names = draw ? [home, 'Draw', away] : [home, away];
  const probs = draw ? [pH, draw, pA] : [pH, pA];
  const odds = priced(probs);

  const totLine = { football: 2.5, basketball: 224.5, tennis: 22.5, cricket: 310.5, hockey: 5.5, mma: 2.5, baseball: 8.5, esports: 2.5 }[sport];
  const pOver = 0.35 + r() * 0.3;
  const [oOver, oUnder] = priced([pOver, 1 - pOver]);

  const markets = [
    { name: draw ? 'Match Result' : 'Winner', outcomes: names.map((n, k) => ({ name: n, odds: odds[k] })) },
    { name: `Total ${totLine}`, outcomes: [{ name: `Over ${totLine}`, odds: oOver }, { name: `Under ${totLine}`, odds: oUnder }] },
  ];
  if (sport === 'football') {
    const pBtts = 0.4 + r() * 0.25;
    const [y, n] = priced([pBtts, 1 - pBtts]);
    markets.push({ name: 'Both Teams To Score', outcomes: [{ name: 'Yes', odds: y }, { name: 'No', odds: n }] });
  }

  const form = () => Array.from({ length: 5 }, () => (r() < 0.45 ? 'W' : r() < 0.5 && draw ? 'D' : 'L'));
  const start = now + (i * 47 + Math.floor(r() * 600)) * 60000;
  return {
    id: `${sport}-${i}`,
    sport,
    league: LEAGUE[sport],
    home, away,
    start,
    live: r() < 0.15,
    markets,
    stats: {
      homeForm: form(), awayForm: form(),
      h2h: { home: Math.floor(r() * 6), draw: draw ? Math.floor(r() * 3) : 0, away: Math.floor(r() * 6) },
      homeRating: Math.round(1400 + strength * 600), awayRating: Math.round(1400 + (1 - strength) * 600),
    },
    lineups: { home: lineup(r, home, sport), away: lineup(r, away, sport) },
  };
}

export async function loadEvents() {
  try {
    const events = await fetchAll(AbortSignal.timeout(12000));
    if (events.length) return { events, source: 'ESPN live', demo: false, fetchedAt: Date.now() };
  } catch { /* blocked or offline: try the snapshot */ }

  try {
    const res = await fetch('data/odds.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.events) && json.events.length) return { events: json.events, source: json.source || 'feed', demo: false, fetchedAt: json.fetchedAt };
    }
  } catch { /* no feed: fall through to demo */ }

  const now = Date.now();
  const r = rng(Math.floor(now / 86400000));
  const events = SPORTS.filter((s) => TEAMS[s.id]).flatMap((s) => Array.from({ length: 8 }, (_, i) => makeEvent(s.id, i, r, now)));
  return { events, source: 'demo', demo: true };
}
