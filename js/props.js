// Player props: DraftKings milestone lines ("Zubac 8+ points", "Ramirez 1+ hits") and anytime
// scorers, from ESPN's core odds feed (sports.core.api.espn.com …/odds/100/propBets). Each is a
// one-way price, so the chance is the price's own chance less a typical one-sided margin. Only prop
// types the box score can grade are kept, so every recorded prop can be settled.

export const CORE = 'https://sports.core.api.espn.com/v2/sports';
export const PROVIDER = 100; // DraftKings, the provider ESPN carries
const MARGIN = 0.05; // one side's share of a two-way book's margin
export const PROP_SPORTS = new Set(['basketball', 'baseball', 'hockey', 'soccer', 'football']);

// Prop type (without " Milestones") → [label, box-score stats summed, fixed target for yes/no props].
// Stats are "<group>.<key>" from the ESPN summary box score (see boxStats).
const P = (label, keys, target = null) => ({ label, keys, target });
export const PROP_STATS = {
  basketball: {
    Points: P('points', ['all.points']), Rebounds: P('rebounds', ['all.rebounds']), Assists: P('assists', ['all.assists']),
    '3-Point Field Goals': P('threes', ['all.threePointFieldGoalsMade-threePointFieldGoalsAttempted']),
    'Points + Assists + Rebounds': P('pts+reb+ast', ['all.points', 'all.rebounds', 'all.assists']),
    'Points + Assists': P('pts+ast', ['all.points', 'all.assists']), 'Points + Rebounds': P('pts+reb', ['all.points', 'all.rebounds']),
    'Rebounds + Assists': P('reb+ast', ['all.rebounds', 'all.assists']), Steals: P('steals', ['all.steals']), Blocks: P('blocks', ['all.blocks']),
  },
  baseball: {
    Hits: P('hits', ['batting.hits']), Runs: P('runs', ['batting.runs']), RBIs: P('RBIs', ['batting.RBIs']), 'Home Runs': P('home runs', ['batting.homeRuns']),
    'Hits + Runs + RBIs': P('hits+runs+RBIs', ['batting.hits', 'batting.runs', 'batting.RBIs']), 'Runs + RBIs': P('runs+RBIs', ['batting.runs', 'batting.RBIs']),
    'Walks (Batter)': P('walks', ['batting.walks']),
  },
  hockey: {
    Points: P('points', ['skaters.goals', 'skaters.assists']), Goals: P('goals', ['skaters.goals']), Assists: P('assists', ['skaters.assists']),
    'Shots on Goal': P('shots on goal', ['skaters.shotsTotal']), 'Blocked Shots': P('blocked shots', ['skaters.blockedShots']),
    'Goalkeeper Saves': P('saves', ['goalies.saves']), 'Anytime Goalscorer': P('goal', ['skaters.goals'], 1),
  },
  soccer: { 'Anytime Goalscorer': P('goal', ['events.goals'], 1) },
  football: {
    'Passing Yards': P('passing yards', ['passing.passingYards']), 'Rushing Yards': P('rushing yards', ['rushing.rushingYards']),
    'Receiving Yards': P('receiving yards', ['receiving.receivingYards']), Receptions: P('receptions', ['receiving.receptions']),
    'Rushing + Receiving Yards': P('rush+rec yards', ['rushing.rushingYards', 'receiving.receivingYards']),
    'Passing Touchdown': P('passing TDs', ['passing.passingTouchdowns']),
    'Anytime Touchdown Scorer': P('touchdown', ['rushing.rushingTouchdowns', 'receiving.receivingTouchdowns'], 1),
  },
};
export const propDef = (sport, type) => PROP_STATS[sport]?.[String(type || '').replace(/ Milestones$/, '')] || null;
// The prop types most bookmakers list (Stake among them). Only these are offered; DraftKings' own
// extras (blocked shots, steals, walks, combined hits + runs + RBIs…) stay gradeable for old picks.
export const COMMON = {
  basketball: ['Points', 'Rebounds', 'Assists', '3-Point Field Goals', 'Points + Assists + Rebounds'],
  baseball: ['Hits', 'Home Runs', 'RBIs'],
  hockey: ['Points', 'Shots on Goal', 'Goalkeeper Saves', 'Anytime Goalscorer'],
  soccer: ['Anytime Goalscorer'],
  football: ['Passing Yards', 'Rushing Yards', 'Receiving Yards', 'Receptions', 'Anytime Touchdown Scorer'],
};
// A main line is priced near even money; DraftKings' ladder rungs far below it (1+ shot at 1.20) are
// alternative lines few other bookmakers carry.
const MAIN = 1.87, MAIN_RANGE = [1.5, 2.6];

