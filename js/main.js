import { createScene } from './scene.js';
import { loadEvents, refreshLive } from './data.js';
import { buildSlips, todayEvents, localDay } from './engine.js';
import { applyModel, bankers } from './intel.js';
import { fetchLineups } from './espn.js';
import { views, bind, legIndex, edgeTable, countdown, esc, sportOf } from './views.js';
import { slip } from './slip.js';
import { preloader, cursor, wipe, magnetic, tilt, countUp, reveal } from './ui.js';
import { pc, odd } from './charts.js';
import { leagueByPath, leagueKey, sportById } from './catalog.js';

const app = document.getElementById('app');
// Effects switch: the 3D background can be turned off (remembered per device, or ?lite in the URL).
const fxOff = (() => { try { return /[?&]lite\b/.test(location.search) || localStorage.getItem('atlas-fx') === 'off'; } catch { return false; } })();
const bg = document.getElementById('bg');
const scene = fxOff ? (bg.classList.add('no-webgl'), { setMode() {}, setAccent() {}, pulse() {}, ok: false }) : createScene(bg);
document.querySelectorAll('[data-fx-toggle]').forEach((b) => { b.setAttribute('aria-pressed', String(!fxOff)); b.querySelector('b').textContent = fxOff ? 'OFF' : 'ON'; });

const state = {
  events: [], source: 'demo', demo: true, news: [], odds: null, fetchedAt: 0,
  slipCache: new Map(), slipsAt: 0,
  // opts.today: only matches still to start today (local time); cached per day so midnight rolls over.
  slips(target, opts = {}) {
    const key = `${target}|${opts.today ? localDay() : 'all'}`;
    if (!this.slipCache.has(key)) this.slipCache.set(key, buildSlips(opts.today ? todayEvents(this.events) : this.events, target, opts));
    return this.slipCache.get(key);
  },
  async detail(e) {
    return { lineups: await fetchLineups(e).catch(() => null), injuries: [] };
  },
};
bind(state);
state.refresh = () => softRender();

// ---------- data ----------
function setData(d) {
  Object.assign(state, d, { events: applyModel(d.events) });
  if (Date.now() - state.slipsAt > 60000) { state.slipCache.clear(); state.slipsAt = Date.now(); }
  ticker();
}
// Snapshot mode: refresh live/imminent leagues straight from ESPN every 20 s, and reload the
// full index every 10 min. Without a snapshot (local preview) poll ESPN every 5 s.
const refreshMs = () => (state.snapshot ? 20000 : 5000);
let polling = false, lastIndex = Date.now();
async function poll() {
  if (polling || document.hidden || state.demo) return;
  polling = true;
  try {
    if (state.snapshot && Date.now() - lastIndex < 600000) {
      const merged = await refreshLive(state.events).catch(() => null);
      if (merged) { setData({ ...state, events: merged, fetchedAt: Date.now() }); softRender(); }
    } else {
      const d = await loadEvents();
      lastIndex = Date.now();
      if (!d.demo) { setData(d); softRender(); }
    }
  } finally { polling = false; }
}

// ---------- routing ----------
const parse = () => { const [, name = '', ...args] = (location.hash || '#/').split('/'); return { name: name || 'home', args }; };
let current = null;

function build() {
  const { name, args } = parse();
  legIndex.clear();
  return { name, v: (views[name] || views.notfound)(args.map(decodeURIComponent)) };
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
  const label = { edge: 'Edge board', x: 'Multipliers', mega: 'Mega bets', bankers: 'Bankers' }[name];
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
  const label = { home: 'DASHBOARD', sports: 'ALL SPORTS', sport: 'SPORT', league: 'LEAGUE', match: 'MATCH DOSSIER', edge: 'EDGE BOARD', x: 'MULTIPLIERS', mega: 'MEGA BETS', bankers: 'BANKERS' }[name] || '';
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
  const { v } = build();
  app.innerHTML = v.html;
  app.querySelectorAll('.reveal, .grow, .grow-y, .draw').forEach((el) => el.classList.add('in'));
  app.querySelectorAll('.ch').forEach((el) => { el.style.opacity = 1; });
  app.querySelectorAll('[data-count-to]').forEach((el) => { el.textContent = el.dataset.countTo; });
  calc();
  v.after?.();
  scrollTo({ top: y, behavior: 'instant' });
}

// ---------- slip drawer ----------
const drawer = document.getElementById('slip');
function renderSlip() {
  const s = slip.summary();
  document.querySelectorAll('[data-slip-count]').forEach((el) => { el.textContent = s.n; el.classList.toggle('has', s.n > 0); });
  drawer.querySelector('.slip-body').innerHTML = s.n ? `
    <ul class="slip-legs">${slip.legs.map((l) => `<li><span>${sportOf(l.sport).icon}</span><div><b>${esc(l.pick)}</b><small>${esc(l.market)} · ${esc(l.match)}</small>${l.derived ? '<small class="warn">ATLAS fair price, not a bookmaker quote</small>' : ''}</div><em>${odd(l.odds)}</em><button data-unleg="${esc(l.key)}" aria-label="Remove">×</button></li>`).join('')}</ul>
    ${s.correlated ? '<p class="warn">Two legs from the same match are correlated: the true combined chance differs from the product shown, and bookmakers may refuse the combination.</p>' : ''}
    <div class="slip-sum">
      <div><small>Total odds</small><b>${s.odds.toFixed(2)}x</b></div>
      <div><small>Win chance</small><b>${pc(s.p, s.p < 0.01 ? 2 : 1)}</b></div>
      <div><small>Edge</small><b class="${s.ev >= 0 ? 'pos' : 'neg'}">${(s.ev * 100).toFixed(1)}%</b></div>
      <label><small>Stake</small><input type="number" min="0" step="1" value="${slip.stake}" data-slip-stake></label>
      <div><small>Potential return</small><b data-sum-pay>${s.payout.toFixed(2)}</b></div>
      <div><small>Expected return</small><b data-sum-exp>${(slip.stake * s.p * s.odds).toFixed(2)}</b></div>
    </div>
    <div class="slip-actions"><button class="btn" data-slip-copy>Copy slip</button><button class="btn-ghost" data-slip-clear>Clear</button></div>`
    : '<p class="muted">Tap any price to add it here. ATLAS shows the combined odds, true win chance and edge as you build.</p>';
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
  else if ('fxToggle' in d) { try { localStorage.setItem('atlas-fx', fxOff ? 'on' : 'off'); } catch { /* storage blocked */ } if (/[?&]lite\b/.test(location.search)) location.search = ''; else location.reload(); }
  else if ('navBack' in d) { if (stack.length > 1) history.back(); else { replacing = true; location.replace(parentOf()); } }
  else if (d.jump) { e.preventDefault(); document.getElementById(d.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  else if (d.league !== undefined && t.classList.contains('chip')) {
    app.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === t));
    app.querySelectorAll('#sport-list [data-lg]').forEach((r) => { r.hidden = !!d.league && r.dataset.lg !== d.league; });
  }
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

// ---------- boot ----------
cursor();
tilt();
renderSlip();
preloader(loadEvents()).then((d) => {
  setData(d);
  render(true);
  addEventListener('hashchange', route);
  scene.pulse();
  (function tick() { setTimeout(() => poll().finally(tick), refreshMs()); })();
});
