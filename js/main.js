import { createScene } from './scene.js';
import { SPORTS, loadEvents } from './data.js';
import { buildSlips, devig, pct } from './engine.js';
import { applyModel, bankers, valueSpots } from './intel.js';
import { fetchLineups } from './espn.js';
import { lineupsFromDetail } from './feed.js';

// Live refresh interval. The ATLAS server caches feeds for 60 s, so polling it faster gains nothing;
// direct ESPN mode refreshes every 5 s.
const refreshMs = () => (state.server ? 30000 : 5000);

const app = document.getElementById('app');
const scene = createScene(document.getElementById('bg'));
const setAccent = scene.setAccent;
scene.setAccent = (hex) => {
  setAccent(hex);
  document.documentElement.style.setProperty('--accent', hex);
};
const gsap = window.gsap;
const state = { events: [], source: 'demo', demo: true };
const slipCache = new Map();
const slips = (target, opts) => {
  if (!slipCache.has(target)) slipCache.set(target, buildSlips(state.events, target, opts));
  return slipCache.get(target);
};

const sportOf = (id) => SPORTS.find((s) => s.id === id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const safeHref = (u) => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '#');
const time = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const formChips = (f) => (f || []).map((x) => `<i class="f f-${x}">${x}</i>`).join('');

// Split headline text into per-letter spans for the "movie title" reveal.
const split = (text) =>
  text.split(' ').map((w) =>
    `<span class="word">${[...w].map((c) => `<span class="ch">${esc(c)}</span>`).join('')}</span>`).join(' ');

function animateIn() {
  scene.pulse();
  if (!gsap) return;
  gsap.fromTo('.ch', { yPercent: 120, rotateX: -90, opacity: 0 },
    { yPercent: 0, rotateX: 0, opacity: 1, duration: 1, stagger: 0.025, ease: 'expo.out' });
  gsap.fromTo('.reveal', { y: 60, opacity: 0, rotateX: 12, transformPerspective: 900 },
    { y: 0, opacity: 1, rotateX: 0, duration: 0.9, stagger: 0.05, ease: 'power4.out', delay: 0.15 });
}

// 3D tilt on hover for every card.
document.addEventListener('pointermove', (e) => {
  const card = e.target.closest?.('.tilt');
  document.querySelectorAll('.tilt.on').forEach((c) => {
    if (c !== card) { c.classList.remove('on'); c.style.transform = ''; }
  });
  if (!card) return;
  const r = card.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  card.classList.add('on');
  card.style.transform = `perspective(900px) rotateY(${x * 12}deg) rotateX(${-y * 12}deg) translateZ(10px)`;
  card.style.setProperty('--mx', `${(x + 0.5) * 100}%`);
  card.style.setProperty('--my', `${(y + 0.5) * 100}%`);
});

const banner = () => `
  <div class="notice reveal">
    <b>${state.demo ? 'DEMO DATA' : `Source: ${esc(state.source)}`}</b>
    ${state.demo ? '— live sources unreachable, odds are simulated.' : `· updated <span data-ago>${ago()}</span> · ${oddsNote()}`}
    Hit-rate shown is the market's own probability with the bookmaker margin removed — no tool can make a 2x+ slip win 90% of the time.
  </div>`;

function slipCard(s, i, target) {
  return `
    <article class="slip tilt reveal">
      <header>
        <span class="tag">#${i + 1}</span>
        <span class="mult">${s.odds.toFixed(2)}x</span>
      </header>
      <ul>${s.legs.map((l) => `
        <li>
          <span class="sp">${sportOf(l.sport)?.icon ?? ''}</span>
          <div><b>${esc(l.pick)}</b><small>${esc(l.market)} · ${esc(l.match)}</small></div>
          <em>${l.odds.toFixed(2)}</em>
        </li>`).join('')}
      </ul>
      <footer>
        <div class="meter"><i style="width:${Math.min(100, s.p * 100 * (target >= 100 ? 50 : 1))}%"></i></div>
        <span>Win chance <b>${pct(s.p)}</b></span>
        <span>${s.legs.length} leg${s.legs.length > 1 ? 's' : ''}</span>
      </footer>
    </article>`;
}

