/* global document, location, innerWidth, window */
// Site check in a real browser: every main page of a running ATLAS (the live site, or the build just
// made, served with its own real data) opened in Chromium on a phone and a desktop screen, with the
// page's errors, failed requests and what each page shows. The browser tests use a fixed board; this
// one uses whatever the feeds hold right now, which is where a page can break that the board never
// shows. Exit code 1 when a page throws or renders nothing.
//   node scripts/site-check.mjs https://vedant-x.github.io/ATLAS/        (the live site)
//   node scripts/site-check.mjs http://127.0.0.1:8190/ --serve           (this build, dist/pages)
import { spawn } from 'node:child_process';

const base = process.argv[2] || 'https://vedant-x.github.io/ATLAS/';
const serve = process.argv.includes('--serve');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROUTES = ['#/', '#/picks', '#/value', '#/x/2', '#/live', '#/sports', '#/watchlist', '#/track', '#/sources', '#/sport/football', '#/sport/basketball', '#/props', '#/compare'];
const SCREENS = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };

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
  for (const route of ROUTES) {
    errors.length = 0; failed.length = 0;
    const t = Date.now(), loadsBefore = loads, espnBefore = espn;
    await page.evaluate(() => { window.__long = 0; }).catch(() => {});
    await page.evaluate((r) => { location.hash = r.slice(1); }, route).catch((e) => errors.push(`nav: ${e.message}`));
    // Long enough for the data, the first live refresh (30 s cycle starts at once) and a re-render.
    await page.waitForTimeout(route === '#/' ? 15000 : 6000);
    const s = await page.evaluate(() => {
      const main = document.getElementById('app');
      const txt = (main?.innerText || '').replace(/\s+/g, ' ').trim();
      return { long: Math.round(window.__long || 0), len: txt.length, head: txt.slice(0, 420), skel: document.querySelectorAll('.skel-row').length, minis: document.querySelectorAll('.mini').length, panels: document.querySelectorAll('.panel').length,
        overflow: document.scrollingElement.scrollWidth > innerWidth + 1 };
    }).catch((e) => ({ err: e.message }));
    const broken = errors.some((x) => !x.startsWith('console:')) || !(s.len > 80) || s.err;
    if (broken) bad++;
    console.log(`${broken ? 'BROKEN' : 'ok    '} ${screen} ${route} (${Math.round((Date.now() - t) / 1000)}s${route === '#/' ? `, first load ${Math.round((Date.now() - t0) / 1000)}s` : ''}): ${s.err || `${s.len} chars, ${s.panels} panels, ${s.minis} picks, ${s.skel} placeholders, main thread blocked ${s.long} ms, ${espn - espnBefore} ESPN requests${loads > loadsBefore ? `, RELOADED ${loads - loadsBefore}x` : ''}${s.overflow ? ', SCROLLS SIDEWAYS' : ''}`}`);
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
