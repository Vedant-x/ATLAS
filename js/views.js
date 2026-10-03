// Page templates. Each view returns { html, mode, accent, sceneOpts?, title, after? }.
import { SPORTS } from './data.js';
import { devig, buildSlips, todayEvents } from './engine.js';
import { bankers, valueSpots, applyModel } from './intel.js';
import { analyse, winProbs, kelly } from './models.js';
import { probBar, gauge, heatmap, distBars, formStrip, outcomeBars, valueTrack, pc, odd } from './charts.js';
import { split } from './ui.js';
import { slip } from './slip.js';
import { CATALOG, sportById, leagueByPath, leagueKey, leagueFromKey } from './catalog.js';
import { detailFor, loadDetail as fetchDetail } from './detail.js';
import { dossierSections } from './dossier.js';
import { fetchAll, LEAGUES } from './espn.js';
import { prefs, prefEvents } from './prefs.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const safeHref = (u) => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '#');
const safeColor = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : fallback);
export const sportOf = (id) => SPORTS.find((s) => s.id === id) || { id, name: id, icon: '◆', color: '#d2ff00' };

const AWAY_COLOR = '#ff3d6e';
const DRAW_COLOR = '#8b8b92';

// ---------- shared state handed in by main.js ----------
let S;
export const legIndex = new Map();
export function bind(state) { S = state; }

const analysisCache = new Map();
export function analysisFor(e) {
  const sig = JSON.stringify(e.markets) + JSON.stringify(e.stats) + JSON.stringify(e.predictor || null);
  const hit = analysisCache.get(e.id);
  if (hit && hit.sig === sig) return hit.a;
  const a = analyse(e);
  analysisCache.set(e.id, { sig, a });
  return a;
}

function legButton(leg, label) {
  legIndex.set(leg.key, leg);
  const on = slip.has(leg.key);
  return `<button class="leg ${on ? 'on' : ''}" data-leg="${esc(leg.key)}" data-cursor="${on ? 'REMOVE' : 'ADD'}">${label}</button>`;
}
const bookLeg = (e, m, o, p) => ({ key: `${e.id}|${m.name}|${o.name}`, eventId: e.id, sport: e.sport, match: `${e.home} vs ${e.away}`, market: m.name, pick: o.name, odds: o.odds, p, derived: false });
const fairLeg = (e, m, o) => ({ key: `${e.id}|fair|${m.name}|${o.name}`, eventId: e.id, sport: e.sport, match: `${e.home} vs ${e.away}`, market: m.name, pick: o.name, odds: +o.fair.toFixed(2), p: o.p, derived: true });