const views = {
  home() {
    const live = state.events.filter((e) => e.live).length;
    return `
      <section class="hero">
        <p class="kicker reveal">ATLAS / SPORTS INTELLIGENCE</p>
        <h1>${split('EVERY SPORT.')}<br>${split('EVERY EDGE.')}</h1>
        <div class="stats reveal">
          <div><b>${state.events.length}</b><span>events</span></div>
          <div><b>${SPORTS.length}</b><span>sports</span></div>
          <div><b class="pulse">${live}</b><span>live now</span></div>
        </div>
      </section>
      ${banner()}
      <h2 class="sec reveal">Sports</h2>
      <section class="grid sports">
        ${SPORTS.map((s) => {
          const n = state.events.filter((e) => e.sport === s.id).length;
          return `<a class="sport tilt reveal" href="#/sport/${s.id}" style="--c:${s.color}">
            <span class="ico">${s.icon}</span><b>${s.name}</b><small>${n} events</small></a>`;
        }).join('')}
      </section>
      <h2 class="sec reveal">Multipliers</h2>
      <section class="grid xs">
        ${[2, 3, 4, 5].map((x) => `<a class="xcard tilt reveal" href="#/x/${x}"><b>${x}x</b><small>5 slips</small></a>`).join('')}
        <a class="xcard mega tilt reveal" href="#/mega"><b>100x+</b><small>Mega bets</small></a>
        <a class="xcard bank tilt reveal" href="#/bankers"><b>70%+</b><small>Bankers · easy-win radar</small></a>
      </section>
      ${state.news?.length ? `<h2 class="sec reveal">Headlines</h2>
      <section class="grid news">${state.news.slice(0, 6).map((n) => `<a class="newsc tilt reveal" href="${safeHref(n.url)}" target="_blank" rel="noopener noreferrer"><small>${esc(n.sport)} · ${esc(n.source)}</small><b>${esc(n.title)}</b></a>`).join('')}</section>` : ''}
      <h2 class="sec reveal">Up next</h2>
      <section class="list">${[...state.events].sort((a, b) => a.start - b.start).slice(0, 8).map(row).join('')}</section>`;
  },

  sport([id]) {
    const s = sportOf(id);
    if (!s) return views.notfound();
    scene.setAccent(s.color);
    const evs = state.events.filter((e) => e.sport === id).sort((a, b) => a.start - b.start);
    return `
      <section class="hero small"><p class="kicker reveal">${esc(evs[0]?.league ?? '')}</p>
        <h1>${split(s.name.toUpperCase())}</h1></section>
      ${banner()}
      <section class="list">${evs.map(row).join('')}</section>`;
  },

  match([id]) {
    const e = state.events.find((x) => x.id === id);
    if (!e) return views.notfound();
    scene.setAccent(sportOf(e.sport).color);
    if (e.lineups === null && !e.lineupsRequested) {
      e.lineupsRequested = true;
      (e.apiId
        ? fetch(`api/event?id=${encodeURIComponent(e.apiId)}`).then((r) => r.json()).then((d) => lineupsFromDetail(d, e))
        : fetchLineups(e)).then((l) => { if (l) { e.lineups = l; rerender(); } }).catch(() => {});
    }
    const lu = (side) => e.lineups?.[side]
      ? `<ol class="lineup">${e.lineups[side].map((p) => `<li class="${p.status}"><span>${esc(p.pos)}</span>${esc(p.name)}<em>${esc(p.rating)}</em></li>`).join('')}</ol>`
      : `<p class="muted">${['tennis', 'mma'].includes(e.sport) ? 'Individual sport, no lineup.' : 'Lineups appear about an hour before start.'}</p>`;
    const st = e.stats || {};
    return `
      <section class="hero small">
        <p class="kicker reveal">${esc(e.league)} · ${e.live ? `<span class="pulse">LIVE</span> ${esc(e.score || '')} ${esc(e.clock || '')}` : time(e.start)}${e.bookmaker ? ` · odds: ${esc(e.bookmaker)}` : ''}</p>
        <h1 class="vs">${split(e.home.toUpperCase())}<br><small>VS</small><br>${split(e.away.toUpperCase())}</h1>
      </section>
      ${banner()}
      <section class="grid two">
        <div class="panel tilt reveal"><h3>Form (last 5)</h3>
          <p>${esc(e.home)} ${formChips(st.homeForm) || '<span class="muted">n/a</span>'}</p>
          <p>${esc(e.away)} ${formChips(st.awayForm) || '<span class="muted">n/a</span>'}</p>
          ${st.homeRecord || st.awayRecord ? `<h3>Season record</h3><p>${esc(e.home)} <b>${esc(st.homeRecord || '–')}</b> · ${esc(e.away)} <b>${esc(st.awayRecord || '–')}</b></p>` : ''}
          ${st.h2h ? `<h3>Head to head</h3>
          <p class="h2h"><b>${st.h2h.home}</b> ${esc(e.home)} · <b>${st.h2h.draw}</b> draws · <b>${st.h2h.away}</b> ${esc(e.away)}</p>` : ''}
          ${st.homeRating ? `<h3>Rating</h3><p>${st.homeRating} — ${st.awayRating}</p>` : ''}
          ${st.starters?.length ? `<h3>Probable starters</h3>${st.starters.map((x) => `<p>${esc(x)}</p>`).join('')}` : ''}
          ${e.source ? `<h3>Source</h3><p>${e.sourceUrl ? `<a href="${safeHref(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(e.source)} ↗</a>` : esc(e.source)}${e.official ? ' · official' : ''}${e.stale ? ' · <span class="pulse">stale</span>' : ''}</p>` : ''}
        </div>
        <div class="panel tilt reveal"><h3>Markets</h3>
          ${e.markets.map((m) => {
            const d = devig(m);
            return `<div class="mkt"><h4>${esc(m.name)} <small>margin ${(d.margin * 100).toFixed(1)}%</small></h4>
              ${d.outcomes.map((o) => `<div class="out"><span>${esc(o.name)}</span><div class="meter"><i style="width:${(o.model ?? o.fair) * 100}%"></i></div><b>${o.odds.toFixed(2)}</b><small title="${o.model != null ? `market ${pct(o.fair)}` : ''}">${pct(o.model ?? o.fair)}</small></div>`).join('')}</div>`;
          }).join('') || '<p class="muted">No odds posted yet.</p>'}
        </div>
        <div class="panel tilt reveal"><h3>${esc(e.home)} lineup</h3>${lu('home')}</div>
        <div class="panel tilt reveal"><h3>${esc(e.away)} lineup</h3>${lu('away')}</div>
      </section>`;
  },

  x([n]) {
    const target = Number(n);
    if (![2, 3, 4, 5].includes(target)) return views.notfound();
    scene.setAccent(['#d2ff00', '#00ffc3', '#4fd1ff', '#b08cff'][target - 2]);
    const list = slips(target, { count: 5, maxLegs: 3, tolerance: 0.08 });
    return `
      <section class="hero small"><p class="kicker reveal">MULTIPLIER</p><h1>${split(`${target}X SLIPS`)}</h1>
        <nav class="tabs reveal">${[2, 3, 4, 5].map((x) => `<a href="#/x/${x}" class="${x === target ? 'on' : ''}">${x}x</a>`).join('')}</nav>
      </section>
      ${banner()}
      <section class="grid slips">${list.map((s, i) => slipCard(s, i, target)).join('') || '<p class="muted">Not enough events.</p>'}</section>`;
  },

  mega() {
    scene.setAccent('#ff3d6e');
    const tiers = [100, 500];
    return `
      <section class="hero small"><p class="kicker reveal">ONCE IN A LIFETIME</p><h1>${split('MEGA BETS')}</h1></section>
      ${banner()}
      ${tiers.map((t) => `
        <h2 class="sec reveal">${t}x</h2>
        <section class="grid slips">${slips(t, { count: 4, maxLegs: 8, tolerance: 0.15 }).map((s, i) => slipCard(s, i, t)).join('')}</section>`).join('')}`;
  },

  bankers() {
    scene.setAccent('#00ffc3');
    const list = bankers(state.events);
    const value = valueSpots(state.events);
    const card = (b) => {
      const s = sportOf(b.event.sport);
      return `<a class="row tilt reveal" href="#/match/${b.event.id}" style="--c:${s.color}">
        <span class="ico">${s.icon}</span>
        <div class="teams"><b>${esc(b.pick)}</b><small>${esc(b.market)} · ${esc(b.event.home)} vs ${esc(b.event.away)} · ${esc(b.event.league)} · ${b.event.live ? '<span class="pulse">LIVE</span>' : time(b.event.start)}</small></div>
        <div class="odds"><span><small>odds</small>${b.odds.toFixed(2)}</span><span class="hot"><small>chance</small>${pct(b.p)}</span>${b.ev > 0 ? `<span class="hot"><small>edge</small>+${(b.ev * 100).toFixed(1)}%</span>` : ''}</div>
      </a>`;
    };
    return `
      <section class="hero small"><p class="kicker reveal">ATLAS INTELLIGENCE · ALL SPORTS</p><h1>${split('BANKERS')}</h1></section>
      ${banner()}
      <p class="muted reveal">Strongest favourites right now (70%+ chance), ranked by the model: market price blended with season record and recent form. Short odds, so small payouts, and they still lose sometimes.</p>
      <section class="list">${list.map(card).join('') || '<p class="muted">No strong favourites on the board right now.</p>'}</section>
      <h2 class="sec reveal">Value spots</h2>
      <p class="muted reveal">Picks where the model rates a side higher than the bookmaker's price does.</p>
      <section class="list">${value.map(card).join('') || '<p class="muted">No value spots right now.</p>'}</section>`;
  },

  notfound() {
    return `<section class="hero"><h1>${split('404')}</h1><p class="reveal"><a href="#/">Back to dashboard</a></p></section>`;
  },
};

