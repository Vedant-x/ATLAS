// Odds archive (model recovery, step 3): every build's prices for matches not yet started, kept so a
// model change can be backtested on the prices that were really on offer instead of waiting weeks of
// live picks. One row per market, written only when its prices changed since the last row kept, so a
// day's file holds each move once. Per outcome: the price shown (best available, or the one book's)
// with its bookmaker, the market reference's fair chance, Pinnacle's own price and Stake's price,
// where the build had them; and per row the times each was read, so a backtest can apply the same
// freshness rules as the live picks.
//   row: { at, id, sport, league, home, away, start, src, ref, sharpAt, stakeAt, priceAt, market,
//          o: [[name, odds, book, fair, pinnacle, stake], ...] }

const num = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const useful = (m) => m.outcomes?.length >= 2 && m.outcomes.every((o) => o.odds > 1) && m.outcomes.some((o) => Number.isFinite(o.cons) || o.pin > 1 || o.stake > 1);

// events: the build's events; last: { "id|market": signature } from the previous build (updated in
// place: entries for started matches are dropped); at: the build time. Returns the rows to append.
export function archiveRows(events, last, at = Date.now()) {
  const rows = [];
  const seen = new Set();
  for (const e of events) {
    if (e.live || !(e.start > at)) continue;
    for (const m of e.markets || []) {
      if (!useful(m)) continue;
      const o = m.outcomes.map((x) => [x.name, num(x.odds), x.bestBook || x.book || null, num(x.cons), num(x.pin), num(x.stake)]);
      const key = `${e.id}|${m.name}`, sig = JSON.stringify(o);
      seen.add(key);
      if (last[key] === sig) continue;
      last[key] = sig;
      rows.push({ at, id: e.id, sport: e.sport, league: e.leaguePath, home: e.home, away: e.away, start: e.start, src: e.oddsSource || null,
        ref: m.consensusFrom || null, sharpAt: e.sharpAt ?? null, stakeAt: e.stakeAt ?? null, priceAt: e.priceAt ?? e.fetchedAt ?? null, market: m.name, o });
    }
  }
  for (const k of Object.keys(last)) if (!seen.has(k)) delete last[k];
  return rows;
}