const idOf = (ref) => /\/athletes\/(\d+)/.exec(ref || '')?.[1] || null;
export const propLabel = (pr) => (pr.yes ? `${pr.player} to score${pr.label === 'touchdown' ? ' a TD' : ''}` : `${pr.player} ${pr.target}+ ${pr.label}`);
// The same prop as most bookmakers write it: "over 24.5 points" for 25+.
export const propOver = (pr) => (pr.yes ? '' : `over ${pr.target - 0.5} ${pr.label}`);
export const propMarket = (pr) => `Player ${pr.label}`;

// Raw propBets items → props for one match. `who(id)` gives { name, side } for an athlete id. One
// line per player and stat: the main line (the rung nearest even money), or the anytime scorer price.
export function parseProps(items, sport, who, { minOdds = 1.15, maxOdds = 3, perEvent = 40 } = {}) {
  const best = new Map();
  for (const x of items || []) {
    const type = String(x.type?.name || '').replace(/ Milestones$/, '');
    const def = propDef(sport, type);
    const id = idOf(x.athlete?.$ref);
    if (!def || !id || !COMMON[sport]?.includes(type)) continue;
    const odds = Number(x.odds?.decimal?.value ?? x.current?.over?.decimal);
    const target = def.target ?? Number(x.current?.target?.value);
    const [lo, hi] = def.target != null ? [minOdds, maxOdds] : MAIN_RANGE;
    if (!(odds >= lo && odds <= hi) || !(target > 0)) continue;
    const key = `${id}|${def.label}`, was = best.get(key);
    if (!was || Math.abs(Math.log(odds / MAIN)) < Math.abs(Math.log(was.odds / MAIN))) best.set(key, { x, def, id, odds, target });
  }
  const out = [];
  for (const { x, def, id, odds, target } of best.values()) {
    const p = who(id);
    if (!p?.name) continue;
    out.push({ id, player: p.name, side: p.side || null, type: String(x.type.name).replace(/ Milestones$/, ''), label: def.label, target, yes: def.target != null, odds: +odds.toFixed(2), p: +Math.min(0.97, (1 / odds) * (1 - MARGIN)).toFixed(4), pm: +Math.min(0.97, (1 / odds) * (1 - MARGIN)).toFixed(4) });
  }
  return out.sort((a, b) => b.p - a.p).slice(0, perEvent);
}

// Every player's stats from an ESPN summary, keyed by athlete id: { "<group>.<key>": number }, plus
// goals from the key events (soccer). Three different facts are kept apart:
//   listed: the player appears in the box score or squad list at all;
//   played: listed with stats, or a starter / used substitute;
//   dnp:    listed but confirmed not to have played (no stats, "did not play", unused substitute).
// A player in none of them is unknown (an incomplete box score): never a loss or a void.
export function boxStats(sm) {
  const stats = {}, played = new Set(), listed = new Set(), dnp = new Set();
  for (const team of sm?.boxscore?.players || []) {
    for (const g of team.statistics || []) {
      const grp = /forwards|defenses|skaters/.test(g.name || '') ? 'skaters' : g.name || g.type || 'all';
      for (const a of g.athletes || []) {
        const id = String(a.athlete?.id || '');
        if (!id) continue;
        listed.add(id);
        // Did not play only when the feed says so; an empty stat row is missing data, not a DNP.
        if (a.didNotPlay === true) { dnp.add(id); continue; }
        if (!a.stats?.length) continue;
        played.add(id);
        const s = (stats[id] ||= {});
        (g.keys || []).forEach((k, i) => { const v = parseFloat(String(a.stats[i] ?? '').split(/[-/]/)[0]); if (Number.isFinite(v)) s[`${grp}.${k}`] = v; });
      }
    }
  }
  for (const r of sm?.rosters || []) {
    for (const a of r.roster || []) {
      const id = String(a.athlete?.id || '');
      if (!id) continue;
      listed.add(id);
      if (a.starter || a.subbedIn === true || a.subbedIn?.didSub) played.add(id); else dnp.add(id);
    }
  }
  // Goals from the key events: complete for a finished match, so a played player without one has 0.
  const events = Boolean(sm?.keyEvents);
  for (const k of sm?.keyEvents || []) {
    const t = k.type?.text || '';
    if (!(k.scoringPlay || /^goal|penalty - scored/i.test(t)) || /own goal/i.test(t)) continue;
    const id = String(k.participants?.[0]?.athlete?.id || '');
    if (!id) continue;
    played.add(id); listed.add(id);
    const s = (stats[id] ||= {});
    s['events.goals'] = (s['events.goals'] || 0) + 1;
  }
  for (const id of played) dnp.delete(id);
  return { stats, played, listed, dnp, events };
}