// "12m ago" style age; class says how fresh it is.
const ago = (t) => { if (!t) return 'unknown'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const freshClass = (t) => (!t ? 'stale' : Date.now() - t < 30 * 6e4 ? 'fresh' : Date.now() - t < 2 * 36e5 ? 'aging' : 'stale');

// Personal filters bar (min odds, sports, priced only), saved per browser.
function prefsBar() {
  const p = prefs.get();
  const sports = SPORTS.filter((s) => S.events.some((e) => e.sport === s.id));
  return `<div class="prefs reveal"><span class="pl">Min odds</span>${[1.1, 1.2, 1.3, 1.5, 1.8].map((o) => `<button class="pchip ${p.minOdds === o ? 'on' : ''}" data-pref="minOdds" data-value="${o}">${o.toFixed(2)}</button>`).join('')}
    <span class="pl">Sports</span><button class="pchip ${p.sports.length ? '' : 'on'}" data-pref="sport" data-value="all">All</button>${sports.map((s) => `<button class="pchip ${p.sports.includes(s.id) ? 'on' : ''}" data-pref="sport" data-value="${s.id}" title="${esc(s.name)}">${s.icon}</button>`).join('')}
    <button class="pchip ${p.pricedOnly ? 'on' : ''}" data-pref="priced" data-value="1">Bookmaker-priced only</button></div>`;
}
const prefFilter = (list) => { const p = prefs.get(); const ev = prefEvents(list); return p.pricedOnly ? ev.filter((e) => e.markets?.length) : ev; };

const when = (e) => (e.live ? `<span class="live">LIVE${e.score ? ` · ${esc(e.score)}` : ''}</span>` : `<span data-start="${e.start}">${countdown(e.start)}</span>`);
export function countdown(ms) {
  const d = ms - Date.now();
  if (!Number.isFinite(d)) return 'TBC';
  if (d <= 0) return 'Starting';
  const h = Math.floor(d / 3.6e6), m = Math.floor((d % 3.6e6) / 6e4), s = Math.floor((d % 6e4) / 1000);
  if (h >= 48) return new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${h ? h + 'h ' : ''}${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}
const confBadge = (c) => `<span class="conf conf-${c}" title="${c === 'high' ? 'From bookmaker prices' : c === 'medium' ? 'ATLAS model from records/form' : 'Baseline only: little data'}">${c === 'high' ? 'MARKET' : c === 'medium' ? 'MODEL' : 'BASELINE'}</span>`;

// Status box removed from pages; it only appears when live feeds failed and sample data is shown.
function notice() {
  return S.demo ? '<div class="notice reveal"><span class="led"></span><b>DEMO DATA</b> · live feeds unreachable, prices are simulated.</div>' : '';
}

// ---------- rows & cards ----------
// ---------- tennis: tournament → draw (singles/doubles) → round ----------
const seedTag = (x) => (x?.seed ? ` <i class="seed">[${esc(x.seed)}]</i>` : '');
const tennisLine = (t) => [t.tournament, t.location, t.drawName, t.round, t.court].filter(Boolean).join(' · ');
const slugId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
const DRAWS = ['Singles', 'Doubles', 'Mixed doubles'];
const span = (a, b) => { const f = (v) => new Date(v).toLocaleDateString([], { day: 'numeric', month: 'short' }); return a && b ? `${f(a)} – ${f(Date.parse(b) - 1)}` : ''; };

function tournamentsOf(list) {
  const m = new Map();
  for (const e of list) {
    const t = e.tennis;
    if (!t) continue;
    const k = t.tournamentId || t.tournament;
    if (!m.has(k)) m.set(k, { id: slugId(`${e.leaguePath}-${k}`), name: t.tournament, location: t.location, major: t.major, from: t.from, to: t.to, tour: e.league, events: [] });
    m.get(k).events.push(e);
  }
  return [...m.values()].sort((a, b) => b.major - a.major || b.events.filter((e) => e.live).length - a.events.filter((e) => e.live).length || b.events.length - a.events.length);
}

function tournamentBlock(t) {
  const draws = DRAWS.map((d) => [d, t.events.filter((e) => e.tennis.draw === d)]).filter(([, evs]) => evs.length);
  const live = t.events.filter((e) => e.live).length;
  return `<section class="tourney reveal" id="${esc(t.id)}">
    <header class="tourney-head"><div><h2>${esc(t.name)}${t.major ? ' <span class="badge-slam">GRAND SLAM</span>' : ''}</h2>
      <p>📍 ${esc(t.location || 'Venue TBA')}${t.from ? ` · ${esc(span(t.from, t.to))}` : ''} · ${esc(t.tour)}</p></div>
      <div class="tourney-meta">${draws.map(([d, evs]) => `<span><b>${evs.length}</b>${esc(d)}</span>`).join('')}${live ? `<span class="live"><b>${live}</b>Live</span>` : ''}</div></header>
    ${draws.map(([d, evs]) => {
      const rounds = new Map();
      [...evs].sort((a, b) => (b.live - a.live) || a.tennis.roundId - b.tennis.roundId || a.start - b.start).forEach((e) => { const r = e.tennis.round || 'Matches'; if (!rounds.has(r)) rounds.set(r, []); rounds.get(r).push(e); });
      return `<div class="tdraw"><h3 class="draw-title"><span>${d === 'Singles' ? '👤' : '👥'}</span>${esc(evs[0].tennis.drawName || d)} <small>${evs.length} match${evs.length > 1 ? 'es' : ''}</small></h3>
        ${[...rounds.entries()].map(([r, list]) => `<h4 class="round-title">${esc(r)}</h4><section class="list">${list.map((e) => eventRow(e, true)).join('')}</section>`).join('')}</div>`;
    }).join('')}
  </section>`;
}

function tennisBoard(list) {
  const ts = tournamentsOf(list);
  if (!ts.length) return '';
  return `<nav class="subnav reveal" aria-label="Tournaments">${ts.map((t) => `<a href="#${esc(t.id)}" data-jump="${esc(t.id)}">${esc(t.name)} <small>${t.events.length}</small></a>`).join('')}</nav>
    ${ts.map(tournamentBlock).join('')}`;
}

// compact: inside a tournament/draw/round section, so the subtitle only needs court and time.
function eventRow(e, compact = false) {
  const s = sportOf(e.sport), w = winProbs(e);
  const hc = safeColor(e.colors?.home, s.color), ac = safeColor(e.colors?.away, AWAY_COLOR);
  const main = e.markets?.[0];
  const d = main ? devig(main) : null;
  return `<article class="row tilt reveal" style="--c:${s.color}">
    <a class="row-link" href="#/match/${esc(e.id)}" data-cursor="OPEN" aria-label="${esc(e.home)} vs ${esc(e.away)}"></a>
    <span class="ico">${s.icon}</span>
    <div class="teams"><b>${esc(e.home)}${seedTag(e.tennis?.home)}</b><b>${esc(e.away)}${seedTag(e.tennis?.away)}</b><small>${e.tennis ? esc(compact === true ? e.tennis.court || e.tennis.round : tennisLine(e.tennis)) : esc(e.league)} · ${when(e)}</small></div>
    <div class="row-prob">${probBar([{ label: e.home, p: w.home, color: hc }, ...(w.draw ? [{ label: 'Draw', p: w.draw, color: DRAW_COLOR }] : []), { label: e.away, p: w.away, color: ac }])}
      <small><span>${pc(w.home, 0)}</span>${w.draw ? `<span>${pc(w.draw, 0)}</span>` : ''}<span>${pc(w.away, 0)}</span></small></div>
    <div class="odds">${main ? main.outcomes.map((o, i) => legButton(bookLeg(e, main, o, o.model ?? d.outcomes[i].fair), `<small>${esc(o.name === 'Draw' ? 'X' : o.name.split(' ').pop().slice(0, 4))}</small>${odd(o.odds)}`)).join('') : `<span class="nobook">model line</span>`}</div>
    ${confBadge(w.confidence)}
  </article>`;
}

function slipCard(s, i, target) {
  const keys = s.legs.map((l) => {
    const leg = { key: `${l.eventId}|${l.market}|${l.pick}`, eventId: l.eventId, sport: l.sport, match: l.match, market: l.market, pick: l.pick, odds: l.odds, p: l.p };
    legIndex.set(leg.key, leg);
    return leg.key;
  });
  return `<article class="slipc tilt reveal">
    <header><span class="tag">#${String(i + 1).padStart(2, '0')}</span><span class="mult">${s.odds.toFixed(2)}<small>x</small></span></header>
    <ul>${s.legs.map((l) => `<li><span class="sp">${sportOf(l.sport).icon}</span><div><b>${esc(l.pick)}</b><small>${esc(l.market)} · ${esc(l.match)}</small></div><em>${l.odds.toFixed(2)}</em><i>${pc(l.p, 0)}</i></li>`).join('')}</ul>
    <footer>
      <div class="meter"><i class="grow" style="--w:${Math.min(100, s.p * 100 * (target >= 100 ? 40 : 1)).toFixed(1)}%"></i></div>
      <span>Estimated chance <b>${pc(s.p, s.p < 0.01 ? 2 : 1)}</b></span><span>Edge <b class="${s.p * s.odds - 1 >= 0 ? 'pos' : 'neg'}">${((s.p * s.odds - 1) * 100).toFixed(1)}%</b></span>
      <p class="slip-note">${s.p * s.odds - 1 >= 0 ? 'The model rates this combination above its price.' : `Meets the ${target}x payout target, but it is not a value bet: the ${((1 - s.p * s.odds) * 100).toFixed(1)}% shortfall is mostly bookmaker margin, so on average it loses money.`}</p>
      <button class="btn-ghost" data-addall="${esc(keys.join('~'))}" data-cursor="ADD ALL">Add all to slip</button>
    </footer></article>`;
}

// ---------- views ----------
export const views = {
  home() {
    const ev = S.events;
    const live = ev.filter((e) => e.live);
    const upcoming = [...ev].filter((e) => !e.live).sort((a, b) => a.start - b.start);
    const bk = bankers(prefFilter(ev), { limit: 6, minOdds: prefs.get().minOdds });
    const val = valueSpots(prefFilter(ev), { limit: 6, minOdds: prefs.get().minOdds });
    const featured = bk[0]?.event || upcoming[0];
    const modelled = ev.reduce((n, e) => n + (e.markets?.length ? 1 : 0), 0);
    const counts = Object.fromEntries(SPORTS.map((s) => [s.id, ev.filter((e) => e.sport === s.id)]));
    return {
      mode: 'home', accent: '#d2ff00', title: 'Dashboard',
      html: `
      <section class="hero compact">
        <p class="kicker reveal">ATLAS · SPORTS INTELLIGENCE SYSTEM</p>
        <h1>${split('EVERY SPORT. EVERY EDGE.')}</h1>
        <div class="stats reveal">
          <div><b data-count-to="${ev.length}">0</b><span>events tracked</span></div>
          <div><b data-count-to="${modelled}">0</b><span>bookmaker-priced</span></div>
          <div><b class="hot" data-count-to="${live.length}">0</b><span>in play</span></div>
        </div>
      </section>
      ${notice()}
      ${dashboard(ev, live)}
      ${featured ? featuredCard(featured) : ''}
      <section class="sec-block"><h2 class="sec reveal"><span>◆</span>Sports</h2>
        <div class="grid sports">${SPORTS.map((s) => {
          const list = counts[s.id] || [];
          const next = list.filter((e) => !e.live).sort((a, b) => a.start - b.start)[0];
          return `<a class="sport tilt reveal" href="#/sport/${s.id}" style="--c:${s.color}" data-cursor="ENTER"><span class="ico">${s.icon}</span><b>${s.name}</b>
            <small>${list.length} events${list.filter((e) => e.live).length ? ` · <span class="live">${list.filter((e) => e.live).length} live</span>` : ''}</small>
            ${next ? `<small class="next">Next: ${esc(next.home)} v ${esc(next.away)}</small>` : ''}</a>`;
        }).join('')}</div></section>
      <section class="sec-block split2">
        <div><h2 class="sec reveal"><span>◆</span>Bankers</h2><div class="minilist">${bk.map((b) => miniPick(b)).join('') || '<p class="muted">No 70%+ favourites right now.</p>'}</div><a class="more reveal" href="#/bankers">All bankers →</a></div>
        <div><h2 class="sec reveal"><span>◆</span>Value</h2><div class="minilist">${val.map((b) => miniPick(b, true)).join('') || '<p class="muted">No value spots right now.</p>'}</div><a class="more reveal" href="#/edge">Full edge board →</a></div>
      </section>
      <section class="sec-block"><h2 class="sec reveal"><span>◆</span>Multipliers</h2>
        <div class="grid xs">${[2, 3, 4, 5].map((x) => `<a class="xcard tilt reveal" href="#/x/${x}" data-cursor="BUILD"><b>${x}x</b><small>5 slips · ${pc(1 / x, 0)} break-even</small></a>`).join('')}
        <a class="xcard mega tilt reveal" href="#/mega" data-cursor="DARE"><b>100x+</b><small>Mega accumulators</small></a></div></section>
      <section class="sec-block"><h2 class="sec reveal"><span>◆</span>Up next</h2><div class="list">${upcoming.slice(0, 14).map(eventRow).join('')}</div></section>`,
    };
  },

  sports() {
    const by = countBy();
    return {
      mode: 'sport', accent: '#d2ff00', title: 'All sports',
      html: `<section class="hero small"><p class="kicker reveal">${CATALOG.length} SPORTS · ${CATALOG.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.leagues.length, 0), 0)} COMPETITIONS</p><h1>${split('ALL SPORTS')}</h1></section>
        ${notice()}
        <div class="grid sports">${CATALOG.map((sp) => {
          const n = sp.groups.reduce((t, g) => t + g.leagues.reduce((u, l) => u + (by[l.path]?.n || 0), 0), 0);
          const live = sp.groups.reduce((t, g) => t + g.leagues.reduce((u, l) => u + (by[l.path]?.live || 0), 0), 0);
          return `<a class="sport tilt reveal" href="#/sport/${sp.id}" style="--c:${sp.color}" data-cursor="ENTER"><span class="ico">${sp.icon}</span><b>${esc(sp.name)}</b>
            <small>${n} match${n === 1 ? "" : "es"} · ${sp.groups.reduce((t, g) => t + g.leagues.length, 0)} competitions${live ? ` · <span class="live">${live} live</span>` : ''}</small></a>`;
        }).join('')}</div>`,
    };
  },

  sport([id]) {
    const sp = sportById(id);
    if (!sp) return views.notfound();
    const after = () => liveLoad(sp.groups.flatMap((g) => g.leagues.map((l) => l.path)));
    const by = countBy();
    const list = S.events.filter((e) => e.sport === id).sort((a, b) => (b.live - a.live) || a.start - b.start);
    return {
      mode: 'sport', accent: sp.color, title: sp.name, after,
      html: `<section class="hero small"><p class="kicker reveal"><a href="#/sports">ALL SPORTS</a> / ${list.length} MATCHES · ${list.filter((e) => e.live).length} LIVE</p><h1>${split(sp.name.toUpperCase())}</h1></section>
        ${notice()}
        ${sp.groups.map((g) => `<section class="sec-block"><h2 class="sec reveal"><span>${esc(sp.icon)}</span>${esc(g.name)}</h2>
          <div class="grid leagues">${[...g.leagues].sort((x, y) => (by[y.path]?.n || 0) - (by[x.path]?.n || 0)).map((l) => {
            const c = by[l.path] || { n: 0, live: 0 };
            const next = S.events.filter((e) => e.leaguePath === l.path && !e.live).sort((a, b) => a.start - b.start)[0];
            return `<a class="leaguec tilt reveal ${c.n ? '' : 'empty'}" href="#/league/${leagueKey(l.path)}" style="--c:${sp.color}" data-cursor="OPEN"><b>${esc(l.name)}</b>
              <small>${c.n ? `${c.n} match${c.n > 1 ? 'es' : ''}` : 'No fixtures in the next 4 days'}${c.live ? ` · <span class="live">${c.live} live</span>` : ''}</small>
              ${next ? `<em>Next: ${esc(next.home)} v ${esc(next.away)} · <span data-start="${next.start}">${countdown(next.start)}</span></em>` : ''}</a>`;
          }).join('')}</div></section>`).join('')}
        ${id === 'tennis' ? `<h2 class="sec reveal"><span>📍</span>Tournaments this week</h2><div class="grid leagues">${tournamentsOf(list).map((t) => {
          const n = (d) => t.events.filter((e) => e.tennis.draw === d).length;
          return `<a class="leaguec tilt reveal" href="#/league/${leagueKey(t.events[0].leaguePath)}" style="--c:${sp.color}" data-cursor="OPEN"><b>${esc(t.name)}</b>
            <small>📍 ${esc(t.location || 'TBA')} · ${esc(t.tour)}${t.major ? ' · Grand Slam' : ''}</small>
            <em>${n('Singles')} singles · ${n('Doubles') + n('Mixed doubles')} doubles${t.events.some((e) => e.live) ? ` · <span class="live">${t.events.filter((e) => e.live).length} live</span>` : ''}</em></a>`;
        }).join('') || '<p class="muted">No tournaments in the next 4 days.</p>'}</div>` : ''}
        <h2 class="sec reveal"><span>◆</span>Every ${esc(sp.name)} match</h2>
        <section class="list">${list.slice(0, 60).map(eventRow).join('') || '<p class="muted">Nothing scheduled in the next 4 days.</p>'}</section>`,
    };
  },

  league([key]) {
    const l = leagueFromKey(key || '');
    if (!l) return views.notfound();
    const sp = sportById(l.sport);
    const list = S.events.filter((e) => e.leaguePath === l.path).sort((a, b) => (b.live - a.live) || a.start - b.start);
    const days = new Map();
    list.forEach((e) => { const d = e.live ? 'Live now' : new Date(e.start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }); if (!days.has(d)) days.set(d, []); days.get(d).push(e); });
    return {
      mode: 'sport', accent: sp.color, title: l.name,
      after: () => { loadStandings(l); liveLoad([l.path]); },
      html: `<section class="hero small"><p class="kicker reveal"><a href="#/sports">ALL SPORTS</a> / <a href="#/sport/${sp.id}">${esc(sp.name)}</a> / ${esc(l.group)}</p><h1>${split(l.name.toUpperCase())}</h1></section>
        ${notice()}
        ${(l.sport === 'tennis' && tennisBoard(list)) || [...days.entries()].map(([d, evs]) => `<h2 class="sec reveal"><span>${evs.length}</span>${esc(d)}</h2><section class="list">${evs.map(eventRow).join('')}</section>`).join('') || '<p class="muted reveal">No fixtures in the next 4 days.</p>'}
        <section class="sec-block" id="league-standings"></section>`,
    };
  },

  match([id]) {
    const e = S.events.find((x) => x.id === id);
    if (!e) return views.notfound();
    const s = sportOf(e.sport);
    const a = analysisFor(e);
    const hc = safeColor(e.colors?.home, s.color), ac = safeColor(e.colors?.away, AWAY_COLOR === hc ? '#4fd1ff' : AWAY_COLOR);
    const w = a.win, twoWay = !w.draw;
    const main = e.markets?.find((m) => m.name === 'Winner' || m.name === 'Match Result');
    const book = (name) => main?.outcomes.find((o) => o.name === name)?.odds;
    const side = (label, p, color, bookOdds) => {
      const ev = bookOdds ? p * bookOdds - 1 : null;
      return `<div class="side reveal">${gauge(p, color, label)}
        <dl><dt>Fair odds</dt><dd>${odd(1 / p)}</dd>
        <dt>${esc(e.bookmaker?.split(' (')[0] || 'Book')} odds</dt><dd>${bookOdds ? odd(bookOdds) : '<span class="muted">none</span>'}</dd>
        <dt>Edge</dt><dd class="${ev == null ? '' : ev >= 0 ? 'pos' : 'neg'}">${ev == null ? '—' : `${(ev * 100).toFixed(1)}%`}</dd>
        <dt>Kelly ¼</dt><dd>${ev && ev > 0 ? pc(kelly(p, bookOdds) / 4, 1) : '—'}</dd></dl></div>`;
    };
    const paramChips = Object.entries(a.params || {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => `<div><small>${esc(paramLabel(k, a.params.unit))}</small><b>${k === 'setWin' ? pc(v) : Number.isInteger(v) ? v : v.toFixed(2)}</b></div>`).join('');
    const d = detailFor(e.id);
    const dos = dossierSections(e, d, hc, ac);
    const sections = [['overview', 'Overview'], ...dos.map((x) => [x.id, x.label]), ['model', a.kind === 'normal' ? 'Margin model' : a.kind === 'tennis' ? 'Set model' : 'Score model'], ['markets', `All markets (${a.marketCount})`], ['book', 'Bookmaker prices'], ['form', 'Records'], ['calc', 'Calculator'], ['notes', 'Model notes']];
    if (a.kind === 'binary') sections.splice(sections.findIndex((x) => x[0] === 'model'), 1);
    return {
      mode: 'match', accent: hc, title: `${e.home} v ${e.away}`,
      sceneOpts: { home: hc, away: ac, pHome: w.home, pAway: w.away },
      // Fetch the full dossier once, then redraw in place (scroll kept).
      after: () => {
        if (detailFor(e.id)) return;
        fetchDetail(e).finally(() => {
          const det = detailFor(e.id);
          if (det?.predictor && !e.markets?.length) e.predictor = det.predictor;
          S.refresh?.();
        });
      },
      html: `
      <section class="hero match-hero">
        <p class="kicker reveal">${s.icon} ${e.tennis ? esc(`${e.tennis.tournament} · ${e.tennis.drawName}`) : esc(e.league)} · ${when(e)} · ${e.bookmaker ? esc(e.bookmaker) : e.markets?.length ? 'bookmaker price' : 'no bookmaker price'} ${confBadge(a.confidence)}</p>
        <h1 class="vs"><span style="--tc:${hc}">${split(e.home.toUpperCase())}</span><small>VS</small><span style="--tc:${ac}">${split(e.away.toUpperCase())}</span></h1>
        ${e.tennis ? `<div class="tennis-facts reveal">${[['Tournament', e.tennis.tournament + (e.tennis.major ? ' (Grand Slam)' : '')], ['Location', e.tennis.location], ['Draw', e.tennis.drawName], ['Round', e.tennis.round], ['Court', e.tennis.court], ['Format', e.tennis.bestOf ? `Best of ${e.tennis.bestOf} sets` : ''], [e.home, [e.tennis.home.seed ? `Seed ${e.tennis.home.seed}` : '', e.tennis.home.country].filter(Boolean).join(' · ')], [e.away, [e.tennis.away.seed ? `Seed ${e.tennis.away.seed}` : '', e.tennis.away.country].filter(Boolean).join(' · ')]].filter(([, v]) => v).map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
        ${e.live ? `<div class="scoreline reveal"><b>${esc(e.score || '')}</b><small>${esc(e.clock || '')}</small></div><p class="live-warn reveal">In play: every probability, price and score grid on this page is a <b>pre-match estimate</b>. It does not include the current score${e.score ? ` (${esc(e.score)})` : ''}.</p>` : ''}
        ${sourcesLine(e)}
      </section>
      <nav class="subnav reveal">${sections.map(([k, l]) => `<a href="#sec-${k}" data-jump="sec-${k}">${l}</a>`).join('')}</nav>
      ${notice()}
      <section class="panel big reveal" id="sec-overview">
        <h2 class="ph">${e.live ? 'Pre-match ' : ''}Estimated win probability <small>${esc(a.basis)}</small></h2>
        ${probBar([{ label: e.home, p: w.home, color: hc }, ...(twoWay ? [] : [{ label: 'Draw', p: w.draw, color: DRAW_COLOR }]), { label: e.away, p: w.away, color: ac }])}
        <div class="sides ${twoWay ? 'two' : 'three'}">${side(e.home, w.home, hc, book(e.home))}${twoWay ? '' : side('Draw', w.draw, DRAW_COLOR, book('Draw'))}${side(e.away, w.away, ac, book(e.away))}</div>
        ${paramChips ? `<div class="params">${paramChips}<div><small>Markets priced</small><b>${a.marketCount}</b></div></div>` : ''}
      </section>
      ${dos.map((x) => `<section id="sec-${x.id}"><h2 class="sec reveal"><span>◆</span>${esc(x.label)}</h2>${x.html}</section>`).join('')}
      ${a.kind === 'binary' ? '' : `<section class="panel reveal" id="sec-model">${modelPanel(e, a, hc, ac)}</section>`}
      <section id="sec-markets"><h2 class="sec reveal"><span>◆</span>Every market <small>ATLAS fair prices · tap to add</small></h2>
        <div class="mgroups">${a.groups.map((g) => `<div class="mgroup panel reveal"><h3>${esc(g.group)}</h3>${g.markets.map((m) => `
          <div class="mk"><h4>${esc(m.name)}</h4>${m.outcomes.map((o) => `<div class="mo">
            <span class="mo-n">${esc(o.name)}</span><div class="meter"><i class="grow" style="--w:${(o.p * 100).toFixed(1)}%"></i></div>
            <span class="mo-p">${pc(o.p)}</span>${legButton(fairLeg(e, m, o), odd(o.fair))}</div>`).join('')}</div>`).join('')}</div>`).join('')}</div>
      </section>
      <section class="panel reveal" id="sec-book">${bookPanel(e)}</section>
      <section class="grid two" id="sec-form">${formPanel(e, hc, ac)}</section>
      <section class="panel reveal" id="sec-calc">${calcPanel(e, w, book)}</section>
      <section class="panel reveal" id="sec-notes"><h2 class="ph">Model notes</h2>${notes(e, a)}</section>`,
    };
  },

  edge() {
    return {
      mode: 'edge', accent: '#4fd1ff', title: 'Edge board',
      html: `<section class="hero small"><p class="kicker reveal">EVERY PRICE · EVERY SPORT · RANKED</p><h1>${split('EDGE BOARD')}</h1>
        <p class="lede reveal">Every bookmaker outcome on the board with its fair probability (margin removed), the ATLAS model probability, edge and quarter-Kelly stake.</p></section>
        ${notice()}
        <div class="filters panel reveal">
          <label>Sport<select data-ef="sport"><option value="">All</option>${SPORTS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select></label>
          <label>Min odds<input data-ef="min" type="number" step="0.05" value="1.01" min="1"></label>
          <label>Max odds<input data-ef="max" type="number" step="0.5" value="20" min="1"></label>
          <label>Sort<select data-ef="sort"><option value="ev">Edge</option><option value="p">Win chance</option><option value="odds">Odds</option><option value="start">Start time</option></select></label>
          <label class="grow1">Search<input data-ef="q" type="search" placeholder="Team, league, market…"></label>
          <label class="chk"><input data-ef="pos" type="checkbox"> Positive edge only</label>
        </div>
        <div class="panel table-wrap reveal" id="edge-table">${edgeTable({})}</div>`,
    };
  },

  x([n]) {
    const target = Number(n);
    if (![2, 3, 4, 5, 10, 20].includes(target)) return views.notfound();
    // Same-day only: every leg kicks off later today (viewer's local time).
    const left = todayEvents(S.events);
    const priced = left.filter((e) => e.markets?.length).length;
    const list = S.slips(target, { count: 5, maxLegs: target <= 5 ? 3 : 5, tolerance: 0.08, today: true });
    const day = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    return {
      mode: 'x', accent: ['#d2ff00', '#00ffc3', '#4fd1ff', '#b08cff'][[2, 3, 4, 5].indexOf(target)] || '#ff9f43', title: `${target}x slips`,
      html: `<section class="hero small"><p class="kicker reveal">MULTIPLIER · BREAK-EVEN ${pc(1 / target, 1)} · TODAY ONLY</p><h1>${split(`${target}X SLIPS`)}</h1>
        <nav class="tabs reveal">${[2, 3, 4, 5, 10, 20].map((x) => `<a href="#/x/${x}" class="${x === target ? 'on' : ''}">${x}x</a>`).join('')}</nav></section>
        ${notice()}
        <p class="lede reveal">Combinations whose total odds land near ${target}x, ranked by edge and estimated win chance. A fairly priced ${target}x slip wins about ${pc(1 / target, 0)} of the time; each extra leg adds another bookmaker margin.</p>
        <p class="note reveal">📅 Only matches on <b>${esc(day)}</b> that haven't started yet: ${left.length} left today, ${priced} with prices. Slips rebuild as games kick off and roll over at midnight.</p>
        <section class="grid slips">${list.map((s, i) => slipCard(s, i, target)).join('') || `<p class="muted">${left.length ? `Today's remaining prices can't be combined to about ${target}x. Try another multiplier.` : 'No more matches left today. Tomorrow\'s slips appear after midnight.'}</p>`}</section>`,
    };
  },

  mega() {
    return {
      mode: 'mega', accent: '#ff3d6e', title: 'Mega bets',
      html: `<section class="hero small"><p class="kicker reveal">ONCE IN A LIFETIME · BREAK-EVEN UNDER 1%</p><h1>${split('MEGA BETS')}</h1></section>
        ${notice()}
        ${[100, 500, 1000].map((t) => `<h2 class="sec reveal"><span>${t}x</span>${t === 100 ? 'Century' : t === 500 ? 'Half-thousand' : 'Thousand'} <small>about ${pc(1 / t, 2)} chance if fairly priced</small></h2>
          <section class="grid slips">${S.slips(t, { count: 4, maxLegs: 10, tolerance: 0.15 }).map((s, i) => slipCard(s, i, t)).join('') || '<p class="muted">Not enough priced events.</p>'}</section>`).join('')}`,
    };
  },

  bankers() {
    const ev = prefFilter(S.events), minOdds = prefs.get().minOdds;
    const list = bankers(ev, { limit: 40, minOdds });
    const val = valueSpots(ev, { limit: 20, minOdds });
    return {
      mode: 'bankers', accent: '#00ffc3', title: 'Bankers',
      html: `<section class="hero small"><p class="kicker reveal">HIGHEST MODEL ESTIMATES · ODDS ≥ ${minOdds.toFixed(2)}</p><h1>${split('BANKERS')}</h1>
        <p class="lede reveal">Picks the model estimates at 70%+ (from margin-free bookmaker prices, adjusted by record and form). These are estimates, not certainties: favourites at this level still lose roughly one time in four to one time in ten.</p></section>
        ${notice()}${prefsBar()}
        <div class="list">${list.map((b) => bigPick(b)).join('') || '<p class="muted">No 70%+ favourites on the board right now.</p>'}</div>
        <h2 class="sec reveal"><span>◆</span>Value spots <small>model above the price, odds ≤ 5</small></h2>
        <div class="list">${val.map((b) => bigPick(b, true)).join('') || '<p class="muted">No value spots right now.</p>'}</div>`,
    };
  },

  notfound() {
    return { mode: 'other', accent: '#d2ff00', title: 'Not found', html: `<section class="hero"><h1>${split('404')}</h1><p class="reveal"><a class="btn" href="#/">Back to dashboard</a></p></section>` };
  },
};

// ---------- pieces ----------
// Home dashboard: Ask ATLAS → today's shortlist → live → absence changes → source health.
function dashboard(ev, live) {
  const minOdds = prefs.get().minOdds;
  const pool = prefFilter(ev);
  let short = bankers(todayEvents(pool), { min: 0.55, minOdds, limit: 5 }), when2 = 'today';
  if (!short.length) { short = bankers(pool.filter((e) => !e.live), { min: 0.55, minOdds, limit: 5 }); when2 = 'next few days'; }
  const changes = ev.flatMap((e) => ['home', 'away'].flatMap((sd) => (e.absences?.[sd] || []).map((x) => ({ e, team: sd === 'home' ? e.home : e.away, ...x }))))
    .filter((x) => x.updated).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated)).slice(0, 6);
  return `<section class="dash">
    <div class="panel dash-ask reveal"><h3 class="ph">Ask ATLAS <small>bets, injuries, starters, slips</small></h3>
      <form class="askform" data-askform><input name="q" placeholder="e.g. 3 safe NBA bets today" autocomplete="off" maxlength="300"/><button class="btn">Ask</button></form>
      <div class="askchips">${['Best bets today', 'Injuries in the Premier League', 'Give me a 2x slip', "What's live?"].map((q) => `<button class="pchip" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>
    <div class="panel dash-short reveal"><h3 class="ph">Today's shortlist <small>${when2} · estimated 55%+ · odds ≥ ${minOdds.toFixed(2)}</small></h3>
      <div class="minilist">${short.map((b) => miniPick(b)).join('') || '<p class="muted">Nothing passes your filters right now. Lower the minimum odds or add sports.</p>'}</div>${prefsBar()}</div>
    <div class="panel dash-live reveal"><h3 class="ph">Live now <small>${live.length}</small></h3>
      ${live.length ? `<ul class="dash-list">${live.slice(0, 6).map((e) => `<li><a href="#/match/${esc(e.id)}">${sportOf(e.sport).icon} ${esc(e.home)} <b>${esc(e.score || '')}</b> ${esc(e.away)}</a><small>${esc(e.clock || '')}</small></li>`).join('')}</ul>` : '<p class="muted">Nothing in play right now.</p>'}</div>
    <div class="panel dash-changes reveal"><h3 class="ph">Latest absences <small>soccer · FotMob</small></h3>
      ${changes.length ? `<ul class="dash-list">${changes.map((x) => `<li><a href="#/match/${esc(x.e.id)}"><b>${esc(x.name)}</b> (${esc(x.team)}) · ${esc(x.injury || x.type)}</a><small>${[x.expectedReturn && `back ${esc(x.expectedReturn)}`, `updated ${ago(Date.parse(x.updated))}`].filter(Boolean).join(' · ')}</small></li>`).join('')}</ul>` : '<p class="muted">No recent absence updates.</p>'}</div>
    <div class="panel dash-health reveal"><h3 class="ph">Source health</h3>${sourceHealth(ev)}</div>
  </section>`;
}

function sourceHealth(ev) {
  const newest = (list, f) => list.reduce((t, x) => Math.max(t, f(x) || 0), 0);
  const espn = ev.filter((e) => e.leaguePath && !e.leaguePath.startsWith('atlas/') && e.source !== 'MLB Stats API');
  const reports = ev.flatMap((e) => (e.probables || []).filter((p) => p.report?.league === 'MLB').map((p) => p.report));
  const rows = [
    ['Snapshot build', ev.length, S.fetchedAt, 'every league, rebuilt every 15 min'],
    ['ESPN scoreboards', espn.length, newest(espn, (e) => e.fetchedAt), 'fixtures, scores, reference odds'],
    ['NPB official', ev.filter((e) => e.leaguePath === 'atlas/npb').length, newest(ev.filter((e) => e.leaguePath === 'atlas/npb'), (e) => e.fetchedAt), 'schedule, starters'],
    ['KBO official', ev.filter((e) => e.leaguePath === 'atlas/kbo').length, newest(ev.filter((e) => e.leaguePath === 'atlas/kbo'), (e) => e.fetchedAt), 'schedule, starters'],
    ['MLB Stats API', reports.length, newest(reports, (r) => r.fetchedAt), 'starter reports'],
    ['FotMob', ev.filter((e) => e.absences).length, newest(ev, (e) => e.absences?.fetchedAt), 'soccer absences'],
  ];
  return `<ul class="health">${rows.map(([n, c, t, what]) => `<li class="${c ? freshClass(t) : 'idle'}"><i></i><b>${n}</b><span>${c ? `${c} · ${ago(t)}` : 'nothing scheduled'}</span><small>${what}</small></li>`).join('')}</ul>`;
}

// Per-match: where each piece of data came from and how old it is.
function sourcesLine(e) {
  const d = detailFor(e.id);
  const st = (e.probables || []).find((p) => p.report)?.report;
  const parts = [
    [e.source || (e.leaguePath?.startsWith('atlas/') ? 'League site' : 'ESPN'), e.fetchedAt || S.fetchedAt, 'fixture & price'],
    st ? [st.sourceLabel?.replace(/ profile$/, '') || st.league, st.fetchedAt || e.fetchedAt || S.fetchedAt, 'starters'] : null,
    e.absences ? ['FotMob', e.absences.fetchedAt, 'absences'] : null,
    d?.ok && !d.native ? ['ESPN summary', d.fetchedAt, 'stats, injuries, form'] : null,
  ].filter(Boolean);
  return `<p class="sources reveal">${parts.map(([n, t, what]) => `<span class="${freshClass(t)}"><i></i>${esc(what)}: ${esc(n)} · ${ago(t)}</span>`).join('')}</p>`;
}

function featuredCard(e) {
  const w = winProbs(e), s = sportOf(e.sport);
  const hc = safeColor(e.colors?.home, s.color), ac = safeColor(e.colors?.away, AWAY_COLOR);
  const fav = w.home >= w.away ? e.home : e.away;
  return `<section class="sec-block"><h2 class="sec reveal"><span>◆</span>Match of the day</h2>
    <a class="featured tilt reveal" href="#/match/${esc(e.id)}" style="--c:${s.color}" data-cursor="DOSSIER">
      <div class="f-meta">${s.icon} ${esc(e.league)} · ${when(e)} ${confBadge(w.confidence)}</div>
      <div class="f-teams"><b style="color:${hc}">${esc(e.home)}</b><span>VS</span><b style="color:${ac}">${esc(e.away)}</b></div>
      ${probBar([{ label: e.home, p: w.home, color: hc }, ...(w.draw ? [{ label: 'Draw', p: w.draw, color: DRAW_COLOR }] : []), { label: e.away, p: w.away, color: ac }])}
      <div class="f-nums"><div><small>${esc(e.home)}</small><b>${pc(w.home, 0)}</b></div>${w.draw ? `<div><small>Draw</small><b>${pc(w.draw, 0)}</b></div>` : ''}<div><small>${esc(e.away)}</small><b>${pc(w.away, 0)}</b></div><div><small>Favourite</small><b>${esc(fav)}</b></div></div>
      <span class="f-go">Open full dossier →</span></a></section>`;
}

function miniPick(b, value) {
  const s = sportOf(b.event.sport);
  const leg = { key: `${b.event.id}|${b.market}|${b.pick}`, eventId: b.event.id, sport: b.event.sport, match: `${b.event.home} vs ${b.event.away}`, market: b.market, pick: b.pick, odds: b.odds, p: b.p };
  return `<div class="mini reveal"><span>${s.icon}</span><a href="#/match/${esc(b.event.id)}"><b>${esc(b.pick)}</b><small>${esc(b.market)} · ${esc(b.event.home)} v ${esc(b.event.away)}</small></a>
    <em>${pc(b.p, 0)}</em>${value ? `<em class="pos">+${(b.ev * 100).toFixed(1)}%</em>` : ''}${legButton(leg, odd(b.odds))}</div>`;
}

function bigPick(b, value) {
  const e = b.event, s = sportOf(e.sport);
  const leg = { key: `${e.id}|${b.market}|${b.pick}`, eventId: e.id, sport: e.sport, match: `${e.home} vs ${e.away}`, market: b.market, pick: b.pick, odds: b.odds, p: b.p };
  return `<article class="row tilt reveal" style="--c:${s.color}">
    <a class="row-link" href="#/match/${esc(e.id)}" data-cursor="OPEN" aria-label="${esc(b.pick)}"></a>
    <span class="ico">${s.icon}</span>
    <div class="teams"><b>${esc(b.pick)}</b><small>${esc(b.market)} · ${esc(e.home)} v ${esc(e.away)} · ${esc(e.league)} · ${when(e)}</small></div>
    <div class="row-prob">${gaugeMini(b.p)}</div>
    <div class="odds"><span class="stat"><small>chance</small>${pc(b.p, 1)}</span><span class="stat ${b.ev >= 0 ? 'pos' : ''}"><small>edge</small>${(b.ev * 100).toFixed(1)}%</span>${legButton(leg, `<small>odds</small>${odd(b.odds)}`)}</div>
    ${value ? '<span class="conf conf-high">VALUE</span>' : '<span class="conf conf-medium">BANKER</span>'}
  </article>`;
}
const gaugeMini = (p) => `<div class="meter tall"><i class="grow" style="--w:${(p * 100).toFixed(1)}%"></i></div>`;

const paramLabel = (k, unit) => ({ lambdaHome: `Expected ${unit} · home`, lambdaAway: `Expected ${unit} · away`, total: `Expected total ${unit || 'points'}`, margin: 'Expected margin (home)', sigma: 'Margin spread σ', homePoints: 'Home points', awayPoints: 'Away points', setWin: 'Home set-win chance', bestOf: 'Best of' }[k] || k);

function modelPanel(e, a, hc, ac) {
  if (a.kind === 'poisson') {
    return `<h2 class="ph">Score model <small>Poisson fit to the price · expected ${a.params.unit}: ${a.params.lambdaHome.toFixed(2)} – ${a.params.lambdaAway.toFixed(2)}</small></h2>
      <div class="model-grid"><div>${heatmap(a.grid, e.home, e.away, hc)}</div>
      <div><h3>Most likely scores</h3><ol class="topscores">${a.grid.top.map((c) => `<li><b>${c.h}–${c.a}</b><div class="meter"><i class="grow" style="--w:${(c.p / a.grid.top[0].p * 100).toFixed(0)}%"></i></div><span>${pc(c.p)}</span><em>${odd(1 / c.p)}</em></li>`).join('')}</ol>
      ${outcomeBars(a.groups.find((g) => g.group.startsWith('Exact')).markets[0].outcomes, hc)}<p class="cap">Exact total ${a.params.unit}</p></div></div>`;
  }
  if (a.kind === 'normal') {
    return `<h2 class="ph">Margin model <small>expected margin ${a.params.margin > 0 ? e.home : e.away} by ${Math.abs(a.params.margin).toFixed(1)} · total ${a.params.total.toFixed(1)}</small></h2>
      ${distBars(a.dist, hc, ac)}
      <div class="params"><div><small>${esc(e.home)} projected</small><b>${a.params.homePoints.toFixed(1)}</b></div><div><small>${esc(e.away)} projected</small><b>${a.params.awayPoints.toFixed(1)}</b></div><div><small>Margin σ</small><b>${a.params.sigma}</b></div></div>`;
  }
  if (a.kind === 'tennis') {
    return `<h2 class="ph">Set model <small>${esc(e.home)} wins ${pc(a.params.setWin)} of sets · best of ${a.params.bestOf}</small></h2>${outcomeBars(a.groups[0].markets[0].outcomes, hc)}`;
  }
  return '';
}

function bookPanel(e) {
  if (!e.markets?.length) return `<h2 class="ph">Bookmaker prices</h2><p class="muted">No bookmaker has priced this event in the connected feeds. Every number above is an ATLAS model line: compare it with your bookmaker before betting.</p>`;
  return `<h2 class="ph">Bookmaker prices <small>${esc(e.bookmaker || '')}</small></h2>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Market</th><th>Pick</th><th>Odds</th><th>Implied</th><th>Fair</th><th>Model</th><th>Value</th><th>Edge</th><th>Kelly ¼</th><th></th></tr></thead><tbody>
    ${e.markets.map((m) => { const d = devig(m); return m.outcomes.map((o, i) => {
      const fair = d.outcomes[i].fair, p = o.model ?? fair, ev = p * o.odds - 1;
      return `<tr><td>${i ? '' : `${esc(m.name)}<small> margin ${(d.margin * 100).toFixed(1)}%</small>`}</td><td>${esc(o.name)}</td><td class="num">${odd(o.odds)}</td><td class="num">${pc(1 / o.odds)}</td><td class="num">${pc(fair)}</td><td class="num">${o.model != null ? pc(o.model) : '—'}</td>
        <td>${valueTrack(fair, o.model, o.odds)}</td><td class="num ${ev >= 0 ? 'pos' : 'neg'}">${(ev * 100).toFixed(1)}%</td><td class="num">${ev > 0 ? pc(kelly(p, o.odds) / 4) : '—'}</td><td>${legButton(bookLeg(e, m, o, p), '+')}</td></tr>`;
    }).join(''); }).join('')}</tbody></table></div>`;
}

function formPanel(e, hc, ac) {
  const st = e.stats || {};
  const card = (name, color, rec, form) => `<div class="panel reveal team-card" style="--tc:${color}"><h2 class="ph">${esc(name)}</h2>
    <div class="tstat"><small>Season record</small><b>${esc(rec || '—')}</b></div>
    <div class="tstat"><small>Last 5</small>${formStrip(form)}</div>
    ${form?.length ? `<div class="tstat"><small>Form points</small><b>${form.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0)} / ${form.length * 3}</b></div>` : ''}</div>`;
  return card(e.home, hc, st.homeRecord, st.homeForm) + card(e.away, ac, st.awayRecord, st.awayForm)
    + (st.starters?.length || e.source ? `<div class="panel reveal span2"><h2 class="ph">Match facts</h2>
      ${st.starters?.length ? `<p><b>Probable starters:</b> ${st.starters.map(esc).join(' · ')}</p>` : ''}
      ${e.source ? `<p><b>Source:</b> <a href="${safeHref(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(e.source)} ↗</a>${e.official ? ' · official' : ''}${e.stale ? ' · <span class="live">stale</span>' : ''}</p>` : ''}
      <p><b>Start:</b> ${Number.isFinite(e.start) ? new Date(e.start).toLocaleString() : 'TBC'}</p></div>` : '');
}

function calcPanel(e, w, book) {
  const rows = [[e.home, w.home], ...(w.draw ? [['Draw', w.draw]] : []), [e.away, w.away]];
  return `<h2 class="ph">Stake calculator <small>returns, profit and expected value at your stake</small></h2>
    <label class="calc-in">Stake <input type="number" min="0" step="1" value="${slip.stake || 10}" data-calc></label>
    <div class="table-wrap"><table class="tbl" data-calc-table><thead><tr><th>Pick</th><th>Odds used</th><th>Chance</th><th>Return</th><th>Profit</th><th>Expected value</th></tr></thead><tbody>
    ${rows.map(([n, p]) => { const o = book(n) || 1 / p; return `<tr data-o="${o}" data-p="${p}"><td>${esc(n)}${book(n) ? '' : ' <small>(fair)</small>'}</td><td class="num">${odd(o)}</td><td class="num">${pc(p)}</td><td class="num" data-ret></td><td class="num" data-pro></td><td class="num" data-ev></td></tr>`; }).join('')}
    </tbody></table></div>`;
}

function notes(e, a) {
  const items = [
    `Basis: ${a.basis}. Confidence: ${a.confidence}.`,
    a.kind === 'poisson' ? `Goals/runs are modelled as independent Poisson variables fitted to the winner price${e.markets?.some((m) => /^Total/.test(m.name)) ? ' and the total line' : ' (no total line: draw rate used instead)'}. Real scores have slight dependence (more draws at low totals), so exact-score prices are approximate.` : '',
    a.kind === 'normal' ? `Final margin is modelled as normal with σ ${a.params.sigma}${e.markets?.some((m) => m.name === 'Spread') ? ', centred on the spread' : ', centred to match the moneyline'}. Totals use σ ${e.sport === 'basketball' ? 18 : 10}.` : '',
    a.kind === 'tennis' ? 'Sets are treated as independent with a constant set-win chance solved from the match price. Momentum and retirements are ignored.' : '',
    e.sport === 'hockey' || e.sport === 'baseball' ? 'Winner prices include overtime/extra innings; regulation ties are split evenly when fitting.' : '',
    'Fair odds are 1 ÷ probability: the break-even price. A bookmaker price above fair odds is positive edge if the model is right.',
    'Kelly ¼ is a quarter of the Kelly-optimal bankroll fraction; it is zero when there is no edge.',
  ].filter(Boolean);
  return `<ul class="notes">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

// Edge table, re-rendered on filter change.
export function edgeTable(f) {
  const rows = [];
  for (const e of S.events) {
    if (f.sport && e.sport !== f.sport) continue;
    for (const m of e.markets || []) {
      const d = devig(m);
      m.outcomes.forEach((o, i) => {
        const fair = d.outcomes[i].fair, p = o.model ?? fair, ev = p * o.odds - 1;
        rows.push({ e, m, o, fair, p, ev });
      });
    }
  }
  const min = Number(f.min) || 1, max = Number(f.max) || 1000, q = (f.q || '').toLowerCase();
  const list = rows.filter((r) => r.o.odds >= min && r.o.odds <= max && (!f.pos || r.ev > 0)
    && (!q || `${r.e.home} ${r.e.away} ${r.e.league} ${r.m.name} ${r.o.name}`.toLowerCase().includes(q)))
    .sort((a, b) => (f.sort === 'p' ? b.p - a.p : f.sort === 'odds' ? a.o.odds - b.o.odds : f.sort === 'start' ? a.e.start - b.e.start : b.ev - a.ev))
    .slice(0, 300);
  return `<p class="cap">${list.length} of ${rows.length} prices</p><table class="tbl edge-tbl"><thead><tr><th></th><th>Match</th><th>Market</th><th>Pick</th><th>Odds</th><th>Fair</th><th>Model</th><th>Edge</th><th>Kelly ¼</th><th></th></tr></thead><tbody>
    ${list.map((r) => `<tr><td class="ic">${sportOf(r.e.sport).icon}</td><td class="mt"><a href="#/match/${esc(r.e.id)}">${esc(r.e.home)} v ${esc(r.e.away)}</a><small>${esc(r.e.league)} · ${when(r.e)}</small></td><td class="mk">${esc(r.m.name)}</td><td class="pk"><b>${esc(r.o.name)}</b></td>
      <td class="num" data-l="Odds">${odd(r.o.odds)}</td><td class="num" data-l="Fair">${pc(r.fair)}</td><td class="num" data-l="Model">${r.o.model != null ? pc(r.o.model) : '—'}</td><td class="num ${r.ev >= 0 ? 'pos' : 'neg'}" data-l="Edge">${(r.ev * 100).toFixed(1)}%</td><td class="num" data-l="Kelly ¼">${r.ev > 0 ? pc(kelly(r.p, r.o.odds) / 4) : '—'}</td><td class="add">${legButton(bookLeg(r.e, r.m, r.o, r.p), '+')}</td></tr>`).join('')}
    </tbody></table>`;
}

// Load leagues live in the browser (once per visit each), merge, and redraw. Covers every league,
// including any the hourly snapshot could not fetch.
const liveLoaded = new Set();
async function liveLoad(paths) {
  const todo = LEAGUES.filter((l) => paths.includes(l.path) && !liveLoaded.has(l.path));
  if (!todo.length) return;
  todo.forEach((l) => liveLoaded.add(l.path));
  const fresh = await fetchAll(undefined, todo, { days: 4, concurrency: 4 }).catch(() => []);
  if (!fresh.length) return;
  applyModel(fresh);
  const map = new Map(S.events.map((e) => [e.id, e]));
  fresh.forEach((f) => map.set(f.id, { ...map.get(f.id), ...f }));
  S.events.splice(0, S.events.length, ...map.values());
  S.refresh?.();
}

function countBy() {
  const out = {};
  for (const e of S.events) { const c = out[e.leaguePath] || (out[e.leaguePath] = { n: 0, live: 0 }); c.n++; if (e.live) c.live++; }
  return out;
}

// League table (ESPN standings endpoint); NPB/KBO have none in the feed.
async function loadStandings(l) {
  const box = document.getElementById('league-standings');
  if (!box || l.path.startsWith('atlas/')) return;
  try {
    const r = await fetch(`https://site.api.espn.com/apis/v2/sports/${l.path}/standings`);
    const j = await r.json();
    const groups = (j.children?.length ? j.children : [j]).map((c) => ({ name: c.name || c.abbreviation || l.name, entries: c.standings?.entries || [] })).filter((g) => g.entries.length);
    if (!groups.length) return;
    const cols = ['GP', 'W', 'D', 'T', 'L', 'OTL', 'PTS', 'GD', 'PF', 'PA', 'PCT', 'GB', 'STRK', 'L10'];
    box.innerHTML = `<h2 class="sec"><span>◆</span>Standings</h2>${groups.map((g) => {
      const stat = (en, k) => en.stats?.find((x) => x.abbreviation === k || x.shortDisplayName === k)?.displayValue;
      const used = cols.filter((k) => g.entries.some((en) => stat(en, k) != null));
      return `<div class="panel"><h3 class="ph">${esc(g.name)}</h3><div class="table-wrap"><table class="tbl tight"><thead><tr><th>#</th><th>Team</th>${used.map((k) => `<th>${k}</th>`).join('')}</tr></thead><tbody>${g.entries.map((en, i) => `<tr><td class="num">${i + 1}</td><td><b>${esc(en.team?.displayName || en.team?.name || '')}</b></td>${used.map((k) => `<td class="num">${esc(stat(en, k) ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
    }).join('')}`;
  } catch { /* standings optional */ }
}

export { buildSlips };
