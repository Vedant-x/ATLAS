// Price movement: each outcome remembers the first price ATLAS saw for it (`open`), carried from one
// build to the next, so a pick can be judged by where its price has gone since. In the settled record,
// picks whose price later drifted (the market moving against them) lost about 19% of their stakes;
// picks whose price shortened made money. A price that is drifting already is a warning.

// A price longer than its first one by this share or more is drifting.
export const DRIFT = 0.03;

// Carry `open` from the previous snapshot onto this one's outcomes: same match, same market name
// (a total or spread's name holds its line, so a moved line starts afresh), same outcome, and the
// same price source (a switch from one bookmaker to the best of many is not a price move).
// Returns how many outcomes kept an earlier first price.
export function carryOpen(events, prevEvents = []) {
  const prev = new Map(prevEvents.map((e) => [e.id, e]));
  let kept = 0;
  for (const e of events) {
    const p = prev.get(e.id);
    const same = p && (p.oddsSource || null) === (e.oddsSource || null);
    for (const m of e.markets || []) {
      const pm = same ? p.markets?.find((x) => x.name === m.name) : null;
      for (const o of m.outcomes || []) {
        const po = pm?.outcomes?.find((x) => x.name === o.name);
        const first = po?.open ?? po?.odds;
        if (first > 1) { o.open = first; kept++; } else if (o.odds > 1) o.open = o.odds;
      }
    }
  }
  return kept;
}

// How far a price has moved since it was first seen: +0.05 is 5% longer (drifting), -0.05 shorter.
export const moveOf = (odds, open) => (open > 1 && odds > 1 ? odds / open - 1 : 0);
export const drifting = (odds, open) => moveOf(odds, open) >= DRIFT;
