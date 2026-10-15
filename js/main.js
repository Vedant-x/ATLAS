import { ico, watchLabel, pinLabel } from './icons.js';
import { mountPalette } from './palette.js';
import { readable } from './color.js';
import { backClosesPanels } from './back.js';
import { mountAssistant } from './assistant/ui.js';
import { legalViews, ageGate } from './legal.js';
import { trackViews } from './trackview.js';
import { watch, checkAlerts, followed, showMoment, requestNotify } from './alerts.js';
import { propsView, propsClick, propsSearch, propsList } from './propsview.js';
import { playerView, playerClick, playerInput } from './playerview.js';
import { slipCheck } from './slipcheck.js';
import { loadPlayers, playersData } from './playerdata.js';
// The Research area: one tab bar across its pages (props and player research, the builder, the
// edge board, compare, and sports and leagues).
const RESEARCH = new Set(['props', 'player', 'bankers', 'x', 'target', 'mega', 'edge', 'compare', 'sports', 'sport', 'league']);
const R_TABS = [['props', '#/props', 'Props', ['props', 'player']], ['builder', '#/x/2', 'Builder', ['bankers', 'x', 'target', 'mega']], ['edge', '#/edge', 'Edge', ['edge']], ['compare', '#/compare', 'Compare', ['compare']], ['sports', '#/sports', 'Sports', ['sports', 'sport', 'league']]];
const withTabs = (name, html) => { if (!RESEARCH.has(name)) return html; const i = html.indexOf('</section>'); return i < 0 ? researchTabs(name) + html : html.slice(0, i + 10) + researchTabs(name) + html.slice(i + 10); };
const researchTabs = (name) => `<nav class="research-tabs" aria-label="Research">${R_TABS.map(([k, h, l, on]) => `<a class="${on.includes(name) ? 'on' : ''}" href="${h}"${on.includes(name) ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;

// "More": every page in one sheet (phones and tablets, where the bar holds only the main ones). The
// tiles reuse the menu's own links and icons.
const MORE_INFO = {
  '#/': 'Shortlist, live strip and what is next', '#/live': 'Everything in play now', '#/watchlist': 'Matches you follow, with alerts',
  '#/sports': 'Every sport and competition', '#/props': 'Player lines, hit rates, research', '#/edge': 'Every price against fair odds',
  '#/bankers': 'Likeliest picks at short odds', '#/x/2': 'Slips from 2x to 1000x', '#/target': 'A slip for any multiplier you type',
  '#/mega': '100x and 1000x slips', '#/compare': 'Pinned matches side by side', '#/track': 'Track record of every pick',
};
const sheet = document.getElementById('more-sheet');
function fillMore() {
  const grid = sheet?.querySelector('.ms-grid');
  if (!grid || grid.children.length) return;
  grid.innerHTML = [...document.querySelectorAll('nav.top a[href^="#/"]')].map((a) => {
    const h = a.getAttribute('href');
    return `<a href="${h}" class="ms-tile">${a.querySelector('svg')?.outerHTML || ''}<b>${esc(a.querySelector('span')?.textContent || a.dataset.m || '')}</b><small>${esc(MORE_INFO[h] || '')}</small></a>`;
  }).join('') + '<button class="ms-tile" data-more-display><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/></svg><b>Display</b><small>Motion, density, ticker, 3D</small></button>';
}
function openMore(open) {
  if (!sheet) return;
  fillMore();
  sheet.hidden = !open;
  sheet.classList.toggle('open', open);
  document.querySelector('nav.top [data-more]')?.setAttribute('aria-expanded', String(open));
  if (open) sheet.querySelector('.ms-tile')?.focus({ preventScroll: true });
}
function closeMore() { if (sheet?.classList.contains('open')) openMore(false); }
sheet?.addEventListener('click', (e) => {
  if (e.target === sheet || e.target.closest('[data-more-close]')) { e.preventDefault(); openMore(false); return; }
  if (e.target.closest('[data-more-display]')) { openMore(false); document.querySelector('[data-display-toggle]')?.click(); return; }
  if (e.target.closest('a.ms-tile')) openMore(false);
});
document.addEventListener('click', (e) => {
  const m = e.target.closest('nav.top [data-more]');
  if (!m) return;
  e.preventDefault();
  openMore(!sheet.classList.contains('open'));
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMore(); });
import { loadEvents, refreshLive, refreshCricket, refreshTeamNews, refreshAsia } from './data.js';
import { refreshLiveCenter, liveCenterHtml } from './livecenter.js';
import { loadF1, f1Data, pollF1Live } from './f1view.js';
import { liveSession } from './f1.js';
import { overlayLive } from './merge.js';
import { enrichMlb } from './mlbstats.js';
import { todayEvents } from './engine.js';
import { slipWindow, slipPolicy, rankedBankers } from './track.js';
import { bankerSlips } from './picks.js';
import { trackCalibration } from './trackview.js';
import { prefs, prefEvents } from './prefs.js';
import { applyModel } from './intel.js';
import { fetchLineups, fetchSummary } from './espn.js';
import { startLiveAlerts } from './livealerts.js';
import { morph } from './morph.js';
import { views, bind, legIndex, edgeTable, countdown, esc, sportOf, ist } from './views.js';
import { slip } from './slip.js';
import { preloader, cursor, wipe, magnetic, tilt, countUp, reveal, fitTitles } from './ui.js';
import { pc, odd } from './charts.js';
import { bindResearch, quickView, togglePin, compareView, watchlistView, setResearchPrefs, pins } from './research.js';
import { loadTimeline, markReviewed } from './timeline.js';
import { display, displayPanel } from './display.js';
import { leagueByPath, leagueKey, sportById } from './catalog.js';

const app = document.getElementById('app');
// Web fonts were loaded with media=print so they don't block the first paint: switch them on now.
document.querySelectorAll('link[data-fonts]').forEach((l) => { l.media = 'all'; });
// Effects switch: the 3D background is off unless the visitor turns it on (remembered per device;
// ?lite in the URL forces it off). Off by default because it makes slower computers lag on start-up,
// and while off the 3D engine is never even downloaded.
const fxOff = (() => { try { return /[?&]lite\b/.test(location.search) || localStorage.getItem('atlas-fx') !== 'on'; } catch { return true; } })();
const bg = document.getElementById('bg');
// The 3D scene (three.js) loads after the first paint; calls made before it's ready are replayed.
const scene = (() => {
  let real = null;
  const queue = [];
  const call = (m) => (...a) => (real ? real[m]?.(...a) : queue.push([m, a]));
  const api = { ok: false, setMode: call('setMode'), setAccent: call('setAccent'), pulse: call('pulse'), setTrack: call('setTrack'), setCars: call('setCars') };
  api.start = () => {
    if (fxOff || api.started) return;
    api.started = true;
    import('./scene.js').then(({ createScene }) => {
      real = createScene(bg);
      api.ok = real.ok;
      const last = new Map(); // only the latest mode/accent/track matter
      for (const [m, a] of queue) if (m === 'pulse') continue; else last.set(m, a);
      for (const m of ['setAccent', 'setTrack', 'setMode', 'setCars']) if (last.has(m)) real[m]?.(...last.get(m));
      queue.length = 0;
    }).catch(() => bg.classList.add('no-webgl'));
  };
  if (fxOff) bg.classList.add('no-webgl');
  return api;
})();
document.querySelectorAll('[data-fx-toggle]').forEach((b) => { b.setAttribute('aria-pressed', String(!fxOff)); b.querySelector('b').textContent = fxOff ? 'OFF' : 'ON'; });

const state = {
  events: [], source: 'loading', demo: false, loading: true, news: [], odds: null, fetchedAt: 0,
  slipCache: new Map(), slipsAt: 0,
  // opts.today: only matches still to start today (local time); cached per day so midnight rolls over.
  slips(target, opts = {}) {
    // Personal filters (min odds per leg, preferred sports) shape every slip.
    // Same window and tolerance as the official record (track.js slipPolicy), plus the viewer's filters.
    // opts.filter (the assistant's constraints: a sport, dates, exclusions) narrows the pool; opts.key
    // names that filter for the cache, and opts.minOdds can raise the minimum leg price.
    const key = `${target}|${prefs.sig()}|${opts.key || ''}|${opts.minOdds || ''}`;
    let pool = prefEvents(slipWindow(this.events, target));
    if (opts.filter) pool = pool.filter(opts.filter);
    // Built from bankers: many short-priced favourites, never a few long shots (picks.js).
    if (!this.slipCache.has(key)) this.slipCache.set(key, bankerSlips(pool, target, { count: opts.count || 5, tolerance: slipPolicy(target).tolerance, cal: trackCalibration(), minOdds: Math.max(prefs.get().minOdds, opts.minOdds || 0) }));
    return this.slipCache.get(key);
  },
  async detail(e) {
    return { lineups: await fetchLineups(e).catch(() => null), injuries: [] };
  },
};
bind(state);
bindResearch(state);
mountPalette(state);
backClosesPanels();
state.refresh = () => softRender();
state.scene = scene;
loadF1().then((d) => { if (d && ['home', 'sports'].includes(parse().name)) softRender(); });

// ---------- data ----------
function setData(d) {
  state.loading = false;
  Object.assign(state, d, { events: applyModel(d.events) });
  checkAlerts(state.events);
  if (Date.now() - state.slipsAt > 60000) { state.slipCache.clear(); state.slipsAt = Date.now(); }
  ticker();
}
// Live loop. While anything is in play, live leagues refresh straight from ESPN every 5 s; leagues
// starting soon every 30 s; the full snapshot (every league, NPB/KBO, absences, lineups) every 5 min.
// The page redraws only when something real changed (score, status, prices, fixtures); otherwise
// just the game clocks update in place, so nothing flickers or closes.
const anyLive = () => state.events.some((e) => e.live);
const following = () => watch.ids().length > 0 || slip.legs.length > 0;
const refreshMs = () => (document.hidden ? 60000 : anyLive() ? 5000 : state.snapshot ? 30000 : 5000);
let polling = false, lastIndex = Date.now(), lastWide = 0, lastNews = 0, lastAsia = 0;
const sigOf = (events) => events.map((e) => `${e.id}|${e.live ? 1 : 0}|${e.score || ''}|${e.lines ? `${e.lines.home}/${e.lines.away}` : ''}|${(e.esports?.maps || []).map((m) => m.score || m.status).join(",")}|${(e.markets || []).map((m) => m.outcomes.map((o) => o.odds).join(',')).join(';')}|${e.absences ? `${e.absences.home.length},${e.absences.away.length},${e.absences.lineup?.type || ''}` : ''}`).join('~');
let lastSig = '';
// A starter announced or changed after the snapshot has no report yet: fetch it from the MLB Stats
// API (browser-friendly) and redraw, so nobody has to reload the page to see it.
const enriching = new Set();
function fillStarters(events) {
  const due = events.filter((e) => e.leaguePath === 'baseball/mlb' && !e.live && e.probables?.some((p) => !p.report) && !enriching.has(e.id)).slice(0, 4);
  if (!due.length) return;
  due.forEach((e) => enriching.add(e.id));
  enrichMlb(due, { signal: AbortSignal.timeout(15000) }).then((n) => { if (n) { lastSig = ''; apply(state.events); } }).catch(() => {}).finally(() => setTimeout(() => due.forEach((e) => enriching.delete(e.id)), 10 * 6e4));
}
function apply(events) {
  const sig = sigOf(events);
  setData({ ...state, events, fetchedAt: Date.now() });
  fillStarters(state.events);
  if (sig === lastSig) { patchClocks(); return; }
  lastSig = sig;
  liveRender();
}
// Live redraws wait until the page has stopped scrolling, so a score change never stalls a swipe.
let lastScroll = 0, liveDue = false;
function liveRender() {
  if (performance.now() - lastScroll > 400) { softRender(); refreshSlip(); return; }
  if (liveDue) return;
  liveDue = true;
  const wait = () => { if (performance.now() - lastScroll < 400) { setTimeout(wait, 200); return; } liveDue = false; softRender(); refreshSlip(); };
  setTimeout(wait, 200);
}
function patchClocks() {
  const byId = new Map(state.events.map((e) => [e.id, e]));
  document.querySelectorAll('[data-clock]').forEach((el) => { const e = byId.get(el.dataset.clock); if (e && el.textContent !== (e.clock || '')) el.textContent = e.clock || ''; });
}
async function poll() {
  if (polling || state.demo || state.loading || (document.hidden && !following())) return; // background: only for alerts
  polling = true;
  try {
    if (state.snapshot && Date.now() - lastIndex < 300000) {
      const wide = Date.now() - lastWide > 30000;
      let next = (await refreshLive(state.events, { liveOnly: !wide }).catch(() => null)) || null;
      // Cricket: every cycle while a match is live, otherwise with the 30 s sweep.
      if (wide || state.events.some((e) => e.live && e.sport === 'cricket')) next = (await refreshCricket(next || state.events).catch(() => null)) || next;
      // Soccer team news (absences, confirmed XIs) every 2 minutes around kick-off.
      if (Date.now() - lastNews > 120000) { lastNews = Date.now(); next = (await refreshTeamNews(next || state.events).catch(() => null)) || next; }
      // NPB/KBO/esports live scores (published every 20 seconds by the deploy workflow).
      if (Date.now() - lastAsia > 10000) { lastAsia = Date.now(); next = (await refreshAsia(next || state.events).catch(() => null)) || next; }
      if (wide) lastWide = Date.now();
      if (next) apply(next);
    } else {
      let d = await loadEvents();
      lastIndex = Date.now();
      if (!d.demo) { d = { ...d, events: overlayLive(d.events, state.events) }; lastSig = ''; setData(d); lastSig = sigOf(state.events); liveRender(); }
    }
  } finally { polling = false; }
}

// Live scoreboard on an open match page: refreshed every 8 seconds, patched in place.
let lcHtml = '';
async function tickLiveCenter() {
  if (document.hidden || current !== 'match') return;
  const e = state.events.find((x) => x.id === decodeURIComponent(parse().args[0] || ''));
  if (!e?.live) return;
  await refreshLiveCenter(e);
  const el = document.getElementById('live-center');
  const html = liveCenterHtml(e);
  if (el && html && html !== lcHtml) { lcHtml = html; el.outerHTML = html; }
}
setInterval(tickLiveCenter, 8000);
// Goals, cards, half-time and full time for followed matches (watchlist + slip), while ATLAS is open.
startLiveAlerts({ events: () => state.events, follow: followed, fetchSummary, show: showMoment, final: (id, line) => watch.finish(id, line) });

// Formula 1: the weekend file every few minutes (so the next Grand Prix and new results appear on
// their own), live timing every 5 seconds while a session runs and the F1 page is open.
const onF1 = () => current === 'sport' && parse().args[0] === 'f1';
async function tickF1() {
  const before = f1Data()?.updatedAt;
  const d = await loadF1();
  if (d && d.updatedAt !== before && (onF1() || current === 'home' || current === 'sports')) softRender();
}
setInterval(tickF1, 4 * 6e4);
setInterval(() => { const d = f1Data(); if (d && onF1() && !document.hidden && liveSession(d.race.sessions)) pollF1Live(d, scene); }, 5000);

// ---------- routing ----------
const parse = () => { const [, name = '', ...args] = (location.hash || '#/').split('/'); return { name: name || 'home', args }; };
let current = null;

function build() {
  const { name, args } = parse();
  legIndex.clear();
  const research = { watchlist: watchlistView, compare: compareView, props: (a) => propsView(state.events, softRender, a[0] || ''), player: (a) => playerView(a[0], state.events, softRender) };
  return { name, v: (views[name] || research[name] || legalViews[name] || trackViews[name] || views.notfound)(args.map(decodeURIComponent)) };
}

function render(animate) {
  const { name, v } = build();
  app.innerHTML = withTabs(name, v.html);
  document.title = `${v.title} · ATLAS`;
  scene.setAccent(v.accent);
  document.documentElement.style.setProperty('--accent', readable(v.accent)); // selected chips carry black text on it
  scene.setMode(v.mode, v.sceneOpts);
  // Deeper pages keep their section lit: matches and leagues under Sports, player research under Props.
  const tab = ['sport', 'league', 'match'].includes(name) ? 'sports' : name === 'player' ? 'props' : name;
  document.querySelectorAll('nav.top a').forEach((a) => { const h = a.getAttribute('href'); a.classList.toggle('on', h.startsWith('#/') && (h.split('/')[1] || 'home') === tab); });
  // On phones and tablets, More is lit when the page's own menu item is folded into it.
  const lit = document.querySelector('nav.top a.on:not([data-more])');
  document.querySelector('nav.top [data-more]')?.classList.toggle('on', Boolean(lit) && getComputedStyle(lit).display === 'none');
  closeMore();
  reveal(app, animate);
  fitTitles(app);
  countUp(app);
  magnetic(app);
  calc();
  v.after?.();
  current = name;
  dock();
  if (name === 'match') { lcHtml = ''; tickLiveCenter(); markReviewed(decodeURIComponent(parse().args[0] || '')); }
  closeQv();
  document.getElementById('display-panel')?.classList.remove('open'); // never carried over to the next page
  if (innerWidth <= 820 && state.ai?.isOpen?.()) state.ai.close(); // phones: the chat sheet covers the page, so a new page closes it
}

// Back / Home dock: always reachable, so no page is a dead end. "Back" goes to the previous ATLAS
// page if there is one in this visit, otherwise to the logical parent (match → league → sport → all).
// Visited ATLAS pages this visit; going back pops, anything else pushes.
const stack = [location.hash || '#/'];
let replacing = false;
function parentOf() {
  const { name, args } = parse();
  if (name === 'match') {
    const e = state.events.find((x) => x.id === decodeURIComponent(args[0] || ''));
    return e?.leaguePath ? `#/league/${leagueKey(e.leaguePath)}` : '#/sports';
  }
  if (name === 'league') { const l = leagueByPath((args[0] || '').replace(/~/g, '/')); return l ? `#/sport/${l.sport}` : '#/sports'; }
  if (name === 'sport') return '#/sports';
  return '#/';
}
function trail() {
  const { name, args } = parse();
  const parts = [['#/', 'Home']];
  let e, l;
  if (name === 'match') e = state.events.find((x) => x.id === decodeURIComponent(args[0] || ''));
  if (name === 'league') l = leagueByPath((args[0] || '').replace(/~/g, '/'));
  if (e?.leaguePath) l = leagueByPath(e.leaguePath);
  const sp = sportById(name === 'sport' ? args[0] : l?.sport);
  if (['sports', 'sport', 'league', 'match'].includes(name)) parts.push(['#/sports', 'Sports']);
  if (sp) parts.push([`#/sport/${sp.id}`, sp.name]);
  if (l) parts.push([`#/league/${leagueKey(l.path)}`, l.short || l.name]);
  if (e) parts.push(['', `${e.home} v ${e.away}`]);
  const label = { edge: 'Edge board', props: 'Player props', player: 'Player', x: 'Multipliers', target: 'Target', mega: 'Mega bets', bankers: 'Bankers', live: 'Live', watchlist: 'Watchlist', compare: 'Compare' }[name];
  if (label) parts.push(['', label]);
  return parts;
}
function dock() {
  const el = document.querySelector('.crumbs-dock');
  if (!el) return;
  const home = parse().name === 'home';
  el.hidden = home;
  document.body.classList.toggle('has-dock', !home);
  el.querySelector('.dock-trail').innerHTML = trail().map(([h, t], i, a) => (h && i < a.length - 1 ? `<a href="${h}">${esc(t)}</a>` : `<b>${esc(t)}</b>`)).join('<i>›</i>');
}

function route() {
  if (!location.hash.startsWith('#/')) return; // in-page anchors
  const { name } = parse();
  // Research: picking a player beside the props list (or going back to the list) patches the page
  // in place, so the list keeps its scroll position; on phones the panel opens at the top.
  if (name === 'props' && current === 'props') {
    const h = location.hash;
    if (stack.length > 1 && stack[stack.length - 2] === h) stack.pop(); else stack.push(h);
    softRender();
    if (innerWidth < 1100) scrollTo({ top: 0, behavior: 'instant' });
    dock();
    return;
  }
  const label = { home: 'TODAY', live: 'LIVE', watchlist: 'WATCHLIST', compare: 'COMPARE', track: 'RESULTS', sports: 'ALL SPORTS', sport: 'SPORT', league: 'LEAGUE', match: 'MATCH DOSSIER', edge: 'EDGE BOARD', props: 'PLAYER PROPS', player: 'PLAYER RESEARCH', x: 'MULTIPLIERS', target: 'TARGET', mega: 'MEGA BETS', bankers: 'BANKERS' }[name] || '';
  const h = location.hash || '#/';
  if (replacing) { stack[stack.length - 1] = h; replacing = false; } else if (stack.length > 1 && stack[stack.length - 2] === h) stack.pop(); else stack.push(h);
  // instant: html has scroll-behavior:smooth, and a smooth scroll still running when a live refresh
  // re-renders would be frozen half-way down the new page.
  wipe(() => { render(true); scrollTo({ top: 0, behavior: 'instant' }); }, label).then(() => scene.pulse());
}

// Live refresh without the intro animation; skipped while the user is typing.
function softRender() {
  const a = document.activeElement;
  if (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
  if (current === 'edge') { refreshEdge(); return; }
  const y = scrollY;
  const open = [...app.querySelectorAll('details[open] > summary')].map((s) => s.textContent);
  const { name, v } = build();
  // Prepare the new page exactly as the shown one was prepared, then patch only what differs.
  const t = document.createElement('template');
  t.innerHTML = withTabs(name, v.html);
  const f = t.content;
  f.querySelectorAll('details > summary').forEach((s) => { if (open.includes(s.textContent)) s.parentElement.open = true; });
  f.querySelectorAll('.reveal, .grow, .grow-y, .draw').forEach((el, i) => { el.style.setProperty('--d', `${Math.min(i % 12, 11) * 45}ms`); el.classList.add('in'); });
  f.querySelectorAll('.ch').forEach((el) => { el.style.opacity = 1; });
  f.querySelectorAll('[data-count-to]').forEach((el) => { el.textContent = Number(el.dataset.countTo).toFixed(Number(el.dataset.dec || 0)) + (el.dataset.suffix || ''); });
  // Headings keep the size fitTitles gave them unless their text changed.
  const was = [...app.querySelectorAll('h1')], now = [...f.querySelectorAll('h1')];
  let refit = was.length !== now.length;
  now.forEach((h, i) => { if (was[i]?.textContent === h.textContent) { const st = was[i].getAttribute('style'); if (st) h.setAttribute('style', st); } else refit = true; });
  morph(app, f);
  if (refit) fitTitles(app);
  calc();
  v.after?.();
  scrollTo({ top: y, behavior: 'instant' });
  if (qvId && qv?.classList.contains('open')) { const st = qv.scrollTop; qv.innerHTML = quickView(qvId); qv.scrollTop = st; document.querySelector(`tr[data-qv="${CSS.escape(qvId)}"]`)?.classList.add('qv-on'); }
}

// ---------- slip drawer ----------
// Saved prices expire: flag legs whose match has started or whose price was saved hours ago.
function staleNote(l) {
  const e = state.events.find((x) => x.id === l.eventId);
  if (e?.live || (e && e.start < Date.now())) return '<small class="warn">Match started: this pre-match price is no longer available</small>';
  if (!e && state.events.length) return '<small class="warn">Match no longer on the board</small>';
  const age = l.addedAt ? (Date.now() - l.addedAt) / 36e5 : null;
  return age != null && age > 3 ? `<small class="warn">Price saved ${Math.round(age)}h ago: check it before betting</small>` : '';
}
const drawer = document.getElementById('slip');
// Re-check the slip's warnings after live data changes, unless the stake box is being edited.
function refreshSlip() { if (slip.legs.length && document.activeElement?.dataset?.slipStake === undefined) renderSlip(); }
function renderSlip() {
  const s = slip.summary();
  document.querySelectorAll('[data-slip-count]').forEach((el) => { el.textContent = s.n; el.classList.toggle('has', s.n > 0); });
  drawer.querySelector('.slip-body').innerHTML = s.n ? `
    <ul class="slip-legs">${slip.legs.map((l) => `<li><span>${sportOf(l.sport).icon}</span><div><b>${esc(l.pick)}</b><small>${esc(l.market)} · ${esc(l.match)}</small>${(() => { const ev = state.events.find((x) => x.id === l.eventId); return ev?.live ? '<small class="live">LIVE</small>' : ev?.start ? `<time class="ist">🕒 ${ist(ev.start)}</time>` : ''; })()}${l.derived ? '<small class="warn">ATLAS fair price, not a bookmaker quote</small>' : ''}${staleNote(l)}</div><em>${odd(l.odds)}</em><button data-unleg="${esc(l.key)}" aria-label="Remove">×</button></li>`).join('')}</ul>
    ${s.correlated ? '<p class="warn">Two legs from the same match: bookmakers may refuse the combination, and the combined chance is not a simple product (see the slip check).</p>' : ''}
    ${slip.legs.length > 1 ? slipCheck(slip.legs, { logs: slip.legs.some((l) => l.prop) ? playersData() || loadPlayers(refreshSlip) : null, esc }) : ''}
    <div class="slip-sum">
      <div><small>Total odds</small><b>${s.odds.toFixed(2)}x</b></div>
      <div><small>Est. chance</small><b>${pc(s.p, s.p < 0.01 ? 2 : 1)}</b></div>
      <div><small>Edge</small><b class="${s.ev >= 0 ? 'pos' : 'neg'}">${(s.ev * 100).toFixed(1)}%</b></div>
      <label><small>Stake</small><input type="number" min="0" step="1" value="${Number(slip.stake) || 0}" data-slip-stake></label>
      <div><small>Potential return</small><b data-sum-pay>${s.payout.toFixed(2)}</b></div>
      <div><small>Expected return</small><b data-sum-exp>${(slip.stake * s.p * s.odds).toFixed(2)}</b></div>
    </div>
    <div class="slip-actions"><button class="btn" data-slip-copy>Copy slip</button><button class="btn-ghost" data-slip-clear>Clear</button></div>`
    : '<p class="muted">Tap any price to add it here. ATLAS shows the combined odds, the estimated win chance and the edge as you build.</p>';
}
slip.subscribe(() => {
  if (document.activeElement?.matches?.('[data-slip-stake]')) return;
  renderSlip();
  document.querySelectorAll('[data-leg]').forEach((b) => b.classList.toggle('on', slip.has(b.dataset.leg)));
});

// ---------- ticker ----------
let tickerHtml = '';
function ticker() {
  const el = document.querySelector('.ticker-track');
  if (!el) return;
  const live = state.events.filter((e) => e.live).map((e) => `<span><i class="live">●</i> ${esc(e.home)} <b>${esc(e.score || '')}</b> ${esc(e.away)} <small>${esc(e.clock || '')}</small></span>`);
  const picks = rankedBankers(todayEvents(state.events), { cal: trackCalibration(), min: 0.6, limit: 10 }).map((b) => `<span>${sportOf(b.event.sport).icon} ${esc(b.pick)} <b>${odd(b.odds)}</b> <small>${pc(b.p, 0)}</small></span>`);
  const next = [...state.events].filter((e) => !e.live).sort((a, b) => a.start - b.start).slice(0, 10).map((e) => `<span>${sportOf(e.sport).icon} ${esc(e.home)} v ${esc(e.away)}</span>`);
  const items = [...live, ...picks, ...next];
  const html = items.length ? items.join('') + items.join('') : '<span>ATLAS · connecting feeds</span>';
  if (html !== tickerHtml) {
    tickerHtml = html; el.innerHTML = html;
    // A steady reading speed (about 30 px a second) however long the strip is: a fixed duration made a
    // long strip race past. The strip holds the items twice and scrolls by half its width.
    requestAnimationFrame(() => { el.style.animationDuration = `${Math.max(60, Math.round(el.scrollWidth / 2 / 30))}s`; });
  }
}

// ---------- calculator ----------
function calc() {
  const input = app.querySelector('[data-calc]');
  if (!input) return;
  const stake = Number(input.value) || 0;
  app.querySelectorAll('[data-calc-table] tr[data-o]').forEach((tr) => {
    const o = Number(tr.dataset.o), p = Number(tr.dataset.p), ev = stake * (p * o - 1);
    tr.querySelector('[data-ret]').textContent = (stake * o).toFixed(2);
    tr.querySelector('[data-pro]').textContent = (stake * (o - 1)).toFixed(2);
    const evEl = tr.querySelector('[data-ev]');
    evEl.textContent = `${ev >= 0 ? '+' : ''}${ev.toFixed(2)}`;
    evEl.className = `num ${ev >= 0 ? 'pos' : 'neg'}`;
  });
}

// ---------- edge filters ----------
function refreshEdge() {
  const f = {};
  app.querySelectorAll('[data-ef]').forEach((el) => { f[el.dataset.ef] = el.type === 'checkbox' ? el.checked : el.value; });
  const box = document.getElementById('edge-table');
  if (box) { legIndex.clear(); box.innerHTML = edgeTable(f); }
}

// ---------- events ----------
function openSlip(open) { drawer.classList.toggle('open', open); document.body.classList.toggle('slip-open', open); }
function bump() {
  document.querySelector('.slip-btn')?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a');
  if (!t) return;
  const d = t.dataset;
  if ((d.pf && propsClick(t)) || (d.plf && playerClick(t))) { softRender(); return; }
  if (d.leg) {
    e.preventDefault(); e.stopPropagation();
    const leg = legIndex.get(d.leg);
    if (leg) { const on = slip.toggle(leg); t.classList.toggle('on', on); d.cursor = on ? 'REMOVE' : 'ADD'; bump(); }
  } else if (d.addall) {
    d.addall.split('~').forEach((k) => { const l = legIndex.get(k); if (l && !slip.has(k)) slip.toggle(l); });
    openSlip(true); bump();
  } else if (d.unleg) slip.remove(d.unleg);
  else if ('slipClear' in d) slip.clear();
  else if ('slipCopy' in d) navigator.clipboard?.writeText(slip.text()).then(() => { t.textContent = 'Copied'; setTimeout(() => { t.textContent = 'Copy slip'; }, 1400); }).catch(() => {});
  else if ('slipToggle' in d) openSlip(!drawer.classList.contains('open'));
  else if (d.watch) {
    e.preventDefault(); e.stopPropagation();
    const on = watch.toggle(d.watch);
    document.querySelectorAll(`[data-watch="${CSS.escape(d.watch)}"]`).forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.innerHTML = b.classList.contains('icon-btn') ? ico(on ? 'star-on' : 'star') : watchLabel(on, !b.closest('#qv')); });
    if (current === 'watchlist') softRender();
  }
  else if (d.pin) {
    e.preventDefault(); e.stopPropagation();
    const on = togglePin(d.pin);
    document.querySelectorAll(`[data-pin="${CSS.escape(d.pin)}"]`).forEach((b) => { b.classList.toggle('on', on); if (!b.classList.contains('icon-btn')) b.innerHTML = pinLabel(on, !b.closest('#qv')); });
    if (on && pins().length >= 2) toast(`Pinned · ${pins().length} to compare`, '#/compare');
    if (current === 'compare') softRender();
  }
  else if (d.shours) { setResearchPrefs({ shortHours: Number(d.shours) }); softRender(); }
  else if (d.smode) { setResearchPrefs({ shortMode: d.smode }); softRender(); }
  else if (d.border) { setResearchPrefs({ betOrder2: d.border }); softRender(); }
  else if ('qvClose' in d) closeQv();
  else if ('displayToggle' in d) { const p = document.getElementById('display-panel'); const open = !p.classList.contains('open'); p.innerHTML = displayPanel(); p.classList.toggle('open', open); t.setAttribute('aria-expanded', open); }
  else if (d.display) { display.set({ [d.display]: d.value }); document.getElementById('display-panel').innerHTML = displayPanel(); }
  else if (d.pref) { e.preventDefault(); const p = prefs.get(); const v = d.value;
    if (d.pref === 'minOdds') prefs.set({ minOdds: Number(v) });
    else if (d.pref === 'sport') prefs.set({ sports: v === 'all' ? [] : p.sports.includes(v) ? p.sports.filter((x) => x !== v) : [...p.sports, v] });
    else if (d.pref === 'priced') prefs.set({ pricedOnly: !p.pricedOnly });
    state.slipCache.clear(); softRender(); }
  else if ('clearFinished' in d) { watch.removeMany(watch.finished(state.events)); softRender(); }
  else if ('notifyOn' in d) { requestNotify().then(() => softRender()); }
  else if ('fxToggle' in d) { try { localStorage.setItem('atlas-fx', fxOff ? 'on' : 'off'); } catch { /* storage blocked */ } if (/[?&]lite\b/.test(location.search)) location.search = ''; else location.reload(); }
  else if ('navBack' in d) { if (stack.length > 1) history.back(); else { replacing = true; location.replace(parentOf()); } }
  else if (d.jump) { e.preventDefault(); document.getElementById(d.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});
document.addEventListener('input', (e) => {
  if (e.target.matches('[data-calc]')) { slip.stake = e.target.value; calc(); }
  if (e.target.matches('[data-slip-stake]')) {
    slip.stake = e.target.value;
    const s = slip.summary();
    drawer.querySelector('[data-sum-pay]').textContent = s.payout.toFixed(2);
    drawer.querySelector('[data-sum-exp]').textContent = (slip.stake * s.p * s.odds).toFixed(2);
  }
  if (e.target.matches('[data-ef]')) refreshEdge();
  if (e.target.matches('[data-props-search]')) { propsSearch(e.target.value); const box = document.querySelector('[data-props-list]'); if (box) box.innerHTML = propsList(state.events, decodeURIComponent(parse().args[0] || '')); }
  playerInput(e.target, state.events);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { openSlip(false); closeQv(); document.getElementById('display-panel')?.classList.remove('open'); }
  if (e.key === 'Enter' && e.target.matches?.('tr[data-qv]')) openQv(e.target.dataset.qv, e.target);
});
// ---------- quick view ----------
// Clicking a research row or a change opens the match summary in a side panel; the page, its filters
// and its scroll position stay where they were. The full dossier is one click further.
const qv = document.getElementById('qv');
let qvId = null, qvReturn = null;
function openQv(id, from) {
  if (!qv || !id) return;
  qvId = id; qvReturn = from || null;
  qv.innerHTML = quickView(id);
  qv.classList.add('open');
  document.querySelectorAll('tr.qv-on').forEach((r) => r.classList.remove('qv-on'));
  from?.closest?.('tr')?.classList.add('qv-on');
  qv.focus({ preventScroll: true });
}
function closeQv() {
  if (!qv?.classList.contains('open')) return;
  qv.classList.remove('open'); qvId = null;
  document.querySelectorAll('tr.qv-on').forEach((r) => r.classList.remove('qv-on'));
  qvReturn?.focus?.({ preventScroll: true }); qvReturn = null;
}
document.addEventListener('click', (e) => {
  const row = e.target.closest('[data-qv]');
  if (!row || e.target.closest('button, input, select') || (e.target.closest('a') && e.target.closest('a') !== row)) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey) return; // let new-tab clicks through
  e.preventDefault();
  openQv(row.dataset.qv, row);
});
// Capture phase: decided before any handler redraws the page (which would detach the tapped element).
document.addEventListener('click', (e) => {
  // Quick view: a tap anywhere outside it (other than another row) closes it, like any sheet.
  if (qv?.classList.contains('open') && !e.target.closest('#qv, [data-qv], .ai-root, #slip, .slip-btn')) closeQv();
  const p = document.getElementById('display-panel');
  if (p?.classList.contains('open') && !e.target.closest('#display-panel, [data-display-toggle]')) p.classList.remove('open'); // a chip that just redrew the panel is detached: not an outside tap
}, true);
function toast(text, href) {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = document.createElement('a'); t.className = 'toast'; t.href = href || '#/'; t.innerHTML = `<span>${ico('compare')}</span><p></p>`; t.querySelector('p').textContent = text;
  box.append(t); setTimeout(() => t.classList.add('out'), 4000); setTimeout(() => t.remove(), 4600);
}
// Target page: any multiplier from 1.2x up.
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-xtarget]');
  if (!f) return;
  e.preventDefault();
  const t = Number(f.elements.t.value);
  if (t >= 1.2 && t <= 100000) location.hash = `#/target/${Math.round(t * 100) / 100}`;
});

