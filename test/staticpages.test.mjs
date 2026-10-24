import test from 'node:test';
import assert from 'node:assert/strict';
import { leaguePage, sportPage, sitemap, fixtureLine, SITE } from '../js/staticpages.js';

const H = 36e5;
const ev = (id, start, extra = {}) => ({ id, sport: 'football', league: 'Premier League', leaguePath: 'soccer/eng.1', home: 'Arsenal', away: 'Chelsea', start, live: false, final: false,
  markets: [{ name: 'Match Result', outcomes: [{ name: 'Arsenal', odds: 2.0 }, { name: 'Draw', odds: 3.4 }, { name: 'Chelsea', odds: 3.8 }] }], bookmaker: 'DraftKings (ESPN)', ...extra });

test('search pages: a league\'s fixtures this week with India times, the market\'s chances and prices, links into the app', () => {
  const now = Date.UTC(2026, 9, 24, 12);
  const events = [
    ev('m2', now + 30 * H), ev('m1', now + 5 * H, { venue: { name: 'Emirates Stadium' } }),
    ev('old', now - 5 * H, { final: true }), ev('far', now + 9 * 24 * H), ev('other', now + 5 * H, { leaguePath: 'soccer/esp.1' }),
    ev('x<y', now + 6 * H, { home: '<script>alert(1)</script>', markets: [] }),
  ];
  const pg = leaguePage({ path: 'soccer/eng.1', name: 'Premier League', sport: 'football', sportName: 'Football' }, events, { now });
  assert.equal(pg.path, 'leagues/soccer~eng.1/');
  assert.equal(pg.count, 3, 'this week, not finished, this league only');
  assert.ok(pg.html.indexOf('#/match/m1') < pg.html.indexOf('#/match/m2'), 'soonest first');
  assert.match(pg.html, /<title>Premier League fixtures, odds and win chances · ATLAS<\/title>/);
  assert.match(pg.html, /<link rel="canonical" href="https:\/\/vedant-x\.github\.io\/ATLAS\/leagues\/soccer~eng\.1\/">/);
  assert.match(pg.html, /Sat, 24 Oct, 10:30\s?pm IST/i, 'India time');
  assert.match(pg.html, /Arsenal 4\d% · Draw 2\d% · Chelsea 2\d%/, 'the market\'s chances, its cut taken out');
  assert.match(pg.html, /Prices 2\.00 \/ 3\.40 \/ 3\.80 \(DraftKings\)/);
  assert.match(pg.html, /href="\.\.\/\.\.\/#\/match\/x%3Cy"/, 'ids encoded');
  assert.ok(!pg.html.includes('<script>alert'), 'names escaped');
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(pg.html)[1]);
  assert.equal(ld['@graph'].length, 3);
  assert.deepEqual([ld['@graph'][0]['@type'], ld['@graph'][0].location.name, ld['@graph'][0].competitor[0].name], ['SportsEvent', 'Emirates Stadium', 'Arsenal']);
  assert.ok(!/<\//.test(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(pg.html)[1]), 'a name with "</script>" in it cannot close the data\'s script tag');
  assert.ok(ld['@graph'].some((x) => x.competitor[0].name === '<script>alert(1)</script>'), 'and still reads back as written');
  assert.match(fixtureLine(ev('c', now, { markets: [{ name: 'Match Result', outcomes: [{ name: 'Arsenal', odds: 2.0, cons: 0.5 }, { name: 'Draw', odds: 3.4, cons: 0.28 }, { name: 'Chelsea', odds: 3.8, cons: 0.22 }] }] })).chances, /^Arsenal 50% · Draw 28% · Chelsea 22%$/, 'the sharp fair chance where held');
  assert.deepEqual(fixtureLine(ev('d', now, { markets: [] })).chances, null);
});

test('search pages: a sport lists its leagues, busiest first; the sitemap lists every page', () => {
  const pg = sportPage({ id: 'football', name: 'Football' }, [{ path: 'soccer/esp.1', name: 'LaLiga', count: 4 }, { path: 'soccer/eng.1', name: 'Premier League', count: 9 }, { path: 'soccer/x', name: 'Empty', count: 0 }]);
  assert.equal(pg.path, 'sports/football/');
  assert.ok(pg.html.indexOf('Premier League') < pg.html.indexOf('LaLiga'));
  assert.ok(!pg.html.includes('Empty'));
  assert.match(pg.html, /href="\.\.\/\.\.\/leagues\/soccer~eng\.1\/"/);
  const sm = sitemap(['leagues/soccer~eng.1/', 'sports/football/'], { at: Date.UTC(2026, 9, 24) });
  assert.equal((sm.match(/<loc>/g) || []).length, 3, 'the home page too');
  assert.ok(sm.includes(`<loc>${SITE}leagues/soccer~eng.1/</loc><lastmod>2026-10-24</lastmod>`));
});
