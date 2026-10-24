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
