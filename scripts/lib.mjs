// Shared by the build (scripts/pages.mjs) and its sources (scripts/sources/*.mjs): where the site is
// written, the fetch helper with browser headers and a timeout, small text helpers, the log, and the
// build's problem list and per-source report (published as data/health.json and data/sources.json).
export const out = 'dist/pages';
export const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };
export const get = async (u, opt = {}) => {
  const r = await fetch(u, { signal: AbortSignal.timeout(20000), ...opt, headers: { ...UA, ...opt.headers } });
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return r.text();
};
export const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// Japan/Korea calendar day (UTC+9): toISOString() of this shifted date reads as the local date.
export const day = (off) => new Date(Date.now() + 9 * 3600e3 + off * 864e5);
export const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
export const log = (...a) => console.log(...a);
// Data health: anything here opens an alert (GitHub issue, and email if configured) after the build.
export const problems = [];
// Every source's result this build, published as data/sources.json for the Sources page:
// { name, site, what, ok, count, note, at }. ok: true (worked), false (failed), null (not set up).
export const sources = [];
export const noteSource = (name, site, what, ok, count = null, note = '') => sources.push({ name, site, what, ok, count, note, at: Date.now() });

// Pitching lines: innings as outs ("6.2" = 20 outs), and walks plus hits per inning.
export const ipToOuts = (ip) => { const [w, f = '0'] = String(ip).split('.'); return Number(w) * 3 + Number(f); };
export const whip = (h, bb, ip) => { const outs = ipToOuts(ip); return outs ? (((Number(h) + Number(bb)) * 3) / outs).toFixed(2) : null; };

// ---------- state kept between builds ----------
// Some sources keep a small state file between builds (the odds credits spent and when each league
// was last read: data/odds-extra.json, data/stake.json). The build used to read it back only from the
// live site. When a publish did not land (14 Nov 2026: the site served one build's data for hours
// while later builds reported success), every build read the same old state, judged each league's
// line hours old and spent again: The Odds API's month ran out by 12 Nov. The state is now also kept
// on the track-record branch (STATE_DIR), and the newer of the two copies is used.
export const stateStamp = (x) => Math.max(0, Number(x?.fetchedAt) || 0, Number(x?.spentAt) || 0, typeof x?.at === 'number' ? x.at : 0);
export const newerState = (a, b) => (!a ? b || null : !b ? a : stateStamp(b) > stateStamp(a) ? b : a);
export async function readState(name, { timeout = 15000 } = {}) {
  let site = null, kept = null;
  try {
    const r = await fetch((process.env.SITE_DATA_URL || 'https://vedant-x.github.io/ATLAS/data/index.json').replace('index.json', name), { signal: AbortSignal.timeout(timeout) });
    if (r.ok) site = await r.json();
  } catch { /* first run, or the site is down */ }
  if (process.env.STATE_DIR) {
    try { const { readFile } = await import('node:fs/promises'); kept = JSON.parse(await readFile(`${process.env.STATE_DIR}/${name}`, 'utf8')); } catch { /* none kept yet */ }
  }
  const use = newerState(site, kept);
  if (site && kept) log(`State ${name}: ${use === kept ? 'the track-record copy' : 'the live site\'s copy'} is newer (${new Date(stateStamp(use)).toISOString()})`);
  return use;
}

// ---------- is the live site keeping up? ----------
// A build runs every ~9 minutes and publishes as it ends, so the live site's data should never be
// much more than 20 minutes old when the next build starts. On 14-15 Nov 2026 it sat on one build's
// data for 1-3 hours while every build reported success, and nothing said so. Past STUCK_MIN this
// is a problem for the data alert (an issue after it lasts 3 builds, closed when it recovers).
export const STUCK_MIN = 45;
export const siteAgeProblem = (fetchedAt, now = Date.now()) => {
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;
  const min = Math.round((now - fetchedAt) / 6e4);
  return min > STUCK_MIN ? `Live site behind: its data is ${min} minutes old (builds publish every ~10 minutes; check the Pages deployments)` : null;
};
