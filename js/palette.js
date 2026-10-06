// Quick search (Ctrl/Cmd+K or "/"): jump to any page, match, team or league from anywhere.
// Matches are ranked by how well the words match, then by how soon they start.
import { esc, sportOf, ist } from './views.js';
import { ico } from './icons.js';

const PAGES = [
  ['Today', '#/'], ['Live', '#/live'], ['Watchlist', '#/watchlist'], ['Explore all sports', '#/sports'],
  ['Edge board', '#/edge'], ['Bankers', '#/bankers'], ['Multipliers', '#/x/2'], ['Target', '#/target'],
  ['Mega bets', '#/mega'], ['Compare', '#/compare'], ['Results / track record', '#/track'],
];
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function mountPalette(state) {
  const el = document.createElement('div');
  el.className = 'pal';
  el.hidden = true;
  el.innerHTML = `<div class="pal-box" role="dialog" aria-label="Quick search">
    <label class="pal-in">${ico('search')}<input type="search" placeholder="Search matches, teams, leagues or pages" aria-label="Search" autocomplete="off" spellcheck="false"></label>
    <ul class="pal-list" role="listbox"></ul>
    <p class="pal-foot"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close</p></div>`;
  document.body.append(el);
  const input = el.querySelector('input'), list = el.querySelector('.pal-list');
  let items = [], sel = 0;

  const results = (q) => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const pages = PAGES.filter(([n]) => words.every((w) => norm(n).includes(w))).map(([n, h]) => ({ kind: 'page', label: n, href: h }));
    if (!words.length) return pages;
    const now = Date.now();
    const evs = (state.events || []).map((e) => {
      const hay = norm(`${e.home} ${e.away} ${e.league} ${sportOf(e.sport).name}`);
      if (!words.every((w) => hay.includes(w))) return null;
      const exact = words.every((w) => norm(e.home).includes(w) || norm(e.away).includes(w));
      return { kind: 'match', e, score: (exact ? 0 : 1) * 1e13 + (e.live ? 0 : Math.abs(e.start - now)) };
    }).filter(Boolean).sort((a, b) => a.score - b.score).slice(0, 12);
    return [...pages.slice(0, 3), ...evs];
  };
  const row = (it, i) => (it.kind === 'page'
    ? `<li role="option" class="${i === sel ? 'on' : ''}" data-i="${i}"><span class="pal-k">Page</span><b>${esc(it.label)}</b></li>`
    : `<li role="option" class="${i === sel ? 'on' : ''}" data-i="${i}"><span class="pal-k">${sportOf(it.e.sport).icon}</span><b>${esc(it.e.home)} v ${esc(it.e.away)}</b><small>${esc(it.e.league)} · ${it.e.live ? 'live now' : esc(ist(it.e.start))}</small></li>`);
  const paint = () => {
    list.innerHTML = items.map(row).join('') || '<li class="pal-none">No matches for that. Try a team, league or sport.</li>';
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const update = () => { items = results(input.value); sel = 0; paint(); };
  const go = (it) => { if (!it) return; close(); location.hash = it.kind === 'page' ? it.href : `#/match/${encodeURIComponent(it.e.id)}`; };
  function open() { el.hidden = false; document.body.classList.add('pal-open'); input.value = ''; update(); setTimeout(() => input.focus(), 0); }
  function close() { el.hidden = true; document.body.classList.remove('pal-open'); }

  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  list.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) go(items[Number(li.dataset.i)]); });
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); el.hidden ? open() : close(); }
    else if (e.key === '/' && !typing && el.hidden) { e.preventDefault(); open(); }
  });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-palette]')) { e.preventDefault(); open(); } });
  return { open, close };
}
