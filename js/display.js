// Display settings, saved in this browser: how much motion, how dense the pages are and what the
// ticker does. Applied as attributes on <html> so CSS and the motion code both read them.
//   motion   standard  quick 150-250 ms transitions (default)
//            cinematic the full-screen page wipes, letter reveals, custom cursor and card tilt
//            reduced   no animation at all (also forced by the system "reduce motion" setting)
//   density  comfortable (default) · compact (tables, tighter rows) · focus (one column, no extras)
//   ticker   moving · paused · hidden
const KEY = 'atlas-display-v1';
export const DISPLAY_DEFAULTS = { motion: 'standard', density: 'comfortable', ticker: 'moving' };
let cur = { ...DISPLAY_DEFAULTS };
try { cur = { ...DISPLAY_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* storage blocked: defaults */ }

const systemReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const motion = () => (systemReduced() ? 'reduced' : cur.motion);
export const display = {
  get: () => cur,
  set(patch) {
    cur = { ...cur, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* ignore */ }
    applyDisplay();
  },
};
export function applyDisplay() {
  const r = document.documentElement;
  r.dataset.motion = motion();
  r.dataset.density = cur.density;
  r.dataset.ticker = cur.ticker;
}
applyDisplay();

export function displayPanel() {
  const opt = (k, v, label) => `<button class="chip ${cur[k] === v ? 'on' : ''}" data-display="${k}" data-value="${v}" aria-pressed="${cur[k] === v}">${label}</button>`;
  return `<div class="dp-row"><span>Motion</span>${opt('motion', 'standard', 'Standard')}${opt('motion', 'cinematic', 'Cinematic')}${opt('motion', 'reduced', 'Reduced')}</div>
    <div class="dp-row"><span>Density</span>${opt('density', 'comfortable', 'Comfortable')}${opt('density', 'compact', 'Compact')}${opt('density', 'focus', 'Focus')}</div>
    <div class="dp-row"><span>Ticker</span>${opt('ticker', 'moving', 'Moving')}${opt('ticker', 'paused', 'Paused')}${opt('ticker', 'hidden', 'Hidden')}</div>
    <p class="cap">${systemReduced() ? 'Your device asks for reduced motion, so animation stays off. ' : ''}Cinematic adds the full-screen page wipes, custom cursor and card tilt (applies after a reload). The 3D background has its own switch in the header.</p>`;
}