// 'won' | 'lost' | 'dnp' (the feed says the player did not play) | null (not known yet: retried, never guessed).
export function gradeProp(prop, sport, box) {
  const def = PROP_STATS[sport]?.[prop.type];
  if (!def || !box?.listed) return null;
  const id = String(prop.id);
  if (box.dnp.has(id)) return 'dnp';
  if (!box.played.has(id)) return null; // not in the box score: incomplete data, not a result
  const s = box.stats[id] || {};
  let v = 0;
  for (const k of def.keys) {
    if (Number.isFinite(s[k])) v += s[k];
    else if (k.startsWith('events.') && box.events) v += 0; // no goal in a complete event list
    else return null; // a stat the result needs is missing
  }
  return v >= prop.target ? 'won' : 'lost';
}

// ---------- player form ----------
// Each prop type as columns of ESPN's player game log (…/athletes/{id}/gamelog), which names its
// columns differently from the box score. Types missing here (goalie saves, soccer) use the price.
// The game-log column that says how much a player played (for the minutes filter), by sport.
export const OPPORTUNITY = { basketball: 'minutes', hockey: 'timeOnIcePerGame', baseball: 'atBats' };
export const GAMELOG_KEYS = {
  basketball: { Points: ['points'], Rebounds: ['totalRebounds'], Assists: ['assists'], '3-Point Field Goals': ['threePointFieldGoalsMade-threePointFieldGoalsAttempted'],
    'Points + Assists + Rebounds': ['points', 'totalRebounds', 'assists'], 'Points + Assists': ['points', 'assists'], 'Points + Rebounds': ['points', 'totalRebounds'],
    'Rebounds + Assists': ['totalRebounds', 'assists'], Steals: ['steals'], Blocks: ['blocks'] },
  baseball: { Hits: ['hits'], Runs: ['runs'], RBIs: ['RBIs'], 'Home Runs': ['homeRuns'], 'Hits + Runs + RBIs': ['hits', 'runs', 'RBIs'], 'Runs + RBIs': ['runs', 'RBIs'], 'Walks (Batter)': ['walks'] },
  hockey: { Points: ['goals', 'assists'], Goals: ['goals'], Assists: ['assists'], 'Shots on Goal': ['shotsTotal'], 'Anytime Goalscorer': ['goals'] },
  football: { 'Passing Yards': ['passingYards'], 'Rushing Yards': ['rushingYards'], 'Receiving Yards': ['receivingYards'], Receptions: ['receptions'],
    'Rushing + Receiving Yards': ['rushingYards', 'receivingYards'], 'Passing Touchdown': ['passingTouchdowns'], 'Anytime Touchdown Scorer': ['rushingTouchdowns', 'receivingTouchdowns'] },
};
// The player's last `n` games (regular season and playoffs, newest first) as { name: value } rows,
// each with _at (time), _opp (opponent team id), _oppAbbr and _home (true at home, false away, null
// unknown) from the log's own game list.
export function gamelogRows(g, n = 10) {
  const names = g?.names || [];
  const rows = [];
  for (const st of g?.seasonTypes || []) {
    if (/preseason/i.test(st.displayName || '')) continue;
    for (const c of st.categories || []) {
      for (const ev of c.events || []) {
        const info = g.events?.[ev.eventId] || {};
        const at = Date.parse(info.gameDate || '') || null;
        const row = {};
        names.forEach((k, i) => {
          const raw = String(ev.stats?.[i] ?? '');
          const clock = /^(\d+):(\d{2})$/.exec(raw); // time on ice "18:32" -> 18.5 minutes
          const v = clock ? +(Number(clock[1]) + Number(clock[2]) / 60).toFixed(1) : parseFloat(raw.split(/[-/]/)[0]);
          if (Number.isFinite(v)) row[k] = v;
        });
        Object.defineProperties(row, {
          _at: { value: at }, _opp: { value: info.opponent?.id != null ? String(info.opponent.id) : null },
          _oppAbbr: { value: info.opponent?.abbreviation || null }, _home: { value: info.atVs === 'vs' ? true : info.atVs === '@' ? false : null },
          _ev: { value: String(ev.eventId) }, _team: { value: info.team?.id != null ? String(info.team.id) : null },
        });
        rows.push({ at, row });
      }
    }
  }
  if (rows.every((r) => r.at)) rows.sort((a, b) => b.at - a.at);
  return rows.slice(0, n).map((r) => r.row);
}
// The season before the one a game log shows (from its season filter), to fill a short early-season log.
export function previousSeason(g) {
  const f = (g?.filters || []).find((x) => x.name === 'season');
  const opts = (f?.options || []).map((o) => String(o.value)).filter((v) => /^\d{4}$/.test(v));
  const cur = String(f?.value || opts[0] || '');
  return opts.find((v) => Number(v) === Number(cur) - 1) || null;
}
// How often the player reached this line in those games: { n, hits, avg } (null if the log can't say).
export function formFor(sport, type, target, rows) {
  const vals = propValues(sport, type, rows);
  if (!vals) return null;
  return { n: vals.length, hits: vals.filter((v) => v >= target).length, avg: +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1) };
}
// The prop's stat in each game (null if any game lacks a column the prop needs).
export function propValues(sport, type, rows) {
  const keys = GAMELOG_KEYS[sport]?.[type];
  if (!keys || !rows?.length || !rows.every((r) => keys.every((k) => Number.isFinite(r[k])))) return null;
  return rows.map((r) => keys.reduce((s, k) => s + r[k], 0));
}
// The chance (the old model, kept for comparison in tests): the price as a prior worth K games, then
// a flat count of the last 10.
const K = 8;
export const blendForm = (market, form) => (form?.n ? +((form.hits + K * market) / (form.n + K)).toFixed(4) : market);
export const hasForm = (sport, type) => Boolean(GAMELOG_KEYS[sport]?.[type]);

