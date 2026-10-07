// Display settings, saved in this browser: how much motion, how dense the pages are and what the
// ticker does. Applied as attributes on <html> so CSS and the motion code both read them.
//   motion   reduced   no animation at all (default: light on slower computers; also forced by the
//                      system "reduce motion" setting)
//            standard  quick 150-250 ms transitions
//            cinematic the full-screen page wipes, letter reveals, custom cursor and card tilt
//   density  comfortable (default) · compact (tables, tighter rows) · focus (one column, no extras)
//   ticker   moving · paused · hidden
// v2: motion now defaults to reduced. Settings saved under v1 keep their density and ticker, but
// motion starts again from the new default (v1 saved it even when the visitor never chose it).
const KEY = 'atlas-display-v2';
export const DISPLAY_DEFAULTS = { motion: 'reduced', density: 'comfortable', ticker: 'moving' };
let cur = { ...DISPLAY_DEFAULTS };
try {
  const v1 = JSON.parse(localStorage.getItem('atlas-display-v1') || '{}');
  const v2 = localStorage.getItem(KEY);
  cur = { ...DISPLAY_DEFAULTS, ...(v2 ? JSON.parse(v2) : { density: v1.density, ticker: v1.ticker }) };
  for (const k of Object.keys(DISPLAY_DEFAULTS)) if (cur[k] == null) cur[k] = DISPLAY_DEFAULTS[k];
} catch { /* storage blocked: defaults */ }

// The 3D background switch (stored by main.js as atlas-fx).
const fx3d = () => { try { return localStorage.getItem('atlas-fx') === 'on'; } catch { return false; } };
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
  return `<div class="dp-row"><span>Motion</span>${opt('motion', 'reduced', 'Off')}${opt('motion', 'standard', 'Standard')}${opt('motion', 'cinematic', 'Cinematic')}</div>
    <div class="dp-row"><span>Density</span>${opt('density', 'comfortable', 'Comfortable')}${opt('density', 'compact', 'Compact')}${opt('density', 'focus', 'Focus')}</div>
    <div class="dp-row"><span>3D scene</span><button class="chip ${fx3d() ? 'on' : ''}" data-fx-toggle aria-pressed="${fx3d()}">${fx3d() ? 'On' : 'Off'} · tap to switch</button></div>
    <div class="dp-row"><span>Ticker</span>${opt('ticker', 'moving', 'Moving')}${opt('ticker', 'paused', 'Paused')}${opt('ticker', 'hidden', 'Hidden')}</div>
    <p class="cap">${systemReduced() ? 'Your device asks for reduced motion, so animation stays off. ' : ''}Motion and the 3D scene start off so the site stays fast on every computer. Cinematic adds the full-screen page wipes, custom cursor and card tilt (applies after a reload). The 3D scene switch reloads the page.</p>`;
}
