// World Football Elo Ratings (eloratings.net): a rating for every national team, updated after each
// international. Used for international matches no bookmaker in our feeds prices (qualifiers,
// friendlies, Nations League, continental cups): two ratings give a far better win/draw/win split
// than records alone. Two tab-separated files:
//   World.tsv      one row per team: rank, …, the team's code, its rating, …
//   en.teams.tsv   one row per team: code, English name (and other names)
// The columns are found by their shape (a 2-4 letter code; the first rating-sized number after it),
// so a reordered file still reads, and anything unreadable gives no ratings rather than wrong ones.
import { normClub } from './clubelo.js';

export const ELO_WORLD = 'https://www.eloratings.net/World.tsv';
export const ELO_TEAMS = 'https://www.eloratings.net/en.teams.tsv';

const CODE = /^[A-Z]{2,4}$/;
const rows = (tsv) => String(tsv || '').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.split('\t').map((c) => c.trim())).filter((r) => r.length > 1);

export function parseTeams(tsv) {
  const names = new Map();
  for (const r of rows(tsv)) {
    const i = r.findIndex((c) => CODE.test(c));
    if (i < 0) continue;
    for (const n of r.slice(i + 1).filter((c) => /[a-z]/i.test(c) && !CODE.test(c))) if (!names.has(normClub(n))) names.set(normClub(n), r[i]);
  }
  return names; // normalised name -> code
}

export function parseWorld(tsv) {
  const elo = new Map();
  for (const r of rows(tsv)) {
    const i = r.findIndex((c) => CODE.test(c));
    if (i < 0) continue;
    const rating = r.slice(i + 1).map(Number).find((v) => Number.isFinite(v) && v >= 700 && v <= 2600);
    if (rating && !elo.has(r[i])) elo.set(r[i], rating);
  }
  return elo; // code -> rating
}

// ESPN national-team name (normalised) → the name eloratings.net uses, where they differ.
const ALIAS = {
  'usa': 'united states', 'united states of america': 'united states', 'korea republic': 'south korea', 'republic of korea': 'south korea', 'korea dpr': 'north korea',
  'ir iran': 'iran', 'turkiye': 'turkey', 'czechia': 'czech republic', 'cote d ivoire': 'ivory coast', 'cabo verde': 'cape verde', 'china pr': 'china',
  'republic of ireland': 'ireland', 'bosnia herzegovina': 'bosnia and herzegovina', 'north macedonia': 'macedonia', 'congo dr': 'dr congo', 'eswatini': 'swaziland',
};

export function eloratingsIndex(worldTsv, teamsTsv) {
  const elo = parseWorld(worldTsv), names = parseTeams(teamsTsv);
  return {
    size: elo.size,
    find(name) {
      // Men's senior ratings only: an under-21 or women's side is a different team.
      if (/\b(u ?\d{2}|women|w)\b/i.test(String(name))) return null;
      const n = normClub(name);
      const code = names.get(n) || names.get(ALIAS[n] || '');
      return code ? elo.get(code) ?? null : null;
    },
  };
}

// The leagues whose matches are between national teams.
export const isInternational = (leaguePath) => /^soccer\/(fifa\.(world|worldq|friendly)|uefa\.(nations|euro)|conmebol\.america|concacaf\.(gold|nations)|caf\.nations|afc\.asian)/.test(leaguePath || '');

// Ratings onto international matches with no rating yet. Returns { rated, unmatched: [names] }.
export function applyEloratings(events, index) {
  const out = { rated: 0, unmatched: new Set() };
  if (!index?.size) return { ...out, unmatched: [] };
  for (const e of events) {
    if (!isInternational(e.leaguePath) || e.stats?.homeElo) continue;
    const h = index.find(e.home), a = index.find(e.away);
    if (!h) out.unmatched.add(e.home);
    if (!a) out.unmatched.add(e.away);
    if (!h || !a) continue;
    e.stats = { ...(e.stats || {}), homeElo: h, awayElo: a, eloSource: 'World Football Elo' };
    out.rated++;
  }
  return { ...out, unmatched: [...out.unmatched] };
}