// ---------- prop history and the ATLAS chance ----------
const rate = (vals, t) => [vals.filter((v) => v >= t).length, vals.length];
// Everything the props page shows for one prop, from the player's games (newest first; `season` marks
// the current season's games): hit rates over 5, 10 and 20 games, this season, against this opponent
// and at this venue (home or away), the average, and the last 10 games for the chart.
export function propHistory(sport, type, target, rows, { opp = null, home = null } = {}) {
  const vals = propValues(sport, type, rows);
  if (!vals?.length) return null;
  const cur = rows.map((r, i) => [r, vals[i]]).filter(([r]) => r._season !== false);
  const vs = rows.map((r, i) => [r, vals[i]]).filter(([r]) => opp && r._opp === String(opp));
  const venue = home == null ? [] : rows.map((r, i) => [r, vals[i]]).filter(([r]) => r._home === home);
  const l10 = vals.slice(0, 10);
  return {
    l5: rate(vals.slice(0, 5), target), l10: rate(l10, target), l20: rate(vals.slice(0, 20), target),
    season: cur.length ? rate(cur.map((x) => x[1]), target) : null,
    vs: vs.length ? rate(vs.map((x) => x[1]), target) : null,
    venue: venue.length ? rate(venue.slice(0, 20).map((x) => x[1]), target) : null, home,
    avg: +(l10.reduce((s, v) => s + v, 0) / l10.length).toFixed(1),
    last: l10.map((v, i) => [v, rows[i]._oppAbbr || '', rows[i]._home === true ? 1 : rows[i]._home === false ? 0 : -1]),
  };
}