function row(e) {
  const s = sportOf(e.sport);
  const main = e.markets?.[0];
  return `<a class="row tilt reveal" href="#/match/${e.id}" style="--c:${s.color}">
    <span class="ico">${s.icon}</span>
    <div class="teams"><b>${esc(e.home)}</b><b>${esc(e.away)}</b><small>${esc(e.league)} · ${e.live ? `<span class="pulse">LIVE</span> ${esc(e.score || '')}` : time(e.start)}</small></div>
    <div class="odds">${(main?.outcomes || []).map((o) => `<span><small>${esc(o.name === 'Draw' ? 'X' : o.name.slice(0, 3))}</small>${o.odds.toFixed(2)}</span>`).join('')}</div>
  </a>`;
}

function route() {
  const [, name = '', ...args] = (location.hash || '#/').split('/');
  const view = views[name || 'home'] || views.notfound;
  if (!name) scene.setAccent('#d2ff00');
  document.querySelectorAll('nav.top a').forEach((a) =>
    a.classList.toggle('on', a.getAttribute('href').split('/')[1] === name));
  app.innerHTML = view(args);
  scrollTo({ top: 0 });
  animateIn();
}

// Redraw the current page in place with fresh data: no intro animation, scroll kept.
function rerender() {
  const [, name = '', ...args] = (location.hash || '#/').split('/');
  const view = views[name || 'home'] || views.notfound;
  const y = scrollY;
  app.innerHTML = view(args);
  app.querySelectorAll('.reveal, .ch').forEach((el) => { el.style.opacity = 1; });
  scrollTo({ top: y });
}

