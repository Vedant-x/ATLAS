// football-data.co.uk: upcoming fixtures with real bookmaker odds for 22 European leagues, in one CSV
// (fixtures.csv, refreshed a few times a week). ATLAS uses it for matches ESPN leaves unpriced (most
// of the English lower leagues, the second divisions, Scotland, Greece, Turkey, Belgium, Portugal):
// Pinnacle's 1X2 and over/under 2.5 where given (a sharp bookmaker, the best single reference),
// otherwise the average across the books the file lists, otherwise Bet365.
//   Div,Date,Time,HomeTeam,AwayTeam,...,B365H,B365D,B365A,...,PSH,PSD,PSA,...,AvgH,AvgD,AvgA,...,P>2.5,P<2.5,Avg>2.5,Avg<2.5
// Times are UK local time. The file carries no quote time, so a match's price time is the file's
// Last-Modified date (passed in by the build): old prices show as old.
import { normClub, countryOf } from './clubelo.js';

export const FD_FIXTURES = 'https://www.football-data.co.uk/fixtures.csv';
export const FD_LEAGUES = {
  E0: 'soccer/eng.1', E1: 'soccer/eng.2', E2: 'soccer/eng.3', E3: 'soccer/eng.4', EC: 'soccer/eng.5', SC0: 'soccer/sco.1', SC1: 'soccer/sco.2',
  D1: 'soccer/ger.1', D2: 'soccer/ger.2', I1: 'soccer/ita.1', I2: 'soccer/ita.2', SP1: 'soccer/esp.1', SP2: 'soccer/esp.2', F1: 'soccer/fra.1', F2: 'soccer/fra.2',
  N1: 'soccer/ned.1', B1: 'soccer/bel.1', P1: 'soccer/por.1', T1: 'soccer/tur.1', G1: 'soccer/gre.1',
};

// UK clock time to UTC: British Summer Time runs from the last Sunday of March to the last Sunday
// of October (both at 01:00 UTC).
const lastSunday = (y, m) => { const d = new Date(Date.UTC(y, m + 1, 0)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d; };
export function ukToUtc(y, mo, d, h, mi) {
  const naive = Date.UTC(y, mo, d, h, mi);
  const bstFrom = lastSunday(y, 2).getTime() + 36e5, bstTo = lastSunday(y, 9).getTime() + 36e5;
  return naive - (naive - 36e5 >= bstFrom && naive - 36e5 < bstTo ? 36e5 : 0);
}

const num = (x) => { const v = Number(x); return Number.isFinite(v) && v > 1 ? v : null; };
const trio = (r, a, b, c) => (num(r[a]) && num(r[b]) && num(r[c]) ? [num(r[a]), num(r[b]), num(r[c])] : null);
const pair = (r, a, b) => (num(r[a]) && num(r[b]) ? [num(r[a]), num(r[b])] : null);

export function parseFixtures(csv) {
  const lines = String(csv || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim());
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const r = Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()]));
    const leaguePath = FD_LEAGUES[r.Div];
    const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(r.Date || ''), tm = /^(\d{1,2}):(\d{2})$/.exec(r.Time || '');
    if (!leaguePath || !dm || !r.HomeTeam || !r.AwayTeam) continue;
    const year = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);
    const start = ukToUtc(year, Number(dm[2]) - 1, Number(dm[1]), tm ? Number(tm[1]) : 15, tm ? Number(tm[2]) : 0);
    const x12 = trio(r, 'PSH', 'PSD', 'PSA'), avg = trio(r, 'AvgH', 'AvgD', 'AvgA'), b365 = trio(r, 'B365H', 'B365D', 'B365A');
    const res = x12 || avg || b365;
    if (!res) continue;
    const ou = pair(r, 'P>2.5', 'P<2.5') || pair(r, 'Avg>2.5', 'Avg<2.5') || pair(r, 'B365>2.5', 'B365<2.5');
    out.push({ div: r.Div, leaguePath, start, home: r.HomeTeam, away: r.AwayTeam, res, ou, book: x12 ? 'Pinnacle' : avg ? 'bookmaker average' : 'Bet365' });
  }
  return out;
}

