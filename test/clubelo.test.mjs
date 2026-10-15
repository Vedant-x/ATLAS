import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClubElo, eloIndex, eloWin, normClub } from '../js/clubelo.js';
import { analyse } from '../js/models.js';

const CSV = `Rank,Club,Country,Level,Elo,From,To
1,Man City,ENG,1,2040.5,2026-10-10,2026-10-17
2,Real Madrid,ESP,1,2010.1,2026-10-10,2026-10-17
3,Bayern,GER,1,1990,2026-10-10,2026-10-17
None,Madrid,ESP,2,1500,2026-10-10,2026-10-17
None,Dortmund,GER,1,1850,2026-10-10,2026-10-17
None,Getafe,ESP,1,1650,2026-10-10,2026-10-17
None,Man United,ENG,1,1800,2026-10-10,2026-10-17
None,Crewe,ENG,4,1300,2026-10-10,2026-10-17`;

test('ClubElo names match ESPN names: exact, alias, or the words of the name, within the country', () => {
  const idx = eloIndex(parseClubElo(CSV));
  assert.equal(idx.find('Manchester City', 'soccer/eng.1').club, 'Man City');
  assert.equal(idx.find('Bayern Munich', 'soccer/ger.1').club, 'Bayern');
  assert.equal(idx.find('Borussia Dortmund', 'soccer/ger.1').club, 'Dortmund');
  assert.equal(idx.find('Real Madrid', 'soccer/esp.1').club, 'Real Madrid', 'the fuller name wins over "Madrid"');
  assert.equal(idx.find('Crewe Alexandra', 'soccer/eng.4').club, 'Crewe');
  assert.equal(idx.find('Getafe', 'soccer/eng.1'), null, 'wrong country: no match');
  assert.equal(idx.find('Getafe CF', 'soccer/uefa.europa').club, 'Getafe', 'UEFA: any country');
  assert.equal(normClub('Atlético Madrid'), 'atletico madrid');
});

test('ratings give a sensible 1X2 split and feed unpriced soccer matches', () => {
  const even = eloWin(1700, 1700, { neutral: true });
  assert.ok(Math.abs(even.home - even.away) < 1e-9 && even.draw > 0.25);
  const big = eloWin(2040, 1650);
  assert.ok(big.home > 0.7 && big.draw < 0.22, JSON.stringify(big));
  const a = analyse({ sport: 'football', home: 'Man City', away: 'Getafe', markets: [], stats: { homeElo: 2040, awayElo: 1650 } });
  assert.ok(a.win.home > 0.7);
  assert.match(a.basis, /ClubElo 2040 vs 1650/);
});