function oddsNote() {
  if (state.odds?.status === 'connected' || state.odds?.status === 'partial') {
    return `<b>Stake prices live</b> (${state.odds.selections.length} selections). Events without a Stake match show the ESPN reference line.`;
  }
  return `Stake prices not connected (<a href="desk.html#connections">connect</a>): odds shown are the ESPN reference line, not Stake.`;
}

function ago() {
  if (!state.fetchedAt) return 'now';
  const s = Math.round((Date.now() - state.fetchedAt) / 1000);
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

function setData(d) {
  // Keep lineups already fetched for events that are still on the board.
  const old = new Map(state.events.map((e) => [e.id, e]));
  d.events.forEach((e) => { const o = old.get(e.id); if (o?.lineups && !e.lineups) e.lineups = o.lineups; });
  Object.assign(state, d, { events: applyModel(d.events) });
  // Rebuild slips at most once a minute so suggestions don't reshuffle on every refresh.
  if (Date.now() - (state.slipsAt || 0) > 60000) { slipCache.clear(); state.slipsAt = Date.now(); }
}

let polling = false;
async function poll() {
  if (polling || document.hidden || state.demo) return;
  polling = true;
  try {
    const d = await loadEvents();
    if (!d.demo) { setData(d); rerender(); }
  } finally { polling = false; }
}

loadEvents().then((d) => {
  setData(d);
  addEventListener('hashchange', route);
  route();
  document.body.classList.add('ready');
  (function tick() { setTimeout(() => poll().finally(tick), refreshMs()); })();
  setInterval(() => document.querySelectorAll('[data-ago]').forEach((el) => { el.textContent = ago(); }), 1000);
});
