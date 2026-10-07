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
    out.push({ id, player: p.name, side: p.side || null, type: String(x.type.name).replace(/ Milestones$/, ''), label: def.label, target, yes: def.target != null, odds: +odds.toFixed(2), p: +Math.min(0.97, (1 / odds) * (1 - MARGIN)).toFixed(4) });
  }
  return out.sort((a, b) => b.p - a.p).slice(0, perEvent);
}

// Every player's stats from an ESPN summary, keyed by athlete id: { "<group>.<key>": number }, plus
// goals from the key events (soccer). `played` lists who took part, so a player who sat out voids.
export function boxStats(sm) {
  const stats = {}, played = new Set();
  for (const team of sm?.boxscore?.players || []) {
    for (const g of team.statistics || []) {
      const grp = /forwards|defenses|skaters/.test(g.name || '') ? 'skaters' : g.name || g.type || 'all';
      for (const a of g.athletes || []) {
        const id = String(a.athlete?.id || '');
        if (!id || !a.stats?.length || a.didNotPlay) continue;
        played.add(id);
        const s = (stats[id] ||= {});
        (g.keys || []).forEach((k, i) => { const v = parseFloat(String(a.stats[i] ?? '').split(/[-/]/)[0]); if (Number.isFinite(v)) s[`${grp}.${k}`] = v; });
      }
    }
  }
  for (const r of sm?.rosters || []) for (const a of r.roster || []) if (a.starter || a.subbedIn === true || a.subbedIn?.didSub) played.add(String(a.athlete?.id || ''));
  for (const k of sm?.keyEvents || []) {
    const t = k.type?.text || '';
    if (!(k.scoringPlay || /^goal|penalty - scored/i.test(t)) || /own goal/i.test(t)) continue;
    const id = String(k.participants?.[0]?.athlete?.id || '');
    if (!id) continue;
    played.add(id);
    const s = (stats[id] ||= {});
    s['events.goals'] = (s['events.goals'] || 0) + 1;
  }
  return { stats, played };
}

// 'won' | 'lost' | 'void' (didn't play) | null (can't tell).
export function gradeProp(prop, sport, box) {
  const def = PROP_STATS[sport]?.[prop.type];
  if (!def || !box) return null;
  if (!box.played.size) return null;
  if (!box.played.has(String(prop.id))) return 'void';
  const s = box.stats[String(prop.id)] || {};
  const v = def.keys.reduce((n, k) => n + (s[k] || 0), 0);
  return v >= prop.target ? 'won' : 'lost';
}
