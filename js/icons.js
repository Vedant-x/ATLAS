// One small set of line icons (24-unit grid, drawn with currentColor) used everywhere in the UI
// instead of emoji or text symbols, so every icon shares one weight and style.
const P = {
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  compare: '<path d="M7 7h12M15 3l4 4-4 4M17 17H5M9 13l-4 4 4 4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 3h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cross: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  dash: '<path d="M7 12h10"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  trend: '<path d="M3.5 16.5l5.5-5.5 4 4 7.5-7.5M15 7.5h5.5V13"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  medical: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  dot: '<circle cx="12" cy="12" r="2.5"/>',
};
export const ico = (name, cls = '') => `<svg class="ico${name === 'star-on' ? ' fill' : ''}${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${P[name === 'star-on' ? 'star' : name] || P.dot}</svg>`;

// Change-timeline kinds (the same keys as changelog.js KIND_ICON, which stays text for notifications).
const KIND = { starter: 'person', lineup: 'list', injury: 'medical', price: 'trend', time: 'clock', start: 'play', soon: 'timer', score: 'dot' };
export const kindIco = (kind) => ico(KIND[kind] || 'dot', `k-${kind || 'other'}`);

// Watch and compare buttons: the same markup on first render and after a toggle.
export const watchLabel = (on, long = true) => `${ico(on ? 'star-on' : 'star')}<span>${on ? 'Watching' : long ? 'Watch match' : 'Watch'}</span>`;
export const pinLabel = (on, long = true) => `${ico('compare')}<span>${on ? (long ? 'Pinned to compare' : 'Pinned') : 'Compare'}</span>`;