// Clocks: countdowns + "updated Xs ago".
setInterval(() => {
  const put = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  document.querySelectorAll('[data-start]').forEach((el) => put(el, countdown(Number(el.dataset.start))));
  const s = Math.max(0, Math.round((Date.now() - (state.fetchedAt || Date.now())) / 1000));
  document.querySelectorAll('[data-ago]').forEach((el) => put(el, s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`));
}, 1000);

// Header compacts on scroll, hides while scrolling down.
let lastY = 0;
addEventListener('scroll', () => {
  lastScroll = performance.now();
  document.body.classList.toggle('scrolled', scrollY > 40);
  document.body.classList.toggle('hide-bar', scrollY > lastY && scrollY > 400);
  lastY = scrollY;
}, { passive: true });

// Installable app: service worker (deployed site only) and an "Install app" button where supported.
// Offline cache. When a new build's worker takes over a page that an older build served, reload once
// so visitors get the update straight away instead of on their next visit (never on a first visit,
// which has no previous worker). The worker is also re-checked whenever the tab comes back into view.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadWorker = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadWorker && !reloaded) { reloaded = true; location.reload(); } });
  addEventListener('load', () => setTimeout(() => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {}), 3000));
}
let installEvt = null;
// Android browsers: a link to the Android app (ATLAS.apk), hidden inside the app itself.
if (/Android/i.test(navigator.userAgent) && !window.AtlasAndroid) document.querySelectorAll('.apk-link').forEach((a) => { a.hidden = false; });
// Phones and tablets (Android Chrome, Samsung Internet, Edge): a small card offers to install ATLAS
// as an app once the visitor has had a look around; "Not now" hides it for two weeks.
const LATER = 'atlas-install-later';
const installCard = () => {
  let later = 0;
  try { later = Number(localStorage.getItem(LATER)) || 0; } catch { /* storage blocked */ }
  if (!installEvt || !matchMedia('(pointer: coarse)').matches || Date.now() - later < 14 * 864e5 || document.querySelector('.install-card')) return;
  const card = document.createElement('div');
  card.className = 'install-card';
  card.innerHTML = '<img src="icons/icon-192.png" alt="" width="40" height="40"><p><b>Install ATLAS</b><small>Opens like an app, with live alerts</small></p><button class="install-go" data-install>Install</button><button class="install-x" data-install-later aria-label="Not now">Not now</button>';
  document.body.append(card);
};
const hideInstall = () => { document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = true; }); document.querySelector('.install-card')?.remove(); };
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); installEvt = e;
  document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = false; });
  setTimeout(installCard, 20000);
});
addEventListener('appinstalled', () => { installEvt = null; hideInstall(); });
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-install-later]')) { try { localStorage.setItem(LATER, String(Date.now())); } catch { /* storage blocked */ } hideInstall(); return; }
  if (!e.target.closest('[data-install]') || !installEvt) return;
  installEvt.prompt();
  installEvt.userChoice.finally(() => { installEvt = null; hideInstall(); });
});

// ---------- boot ----------
ageGate();
cursor();
tilt();
renderSlip();
// First paint doesn't wait for the full data file: after a short beat the page renders with what it
// has and fills in when the snapshot arrives.
const firstData = loadEvents();
preloader(Promise.race([firstData, new Promise((r) => setTimeout(() => r(null), 350))])).then((d) => {
  if (d) setData(d);
  render(true);
  if (!d) firstData.then((x) => { setData(x); lastSig = sigOf(state.events); softRender(); refreshSlip(); });
  // 3D after the page is up: on phones at the first touch/scroll (or after 5 s) to keep loading light.
  if (matchMedia('(max-width: 700px)').matches) {
    const go = () => { scene.start(); ['pointerdown', 'scroll', 'keydown'].forEach((t) => removeEventListener(t, go)); };
    ['pointerdown', 'scroll', 'keydown'].forEach((t) => addEventListener(t, go, { once: true, passive: true }));
    setTimeout(go, 5000);
  } else (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(() => scene.start(), { timeout: 1500 });
  addEventListener('hashchange', route);
  addEventListener('resize', () => fitTitles(app), { passive: true });
  scene.pulse();
  state.ai = mountAssistant(state);
  // Evidence timeline (what changed): loaded now, refreshed every 5 minutes.
  loadTimeline(() => softRender());
  setInterval(() => loadTimeline(() => softRender()), 5 * 6e4);
  // Catch up on live scores straight away (the snapshot can be minutes old), then keep polling.
  poll().finally(function tick() { setTimeout(() => poll().finally(tick), refreshMs()); });
  addEventListener('visibilitychange', () => { if (!document.hidden) poll(); }); // back on the tab: catch up now
});


