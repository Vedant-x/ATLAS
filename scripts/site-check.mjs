/* global document, location, innerWidth, window */
// Site check in a real browser: every main page of a running ATLAS (the live site, or the build just
// made, served with its own real data) opened in Chromium on a phone and a desktop screen, with the
// page's errors, failed requests and what each page shows. The browser tests use a fixed board; this
// one uses whatever the feeds hold right now, which is where a page can break that the board never
// shows. A page fails the check when it throws; shows nothing or still shows placeholders; scrolls
// sideways; blocks the main thread past its budget; sends more than 40 ESPN requests; reloads itself;
// has duplicate element ids or in-page links with no target; or lacks its essential content (a list
// or an explicit no-pick answer, never a blank). Exit code 1 if any page fails.
//   node scripts/site-check.mjs https://vedant-x.github.io/ATLAS/        (the live site)
//   node scripts/site-check.mjs http://127.0.0.1:8190/ --serve           (this build, dist/pages)
import { spawn } from 'node:child_process';

const base = process.argv[2] || 'https://vedant-x.github.io/ATLAS/';
const serve = process.argv.includes('--serve');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
// '@match': the first match linked from the page before it (a real match page, with its section links).
const ROUTES = ['#/', '@match', '#/picks', '#/value', '#/x/2', '#/live', '#/sports', '#/watchlist', '#/track', '#/sources', '#/sport/football', '#/sport/basketball', '#/props', '#/compare'];
const SCREENS = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };
// Main-thread budget per page (long tasks, ms): the phone runs at a quarter of the machine's speed.
const BUDGET = { phone: 2000, desktop: 600, espn: 40 };
// What each page must show once loaded: a selector that must exist, and text that proves the content
// is real (a list, or the plain answer that there is none).
const ESSENTIAL = {
  '#/': ['.dash-short', /No qualifying bets|vs market|needs \d+%/], '#/picks': ['.minilist', /No qualifying bets|vs market|needs \d+%/],
  '#/value': ['.minilist', /No price beats|take \d/], '#/x/2': ['.hero', /2X SLIPS/i], '#/live': ['.hero', /in play|Nothing in play/i],
  '#/sports': ['.hero', /SPORTS/], '#/track': ['.hero', /RESULTS/], '#/sources': ['.hero', /SOURCES/], '#/sport/football': ['.hero', /matches/i],
  '#/sport/basketball': ['.hero', /matches/i], '@match': ['.subnav', /probability/i], '#/props': ['.hero', /PLAYER PROPS/], '#/compare': ['.hero', /COMPARE/], '#/watchlist': ['.hero', /WATCHLIST/],
};

