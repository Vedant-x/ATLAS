// Shape of ESPN's tennis scoreboard (trimmed from a real response): one combined event with four draws.
const ath = (id, n, c, seed) => ({ id, homeAway: id.endsWith('1') ? 'home' : 'away', type: 'athlete', ...(seed ? { curatedRank: { current: seed } } : {}), athlete: { displayName: n, flag: { alt: c } } });
const pair = (id, a, b, c) => ({ id, homeAway: id.endsWith('1') ? 'home' : 'away', type: 'team', roster: { displayName: `${a} / ${b}`, athletes: [{ displayName: a, flag: { alt: c } }, { displayName: b, flag: { alt: c } }] } });
const comp = (id, slug, text, round, rid, court, sets, cs) => ({ id, date: '2026-10-03T07:00Z', status: { type: { state: 'pre', shortDetail: '10/3' } }, venue: { fullName: 'Beijing, China PR', court }, format: { regulation: { periods: sets } }, type: { slug, text }, round: { id: String(rid), displayName: round }, competitors: cs });
export const tennisBoard = { events: [{
  id: '959-2026', name: 'China Open', date: '2026-09-27T04:00Z', endDate: '2026-10-12T03:59Z', major: false, venue: { displayName: 'Beijing, China PR' },
  groupings: [
    { grouping: { slug: 'mens-singles', displayName: "Men's Singles" }, competitions: [comp('m1', 'mens-singles', "Men's Singles", 'Round 2', 2, 'Diamond', 3, [ath('a1', 'Jannik Sinner', 'Italy', 1), ath('a2', 'Quentin Halys', 'France')])] },
    { grouping: { slug: 'womens-singles', displayName: "Women's Singles" }, competitions: [comp('w1', 'womens-singles', "Women's Singles", 'Round 2', 2, 'Lotus', 3, [ath('b1', 'Coco Gauff', 'USA', 3), ath('b2', 'Camila Osorio', 'Colombia')])] },
    { grouping: { slug: 'mens-doubles', displayName: "Men's Doubles" }, competitions: [comp('d1', 'mens-doubles', "Men's Doubles", 'Quarterfinal', 5, 'Court 5', 3, [pair('p1', 'Zhang Zhizhen', 'Zhou Yi', 'China'), pair('p2', 'Joe Salisbury', 'Neal Skupski', 'Great Britain')])] },
    { grouping: { slug: 'womens-doubles', displayName: "Women's Doubles" }, competitions: [comp('x1', 'womens-doubles', "Women's Doubles", 'Round 1', 1, '', 3, [
      { id: 't1', homeAway: 'home', athlete: { displayName: 'TBD' } }, { id: 't2', homeAway: 'away', athlete: { displayName: 'TBD' } }])] },
  ],
}] };
