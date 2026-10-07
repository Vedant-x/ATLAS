import { ico, watchLabel, pinLabel } from './icons.js';
import { mountPalette } from './palette.js';
import { mountAssistant } from './assistant/ui.js';
import { legalViews, ageGate } from './legal.js';
import { trackViews } from './trackview.js';
import { watch, checkAlerts, followed, showMoment, requestNotify } from './alerts.js';
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
  events: [], source: 'demo', demo: true, news: [], odds: null, fetchedAt: 0,
  slipCache: new Map(), slipsAt: 0,
  // opts.today: only matches still to start today (local time); cached per day so midnight rolls over.
  slips(target, opts = {}) {
    // Personal filters (min odds per leg, preferred sports) shape every slip.
    // Same window and tolerance as the official record (track.js slipPolicy), plus the viewer's filters.
    const key = `${target}|${prefs.sig()}`;
    const pool = prefEvents(slipWindow(this.events, target));
    // Built from bankers: many short-priced favourites, never a few long shots (picks.js).
    if (!this.slipCache.has(key)) this.slipCache.set(key, bankerSlips(pool, target, { count: opts.count || 5, tolerance: slipPolicy(target).tolerance, cal: trackCalibration(), minOdds: prefs.get().minOdds }));
    return this.slipCache.get(key);
  },
  async detail(e) {
    return { lineups: await fetchLineups(e).catch(() => null), injuries: [] };
  },
};
bind(state);
bindResearch(state);
mountPalette(state);
state.refresh = () => softRender();
state.scene = scene;
loadF1().then((d) => { if (d && ['home', 'sports'].includes(parse().name)) softRender(); });

// ---------- data ----------
function setData(d) {
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
  if (polling || state.demo || (document.hidden && !following())) return; // background: only for alerts
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
  const research = { watchlist: watchlistView, compare: compareView };
  return { name, v: (views[name] || research[name] || legalViews[name] || trackViews[name] || views.notfound)(args.map(decodeURIComponent)) };
}

function render(animate) {
  const { name, v } = build();
  app.innerHTML = v.html;
  document.title = `${v.title} · ATLAS`;
  scene.setAccent(v.accent);
  document.documentElement.style.setProperty('--accent', v.accent);
  scene.setMode(v.mode, v.sceneOpts);
  const tab = ['sport', 'league', 'match'].includes(name) ? 'sports' : name; // deeper pages keep the Sports tab lit
  document.querySelectorAll('nav.top a').forEach((a) => { const h = a.getAttribute('href'); a.classList.toggle('on', h.startsWith('#/') && (h.split('/')[1] || 'home') === tab); });
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
  const label = { edge: 'Edge board', x: 'Multipliers', target: 'Target', mega: 'Mega bets', bankers: 'Bankers', live: 'Live', watchlist: 'Watchlist', compare: 'Compare' }[name];
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
  const label = { home: 'TODAY', live: 'LIVE', watchlist: 'WATCHLIST', compare: 'COMPARE', track: 'RESULTS', sports: 'ALL SPORTS', sport: 'SPORT', league: 'LEAGUE', match: 'MATCH DOSSIER', edge: 'EDGE BOARD', x: 'MULTIPLIERS', target: 'TARGET', mega: 'MEGA BETS', bankers: 'BANKERS' }[name] || '';
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
  const { v } = build();
  // Prepare the new page exactly as the shown one was prepared, then patch only what differs.
  const t = document.createElement('template');
  t.innerHTML = v.html;
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
    ${s.correlated ? '<p class="warn">Two legs from the same match are correlated: the true combined chance differs from the product shown, and bookmakers may refuse the combination.</p>' : ''}
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
  if (html !== tickerHtml) { tickerHtml = html; el.innerHTML = html; }
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
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = false; }); });
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-install]') || !installEvt) return;
  installEvt.prompt();
  installEvt.userChoice.finally(() => { installEvt = null; document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = true; }); });
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


