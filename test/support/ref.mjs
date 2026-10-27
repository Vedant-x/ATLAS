// A board as the build publishes it for the main leagues: each price with the market's fair chance
// (here exactly the price's own, so every leg is at its fair odds), read an hour ago, and the feed
// read a minute ago. Slips and the parlay of the day only use legs at or over the fair odds.
export const withRef = (e, now = Date.now()) => ({
  ...e, sharpAt: now - 36e5, fetchedAt: now - 6e4,
  markets: (e.markets || []).map((m) => ({ ...m, consensusFrom: 'Pinnacle', outcomes: m.outcomes.map((o) => ({ ...o, cons: 1 / o.odds })) })),
});