// P(X >= t) for a count with this mean and variance: Poisson, or negative binomial when the games
// vary more than a Poisson would.
export function countTail(mean, variance, t) {
  if (t <= 0) return 1;
  if (!(mean > 0)) return 0;
  // Large counts (yards, passing totals): the normal curve, with a continuity correction.
  if (mean > 30) return 1 - normCdf((t - 0.5 - mean) / Math.sqrt(Math.max(variance, mean)));
  let pmf, step;
  if (variance > mean * 1.05) {
    const r = (mean * mean) / (variance - mean), q = mean / (mean + r);
    pmf = Math.exp(r * Math.log(1 - q));
    step = (k) => (pmf *= ((k + r) / (k + 1)) * q);
  } else {
    pmf = Math.exp(-mean);
    step = (k) => (pmf *= mean / (k + 1));
  }
  let below = 0;
  for (let k = 0; k < t; k++) { below += pmf; step(k); }
  return Math.min(1, Math.max(0, 1 - below));
}

// Standard normal CDF (Abramowitz-Stegun 7.1.26 erf, error < 1.5e-7).
function normCdf(z) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

// A rough 80% range for a chance resting on `n` effective observations (the price counts as K more
// when there is one): wide on a thin sample, narrow on a long one. A normal approximation, not yet
// checked against how often future results land inside it, so the page calls it approximate.
const clamp01 = (x) => Math.min(0.99, Math.max(0.01, x));
export function chanceRange(p, n, priced = true) {
  const m = n + (priced ? K : 0) + 1;
  const half = 1.2816 * Math.sqrt((p * (1 - p)) / m);
  return [clamp01(p - half), clamp01(p + half)];
}

// The ATLAS chance for a prop. Two readings of the player's last 20 games, recent games counting
// more (a game 8 games ago counts half): how often he cleared the line, and the chance a player with
// his average and spread clears it (smooths out 24s and 26s around a line of 25). His record at this
// venue nudges the average when there are enough games. The bookmaker's price is the prior, worth 8
// games; the player's games move it as far as their effective number allows. Head-to-head samples are
// shown but never trusted: a handful of games against one team says little.
const HALF_LIFE = 8;
export function propChance(market, sport, type, target, rows, { home = null, scale = 1, without = null } = {}) {
  const vals = propValues(sport, type, rows)?.slice(0, 20);
  if (!vals?.length) return { p: market, n: 0, nEff: 0, form: null };
  const w = vals.map((_, i) => 0.5 ** (i / HALF_LIFE));
  const sw = w.reduce((s, x) => s + x, 0), sw2 = w.reduce((s, x) => s + x * x, 0);
  const nEff = (sw * sw) / sw2;
  let emp = vals.reduce((s, v, i) => s + w[i] * (v >= target ? 1 : 0), 0) / sw;
  // A key teammate out tonight: his games without that teammate count for more, as far as they go.
  if (without?.[1] >= 3) emp = (without[1] * (without[0] / without[1]) + 6 * emp) / (without[1] + 6);
  let mean = vals.reduce((s, v, i) => s + w[i] * v, 0) / sw;
  const variance = vals.reduce((s, v, i) => s + w[i] * (v - mean) ** 2, 0) / sw;
  if (home != null) {
    const at = rows.slice(0, 20).map((r, i) => [r._home, vals[i]]).filter(([h, v]) => h === home && v != null);
    const all = vals.reduce((s, v) => s + v, 0) / vals.length;
    if (at.length >= 4 && all > 0) {
      const ratio = at.reduce((s, x) => s + x[1], 0) / at.length / all;
      mean *= 1 + (ratio - 1) * (at.length / (at.length + 10));
    }
  }
  mean *= scale;
  const dist = countTail(mean, Math.max(variance, mean * 0.5), Math.ceil(target - 1e-9));
  const form = 0.5 * emp + 0.5 * dist;
  const p = (nEff * form + K * market) / (nEff + K);
  return { p: +Math.min(0.97, Math.max(0.03, p)).toFixed(4), n: vals.length, nEff: +nEff.toFixed(2), form: +form.toFixed(4) };
}

