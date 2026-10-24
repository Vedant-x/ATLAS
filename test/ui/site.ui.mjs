// Browser tests: the real pages in Chromium against a fixed board (test/fixtures/site.mjs), with every
// outside feed blocked. Run with `npm run test:ui` (needs Playwright; CI installs it). Serves the
// built site when dist/pages exists, else the source. Screenshots land in test-results/ for review.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { siteData, trackData } from '../fixtures/site.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const PORT = 8187, BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = 'test-results';
const PHONE = { width: 390, height: 844 }, DESK = { width: 1440, height: 900 };

let server, browser;
before(async () => {
  await mkdir(SHOTS, { recursive: true });
  server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res) => server.stdout.once('data', res));
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
after(async () => { await browser?.close(); server?.kill(); });

// A page with the fixture board. `hold` keeps data/index.json waiting until released (loading state).
async function open(route, { viewport = DESK, adult = true, hold = false, feeds = [] } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' }); // feeds come only from the fixtures
  if (adult) await ctx.addInitScript(() => { try { localStorage.setItem('atlas-age-ok', '1'); } catch { /* ignore */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let release = () => {};
  const held = hold ? new Promise((r) => { release = r; }) : null;
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.route('**/data/index.json*', async (r) => { if (held) await held; r.fulfill({ json: siteData() }); });
  await page.route('**/data/track.json*', (r) => r.fulfill({ json: trackData() }));
  await page.route(/\/data\/(?!index|track)[^/]+\.json/, (r) => r.fulfill({ status: 404, body: '' }));
  for (const [url, json] of feeds) await page.route(url, (r) => r.fulfill({ json })); // outside feeds a test stands in for
  await page.goto(BASE + route, { waitUntil: 'commit' });
  return { page, ctx, errors, release };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const noOverflow = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1);

test('home: placeholders while loading, never "no picks"; no counters, sports grid or fixture list', async () => {
  const { page, ctx, errors, release } = await open('#/', { hold: true });
  await page.waitForSelector('.dash-short .skel-row');
  assert.equal(await page.locator('.dash-short .muted').count(), 0, 'no empty-state text while loading');
  await shot(page, 'home-loading');
  release();
  await page.waitForSelector('.dash-short .mini');
  assert.equal(await page.locator('.hero .stats, .grid.sports, .grid.xs, .dash-track').count(), 0, 'minimal: those live on their own pages');
  await shot(page, 'home-desktop');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('home: 30-day record strip and a reason behind each pick', async () => {
  const { page, ctx, errors } = await open('#/');
  await page.waitForSelector('.track-strip');
  const strip = await page.textContent('.track-strip');
  assert.match(strip, /Last 30 days/);
  assert.match(strip, /9–3/);
  assert.match(await page.getAttribute('.track-strip', 'aria-label'), /beat the close/);
  await page.waitForSelector('.dash-short .mini');
  // Minimal cards: the reason is in the card's tip (a tap on the card, or hover), not printed on it.
  const tips = await page.$$eval('.dash-short .mini', (rows) => rows.map((r) => r.dataset.tip).join('\n'));
  assert.match(tips, /Why: Arsenal unbeaten in 5/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('phone: minimal first screen (no hero counters, picks in view) and no page scrolls sideways', async () => {
  const { page, ctx, errors } = await open('#/', { viewport: PHONE });
  await page.waitForSelector('.dash-short .mini');
  assert.equal(await page.locator('.hero .stats').count(), 0, 'no hero counters');
  await shot(page, 'home-phone');
  for (const r of ['#/', '#/picks', '#/value', '#/x/2', '#/watchlist', '#/track']) {
    await page.goto(BASE + r); await page.waitForTimeout(600);
    assert.ok(await noOverflow(page), `${r} fits the phone width`);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('first visit: the age check shows at once, without the intro animation', async () => {
  const { page, ctx } = await open('#/', { adult: false });
  await page.waitForSelector('.age-gate');
  assert.equal(await page.locator('#preloader').count(), 0);
  await shot(page, 'age-gate');
  await ctx.close();
});

test('Picks: three lists (Best bets, Value bets, 2x and 3x slips), one menu entry lit across them', async () => {
  const { page, ctx, errors } = await open('#/picks');
  for (const [r, tab] of [['#/picks', 'Best bets'], ['#/value', 'Value bets'], ['#/x/3', 'Slips']]) {
    await page.goto(BASE + r); await page.waitForSelector('.builder-nav');
    assert.equal(await page.getAttribute('nav.top a[href="#/picks"]', 'class'), 'on', `${r}: Picks lit`);
    assert.equal(await page.textContent('.builder-nav [aria-current="page"]'), tab);
    assert.equal(await page.locator('.builder-nav a').count(), 3, 'three lists, no more');
    assert.equal(await page.locator('.research-tabs').count(), 0, 'one tab row only');
  }
  await shot(page, 'picks-slips');
  // The retired pages' old links land on the list that replaced them.
  for (const [from, to] of [['#/bankers', '#/picks'], ['#/every', '#/picks'], ['#/edge', '#/value'], ['#/mega', '#/x/2'], ['#/x/10', '#/x/2'], ['#/target', '#/x/2']]) {
    await page.goto(BASE + from);
    await page.waitForFunction((h) => location.hash === h, to);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('slip: bankroll gives a stake suggestion, and a share link opens the same legs', async () => {
  const { page, ctx, errors } = await open('#/picks');
  await page.waitForSelector('button.leg');
  const legs = page.locator('.minilist button.leg');
  await legs.nth(0).click(); await legs.nth(1).click();
  await page.click('.slip-btn');
  await page.fill('[data-slip-bankroll]', '1000');
  assert.match(await page.textContent('[data-stake-tip]'), /Suggested stake/);
  await shot(page, 'slip-bankroll');
  const url = await page.evaluate(async () => { const { encodeSlip } = await import('./js/share.js'); const { slip } = await import('./js/slip.js'); return `#/slip/${encodeSlip(slip.legs)}`; })
    .catch(() => null); // the bundled build has no separate modules: build the link through the button instead
  const link = url || await (async () => { await ctx.grantPermissions(['clipboard-read', 'clipboard-write']); await page.click('[data-slip-share]'); return new URL(await page.evaluate(() => navigator.clipboard.readText())).hash; })();
  await page.goto(BASE + link);
  await page.waitForSelector('.shared-slip');
  assert.equal(await page.locator('.shared-slip .slip-legs li').count(), 2);
  await shot(page, 'shared-slip');
  await page.goto(`${BASE}#/slip/not-a-slip`);
  await page.waitForSelector('.hero h1');
  assert.match(await page.textContent('#app'), /SLIP NOT FOUND/i);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('watchlist: alerts can be set for one match only', async () => {
  const { page, ctx, errors } = await open('#/match/fx-ars-lee');
  await page.waitForSelector('[data-watch]');
  await page.click('[data-watch]');
  await page.goto(`${BASE}#/watchlist`);
  await page.waitForSelector('.list .al-kinds');
  await page.click('.list [data-alert-kind="cards"]');
  await page.waitForSelector('.list [data-alert-kind="cards"][aria-pressed="false"]');
  assert.match(await page.textContent('.list .al-kinds'), /this match/);
  assert.equal(await page.getAttribute('.alerts-panel [data-alert-kind="cards"]', 'aria-pressed'), 'true', 'other matches keep cards');
  await shot(page, 'watchlist-alerts');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('watchlist: a finished match stays with its final score and opens what happened, until removed', async () => {
  const sm = {
    header: { competitions: [{ status: { type: { completed: true, detail: 'FT' } }, competitors: [{ homeAway: 'home', score: '2', team: { id: '1' } }, { homeAway: 'away', score: '1', team: { id: '2' } }] }] },
    keyEvents: [{ type: { text: 'Goal' }, clock: { displayValue: "23'" }, text: 'Goal! Chelsea 1, Everton 0. Cole Palmer', team: { displayName: 'Chelsea' } }],
    boxscore: { teams: [{ homeAway: 'home', statistics: [{ name: 'possessionPct', displayName: 'Possession', displayValue: '58' }] }, { homeAway: 'away', statistics: [{ name: 'possessionPct', displayName: 'Possession', displayValue: '42' }] }] },
  };
  const { page, ctx, errors } = await open('#/', { feeds: [[/summary\?event=999/, sm]] });
  await page.waitForSelector('.dash');
  await page.evaluate((start) => {
    localStorage.setItem('atlas-watch', JSON.stringify(['fx-old']));
    localStorage.setItem('atlas-watch-meta', JSON.stringify({ 'fx-old': { home: 'Chelsea', away: 'Everton', league: 'Premier League', sport: 'football', start, leaguePath: 'soccer/eng.1', compId: '999' } }));
  }, Date.now() - 5 * 36e5);
  await page.goto(`${BASE}#/watchlist`);
  await page.reload();
  await page.waitForSelector('.row.wl.done .fin-score');
  assert.match(await page.textContent('.row.wl.done'), /Chelsea 2–1 Everton/);
  await page.click('.row.wl.done .row-link');
  await page.waitForSelector('.fin-head ~ * .timeline li, .match-final ~ .panel .timeline li');
  assert.match(await page.textContent('.fin-head'), /Chelsea\s*2 – 1\s*Everton/);
  assert.match(await page.textContent('#app'), /Cole Palmer[\s\S]*Possession[\s\S]*58/);
  await shot(page, 'watchlist-final');
  await page.click('.match-final [data-watch]');
  await page.waitForFunction(() => location.hash === '#/watchlist');
  await page.waitForFunction(() => !document.querySelector('.row.wl.done'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('league table: GP, W, D, L, GD, Pts in rank order, whatever order the feed sends', async () => {
  // ESPN lists the stats as GP, L, GD, P, D, W, R plus a Total record (the order that used to show).
  const row = (team, [gp, l, gd, p, d, w, r]) => ({ team: { displayName: team }, stats: [['GP', gp], ['L', l], ['GD', gd], ['P', p], ['D', d], ['W', w], ['R', r]].map(([abbreviation, v]) => ({ abbreviation, displayValue: String(v) })).concat({ name: 'Total', summary: `${w}-${d}-${l}` }) });
  const feed = { children: [{ name: "Women's Super League", standings: { entries: [row('Chelsea', [5, 0, '+11', 13, 1, 4, 2]), row('Manchester City', [5, 0, '+10', 15, 0, 5, 1]), row('Arsenal', [6, 2, '-2', 6, 3, 1, 3])] } }] };
  const { page, ctx, errors } = await open('#/league/soccer~eng.w.1', { feeds: [['**/apis/v2/sports/soccer/eng.w.1/standings*', feed]], viewport: PHONE });
  await page.waitForSelector('.tbl.standings');
  await page.waitForTimeout(1000); // past the redraw once the league's fixtures load: the table must stay
  assert.deepEqual(await page.$$eval('.tbl.standings th', (ths) => ths.map((t) => t.textContent.trim())), ['#', 'Team', 'GP', 'W', 'D', 'L', 'GD', 'Pts']);
  assert.deepEqual(await page.$$eval('.tbl.standings tbody tr', (trs) => trs.map((t) => [...t.cells].map((c) => c.textContent.trim()).join(' '))),
    ['1 Manchester City 5 5 0 0 +10 15', '2 Chelsea 5 4 1 0 +11 13', '3 Arsenal 6 1 3 2 -2 6']);
  // Every column visible on a phone: the table does not scroll sideways.
  assert.ok(await page.$eval('.tbl.standings', (t) => t.parentElement.scrollWidth <= t.parentElement.clientWidth + 1));
  await page.locator('#league-standings').scrollIntoViewIfNeeded();
  await shot(page, 'standings-phone');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Sources: every feed with its last result, failures first', async () => {
  const at = Date.now() - 5 * 6e4;
  const report = { at, sources: [
    { name: 'ESPN', site: 'espn.com', what: 'Fixtures', ok: true, count: 1700, note: '1700 events', at },
    { name: 'football-data.co.uk', site: 'football-data.co.uk', what: 'Pinnacle odds', ok: false, count: null, note: 'HTTP 503', at },
    { name: 'The Odds API', site: 'the-odds-api.com', what: 'Odds', ok: null, count: null, note: 'not switched on', at },
  ] };
  const { page, ctx, errors } = await open('#/sources', { feeds: [['**/data/sources.json*', report]] });
  await page.waitForSelector('.sources-tbl');
  const rows = await page.$$eval('.sources-tbl tbody tr', (trs) => trs.map((t) => t.querySelector('b').textContent + ' ' + t.querySelector('.src-state').textContent));
  assert.deepEqual(rows, ['football-data.co.uk Failed', 'ESPN Working', 'The Odds API Not set up']);
  assert.match(await page.textContent('#app'), /1 source failed on the last build/);
  await shot(page, 'sources');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('match page: the results history (ratings, rest, last meetings)', async () => {
  const { page, ctx, errors } = await open('#/match/fx-ars-lee');
  // Folded until tapped, like every detail section on the match page.
  await page.waitForSelector('#sec-atlas-history summary');
  assert.equal(await page.$eval('#sec-atlas-history', (d) => d.open), false);
  await page.click('#sec-atlas-history summary');
  await page.waitForSelector('.hist-nums');
  const txt = await page.textContent('.hist-nums');
  assert.match(txt, /1712/);
  assert.match(txt, /ATLAS rating · 34 results/);
  assert.match(await page.textContent('#app'), /Last meetings[\s\S]*Leeds[\s\S]*0 – 2/);
  await shot(page, 'match-history');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('time zone: one setting for every time; the parlay of the day follows it', async () => {
  const { page, ctx, errors } = await open('#/');
  await page.waitForSelector('.dash-potd');
  assert.match(await page.textContent('.dash-potd'), /12:00 to 12:00 IST/);
  // As a visitor does it, from the Display panel: the menu has focus while the choice is made.
  assert.equal(await page.locator('.bar [data-tz-select], .bar [data-fx-toggle]').count(), 0, 'the header is search, Display and the slip');
  await page.click('.bar [data-display-toggle]');
  await page.focus('#display-panel [data-tz-select]');
  await page.selectOption('#display-panel [data-tz-select]', 'GMT');
  await page.waitForFunction(() => /12:00 to 12:00 GMT/.test(document.querySelector('.dash-potd')?.textContent || ''));
  // A zone with no recorded day follows the IST day, shown in the visitor's own time too.
  await page.selectOption('#display-panel [data-tz-select]', 'ET');
  await page.waitForFunction(() => /12:00 to 12:00 IST · .*your time/.test(document.querySelector('.dash-potd')?.textContent || ''));
  assert.match(await page.textContent('.dash-short'), /\d\d:\d\d (EDT|EST)/, 'kick-off times in US Eastern time');
  await page.reload();
  await page.waitForSelector('.dash-potd');
  await page.click('.bar [data-display-toggle]');
  assert.equal(await page.$eval('#display-panel [data-tz-select]', (s) => s.value), 'ET', 'kept after a reload');
  await shot(page, 'home-potd');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('assistant and dashboard agree: the same picks at the same chance', async () => {
  const { page, ctx, errors } = await open('#/');
  await page.waitForSelector('.dash-short .mini');
  const board = await page.$$eval('.dash-short .mini', (rows) => rows.map((r) => [r.querySelector('.mini-main b').textContent.trim(), r.querySelector('.mini-nums b').textContent.trim()]));
  await page.click('.ai-launch');
  await page.fill('.ai-input', 'best bets');
  await page.press('.ai-input', 'Enter');
  await page.waitForSelector('.ai-msg.bot .ai-card.pick');
  const said = await page.$$eval('.ai-msg.bot:last-child .ai-card.pick', (cards) => cards.map((c) => c.querySelector('b').textContent.trim()));
  // The same recommendation (same id: selection, quote, model and calibration) on both surfaces.
  const recs = await page.$$eval('.ai-msg.bot:last-child .ai-card.pick[data-rec]', (cards) => cards.map((c) => c.dataset.rec));
  const boardRecs = await page.$$eval('.dash-short .mini[data-rec]', (rows) => rows.map((r) => r.dataset.rec));
  assert.ok(recs.length > 0 && recs.every((r) => boardRecs.includes(r)), JSON.stringify({ recs, boardRecs }));
  assert.ok(said.length > 0);
  // Every pick the assistant gives is on the dashboard's Best bets list.
  const names = board.map(([n]) => n);
  assert.ok(said.every((n) => names.includes(n)), JSON.stringify({ said, names }));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('navigation: five destinations, Research lit across its pages, Live and Props one tap away', async () => {
  for (const viewport of [DESK, PHONE]) {
    const { page, ctx, errors } = await open('#/props', { viewport });
    await page.waitForSelector('.research-tabs');
    const shown = await page.$$eval('nav.top a', (as) => as.filter((a) => getComputedStyle(a).display !== 'none').map((a) => a.dataset.m));
    assert.deepEqual(shown, ['Today', 'Research', 'Picks', 'Watchlist', 'Results', ...(viewport === PHONE ? ['More'] : [])]);
    assert.equal(await page.getAttribute('nav.top a[href="#/sports"]', 'class'), 'on');
    assert.deepEqual(await page.$$eval('.research-tabs a', (as) => as.map((a) => a.textContent)), ['Sports', 'Live', 'Props', 'Compare', 'Picks']);
    await shot(page, `nav-${viewport === PHONE ? 'phone' : 'desk'}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('home: panels can be hidden and reordered, and the layout is kept', async () => {
  const { page, ctx, errors } = await open('#/');
  await page.waitForSelector('.dash-potd');
  const order = () => page.$$eval('.dash > .panel:not(.dash-layout)', (ps) => ps.map((p) => p.className.match(/dash-(potd|short|live|health)|changes|track/)?.[0]).filter(Boolean));
  await page.click('.dash-layout summary');
  await page.click('[data-lay="toggle"][data-lay-key="potd"]');
  await page.waitForFunction(() => !document.querySelector('.dash-potd'));
  assert.ok(await page.$('.dash-layout[open]'), 'still open after a change');
  for (let i = 0; i < 2; i++) await page.click('[data-lay="up"][data-lay-key="live"]'); // above Value bets, then Best bets
  await page.waitForFunction(() => { const ps = [...document.querySelectorAll('.dash > .panel')]; return ps.findIndex((p) => p.classList.contains('dash-live')) < ps.findIndex((p) => p.classList.contains('dash-short')); });
  await page.reload();
  await page.waitForSelector('.dash-live');
  assert.equal(await page.$('.dash-potd'), null, 'hidden after a reload');
  const o = await order();
  assert.ok(o.indexOf('dash-live') < o.indexOf('dash-short'), JSON.stringify(o));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('watchlist: quiet hours are kept, and alerts while closed are not offered when there is no server for them', async () => {
  const { page, ctx, errors } = await open('#/watchlist');
  await page.waitForSelector('.alerts-panel');
  assert.match(await page.textContent('.alerts-panel'), /Alerts come while ATLAS is open/);
  assert.equal(await page.locator('[data-push]').count(), 0);
  await page.click('[data-quiet="22-7"]');
  await page.waitForSelector('[data-quiet="22-7"][aria-pressed="true"]');
  await page.reload();
  await page.waitForSelector('[data-quiet="22-7"][aria-pressed="true"]');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('home: a panel can be made full width, and every panel takes a size', async () => {
  const { page, ctx, errors } = await open('#/');
  await page.waitForSelector('.dash-live');
  await page.click('.dash-layout summary');
  for (let i = 0; i < 3; i++) await page.click('[data-lay="size"][data-lay-key="live"]'); // auto → third → half → full
  await page.waitForSelector('.dash-live.lay-full');
  const [panel, dash] = await page.$$eval('.dash-live, .dash', (els) => els.map((x) => x.getBoundingClientRect().width).reverse());
  assert.ok(Math.abs(panel - dash) < 2, `${panel} vs ${dash}`);
  assert.match(await page.textContent('[data-lay="size"][data-lay-key="live"]'), /Full/);
  // Every panel's markup accepts a size (the class goes on its own element).
  for (const k of ['potd', 'shortlist', 'value', 'changes', 'record', 'health']) await page.click(`[data-lay="size"][data-lay-key="${k}"]`);
  const sized = await page.$$eval('.dash > .panel.lay-third', (ps) => ps.length);
  const shown = await page.$$eval('.dash > .panel:not(.dash-layout):not(.lay-full)', (ps) => ps.length);
  assert.equal(sized, shown);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('theme: a colour and a background of the visitor\'s own, kept after a reload', async () => {
  const { page, ctx, errors } = await open('#/');
  await page.waitForSelector('.dash-short');
  await page.click('[data-display-toggle]');
  await page.waitForSelector('#display-panel.open [data-theme-accent="cyan"]');
  await page.click('[data-theme-accent="cyan"]');
  await page.click('[data-theme-surface="navy"]');
  const vars = () => page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return [cs.getPropertyValue('--accent').trim().toLowerCase(), cs.getPropertyValue('--bg').trim().toLowerCase()]; });
  assert.deepEqual(await vars(), ['#00e5ff', '#03060f']);
  await shot(page, 'theme-panel');
  await page.reload();
  await page.waitForSelector('.dash-short');
  assert.deepEqual(await vars(), ['#00e5ff', '#03060f'], 'kept after a reload');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('value bets: prices above the sharp fair odds, with the edge and the lowest price worth taking; a drifting price is left out', async () => {
  const { page, ctx, errors } = await open('#/');
  await page.waitForSelector('.dash-value .mini');
  const rows = await page.$$eval('.dash-value .mini', (rs) => rs.map((r) => [r.querySelector('.mini-main b').textContent, r.querySelector('.mini-nums').textContent.replace(/\s+/g, ' ').trim(), r.dataset.tip]));
  assert.deepEqual(rows.map((r) => r[0]), ['Liverpool'], 'Man City drifted from 1.42 to 1.55: left out');
  assert.match(rows[0][1], /\+4\.4%\s*take 1\.76\+/);
  assert.match(rows[0][2], /Fair odds 1\.72 \(Pinnacle[\s\S]*Price 1\.80 at Unibet[\s\S]*First seen at 1\.78/);
  await page.locator('.dash-value').scrollIntoViewIfNeeded();
  await shot(page, 'value-bets');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('best bets: the minimum odds chosen in Filters apply to the list', async () => {
  const { page, ctx, errors } = await open('#/');
  await page.waitForSelector('.dash-short .mini');
  await page.click('.sl-filters > summary');
  await page.click('.sl-filters [data-pref="minOdds"][data-value="1.5"]');
  await page.waitForFunction(() => /odds 1\.50\+/.test(document.querySelector('.sl-filters > summary')?.textContent || ''));
  const odds = await page.$$eval('.dash-short .mini .leg, .dash-short .mini > button', (bs) => bs.map((b) => Number(b.textContent.trim())).filter(Number.isFinite));
  assert.ok(odds.every((o) => o >= 1.5), JSON.stringify(odds));
  assert.equal(await page.$('.dash-short .pill-status'), null, 'no status tags on cards');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// Readability checks run in the page: every visible text at 12 px or more, small text at 4.5:1 against
// what is really behind it (backgrounds blended down the tree), no hover-only title tips, and every
// control at least 44 px on a phone (links inside a sentence excepted, as WCAG allows).
const READABILITY = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const parse = (c) => { c = String(c); const srgb = /^color\(srgb/.test(c); const m = c.match(/[\d.]+/g); if (!m) return null; return [...m.slice(0, 3).map(Number).map((x) => (srgb ? x * 255 : x)), m[3] == null ? 1 : Number(m[3])]; };
  const over = (t, b) => [0, 1, 2].map((i) => t[i] * t[3] + b[i] * (1 - t[3])).concat(1);
  const bgOf = (el) => { const l = []; while (el) { const c = parse(getComputedStyle(el).backgroundColor); if (c && c[3] > 0) l.push(c); if (c && c[3] >= 1) break; el = el.parentElement; } let b = [4, 4, 6, 1]; for (const x of l.reverse()) b = over(x, b); return b; };
  const opac = (el) => { let o = 1; while (el) { o *= Number(getComputedStyle(el).opacity); el = el.parentElement; } return o; };
  const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const app = document.querySelector('#app');
  const texts = [...app.querySelectorAll('*')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1) && vis(el));
  const tiny = [], low = [];
  for (const el of texts) {
    const s = getComputedStyle(el), fs = parseFloat(s.fontSize), label = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${el.textContent.trim().slice(0, 20)}"`;
    if (fs < 12) tiny.push(`${label} ${fs}px`);
    const bg = bgOf(el), c = parse(s.color);
    if (!c) continue;
    const fg = over([...c.slice(0, 3), c[3] * opac(el)], bg);
    const L1 = lum(fg), L2 = lum(bg), cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (cr < (fs >= 18.66 || (fs >= 14 && Number(s.fontWeight) >= 700) ? 3 : 4.5)) low.push(`${label} ${cr.toFixed(1)}:1`);
  }
  const inSentence = (a) => a.tagName === 'A' && getComputedStyle(a).display === 'inline' && /^(P|LI|SMALL|SPAN|TD|DD)$/.test(a.parentElement.tagName) && a.parentElement.textContent.trim().length > a.textContent.trim().length + 8;
  const small = innerWidth < 600 ? 44 : 32;
  const targets = [...document.querySelectorAll('button, a[href], select, summary, [role=button]')].filter((b) => vis(b) && !inSentence(b) && !b.closest('[aria-hidden="true"]'))
    .filter((b) => { const r = b.getBoundingClientRect(); return r.width < small - 0.5 || r.height < small - 0.5; })
    .map((b) => `${b.tagName.toLowerCase()}.${String(b.className).split(' ')[0]} "${(b.textContent.trim() || b.getAttribute('aria-label') || '').slice(0, 16)}" ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`);
  const titles = [...app.querySelectorAll('[title]')].filter(vis).map((el) => el.getAttribute('title').slice(0, 30));
  return { tiny, low, targets, titles };
};

for (const viewport of [PHONE, DESK]) {
  test(`readable and reachable (${viewport === PHONE ? 'phone' : 'desktop'}): 12 px text, 4.5:1 contrast, no hover-only tips, ${viewport === PHONE ? 44 : 32} px controls`, async () => {
    for (const r of ['#/', '#/picks', '#/value', '#/x/2', '#/match/fx-ars-lee', '#/track', '#/sources', '#/watchlist', '#/sport/basketball']) {
      const { page, ctx } = await open(r, { viewport });
      await page.waitForSelector('#app .panel, #app .hero');
      await page.waitForTimeout(1200);
      const a = await page.evaluate(READABILITY);
      assert.deepEqual(a.tiny, [], `${r}: text under 12 px`);
      assert.deepEqual(a.low, [], `${r}: low contrast`);
      assert.deepEqual(a.titles, [], `${r}: hover-only title tips`);
      assert.deepEqual(a.targets, [], `${r}: controls too small`);
      await ctx.close();
    }
  });
}

test('phone: tapping a pick card shows its reasons; a tap elsewhere hides them; a tap on its odds adds it to the slip instead', async () => {
  const { page, ctx, errors } = await open('#/', { viewport: PHONE });
  await page.waitForSelector('.dash-short .mini');
  const card = page.locator('.dash-short .mini').first();
  await card.locator('.mini-ico').click();
  await page.waitForSelector('#tip:not([hidden])');
  assert.match(await page.textContent('#tip'), /Why:|Chance range/);
  await shot(page, 'tip-phone');
  await page.click('.dash-short .ph');
  await page.waitForSelector('#tip', { state: 'hidden' });
  await card.locator('button.leg').click();
  assert.equal(await page.isVisible('#tip'), false, 'the odds button adds to the slip, it does not open the tip');
  assert.match(await page.textContent('[data-slip-count]'), /1/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('first visit: the age check asks for a year of birth; under 18 is turned away and stays turned away', async () => {
  const { page, ctx } = await open('#/', { adult: false });
  await page.waitForSelector('.age-gate input[name="year"]');
  await page.fill('.age-gate input[name="year"]', String(new Date().getFullYear() - 15));
  await page.click('.age-gate button[type="submit"]');
  await page.waitForSelector('.age-gate:has-text("adults only")');
  await page.reload();
  await page.waitForSelector('.age-gate:has-text("adults only")');
  await ctx.close();
  const adult = await open('#/', { adult: false });
  await adult.page.waitForSelector('.age-gate input[name="year"]');
  await adult.page.fill('.age-gate input[name="year"]', '1994');
  await adult.page.click('.age-gate button[type="submit"]');
  await adult.page.waitForSelector('.age-err:not([hidden])'); // the box must be ticked too
  await adult.page.check('.age-gate input[name="confirm"]');
  await adult.page.click('.age-gate button[type="submit"]');
  await adult.page.waitForSelector('.age-gate', { state: 'detached' });
  await adult.ctx.close();
});
