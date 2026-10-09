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

const idOf = (ref) => /\/athletes\/(\d+)/.exec(ref || '')?.[1] || null;
export const propLabel = (pr) => (pr.yes ? `${pr.player} to score${pr.label === 'touchdown' ? ' a TD' : ''}` : `${pr.player} ${pr.target}+ ${pr.label}`);
export const propMarket = (pr) => `Player ${pr.label}`;

// Raw propBets items → props for one match. `who(id)` gives { name, side } for an athlete id.
export function parseProps(items, sport, who, { minOdds = 1.15, maxOdds = 3, perEvent = 40 } = {}) {
  const out = [], seen = new Set();
  for (const x of items || []) {
    const def = propDef(sport, x.type?.name);
    const id = idOf(x.athlete?.$ref);
    if (!def || !id) continue;
    const odds = Number(x.odds?.decimal?.value ?? x.current?.over?.decimal);
    const target = def.target ?? Number(x.current?.target?.value);
    if (!(odds >= minOdds && odds <= maxOdds) || !(target > 0)) continue;
    const p = who(id);
    if (!p?.name) continue;
    const key = `${id}|${def.label}|${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
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
        if (!a.stats?.length || a.didNotPlay) { dnp.add(id); continue; }
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

// 'won' | 'lost' | 'void' (confirmed did not play) | null (not known yet: retried, never guessed).
export function gradeProp(prop, sport, box) {
  const def = PROP_STATS[sport]?.[prop.type];
  if (!def || !box?.listed) return null;
  const id = String(prop.id);
  if (box.dnp.has(id)) return 'void';
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
const G = {
  basketball: { Points: ['points'], Rebounds: ['totalRebounds'], Assists: ['assists'], '3-Point Field Goals': ['threePointFieldGoalsMade-threePointFieldGoalsAttempted'],
    'Points + Assists + Rebounds': ['points', 'totalRebounds', 'assists'], 'Points + Assists': ['points', 'assists'], 'Points + Rebounds': ['points', 'totalRebounds'],
    'Rebounds + Assists': ['totalRebounds', 'assists'], Steals: ['steals'], Blocks: ['blocks'] },
  baseball: { Hits: ['hits'], Runs: ['runs'], RBIs: ['RBIs'], 'Home Runs': ['homeRuns'], 'Hits + Runs + RBIs': ['hits', 'runs', 'RBIs'], 'Runs + RBIs': ['runs', 'RBIs'], 'Walks (Batter)': ['walks'] },
  hockey: { Points: ['goals', 'assists'], Goals: ['goals'], Assists: ['assists'], 'Shots on Goal': ['shotsTotal'], 'Anytime Goalscorer': ['goals'] },
  football: { 'Passing Yards': ['passingYards'], 'Rushing Yards': ['rushingYards'], 'Receiving Yards': ['receivingYards'], Receptions: ['receptions'],
    'Rushing + Receiving Yards': ['rushingYards', 'receivingYards'], 'Passing Touchdown': ['passingTouchdowns'], 'Anytime Touchdown Scorer': ['rushingTouchdowns', 'receivingTouchdowns'] },
};
// The player's last `n` games (regular season and playoffs, newest first) as { name: value } rows.
export function gamelogRows(g, n = 10) {
  const names = g?.names || [];
  const rows = [];
  for (const st of g?.seasonTypes || []) {
    if (/preseason/i.test(st.displayName || '')) continue;
    for (const c of st.categories || []) {
      for (const ev of c.events || []) {
        const at = Date.parse(g.events?.[ev.eventId]?.gameDate || '') || null;
        const row = {};
        names.forEach((k, i) => { const v = parseFloat(String(ev.stats?.[i] ?? '').split(/[-/]/)[0]); if (Number.isFinite(v)) row[k] = v; });
        rows.push({ at, row });
      }
    }
  }
  if (rows.every((r) => r.at)) rows.sort((a, b) => b.at - a.at);
  return rows.slice(0, n).map((r) => r.row);
}
// How often the player reached this line in those games: { n, hits, avg } (null if the log can't say).
export function formFor(sport, type, target, rows) {
  const keys = G[sport]?.[type];
  if (!keys || !rows?.length || !rows.every((r) => keys.every((k) => Number.isFinite(r[k])))) return null;
  const vals = rows.map((r) => keys.reduce((s, k) => s + r[k], 0));
  return { n: vals.length, hits: vals.filter((v) => v >= target).length, avg: +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1) };
}
// The chance: the price's chance as a prior worth K games, updated by the player's own recent games.
// A player who cleared the line in 9 of his last 10 moves well above the price; 3 of 10 well below.
const K = 8;
export const blendForm = (market, form) => (form?.n ? +((form.hits + K * market) / (form.n + K)).toFixed(4) : market);
export const hasForm = (sport, type) => Boolean(G[sport]?.[type]);
