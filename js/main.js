import { loadStakeFeed, stakeView } from './stake.js';
import { mountAssistant } from './assistant/ui.js';
import { legalViews, ageGate } from './legal.js';
import { trackViews } from './trackview.js';
import { watch, checkAlerts } from './alerts.js';
import { loadEvents, refreshLive, refreshCricket, refreshTeamNews, refreshAsia } from './data.js';
import { refreshLiveCenter, liveCenterHtml } from './livecenter.js';
import { loadF1, f1Data, pollF1Live } from './f1view.js';
import { liveSession } from './f1.js';
import { overlayLive } from './merge.js';
import { enrichMlb } from './mlbstats.js';
import { buildSlips, todayEvents, localDay } from './engine.js';
import { prefs, prefEvents } from './prefs.js';
import { applyModel, bankers } from './intel.js';
import { fetchLineups } from './espn.js';
import { views, bind, legIndex, edgeTable, countdown, esc, sportOf } from './views.js';
import { slip } from './slip.js';
import { preloader, cursor, wipe, magnetic, tilt, countUp, reveal } from './ui.js';
import { pc, odd } from './charts.js';
import { leagueByPath, leagueKey, sportById } from './catalog.js';

const app = document.getElementById('app');
// Web fonts were loaded with media=print so they don't block the first paint: switch them on now.
document.querySelectorAll('link[data-fonts]').forEach((l) => { l.media = 'all'; });
// Effects switch: the 3D background can be turned off (remembered per device, or ?lite in the URL).
const fxOff = (() => { try { return /[?&]lite\b/.test(location.search) || localStorage.getItem('atlas-fx') === 'off'; } catch { return false; } })();
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
  stake: null, events: [], source: 'demo', demo: true, news: [], odds: null, fetchedAt: 0,
  slipCache: new Map(), slipsAt: 0,
  // opts.today: only matches still to start today (local time); cached per day so midnight rolls over.
  slips(target, opts = {}) {
    // Personal filters (min odds per leg, preferred sports) shape every slip.
    const key = `${target}|${opts.today ? localDay() : 'all'}|${prefs.sig()}`;
    const pool = prefEvents(opts.today ? todayEvents(this.events) : this.events);
    if (!this.slipCache.has(key)) this.slipCache.set(key, buildSlips(prefs.get().pricedOnly ? pool.filter((e) => e.markets?.length) : pool, target, { minOdds: prefs.get().minOdds, ...opts }));
    return this.slipCache.get(key);
  },
  async detail(e) {
    return { lineups: await fetchLineups(e).catch(() => null), injuries: [] };
  },
};
bind(state);
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
  softRender(); refreshSlip();
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
      if (!d.demo) { d = { ...d, events: overlayLive(d.events, state.events) }; lastSig = ''; setData(d); lastSig = sigOf(state.events); softRender(); refreshSlip(); }
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
  return { name, v: (name === 'stake' ? (() => stakeView(state.stake, state.events)) : views[name] || legalViews[name] || trackViews[name] || views.notfound)(args.map(decodeURIComponent)) };
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
  countUp(app);
  magnetic(app);
  calc();
  v.after?.();
  current = name;
  dock();
  if (name === 'match') { lcHtml = ''; tickLiveCenter(); }
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
  const label = { stake: 'Stake odds', edge: 'Edge board', x: 'Multipliers', mega: 'Mega bets', bankers: 'Bankers' }[name];
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
  const label = { stake: 'STAKE ODDS', home: 'DASHBOARD', sports: 'ALL SPORTS', sport: 'SPORT', league: 'LEAGUE', match: 'MATCH DOSSIER', edge: 'EDGE BOARD', x: 'MULTIPLIERS', mega: 'MEGA BETS', bankers: 'BANKERS' }[name] || '';
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
  app.innerHTML = v.html;
  app.querySelectorAll('details > summary').forEach((s) => { if (open.includes(s.textContent)) s.parentElement.open = true; });
  app.querySelectorAll('.reveal, .grow, .grow-y, .draw').forEach((el) => el.classList.add('in'));
  app.querySelectorAll('.ch').forEach((el) => { el.style.opacity = 1; });
  app.querySelectorAll('[data-count-to]').forEach((el) => { el.textContent = el.dataset.countTo; });
  calc();
  v.after?.();
  scrollTo({ top: y, behavior: 'instant' });
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
    <ul class="slip-legs">${slip.legs.map((l) => `<li><span>${sportOf(l.sport).icon}</span><div><b>${esc(l.pick)}</b><small>${esc(l.market)} · ${esc(l.match)}</small>${l.derived ? '<small class="warn">ATLAS fair price, not a bookmaker quote</small>' : ''}${staleNote(l)}</div><em>${odd(l.odds)}</em><button data-unleg="${esc(l.key)}" aria-label="Remove">×</button></li>`).join('')}</ul>
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
function ticker() {
  const el = document.querySelector('.ticker-track');
  if (!el) return;
  const live = state.events.filter((e) => e.live).map((e) => `<span><i class="live">●</i> ${esc(e.home)} <b>${esc(e.score || '')}</b> ${esc(e.away)} <small>${esc(e.clock || '')}</small></span>`);
  const picks = bankers(state.events, { limit: 10 }).map((b) => `<span>${sportOf(b.event.sport).icon} ${esc(b.pick)} <b>${odd(b.odds)}</b> <small>${pc(b.p, 0)}</small></span>`);
  const next = [...state.events].filter((e) => !e.live).sort((a, b) => a.start - b.start).slice(0, 10).map((e) => `<span>${sportOf(e.sport).icon} ${esc(e.home)} v ${esc(e.away)}</span>`);
  const items = [...live, ...picks, ...next];
  el.innerHTML = items.length ? items.join('') + items.join('') : '<span>ATLAS · connecting feeds</span>';
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
  else if (d.watch) { const on = watch.toggle(d.watch); t.classList.toggle('on', on); t.setAttribute('aria-pressed', on); t.textContent = on ? '★ Watching' : '☆ Watch match'; }
  else if (d.pref) { e.preventDefault(); const p = prefs.get(); const v = d.value;
    if (d.pref === 'minOdds') prefs.set({ minOdds: Number(v) });
    else if (d.pref === 'sport') prefs.set({ sports: v === 'all' ? [] : p.sports.includes(v) ? p.sports.filter((x) => x !== v) : [...p.sports, v] });
    else if (d.pref === 'priced') prefs.set({ pricedOnly: !p.pricedOnly });
    state.slipCache.clear(); softRender(); }
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openSlip(false); });