// ---------- other lines ----------
// Bookmakers offer the same prop at different lines (DraftKings "25+ points" is "over 24.5"; another
// book may offer over 26.5). The chance at any line, from the same model: the bookmaker's price at
// the offered line fixes the mean it implies (with the player's own spread), that mean gives the
// price's chance at every other line, and the player's games then move it exactly as they do at the
// offered line (propChance). Lines are written the bookmakers' way: N+ is "over N-0.5".
export const overLine = (target) => target - 0.5;
export function impliedMean(market, dispersion, t) {
  let lo = 0.01, hi = Math.max(5, t * 6);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (countTail(mid, Math.max(dispersion * mid, mid * 0.5), t) < market) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
export function propLadder(market, sport, type, target, rows, { home = null, scale = 1, without = null, thresholds = null } = {}) {
  const vals = propValues(sport, type, rows)?.slice(0, 20);
  if (!vals?.length || !(market > 0 && market < 1)) return [];
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
  const d = mean > 0 ? Math.max(0.5, variance / mean) : 1;
  const m = impliedMean(market, d, target);
  const step = target >= 100 ? 10 : target >= 40 ? 5 : 1;
  const ts = thresholds || [...new Set(Array.from({ length: 7 }, (_, i) => target + (i - 3) * step).filter((t) => t >= 1))];
  return ts.map((t) => {
    const prior = t === target ? market : Math.min(0.97, Math.max(0.03, countTail(m, Math.max(d * m, m * 0.5), t)));
    const p = propChance(prior, sport, type, t, rows, { home, scale, without }).p;
    return { t, line: overLine(t), p, fair: +(1 / p).toFixed(2), offered: t === target };
  });
}

// ---------- teammates ----------
// Whether a teammate played in each of the player's games, from the teammate's own game log: a game
// is "without" him only if he was on the same team that season and has no entry for it (his log lists
// the games he played). Returns { with: rows, without: rows } (games we cannot place are left out).
export function splitByTeammate(rows, mate) {
  const played = new Set(), onTeam = new Set();
  for (const r of mate || []) {
    if (r._ev) played.add(r._ev);
    if (r._team) onTeam.add(`${r._team}|${r._season !== false}`);
  }
  const out = { with: [], without: [] };
  for (const r of rows || []) {
    if (!r._ev) continue;
    if (played.has(r._ev)) out.with.push(r);
    else if (r._team && onTeam.has(`${r._team}|${r._season !== false}`)) out.without.push(r);
  }
  return out;
}

// How a teammate's absence tonight moves this prop (`fresh`: he played at least 3 of the player's
// last 5 games, so his absence is news the recent form does not already hold): the player's average without him against his
// average with him, shrunk toward no change (6 games' worth of "no change"), and his hit rate in
// those games. null when there are fewer than 2 games without him.
export function withoutTeammate(sport, type, target, rows, mate) {
  const { with: w, without: wo } = splitByTeammate(rows, mate);
  const vw = propValues(sport, type, w), vo = propValues(sport, type, wo);
  if (!vo || vo.length < 2 || !vw || !vw.length) return null;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mw = mean(vw), mo = mean(vo);
  if (!(mw > 0)) return null;
  const k = vo.length / (vo.length + 6);
  const scale = 1 + (mo / mw - 1) * k;
  // How many of his last 5 games the teammate played: if he has already missed most of them (out for
  // weeks, or all of this young season), the player's recent form reflects his absence and applying
  // it again would count it twice.
  const withSet = new Set(w);
  const recentWith = (rows || []).slice(0, 5).filter((r) => withSet.has(r)).length;
  return { scale: +Math.min(1.35, Math.max(0.75, scale)).toFixed(3), without: [vo.filter((v) => v >= target).length, vo.length], with: [vw.filter((v) => v >= target).length, vw.length], avgWith: +mw.toFixed(1), avgWithout: +mo.toFixed(1), recentWith, fresh: recentWith >= 3 };
}
