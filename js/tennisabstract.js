// Tennis Elo from Tennis Abstract (tennisabstract.com/reports/atp_elo_ratings.html and the WTA
// page): a rating for every ranked player, overall and per surface (hard, clay, grass), from every
// tour-level result. Rankings reward how much a player plays; Elo rates how well, which predicts a
// match better. Used for singles matches with no bookmaker price: half overall Elo, half the
// surface's, as Tennis Abstract itself suggests.
// The page is an HTML table; its columns are found by their header text (Player, Elo, hElo, cElo,
// gElo), so a reordered table still reads, and a changed one gives no ratings rather than wrong ones.
import { normClub } from './clubelo.js';

export const TA_ELO = { atp: 'https://www.tennisabstract.com/reports/atp_elo_ratings.html', wta: 'https://www.tennisabstract.com/reports/wta_elo_ratings.html' };

const text = (s) => String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

export function parseEloPage(html) {
  const out = new Map();
  const tableRows = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  let col = null;
  for (const tr of tableRows) {
    const cells = (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map(text);
    if (!col) {
      const at = (h) => cells.findIndex((c) => c.toLowerCase() === h);
      if (at('player') >= 0 && at('elo') >= 0) col = { player: at('player'), elo: at('elo'), hard: at('helo'), clay: at('celo'), grass: at('gelo') };
      continue;
    }
    const name = cells[col.player], elo = Number(cells[col.elo]);
    if (!name || !(elo > 1000 && elo < 3000)) continue;
    const num = (i) => { const v = Number(cells[i]); return i >= 0 && v > 1000 && v < 3000 ? v : null; };
    out.set(normClub(name), { name, elo, hard: num(col.hard), clay: num(col.clay), grass: num(col.grass) });
  }
  return out;
}

// The surface, from the tournament: the clay and grass events are few and known; the rest are hard
// (indoor or outdoor). June means grass for the events that have both.
const CLAY = /roland|french open|monte.?carlo|madrid|rome|internazionali|italian open|barcelona|hamburg|gstaad|kitzb|umag|bastad|b[aå]stad|buenos aires|rio de janeiro|rio open|santiago|estoril|munich|geneva|lyon|houston|marrakech|bucharest|c[oó]rdoba|palermo|prague|rabat|bogot|charleston|strasbourg|lausanne|iasi|parma|budapest|warsaw|portoroz|bol\b|cagliari|split|grand prix hassan|chile open|argentina open|serbia open|banja luka|belgrade|tiriac/i;
const GRASS = /wimbledon|queen'?s|halle|hertogenbosch|libema|eastbourne|mallorca|berlin|bad homburg|nottingham|birmingham|newport|ilkley|boss open|terra wortmann|cinch/i;
export function surfaceOf(t, start) {
  const s = `${t?.tournament || ''} ${t?.location || ''}`;
  const june = new Date(start || Date.now()).getUTCMonth() === 5;
  if (GRASS.test(s) || (june && /stuttgart/i.test(s))) return 'grass';
  if (CLAY.test(s) || (!june && /stuttgart/i.test(s) && new Date(start || Date.now()).getUTCMonth() === 3)) return 'clay';
  return 'hard';
}

// A player's rating for a surface: half overall, half the surface's (overall alone if no surface Elo).
export const blendElo = (r, surface) => (r?.[surface] ? (r.elo + r[surface]) / 2 : r?.elo ?? null);

// Find a player: exact name, else the same surname with the same first initial (unique).
export function eloIndex(map) {
  const list = [...map.values()].map((r) => ({ r, words: normClub(r.name).split(' ') }));
  return {
    size: map.size,
    find(name) {
      const n = normClub(name);
      if (map.has(n)) return map.get(n);
      const w = n.split(' '), last = w.at(-1), first = w[0]?.[0];
      const hits = list.filter((x) => x.words.at(-1) === last && x.words[0]?.[0] === first);
      return hits.length === 1 ? hits[0].r : null;
    },
  };
}

// Ratings onto singles matches (ATP / WTA tours) with no price. Returns { rated, unmatched }.
export function applyTennisElo(events, { atp, wta }) {
  const out = { rated: 0, unmatched: new Set() };
  for (const e of events) {
    if (e.sport !== 'tennis' || !e.tennis || e.tennis.draw !== 'Singles' || e.markets?.length) continue;
    const idx = /wta|women/i.test(`${e.leaguePath} ${e.league}`) ? wta : atp;
    if (!idx?.size) continue;
    const h = idx.find(e.home), a = idx.find(e.away);
    if (!h) out.unmatched.add(e.home);
    if (!a) out.unmatched.add(e.away);
    if (!h || !a) continue;
    const surface = surfaceOf(e.tennis, e.start);
    e.tennis = { ...e.tennis, surface, surfaceInferred: true, home: { ...e.tennis.home, elo: Math.round(blendElo(h, surface)) }, away: { ...e.tennis.away, elo: Math.round(blendElo(a, surface)) } };
    out.rated++;
  }
  return { rated: out.rated, unmatched: [...out.unmatched] };
}
