// The visitor's colour theme: an accent and a background, saved on this device. The accents are the
// neon family ATLAS already uses (lime, mint, cyan…); "Page colours" keeps each page's own accent.
// Backgrounds are all near-black so the neon reads; only the tint changes.

export const ACCENTS = {
  page: { label: 'Page colours', hex: null },
  lime: { label: 'Volt', hex: '#d2ff00' },
  mint: { label: 'Mint', hex: '#3dff9a' },
  cyan: { label: 'Cyan', hex: '#00e5ff' },
  ice: { label: 'Ice', hex: '#7cc7ff' },
  violet: { label: 'Violet', hex: '#b08cff' },
  pink: { label: 'Neon pink', hex: '#ff4fd8' },
  ember: { label: 'Ember', hex: '#ff9f43' },
  gold: { label: 'Gold', hex: '#ffd84d' },
};
export const SURFACES = {
  midnight: { label: 'Midnight', bg: '#040406', panel: '12, 12, 18' },
  oled: { label: 'True black', bg: '#000000', panel: '8, 8, 10' },
  navy: { label: 'Deep navy', bg: '#03060f', panel: '10, 14, 28' },
  plum: { label: 'Plum', bg: '#07040c', panel: '19, 12, 27' },
  forest: { label: 'Forest', bg: '#030805', panel: '10, 20, 15' },
};
const KEY = 'atlas-theme';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
let cur = { accent: 'page', surface: 'midnight', ...read() };
if (!ACCENTS[cur.accent]) cur.accent = 'page';
if (!SURFACES[cur.surface]) cur.surface = 'midnight';

export const theme = () => cur;
// The accent to use on a page: the visitor's own, or the page's when they keep page colours.
export const accentFor = (pageAccent) => ACCENTS[cur.accent].hex || pageAccent;

export function applyTheme() {
  const r = document.documentElement, s = SURFACES[cur.surface];
  r.style.setProperty('--bg', s.bg);
  r.style.setProperty('--panel-rgb', s.panel);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.bg);
  r.dataset.theme = `${cur.accent} ${cur.surface}`;
}
export function setTheme(patch) {
  cur = { ...cur, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* this visit only */ }
  applyTheme();
}
applyTheme();

// The Display panel rows: accent swatches and background chips.
export const themeRows = () => `<div class="dp-row"><span>Colour</span><div class="swatches">${Object.entries(ACCENTS).map(([k, a]) => `<button class="swatch ${cur.accent === k ? 'on' : ''}" data-theme-accent="${k}" aria-pressed="${cur.accent === k}" aria-label="${a.label}" aria-label="${a.label}" style="--sw:${a.hex || 'conic-gradient(#d2ff00, #00e5ff, #b08cff, #ff4fd8, #ff9f43, #d2ff00)'}"></button>`).join('')}</div></div>
    <div class="dp-row"><span>Background</span>${Object.entries(SURFACES).map(([k, s]) => `<button class="chip ${cur.surface === k ? 'on' : ''}" data-theme-surface="${k}" aria-pressed="${cur.surface === k}"><i class="sf-dot" style="background:rgb(${s.panel})"></i>${s.label}</button>`).join('')}</div>`;