// ESPN name (normalised) → football-data.co.uk name, where the words alone don't match.
const ALIAS = {
  'manchester city': 'Man City', 'manchester united': 'Man United', 'nottingham forest': "Nott'm Forest", 'wolverhampton wanderers': 'Wolves',
  'brighton and hove albion': 'Brighton', 'tottenham hotspur': 'Tottenham', 'west ham united': 'West Ham', 'newcastle united': 'Newcastle',
  'sheffield wednesday': 'Sheffield Weds', 'sheffield united': 'Sheffield United', 'queens park rangers': 'QPR', 'west bromwich albion': 'West Brom',
  'milton keynes dons': 'Milton Keynes Dons', 'mk dons': 'Milton Keynes Dons', 'atletico madrid': 'Ath Madrid', 'athletic club': 'Ath Bilbao', 'athletic bilbao': 'Ath Bilbao',
  'rayo vallecano': 'Vallecano', 'espanyol': 'Espanol', 'real betis': 'Betis', 'celta vigo': 'Celta', 'real sociedad': 'Sociedad', 'deportivo alaves': 'Alaves',
  'paris saint germain': 'Paris SG', 'borussia monchengladbach': "M'gladbach", 'eintracht frankfurt': 'Ein Frankfurt', 'bayer leverkusen': 'Leverkusen',
  'borussia dortmund': 'Dortmund', 'internazionale': 'Inter', 'inter milan': 'Inter', 'ac milan': 'Milan', 'psv eindhoven': 'PSV Eindhoven', 'sporting cp': 'Sp Lisbon',
  'sporting lisbon': 'Sp Lisbon', 'sc braga': 'Sp Braga', 'braga': 'Sp Braga', 'vitoria guimaraes': 'Guimaraes', 'olympiacos': 'Olympiakos', 'club brugge': 'Club Brugge',
  'royal antwerp': 'Antwerp', 'st mirren': 'St Mirren', 'heart of midlothian': 'Hearts', 'hibernian': 'Hibernian', 'inverness caledonian thistle': 'Inverness C',
};

// Find the fixture for one ATLAS match: same league, kick-off within a day, both clubs matched
// (exact, a known alias, or every word of the shorter name in the longer one, unique in the league).
export function fixtureIndex(fixtures) {
  const byLeague = new Map();
  for (const f of fixtures) { if (!byLeague.has(f.leaguePath)) byLeague.set(f.leaguePath, []); byLeague.get(f.leaguePath).push(f); }
  const same = (espn, fd) => {
    const a = normClub(espn), b = normClub(fd);
    if (a === b || (ALIAS[a] && normClub(ALIAS[a]) === b)) return true;
    const wa = a.split(' ').filter(Boolean), wb = b.split(' ').filter(Boolean);
    const [s, l] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
    if (s.length > 0 && s.every((w) => l.has(w))) return true;
    // One-word names where one is a shortening of the other ("Kocaeli" / "Kocaelispor"): 5+ letters.
    return wa.length === 1 && wb.length === 1 && Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a));
  };
  return {
    find(e) {
      const cands = (byLeague.get(e.leaguePath) || []).filter((f) => Math.abs(f.start - e.start) <= 26 * 36e5 && same(e.home, f.home) && same(e.away, f.away));
      return cands.length === 1 ? cands[0] : null;
    },
    clubs: (leaguePath) => [...new Set((byLeague.get(leaguePath) || []).flatMap((f) => [f.home, f.away]))],
  };
}

// Prices onto unpriced, not-live, upcoming matches. fileAt: the file's Last-Modified time; prices
// older than maxAge are not applied. Returns { priced, unmatched: [ATLAS names with no fixture] }.
export function applyFixtures(events, fixtures, { now = Date.now(), fileAt = null, maxAge = 7 * 864e5 } = {}) {
  const out = { priced: 0, unmatched: [] };
  if (fileAt != null && now - fileAt > maxAge) return out;
  const idx = fixtureIndex(fixtures);
  const leagues = new Set(Object.values(FD_LEAGUES));
  // The file covers a few days; a match outside them is not a name that failed to match.
  const from = Math.min(...fixtures.map((f) => f.start)) - 864e5, to = Math.max(...fixtures.map((f) => f.start)) + 864e5;
  for (const e of events) {
    if (!leagues.has(e.leaguePath) || e.live || !(e.start > now) || e.markets?.length || !countryOf(e.leaguePath)) continue;
    const f = idx.find(e);
    if (!f) { if (e.start >= from && e.start <= to) out.unmatched.push(`${e.home} v ${e.away} [${e.leaguePath.split('/')[1]}]`); continue; }
    e.markets = [{ name: 'Match Result', outcomes: [{ name: e.home, odds: f.res[0] }, { name: 'Draw', odds: f.res[1] }, { name: e.away, odds: f.res[2] }] }];
    if (f.ou) e.markets.push({ name: 'Total 2.5', outcomes: [{ name: 'Over 2.5', odds: f.ou[0] }, { name: 'Under 2.5', odds: f.ou[1] }] });
    e.bookmaker = `${f.book} via football-data.co.uk`;
    e.oddsSource = 'football-data';
    e.priceAt = fileAt ?? null; // the file's own date; unknown if the server gives none
    out.priced++;
  }
  return out;
}
