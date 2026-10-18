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

test('home: placeholders while loading, never "0 events" or "no picks"', async () => {
  const { page, ctx, errors, release } = await open('#/', { hold: true });
  await page.waitForSelector('.stats .skel-num');
  assert.equal(await page.locator('.stats .skel-num').count(), 3);
  assert.equal(await page.locator('.dash-short .muted').count(), 0, 'no empty-state text while loading');
  await shot(page, 'home-loading');
  release();
  await page.waitForSelector('.stats b[data-count-to]');
  assert.equal(await page.getAttribute('.stats b[data-count-to]', 'data-count-to'), String(siteData().events.length));
  await page.waitForSelector('.dash-short .mini');
  await shot(page, 'home-desktop');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('home: 30-day record strip and a reason on picks', async () => {
  const { page, ctx, errors } = await open('#/');
  await page.waitForSelector('.track-strip');
  const strip = await page.textContent('.track-strip');
  assert.match(strip, /Last 30 days/);
  assert.match(strip, /9–3/);
  assert.match(strip, /beat the close/);
  await page.waitForSelector('.dash-short .mini');
  assert.match(await page.textContent('.dash-short'), /Arsenal unbeaten in 5/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('phone: the three hero numbers share a row and no page scrolls sideways', async () => {
  const { page, ctx, errors } = await open('#/', { viewport: PHONE });
  await page.waitForSelector('.stats b[data-count-to]');
  // The live board runs to four figures: measure with numbers that wide.
  await page.waitForTimeout(1500); // count-up finished
  await page.$$eval('.hero .stats b', (bs) => bs.forEach((b) => { b.textContent = '1,284'; }));
  const tops = await page.$$eval('.hero .stats > div', (ds) => ds.map((d) => Math.round(d.getBoundingClientRect().top)));
  assert.equal(tops.length, 3);
  assert.equal(new Set(tops).size, 1, `stats on one row: ${tops}`);
  await shot(page, 'home-phone');
  for (const r of ['#/', '#/bankers', '#/edge', '#/x/2', '#/watchlist', '#/track']) {
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

test('Picks: one menu entry lit across bankers, edge board and the builder', async () => {
  const { page, ctx, errors } = await open('#/edge');
  for (const [r, tab] of [['#/edge', 'Edge board'], ['#/bankers', 'Bankers'], ['#/x/3', 'Multipliers'], ['#/mega', 'Mega']]) {
    await page.goto(BASE + r); await page.waitForSelector('.builder-nav');
    assert.equal(await page.getAttribute('nav.top a[href="#/bankers"]', 'class'), 'on', `${r}: Picks lit`);
    assert.equal(await page.textContent('.builder-nav [aria-current="page"]'), tab);
    assert.equal(await page.locator('.research-tabs').count(), 0, 'one tab row only');
  }
  await shot(page, 'picks-mega');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('slip: bankroll gives a stake suggestion, and a share link opens the same legs', async () => {
  const { page, ctx, errors } = await open('#/bankers');
  await page.waitForSelector('button.leg');
  const legs = page.locator('.list button.leg');
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
