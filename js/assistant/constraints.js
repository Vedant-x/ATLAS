// What a question asks for, as constraints every answer must keep: an odds range, a day or window,
// sports or leagues to include or leave out, "positive return only", how many, and a multiplier.
// Pure, so it can be tested; K supplies sportIn / leagueIn (knowledge.js).
//
//   "one bet with odds at least 1.80"        -> minOdds 1.8, n 1
//   "best bets tomorrow"                      -> from/to = tomorrow (local day)
//   "best bets excluding NBA"                 -> exclude leagues [basketball/nba]
//   "an NBA-only 3x slip"                     -> league basketball/nba, target 3
//   "positive edge bets only"                 -> positiveOnly (never substituted)

const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };
const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function parseConstraints(raw, K, now = Date.now()) {
  let q = String(raw || '').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const c = { exclude: { sports: [], leagues: [] } };

  // Exclusions first, and cut them out so "excluding NBA" never reads as "NBA".
  // A list runs through "and" / "or" ("no tennis or baseball"); words that are not a sport or league
  // go back into the question ("no nba and give me 3 bets" keeps "give me 3 bets").
  const EXCL = /\b(?:excluding|exclude|except(?: for)?|without|other than|skip(?:ping)?|not|no|non)[- ]((?:the )?[a-z0-9' ]+?(?:(?:,| and| or)\s*(?:the )?[a-z][a-z0-9' ]*?)*?)(?=$|[,.;!?]| (?:but|with|only|odds|today|tomorrow|tonight|this|next|bets?|picks?|slips?|games?|matches?)\b)/g;
  q = q.replace(EXCL, (all, what) => {
    const parts = what.split(/,| and | or /).map((x) => x.trim()).filter(Boolean);
    const rest = [];
    let used = false;
    for (const w of parts) {
      const lg = K.leagueIn(w), sp = lg ? null : K.sportIn(w);
      if (lg) { c.exclude.leagues.push(lg); used = true; } else if (sp) { c.exclude.sports.push(sp); used = true; } else rest.push(w);
    }
    return used ? ` ${rest.join(' ')} ` : all;
  });

  // Odds limits ("odds at least 1.80", "1.8+ odds", "min odds 2", "under 1.50 odds", "odds between 1.5 and 2").
  const n = '(\\d+(?:\\.\\d+)?)';
  let m;
  if ((m = q.match(new RegExp(`odds (?:between|from) ${n} (?:and|to|-) ${n}`)))) { c.minOdds = +m[1]; c.maxOdds = +m[2]; }
  if (c.minOdds == null && (m = q.match(new RegExp(`(?:odds|price)[^0-9]{0,24}?(?:at least|minimum|min|over|above|>=|≥|>|from) ?${n}|(?:at least|minimum|min|over|above|>=|≥) ?${n} ?(?:odds|price)|${n} ?\\+ ?(?:odds|price)?|(?:odds|price) ?${n} ?\\+`)))) c.minOdds = +(m[1] || m[2] || m[3] || m[4]);
  if (c.maxOdds == null && (m = q.match(new RegExp(`(?:odds|price)[^0-9]{0,24}?(?:at most|maximum|max|under|below|<=|≤|<) ?${n}|(?:at most|maximum|max|under|below|<=|≤) ?${n} ?(?:odds|price)`)))) c.maxOdds = +(m[1] || m[2]);
  for (const k of ['minOdds', 'maxOdds']) if (c[k] != null && !(c[k] >= 1.01 && c[k] <= 1000)) delete c[k];

  // Day or window.
  const today0 = dayStart(now), D = 864e5;
  if (/\btomorrow\b/.test(q)) { c.day = 'tomorrow'; c.from = today0 + D; c.to = today0 + 2 * D; }
  else if (/\b(today|tonight)\b/.test(q)) { c.day = 'today'; c.from = now; c.to = today0 + D + 6 * 36e5; }
  else if (/\b(this week|next 7 days|week)\b/.test(q)) { c.day = 'week'; c.from = now; c.to = now + 7 * D; }
  else if (/\bweekend\b/.test(q)) { const dow = new Date(now).getDay(); const sat = today0 + ((6 - dow + 7) % 7) * D; c.day = 'weekend'; c.from = Math.max(now, sat); c.to = sat + 2 * D; }

  // Positive return only (value / +EV with "only", or "positive edge").
  c.positiveOnly = /\b(positive (edge|value|ev|return)|\+ ?ev|value only|only (value|positive)|edge only)\b/.test(q) || (/\b(value|edge|\+ev|positive)\b/.test(q) && /\bonly\b/.test(q));

  // Multiplier ("3x", "10 times", "mega").
  if ((m = q.match(/(\d{1,5}(?:\.\d+)?)\s*x\b|\b(\d{1,5}(?:\.\d+)?)\s*times\b/))) { const t = +(m[1] || m[2]); if (t >= 1.2 && t <= 100000) c.target = t; }
  else if (/\bmega\b/.test(q)) c.target = 100;

  // Scope: a league or sport still named after exclusions ("nba-only", "only nba", "nba bets").
  const lg = K.leagueIn(q), sp = lg ? null : K.sportIn(q);
  if (lg && !c.exclude.leagues.includes(lg)) c.league = lg;
  else if (sp && !c.exclude.sports.includes(sp)) c.sport = sp;

  // How many ("one bet", "3 picks"); a multiplier or an odds number is not a count.
  const cleaned = q.replace(/\d+(?:\.\d+)?\s*(?:x|times|\+)\b/g, ' ').replace(/(?:odds|price)[^a-z]{0,30}\d+(?:\.\d+)?/g, ' ').replace(/\d+\.\d+/g, ' ');
  if ((m = cleaned.match(/\b(\d{1,2})\s*(?:[a-z]+\s+)?(?:bets?|picks?|tips?|legs?|selections?)\b/))) c.n = +m[1];
  else { const w = Object.keys(NUM).find((k) => new RegExp(`\\b${k}\\s+(?:bets?|picks?|tips?|selections?)\\b`).test(cleaned) || new RegExp(`\\b(?:give me|just)\\s+${k}\\b`).test(cleaned)); if (w) c.n = NUM[w]; }
  return c;
}