// Clocks: countdowns + "updated Xs ago".
setInterval(() => {
  document.querySelectorAll('[data-start]').forEach((el) => { el.textContent = countdown(Number(el.dataset.start)); });
  const s = Math.max(0, Math.round((Date.now() - (state.fetchedAt || Date.now())) / 1000));
  document.querySelectorAll('[data-ago]').forEach((el) => { el.textContent = s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`; });
}, 1000);

// Header compacts on scroll, hides while scrolling down.
let lastY = 0;
addEventListener('scroll', () => {
  document.body.classList.toggle('scrolled', scrollY > 40);
  document.body.classList.toggle('hide-bar', scrollY > lastY && scrollY > 400);
  lastY = scrollY;
}, { passive: true });

// Installable app: service worker (deployed site only) and an "Install app" button where supported.
if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => setTimeout(() => navigator.serviceWorker.register('sw.js').catch(() => {}), 3000));
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
  scene.pulse();
  state.ai = mountAssistant(state);
  // Catch up on live scores straight away (the snapshot can be minutes old), then keep polling.
  poll().finally(function tick() { setTimeout(() => poll().finally(tick), refreshMs()); });
  addEventListener('visibilitychange', () => { if (!document.hidden) poll(); }); // back on the tab: catch up now
});

// Separate feed and timestamps: score refreshes never make Stake prices look newer.
let stakeLoading = false;
async function refreshStakeFeed() {
  if (stakeLoading) return; stakeLoading = true;
  try { state.stake = await loadStakeFeed(); if (current === 'stake' || current === 'match') softRender(); } finally { stakeLoading = false; }
}
refreshStakeFeed();
setInterval(() => { if (!document.hidden) refreshStakeFeed(); }, 60000);
