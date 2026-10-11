// Colours from feeds (team colours, F1 liveries) and the page accent are used as text and as chip
// backgrounds on a near-black page. A dark colour there is unreadable (black on black), so every such
// colour passes through `readable`: dark colours with a hue are lightened (same hue) until they stand
// out on the dark background and can carry black text; black and greys with no hue use the fallback.
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const hex = (c) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
function hsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function fromHsl([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
export const MIN_LUMINANCE = 0.2; // ≥ 4.5:1 against the page background and against black text
export function readable(color, fallback = '#d2ff00') {
  if (!/^#[0-9a-f]{6}$/i.test(color || '')) return fallback;
  const c = rgb(color);
  if (lum(c) >= MIN_LUMINANCE) return color.toLowerCase();
  const [h, s, l] = hsl(c);
  if (s < 0.2) return fallback; // black or grey: no colour to keep
  for (let L = l; L <= 0.9; L += 0.03) { const next = fromHsl([h, s, L]); if (lum(next) >= MIN_LUMINANCE) return hex(next); }
  return fallback;
}
export const luminance = (color) => lum(rgb(color));
