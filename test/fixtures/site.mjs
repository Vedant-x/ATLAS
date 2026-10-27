// A small, fixed board for the browser tests: the data/index.json and data/track.json the site reads,
// with every time relative to `now` so the shortlist (next 12 hours) and the 30-day record have content.
const H = 36e5, D = 864e5;
// winner: [name, price, the sharp market's fair chance (Pinnacle, margin off), Stake's price].
const ev = (id, sport, league, leaguePath, home, away, inHours, winner, extra = {}) => ({
  id, sport, league, leaguePath, home, away, start: 0, inHours, live: false,
  markets: [{ name: winner.length === 3 ? 'Match Result' : 'Winner', ...(winner[0]?.[2] ? { consensusFrom: 'Pinnacle' } : {}),
    outcomes: winner.map(([name, odds, cons, stake]) => ({ name, odds, ...(cons ? { cons } : {}), ...(stake ? { stake } : {}) })) }],
  stats: {}, ...extra,
});

export function siteData(now = Date.now()) {
  const list = [
    ev('fx-ars-lee', 'football', 'Premier League', 'soccer/eng.1', 'Arsenal', 'Leeds', 3, [['Arsenal', 1.36, 0.74, 1.37], ['Draw', 5.2, 0.17, 4.9], ['Leeds', 9.5, 0.09, 8.5]],
      { stats: { homeForm: ['W', 'D', 'W', 'W', 'W'], awayForm: ['L', 'L', 'D', 'W', 'L'], homeRecord: '7-2-1', awayRecord: '2-3-5' }, absences: { home: [], away: [{ name: 'A. Player' }, { name: 'B. Player' }] },
        atlas: { home: { r: 1712, n: 34 }, away: { r: 1488, n: 31 } }, h2hRecent: [{ t: Date.parse('2026-03-01'), h: 'Leeds', a: 'Arsenal', hs: 0, as: 2, w: 'away' }] }),
    ev('fx-rma-get', 'football', 'LaLiga', 'soccer/esp.1', 'Real Madrid', 'Getafe', 5, [['Real Madrid', 1.42, 0.71], ['Draw', 4.6, 0.19], ['Getafe', 8.0, 0.1]]),
    ev('fx-nyy-tb', 'baseball', 'MLB', 'baseball/mlb', 'Yankees', 'Rays', 6, [['Yankees', 1.55, 0.65], ['Rays', 2.5, 0.35]],
      { probables: [{ side: 'home', name: 'G. Cole', report: { season: { era: 2.9 } } }, { side: 'away', name: 'Z. Eflin', report: { season: { era: 4.4 } } }] }),
    ev('fx-bos-nyk', 'basketball', 'NBA', 'basketball/nba', 'Celtics', 'Knicks', 8, [['Celtics', 1.48, 0.68], ['Knicks', 2.7, 0.32]]),
    ev('fx-sin-dra', 'tennis', 'ATP', 'tennis/atp', 'Sinner', 'Draper', 4, [['Sinner', 1.32, 0.76], ['Draper', 3.4, 0.24]]),
    ev('fx-tor-mtl', 'hockey', 'NHL', 'hockey/nhl', 'Maple Leafs', 'Canadiens', 9, [['Maple Leafs', 1.62, 0.62], ['Canadiens', 2.3, 0.38]]),
    // No price in the feed: rated by the model from rankings / records (match page only).
    ev('fx-alc-ruu', 'tennis', 'ATP', 'tennis/atp', 'Alcaraz', 'Ruud', 7, [], { markets: [], tennis: { home: { rank: 2, points: 9000 }, away: { rank: 40, points: 1300 } } }),
    ev('fx-ind-ban', 'cricket', 'T20I', 'atlas/cricket-intl', 'India', 'Bangladesh', 10, [], { markets: [], stats: { homeRecord: '9-1', awayRecord: '3-7', homeForm: ['W', 'W', 'W', 'W', 'L'], awayForm: ['L', 'L', 'W', 'L', 'L'] } }),
    // Priced by many bookmakers (The Odds API): fair chances from Pinnacle, the best price on offer.
    // Liverpool's best price beats Pinnacle's fair odds (a value bet); Man City's did too, but it has
    // drifted from 1.42 since first seen and its quotes are 4 hours old, so it is left out.
    ev('fx-liv-che', 'football', 'Premier League', 'soccer/eng.1', 'Liverpool', 'Chelsea', 20, [], { markets: [{ name: 'Match Result', consensusFrom: 'Pinnacle', outcomes: [
      { name: 'Liverpool', odds: 1.8, book: 'Unibet', cons: 0.58, open: 1.78 }, { name: 'Draw', odds: 4.1, book: 'Betway', cons: 0.24 }, { name: 'Chelsea', odds: 5.4, book: 'Marathonbet', cons: 0.18 }] }],
      bookmaker: 'best of 14 bookmakers; fair chance from Pinnacle', oddsSource: 'the-odds-api', quoteType: 'best-available', priceAtAgo: H }),
    ev('fx-mci-bur', 'football', 'Premier League', 'soccer/eng.1', 'Man City', 'Burnley', 22, [], { markets: [{ name: 'Match Result', consensusFrom: 'Pinnacle', outcomes: [
      { name: 'Man City', odds: 1.55, book: 'Betway', cons: 0.7, open: 1.42 }, { name: 'Draw', odds: 4.6, book: 'Unibet', cons: 0.19 }, { name: 'Burnley', odds: 9.5, book: '1xBet', cons: 0.11 }] }],
      bookmaker: 'best of 12 bookmakers; fair chance from Pinnacle', oddsSource: 'the-odds-api', quoteType: 'best-available', priceAtAgo: 4 * H }),
    ev('fx-lal-gsw', 'basketball', 'NBA', 'basketball/nba', 'Lakers', 'Warriors', -1, [['Lakers', 1.7], ['Warriors', 2.15]], { live: true, score: '54-49', clock: 'Q3 4:12' }),
  ];
  // Every match has its feed's match id, as ESPN's do (picks are only offered where a result can be read).
  // The feed's prices carry the sharp market's fair chances (read an hour ago); Arsenal's Stake price
  // (1.37) clears its fair odds (1.35) by 1.4%: a Best bet at Stake, short of a value bet's 2%.
  const events = list.map(({ inHours, ...e }, i) => ({ compId: String(401000000 + i), ...e, start: now + inHours * H, fetchedAt: now - 2 * 6e4,
    ...(e.markets?.[0]?.consensusFrom && !e.oddsSource ? { sharpAt: now - H, sharpFrom: 'the-odds-api' } : {}), ...(e.priceAtAgo ? { priceAt: now - e.priceAtAgo, priceAtAgo: undefined } : {}), ...(e.id === 'fx-ars-lee' ? { stakeAt: now - H } : {}) }));
  return { events, fetchedAt: now - 2 * 6e4, leagueStatus: {} };
}

// 12 settled Best bets in the last 30 days: 9 won, 3 lost, each with a closing price.
export function trackData(now = Date.now()) {
  const picks = Array.from({ length: 12 }, (_, i) => ({
    key: `fx-${i}|Winner|Team ${i}`, type: 'best', sport: 'football', market: 'Winner', pick: `Team ${i}`, home: `Team ${i}`, away: `Rival ${i}`,
    odds: 1.45, p: 0.72, shown: 0.72, fair: 0.66, close: i % 3 ? 1.4 : 1.5, start: now - (i + 1) * 2 * D, recordedAt: now - (i + 1) * 2 * D - H,
    status: i % 4 === 3 ? 'lost' : 'won',
  }));
  return { picks, updatedAt: now - 30 * 6e4 };
}