// The constraints as short labels for the answer ("Tomorrow · NBA · Odds ≥ 1.80 · Positive return only").
export function constraintChips(c, names = {}) {
  const out = [];
  if (c.day) out.push({ today: 'Today', tomorrow: 'Tomorrow', week: 'Next 7 days', weekend: 'Weekend' }[c.day]);
  const lname = (l) => (names.leagueName ? names.leagueName(l) : l.split('/').pop().toUpperCase());
  if (c.league) out.push(lname(c.league));
  else if (c.sport) out.push(names.sport || c.sport);
  for (const l of c.exclude?.leagues || []) out.push(`Not ${lname(l)}`);
  for (const s of c.exclude?.sports || []) out.push(`Not ${s}`);
  if (c.minOdds != null && c.maxOdds != null) out.push(`Odds ${c.minOdds.toFixed(2)}–${c.maxOdds.toFixed(2)}`);
  else if (c.minOdds != null) out.push(`Odds ≥ ${c.minOdds.toFixed(2)}`);
  else if (c.maxOdds != null) out.push(`Odds ≤ ${c.maxOdds.toFixed(2)}`);
  if (c.positiveOnly) out.push('Positive return only');
  if (c.target) out.push(`${c.target}x`);
  if (c.n) out.push(`${c.n} pick${c.n > 1 ? 's' : ''}`);
  return out;
}

// Does one event pass the constraints' scope (for slips and lists)?
export const passes = (c, e) => (!c.sport || e.sport === c.sport) && (!c.league || e.leaguePath === c.league)
  && !(c.exclude?.sports || []).includes(e.sport) && !(c.exclude?.leagues || []).includes(e.leaguePath)
  && (!c.from || e.start >= c.from) && (!c.to || e.start < c.to);
