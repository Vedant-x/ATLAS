import { createScene } from './scene.js';
import { SPORTS, loadEvents } from './data.js';
import { buildSlips, devig, pct } from './engine.js';

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
const time = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const formChips = (f) => f.map((x) => `<i class="f f-${x}">${x}</i>`).join('');

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
    ${state.demo ? '— odds are simulated. Plug a feed into <code>data/odds.json</code> for real prices.' : ''}
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
      </section>
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
    const lu = (side) => e.lineups[side]
      ? `<ol class="lineup">${e.lineups[side].map((p) => `<li class="${p.status}"><span>${p.pos}</span>${esc(p.name)}<em>${p.rating}</em></li>`).join('')}</ol>`
      : '<p class="muted">Individual sport — no lineup.</p>';
    return `
      <section class="hero small">
        <p class="kicker reveal">${esc(e.league)} · ${e.live ? '<span class="pulse">LIVE</span>' : time(e.start)}</p>
        <h1 class="vs">${split(e.home.toUpperCase())}<br><small>VS</small><br>${split(e.away.toUpperCase())}</h1>
      </section>
      ${banner()}
      <section class="grid two">
        <div class="panel tilt reveal"><h3>Form (last 5)</h3>
          <p>${esc(e.home)} ${formChips(e.stats.homeForm)}</p>
          <p>${esc(e.away)} ${formChips(e.stats.awayForm)}</p>
          <h3>Head to head</h3>
          <p class="h2h"><b>${e.stats.h2h.home}</b> ${esc(e.home)} · <b>${e.stats.h2h.draw}</b> draws · <b>${e.stats.h2h.away}</b> ${esc(e.away)}</p>
          <h3>Rating</h3><p>${e.stats.homeRating} — ${e.stats.awayRating}</p>
        </div>
        <div class="panel tilt reveal"><h3>Markets</h3>
          ${e.markets.map((m) => {
            const d = devig(m);
            return `<div class="mkt"><h4>${esc(m.name)} <small>margin ${(d.margin * 100).toFixed(1)}%</small></h4>
              ${d.outcomes.map((o) => `<div class="out"><span>${esc(o.name)}</span><div class="meter"><i style="width:${o.fair * 100}%"></i></div><b>${o.odds.toFixed(2)}</b><small>${pct(o.fair)}</small></div>`).join('')}</div>`;
          }).join('')}
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

  notfound() {
    return `<section class="hero"><h1>${split('404')}</h1><p class="reveal"><a href="#/">Back to dashboard</a></p></section>`;
  },
};

function row(e) {
  const s = sportOf(e.sport);
  const main = e.markets[0];
  return `<a class="row tilt reveal" href="#/match/${e.id}" style="--c:${s.color}">
    <span class="ico">${s.icon}</span>
    <div class="teams"><b>${esc(e.home)}</b><b>${esc(e.away)}</b><small>${esc(e.league)} · ${e.live ? '<span class="pulse">LIVE</span>' : time(e.start)}</small></div>
    <div class="odds">${main.outcomes.map((o) => `<span><small>${esc(o.name === 'Draw' ? 'X' : o.name.slice(0, 3))}</small>${o.odds.toFixed(2)}</span>`).join('')}</div>
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

loadEvents().then((d) => {
  Object.assign(state, d);
  addEventListener('hashchange', route);
  route();
  document.body.classList.add('ready');
});
