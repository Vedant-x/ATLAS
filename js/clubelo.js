// ClubElo (clubelo.com): a strength rating for every European club in the top divisions, updated
// after each match. Used for soccer matches without a bookmaker price (lower leagues, cups): two
// ratings give a win / draw / win split far better than records alone. One CSV per day:
//   Rank,Club,Country,Level,Elo,From,To
// Clubs are matched to ESPN's names: exact, a known alias, or a ClubElo name whose words are all in
// the ESPN name, within the league's country (UEFA competitions: any country, if unique).

export const CLUBELO = (day) => `http://api.clubelo.com/${day}`;

export function parseClubElo(csv) {
  const out = [];
  for (const line of String(csv || '').split(/\r?\n/).slice(1)) {
    const [, club, country, level, elo] = line.split(',');
    const r = Number(elo);
    if (club && Number.isFinite(r)) out.push({ club, country, level: Number(level) || null, elo: r });
  }
  return out;
}

export const normClub = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(fc|cf|afc|sc|ac|as|ss|ssc|sv|vfb|vfl|tsg|fk|sk|bk|if|ik|cd|ud|sd|rc|rcd|ca|club|calcio|de|futbol|football|1\.?|04|05|1846|1860|1896|1899|1900|1907|1909|1910|1913)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

// ESPN name (normalised) → ClubElo name, where words alone don't match.
const ALIAS = {
  'manchester city': 'Man City', 'manchester united': 'Man United', 'paris saint germain': 'Paris SG', 'internazionale': 'Inter', 'inter milan': 'Inter',
  'milan': 'Milan', 'atletico madrid': 'Atletico', 'bayern munich': 'Bayern', 'borussia monchengladbach': 'Gladbach', 'bayer leverkusen': 'Leverkusen',
  'eintracht frankfurt': 'Frankfurt', 'tottenham hotspur': 'Tottenham', 'wolverhampton wanderers': 'Wolves', 'newcastle united': 'Newcastle',
  'west ham united': 'West Ham', 'brighton and hove albion': 'Brighton', 'nottingham forest': 'Forest', 'athletic': 'Bilbao', 'athletic bilbao': 'Bilbao',
  'real sociedad': 'Sociedad', 'celta vigo': 'Celta', 'sporting cp': 'Sporting', 'psv eindhoven': 'PSV', 'club brugge': 'Brugge', 'olympique lyonnais': 'Lyon',
  'olympique de marseille': 'Marseille', 'marseille': 'Marseille', 'lazio': 'Lazio', 'roma': 'Roma', 'napoli': 'Napoli', 'porto': 'Porto', 'benfica': 'Benfica',
  'sl benfica': 'Benfica', 'red bull salzburg': 'Salzburg', 'rb salzburg': 'Salzburg', 'rb leipzig': 'RB Leipzig', 'hoffenheim': 'Hoffenheim',
  'mainz': 'Mainz', 'koln': 'Koeln', 'cologne': 'Koeln', 'stuttgart': 'Stuttgart', 'schalke': 'Schalke', 'union berlin': 'Union Berlin', 'hertha berlin': 'Hertha',
  'deportivo alaves': 'Alaves', 'real betis': 'Betis', 'rayo vallecano': 'Rayo Vallecano', 'leganes': 'Leganes', 'espanyol': 'Espanyol',
  'queens park rangers': 'QPR', 'west bromwich albion': 'West Brom', 'sheffield wednesday': 'Sheffield Weds', 'paok salonika': 'PAOK', 'paok': 'PAOK',
  'olympiacos': 'Olympiakos', 'fenerbahce': 'Fenerbahce', 'besiktas': 'Besiktas', 'galatasaray': 'Galatasaray', 'red star belgrade': 'Crvena Zvezda',
  'dinamo zagreb': 'Dinamo Zagreb', 'ferencvaros': 'Ferencvaros', 'slavia prague': 'Slavia Praha', 'sparta prague': 'Sparta Praha', 'young boys': 'Young Boys',
  'fc copenhagen': 'FC Kobenhavn', 'copenhagen': 'FC Kobenhavn', 'bodo glimt': 'Bodoe Glimt', 'malmo ff': 'Malmoe', 'malmo': 'Malmoe', 'shakhtar donetsk': 'Shakhtar',
};
// ESPN league prefix → ClubElo country code.
const COUNTRY = { eng: 'ENG', esp: 'ESP', ger: 'GER', ita: 'ITA', fra: 'FRA', ned: 'NED', por: 'POR', bel: 'BEL', tur: 'TUR', sco: 'SCO', aut: 'AUT', gre: 'GRE', den: 'DEN', swe: 'SWE', nor: 'NOR', rus: 'RUS' };
export const countryOf = (leaguePath) => COUNTRY[String(leaguePath || '').split('/')[1]?.split('.')[0]] || null;
export const isEuropean = (leaguePath) => Boolean(countryOf(leaguePath)) || /^soccer\/uefa\./.test(leaguePath || '');

export function eloIndex(rows) {
  const byName = new Map(), list = rows.map((r) => ({ ...r, n: normClub(r.club), words: normClub(r.club).split(' ').filter(Boolean) }));
  for (const r of list) byName.set(r.n, r);
  for (const r of list) byName.set(r.club.toLowerCase(), r);
  return {
    find(name, leaguePath) {
      const n = normClub(name), country = countryOf(leaguePath);
      const ok = (r) => r && (!country || r.country === country);
      const exact = byName.get(n);
      if (ok(exact)) return exact;
      const al = ALIAS[n] && byName.get(ALIAS[n].toLowerCase());
      if (ok(al)) return al;
      const words = new Set(n.split(' '));
      const hits = list.filter((r) => ok(r) && r.words.length && r.words.every((w) => words.has(w)));
      if (hits.length === 1) return hits[0];
      // Several (e.g. "Real Madrid" and "Madrid"): the one using the most of the name's words.
      if (hits.length > 1) { hits.sort((a, b) => b.words.length - a.words.length); if (hits[0].words.length > hits[1].words.length) return hits[0]; }
      return null;
    },
  };
}

// Win / draw / win from two ratings: the Elo expectation (home edge HOME points), with a draw share
// that shrinks as the gap grows.
export const ELO_HOME = 70;
export function eloWin(home, away, { neutral = false } = {}) {
  const d = home - away + (neutral ? 0 : ELO_HOME);
  const we = 1 / (1 + 10 ** (-d / 400));
  const draw = Math.max(0.12, 0.28 * (1 - 1.3 * Math.abs(we - 0.5)));
  const h = Math.max(0.02, we - draw / 2), a = Math.max(0.02, 1 - we - draw / 2);
  const t = h + draw + a;
  return { home: h / t, draw: draw / t, away: a / t };
}