let server = null;
if (serve) {
  server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: new URL(base).port }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => server.stdout.once('data', r));
}
const browser = await chromium.launch();
let bad = 0;
for (const [screen, viewport] of Object.entries(SCREENS)) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => { try { localStorage.setItem('atlas-age-ok', '1'); } catch { /* ignore */ } });
  const page = await ctx.newPage();
  // A phone's slower processor (4x slower than the test machine's), so slow renders show.
  if (screen === 'phone') { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
  let loads = 0;
  page.on('load', () => { loads++; });
  await page.addInitScript(() => {
    window.__long = 0;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long += e.duration; }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
  });
  const errors = [], failed = [];
  let espn = 0;
  page.on('request', (r) => { if (/espn\.com/.test(r.url())) espn++; });
  page.on('pageerror', (e) => errors.push(`${e.message} ${String(e.stack || '').split('\n').slice(1, 3).join(' ').trim()}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 140)}`));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(base)) failed.push(`HTTP ${r.status()} ${r.url().slice(0, 140)}`); });
  const t0 = Date.now();
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => errors.push(`load: ${e.message}`));
  for (const r of ROUTES) {
    errors.length = 0; failed.length = 0;
    const route = r === '@match' ? await page.evaluate(() => document.querySelector('a[href^="#/match/"]')?.getAttribute('href') || '#/').catch(() => '#/') : r;
    const key = r;
    const t = Date.now(), loadsBefore = loads, espnBefore = espn;
    await page.evaluate(() => { window.__long = 0; }).catch(() => {});
    await page.evaluate((r) => { location.hash = r.slice(1); }, route).catch((e) => errors.push(`nav: ${e.message}`));
    // Long enough for the data, the first live refresh (30 s cycle starts at once) and a re-render.
    await page.waitForTimeout(route === '#/' ? 15000 : 6000);
    const [sel] = ESSENTIAL[key] || [];
    const s = await page.evaluate((need) => {
      const main = document.getElementById('app');
      const txt = (main?.innerText || '').replace(/\s+/g, ' ').trim();
      const ids = [...document.querySelectorAll('[id]')].map((x) => x.id), dup = ids.filter((x, i) => ids.indexOf(x) !== i);
      const dead = [...document.querySelectorAll('a[href^="#sec-"], [data-jump]')].map((a) => a.dataset.jump || a.getAttribute('href').slice(1)).filter((id) => !document.getElementById(id));
      return { long: Math.round(window.__long || 0), len: txt.length, text: txt, head: txt.slice(0, 420), skel: document.querySelectorAll('.skel-row').length, minis: document.querySelectorAll('.mini').length, panels: document.querySelectorAll('.panel').length,
        overflow: document.scrollingElement.scrollWidth > innerWidth + 1, dup: [...new Set(dup)], dead: [...new Set(dead)], has: !need || Boolean(document.querySelector(need)) };
    }, sel).catch((e) => ({ err: e.message }));
    const [, proof] = ESSENTIAL[key] || [];
    const reqs = espn - espnBefore, reloaded = key !== ROUTES[0] && loads > loadsBefore;
    const why = [
      errors.some((x) => !x.startsWith('console:')) && 'page error', s.err && `unreadable: ${s.err}`, !(s.len > 80) && 'shows nothing',
      s.skel > 0 && 'placeholders never resolved', s.overflow && 'scrolls sideways', s.long > BUDGET[screen] && `main thread blocked ${s.long} ms (budget ${BUDGET[screen]})`,
      reqs > BUDGET.espn && `${reqs} ESPN requests (budget ${BUDGET.espn})`, reloaded && 'reloaded itself', s.dup?.length && `duplicate ids: ${s.dup.slice(0, 5).join(', ')}`,
      s.dead?.length && `in-page links without a target: ${s.dead.slice(0, 5).join(', ')}`, s.has === false && `missing ${sel}`, proof && s.text && !proof.test(s.text) && `no essential content (${proof})`,
    ].filter(Boolean);
    const broken = why.length > 0;
    if (broken) bad++;
    console.log(`${broken ? 'BROKEN' : 'ok    '} ${screen} ${route} (${Math.round((Date.now() - t) / 1000)}s${route === '#/' ? `, first load ${Math.round((Date.now() - t0) / 1000)}s` : ''}): ${s.err || `${s.len} chars, ${s.panels} panels, ${s.minis} picks, ${s.skel} placeholders, main thread blocked ${s.long} ms, ${espn - espnBefore} ESPN requests${loads > loadsBefore ? `, RELOADED ${loads - loadsBefore}x` : ''}${s.overflow ? ', SCROLLS SIDEWAYS' : ''}`}`);
    if (broken) console.log(`    fails: ${why.join(' · ')}`);
    console.log(`    shows: ${s.head || ''}`);
    for (const e of [...new Set(errors)].slice(0, 8)) console.log(`    error: ${e}`);
    for (const f of [...new Set(failed)].slice(0, 6)) console.log(`    failed: ${f}`);
  }
  await ctx.close();
}
await browser.close();
server?.kill();
console.log(bad ? `Site check: ${bad} page(s) broken` : 'Site check: every page renders without an error');
process.exit(bad ? 1 : 0);
