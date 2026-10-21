// Page templates. Each view returns { html, mode, accent, sceneOpts?, title, after? }.
import { ico, watchLabel, pinLabel } from './icons.js';
import { SPORTS } from './data.js';
import { readable } from './color.js';
import { devig, buildSlips, todayEvents } from './engine.js';
import { liveCenterHtml } from './livecenter.js';
import { f1View, f1Teaser } from './f1view.js';
import { fieldView, fieldsTeaser } from './fieldview.js';
import { applyModel } from './intel.js';
import { analyse, winProbs, kelly } from './models.js';
import { probBar, gauge, heatmap, distBars, formStrip, outcomeBars, valueTrack, pc, odd } from './charts.js';
import { split } from './ui.js';
import { slip } from './slip.js';
import { CATALOG, sportById, leagueKey, leagueFromKey } from './catalog.js';
import { detailFor, loadDetail as fetchDetail } from './detail.js';
import { dossierSections } from './dossier.js';
import { fetchAll, LEAGUES, leagueStatus } from './espn.js';
import { prefs, prefEvents } from './prefs.js';
import { liveWin } from './live.js';
import { watch } from './alerts.js';
import { trackCard, trackStrip, trackStats, trackCalibration, recordLine, ensureTrack, officialParlay } from './trackview.js';
import { zone as tzZone, tzOf, abbr as tzAbbr, fmt as fmtTime, ZONES } from './tz.js';
import { bestBets, BEST, POTD_ZONES, potdDay, parlayOfDay, recommendationFor } from './track.js';
import { propLabel, propMarket } from './props.js';
import { propRow, allProps } from './propsview.js';
import { coherentBets } from './picks.js';
import { mergeEvent } from './merge.js';
import { casePanel, historyPanel, researchRow, pins, researchPrefs, windowChips, changesPanel, orderBets, orderChips, orderLabel } from './research.js';
import { readiness, priceTime } from './readiness.js';
import { lastVisit } from './timeline.js';
import { whyLine } from './why.js';
import { canonStats, standingsTable } from './standings.js';
// Picks pages (bankers, edge board, multipliers): picksview.js, which also uses the helpers here.
import { picksViews, bindPicks, edgeTable, everyTeaser } from './picksview.js';
export { edgeTable };
// Golf and motor racing: a field of players or drivers, drawn by fieldview.js.
const FIELD_SPORTS = new Set(['golf', 'motorsport']);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const safeHref = (u) => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '#');
// Team colours are shown as text on the dark page: never one too dark to read (color.js).
const safeColor = (c, fallback) => readable(c, fallback);
export const sportOf = (id) => SPORTS.find((s) => s.id === id) || { id, name: id, icon: '◆', color: '#d2ff00' };

const AWAY_COLOR = '#ff3d6e';
const DRAW_COLOR = '#8b8b92';

// ---------- shared state handed in by main.js ----------
let S;
export const legIndex = new Map();
export function bind(state) { S = state; bindPicks(state); }

const analysisCache = new Map();
export function analysisFor(e) {
  // Every input the models read (prices, records, form, predictor, starters, rankings, team news), so
  // a starter or lineup update always produces a fresh analysis instead of a cached one.
  const sig = JSON.stringify([e.markets, e.stats, e.records, e.predictor, e.probables, e.tennis, e.ranks, e.absences, e.lineups, e.neutral, e.bestOf]);
  const hit = analysisCache.get(e.id);
  if (hit && hit.sig === sig) return hit.a;
  const a = analyse(e);
  analysisCache.set(e.id, { sig, a });
  return a;
}

export function legButton(leg, label) {
  legIndex.set(leg.key, leg);
  const on = slip.has(leg.key);
  return `<button class="leg ${on ? 'on' : ''}" data-leg="${esc(leg.key)}" data-cursor="${on ? 'REMOVE' : 'ADD'}">${label}</button>`;
}
export const bookLeg = (e, m, o, p) => ({ key: `${e.id}|${m.name}|${o.name}`, eventId: e.id, sport: e.sport, match: `${e.home} vs ${e.away}`, market: m.name, pick: o.name, odds: o.odds, p, derived: false });
const fairLeg = (e, m, o) => ({ key: `${e.id}|fair|${m.name}|${o.name}`, eventId: e.id, sport: e.sport, match: `${e.home} vs ${e.away}`, market: m.name, pick: o.name, odds: +o.fair.toFixed(2), p: o.p, derived: true });

// "12m ago" style age; class says how fresh it is.
const ago = (t) => { if (!t) return 'unknown'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const freshClass = (t) => (!t ? 'stale' : Date.now() - t < 30 * 6e4 ? 'fresh' : Date.now() - t < 2 * 36e5 ? 'aging' : 'stale');

// Personal filters bar (min odds, sports, priced only), saved per browser.
export function prefsBar() {
  const p = prefs.get();
  const sports = SPORTS.filter((s) => S.events.some((e) => e.sport === s.id));
  return `<div class="prefs reveal"><span class="pl">Min odds</span>${[1.2, 1.3, 1.5, 1.8].map((o) => `<button class="pchip ${p.minOdds === o ? 'on' : ''}" data-pref="minOdds" data-value="${o}">${o.toFixed(2)}</button>`).join('')}
    <span class="pl">Sports</span><button class="pchip ${p.sports.length ? '' : 'on'}" data-pref="sport" data-value="all">All</button>${sports.map((s) => `<button class="pchip ${p.sports.includes(s.id) ? 'on' : ''}" data-pref="sport" data-value="${s.id}" title="${esc(s.name)}">${s.icon}</button>`).join('')}
    <button class="pchip ${p.pricedOnly ? 'on' : ''}" data-pref="priced" data-value="1">Bookmaker-priced only</button></div>`;
}
export const prefFilter = (list) => { const p = prefs.get(); const ev = prefEvents(list); return p.pricedOnly ? ev.filter((e) => e.markets?.length) : ev; };

// Kick-off in the visitor's chosen time zone (tz.js), e.g. "Mon 6 Oct, 7:30 pm IST".
export const ist = (t) => fmtTime(t);
export const istTag = (t) => (Number.isFinite(t) ? `<time class="ist" datetime="${new Date(t).toISOString()}">${ico('clock')} ${ist(t)}</time>` : '');
export const when = (e) => (e.live ? `<span class="live">LIVE${e.score ? ` · ${esc(e.score)}` : ''}</span>${e.clock ? ` <small class="lclock" data-clock="${esc(e.id)}">${esc(e.clock)}</small>` : ''}` : `<span data-start="${e.start}">${countdown(e.start)}</span> ${istTag(e.start)}`);
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
// How fresh the whole snapshot is: fresh within 30 minutes of the last build (builds run about every
// 15), delayed to 75, stale after. Shown at the top of working pages whenever it is not fresh.
export const buildAge = () => (S.fetchedAt ? Date.now() - S.fetchedAt : null);
export const buildState = (age = buildAge()) => (age == null ? 'unknown' : age < 30 * 6e4 ? 'fresh' : age < 75 * 6e4 ? 'delayed' : 'stale');
export function notice() {
  if (S.loading) return '<div class="notice reveal"><span class="loading-dots">Loading today\'s fixtures</span></div>';
  if (S.demo) return '<div class="notice reveal"><span class="led"></span><b>DEMO DATA</b> · live feeds unreachable, prices are simulated.</div>';
  const st = buildState();
  if (st === 'delayed' || st === 'stale') return `<div class="notice notice-${st} reveal"><span class="led"></span><b>${st === 'stale' ? 'DATA STALE' : 'DATA DELAYED'}</b> · last update ${Math.round(buildAge() / 6e4)} min ago (normally about every 15 min). Prices and team news may have moved; live scores still update.</div>`;
  return '';
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
// Baseball: the starting pitchers right in the list ("SP Maeda v Kamichatani").
function starterLine(e) {
  if (e.sport !== 'baseball' || !e.probables?.length) return '';
  const nm = (side) => { const p = e.probables.find((x) => x.side === side); const n = p?.report?.name || p?.name || ''; return (n.includes(',') ? n.split(',')[0] : n.split(' ').slice(-1)[0]) || 'TBA'; };
  return `<small class="sp-line">SP ${esc(nm('home'))} v ${esc(nm('away'))}</small>`;
}

function eventRow(e, compact = false) {
  const s = sportOf(e.sport), w = winProbs(e);
  const hc = safeColor(e.colors?.home, s.color), ac = safeColor(e.colors?.away, AWAY_COLOR);
  const main = e.markets?.[0];
  const d = main ? devig(main) : null;
  return `<article class="row tilt reveal" style="--c:${s.color}">
    <a class="row-link" href="#/match/${esc(e.id)}" data-cursor="OPEN" aria-label="${esc(e.home)} vs ${esc(e.away)}"></a>
    <span class="ico">${s.icon}</span>
    <div class="teams"><b>${esc(e.home)}${seedTag(e.tennis?.home)}</b><b>${esc(e.away)}${seedTag(e.tennis?.away)}</b><small>${e.tennis ? esc(compact === true ? e.tennis.court || e.tennis.round : tennisLine(e.tennis)) : esc(e.league)} · ${when(e)}</small>${starterLine(e)}</div>
    <div class="row-prob">${probBar([{ label: e.home, p: w.home, color: hc }, ...(w.draw ? [{ label: 'Draw', p: w.draw, color: DRAW_COLOR }] : []), { label: e.away, p: w.away, color: ac }])}
      <small><span>${pc(w.home, 0)}</span>${w.draw ? `<span>${pc(w.draw, 0)}</span>` : ''}<span>${pc(w.away, 0)}</span></small></div>
    <div class="odds">${main ? main.outcomes.map((o, i) => legButton(bookLeg(e, main, o, o.model ?? d.outcomes[i].fair), `<small>${esc(o.name === 'Draw' ? 'X' : o.name.split(' ').pop().slice(0, 4))}</small>${odd(o.odds)}`)).join('') : `<span class="nobook">model line</span>`}${main && e.bookmaker ? `<small class="odds-src">${e.quoteType === 'reference' ? 'reference average, not a price on offer' : `odds via ${esc(e.bookmaker.replace(/^Bookmaker price via /, '').split(' (')[0])}`}</small>` : ''}</div>
    ${confBadge(w.confidence)}
  </article>`;
}


// ---------- views ----------
// A hero number: a placeholder bar until the first snapshot lands, so "0" never stands in for "not loaded yet".
const statNum = (n, cls = '') => (S.loading ? `<b class="skel-num ${cls}" aria-label="loading"></b>` : `<b class="${cls}" data-count-to="${n}">0</b>`);
const skelRows = (n) => `<div class="skel-list" aria-busy="true" aria-label="Loading">${'<i class="skel-row"></i>'.repeat(n)}</div>`;

export const views = {
  home() {
    const ev = S.events;
    const live = ev.filter((e) => e.live);
    const upcoming = [...ev].filter((e) => !e.live && e.sport !== 'efootball').sort((a, b) => a.start - b.start); // eSoccer runs round the clock: it has its own page
    const day = todayEvents(prefFilter(ev)); // next 12 hours
    const ts = trackStats();
    const modelled = ev.reduce((n, e) => n + (e.markets?.length ? 1 : 0), 0);
    const counts = Object.fromEntries(SPORTS.map((s) => [s.id, ev.filter((e) => e.sport === s.id)]));
    return {
      mode: 'home', accent: '#d2ff00', title: 'Dashboard',
      html: `
      <section class="hero compact today">
        <p class="kicker reveal">TODAY · ${esc(new Date().toLocaleDateString('en-IN', { timeZone: tzOf(tzZone()), weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase())} · ${esc(tzAbbr(tzZone()))}</p>
        <h1>${split('EVERY SPORT. EVERY EDGE.')}</h1>
        <div class="stats reveal${S.loading ? ' is-loading' : ''}">
          <div>${statNum(ev.length)}<span>events tracked</span></div>
          <div>${statNum(modelled)}<span>with prices${S.loading ? '' : ` (${ev.length ? Math.round((modelled / ev.length) * 100) : 0}%)`}</span></div>
          <div>${statNum(live.length, 'hot')}<span>in play</span></div>
        </div>
        ${trackStrip(() => S.refresh?.())}
      </section>
      ${notice()}
      ${dashboard(ev, live)}
      <section class="sec-block"><h2 class="sec reveal">Sports</h2>
        <div class="grid sports">${SPORTS.map((s) => {
          const list = counts[s.id] || [];
          const next = list.filter((e) => !e.live).sort((a, b) => a.start - b.start)[0];
          return `<a class="sport tilt reveal" href="#/sport/${s.id}" style="--c:${s.color}" data-cursor="ENTER"><span class="ico">${s.icon}</span><b>${s.name}</b>
            <small>${s.id === 'f1' ? f1Teaser() : FIELD_SPORTS.has(s.id) ? fieldsTeaser(s.id) : `${list.length} events${list.filter((e) => e.live).length ? ` · <span class="live">${list.filter((e) => e.live).length} live</span>` : ''}`}</small>
            ${next ? `<small class="next">Next: ${esc(next.home)} v ${esc(next.away)}</small>` : ''}</a>`;
        }).join('')}</div></section>
      <section class="sec-block"><h2 class="sec reveal">Multipliers</h2>
        <div class="grid xs">${[2, 3, 4, 5].map((x) => { const r = ts?.byTarget?.find((t) => t.target === x); return `<a class="xcard tilt reveal" href="#/x/${x}" data-cursor="BUILD"><b>${x}x</b><small>5 slips<br>break-even ${pc(1 / x, 0)}</small>${r && r.won + r.lost ? `<small class="xrec">record ${r.won}–${r.lost} · ${pc(r.hitRate, 0)}</small>` : ''}</a>`; }).join('')}
        <a class="xcard mega tilt reveal" href="#/mega" data-cursor="DARE"><b>100x+</b><small>Mega accumulators from bankers</small></a>
        <a class="xcard any tilt reveal" href="#/target" data-cursor="BUILD"><b>Any x</b><small>Pick your own multiplier</small></a></div></section>
      <section class="sec-block"><h2 class="sec reveal">Up next</h2><div class="list">${upcoming.slice(0, 14).map(eventRow).join('')}</div></section>`,
    };
  },

  // Everything in play, grouped by sport, plus what starts in the next hour.
  live() {
    const live = S.events.filter((e) => e.live);
    const soon = S.events.filter((e) => !e.live && e.start > Date.now() && e.start < Date.now() + 36e5 && e.sport !== 'efootball').sort((a, b) => a.start - b.start);
    const groups = SPORTS.map((sp) => [sp, live.filter((e) => e.sport === sp.id)]).filter(([, l]) => l.length);
    return {
      mode: 'other', accent: '#ff3d6e', title: 'Live',
      html: `<section class="hero small"><p class="kicker reveal">IN PLAY · UPDATES EVERY FEW SECONDS</p><h1>${split('LIVE')}</h1>
        <p class="lede reveal">${live.length} match${live.length === 1 ? '' : 'es'} in play. Open one for the live scoreboard; star it to get alerts.</p></section>
        ${notice()}
        ${groups.map(([sp, l]) => `<section class="sec-block"><h2 class="sec reveal"><span>${sp.icon}</span>${esc(sp.name)} <small>${l.length} live</small></h2><div class="list">${l.map((e) => eventRow(e)).join('')}</div></section>`).join('') || '<p class="muted reveal">Nothing in play right now.</p>'}
        ${soon.length ? `<section class="sec-block"><h2 class="sec reveal">Starting within the hour</h2><div class="list">${soon.slice(0, 20).map((e) => eventRow(e)).join('')}</div></section>` : ''}`,
    };
  },

  sports() {
    const by = countBy();
    return {
      mode: 'sport', accent: '#d2ff00', title: 'All sports',
      html: `<section class="hero small"><p class="kicker reveal">${CATALOG.length} SPORTS · ${CATALOG.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.leagues.length, 0), 0)} COMPETITIONS</p><h1>${split('ALL SPORTS')}</h1><button class="pal-open-btn reveal" data-palette>${ico('search')}<span>Search matches, teams and leagues</span></button></section>
        ${notice()}
        <div class="grid sports">${CATALOG.map((sp) => {
          const n = sp.groups.reduce((t, g) => t + g.leagues.reduce((u, l) => u + (by[l.path]?.n || 0), 0), 0);
          const live = sp.groups.reduce((t, g) => t + g.leagues.reduce((u, l) => u + (by[l.path]?.live || 0), 0), 0);
          return `<a class="sport tilt reveal" href="#/sport/${sp.id}" style="--c:${sp.color}" data-cursor="ENTER"><span class="ico">${sp.icon}</span><b>${esc(sp.name)}</b>
            <small>${sp.id === 'f1' ? f1Teaser() : FIELD_SPORTS.has(sp.id) ? fieldsTeaser(sp.id) : `${n} match${n === 1 ? "" : "es"} · ${sp.groups.reduce((t, g) => t + g.leagues.length, 0)} competitions${live ? ` · <span class="live">${live} live</span>` : ''}`}</small></a>`;
        }).join('')}</div>`,
    };
  },

  sport([id]) {
    const sp = sportById(id);
    if (!sp) return views.notfound();
    if (id === 'f1') return f1View(S, { legButton, notice });
    if (FIELD_SPORTS.has(id)) return fieldView(S, id, { legButton, notice });
    // Only leagues the snapshot couldn't load are fetched again here (each league is several requests).
    const after = () => liveLoad(sp.groups.flatMap((g) => g.leagues.map((l) => l.path)).filter((p) => !leagueKnown(p)));
    const by = countBy();
    const list = S.events.filter((e) => e.sport === id).sort((a, b) => (b.live - a.live) || a.start - b.start);
    return {
      mode: 'sport', accent: sp.color, title: sp.name, after, sceneOpts: { sport: id },
      html: `<section class="hero small"><p class="kicker reveal"><a href="#/sports">ALL SPORTS</a> / ${list.length} MATCHES · ${list.filter((e) => e.live).length} LIVE</p><h1>${split(sp.name.toUpperCase())}</h1></section>
        ${notice()}
        ${sp.groups.map((g) => {
          const card = (l) => {
            const c = by[l.path] || { n: 0, live: 0 };
            const next = S.events.filter((e) => e.leaguePath === l.path && !e.live).sort((a, b) => a.start - b.start)[0];
            return `<a class="leaguec tilt reveal ${c.n ? '' : 'empty'}" href="#/league/${leagueKey(l.path)}" style="--c:${sp.color}" data-cursor="OPEN"><b>${esc(l.name)}</b>
              <small>${c.n ? `${c.n} match${c.n > 1 ? 'es' : ''}` : emptyText([l.path])}${c.live ? ` · <span class="live">${c.live} live</span>` : ''}</small>
              ${next ? `<em>Next: ${esc(next.home)} v ${esc(next.away)} · <span data-start="${next.start}">${countdown(next.start)}</span></em>` : ''}</a>`;
          };
          const sorted = [...g.leagues].sort((x, y) => (by[y.path]?.n || 0) - (by[x.path]?.n || 0));
          const active = sorted.filter((l) => by[l.path]?.n), quiet = sorted.filter((l) => !by[l.path]?.n);
          // Leagues with no fixtures fold away so long sports stay quick to scroll.
          return `<section class="sec-block cv"><h2 class="sec reveal"><span>${esc(sp.icon)}</span>${esc(g.name)}${active.length ? '' : ' <small>no fixtures this week</small>'}</h2>
            ${active.length ? `<div class="grid leagues">${active.map(card).join('')}</div>` : ''}
            ${quiet.length ? `<details class="more-leagues"><summary>${active.length ? `${quiet.length} more league${quiet.length > 1 ? 's' : ''} with no fixtures` : `Show ${quiet.length} league${quiet.length > 1 ? 's' : ''}`}</summary><div class="grid leagues">${quiet.map(card).join('')}</div></details>` : ''}</section>`;
        }).join('')}
        ${id === 'tennis' ? `<h2 class="sec reveal"><span>📍</span>Tournaments this week</h2><div class="grid leagues">${tournamentsOf(list).map((t) => {
          const n = (d) => t.events.filter((e) => e.tennis.draw === d).length;
          return `<a class="leaguec tilt reveal" href="#/league/${leagueKey(t.events[0].leaguePath)}" style="--c:${sp.color}" data-cursor="OPEN"><b>${esc(t.name)}</b>
            <small>📍 ${esc(t.location || 'TBA')} · ${esc(t.tour)}${t.major ? ' · Grand Slam' : ''}</small>
            <em>${n('Singles')} singles · ${n('Doubles') + n('Mixed doubles')} doubles${t.events.some((e) => e.live) ? ` · <span class="live">${t.events.filter((e) => e.live).length} live</span>` : ''}</em></a>`;
        }).join('') || '<p class="muted">No tournaments in the next 4 days.</p>'}</div>` : ''}
        <h2 class="sec reveal">Every ${esc(sp.name)} match</h2>
        <section class="list cv">${list.slice(0, 20).map(eventRow).join('') || `<p class="muted">${emptyText(sp.groups.flatMap((g) => g.leagues.map((x) => x.path)))}.</p>`}</section>
        ${list.length > 20 ? `<details class="more-leagues"><summary>Show ${Math.min(list.length, 80) - 20} more matches</summary><section class="list">${list.slice(20, 80).map(eventRow).join('')}</section></details>` : ''}`,
    };
  },

  league([key]) {
    const l = leagueFromKey(key || '');
    if (!l) return views.notfound();
    if (l.sport === 'f1') return f1View(S, { legButton, notice });
    if (FIELD_SPORTS.has(l.sport)) return fieldView(S, l.sport, { legButton, notice, only: l.only });
    const sp = sportById(l.sport);
    const list = S.events.filter((e) => e.leaguePath === l.path).sort((a, b) => (b.live - a.live) || a.start - b.start);
    const days = new Map();
    list.forEach((e) => { const d = e.live ? 'Live now' : new Date(e.start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }); if (!days.has(d)) days.set(d, []); days.get(d).push(e); });
    return {
      mode: 'sport', accent: sp.color, title: l.name, sceneOpts: { sport: l.sport },
      after: () => { loadStandings(l); liveLoad([l.path]); },
      html: `<section class="hero small"><p class="kicker reveal"><a href="#/sports">ALL SPORTS</a> / <a href="#/sport/${sp.id}">${esc(sp.name)}</a> / ${esc(l.group)}</p><h1>${split(l.name.toUpperCase())}</h1></section>
        ${notice()}
        ${(l.sport === 'tennis' && tennisBoard(list)) || [...days.entries()].map(([d, evs]) => `<h2 class="sec reveal"><span>${evs.length}</span>${esc(d)}</h2><section class="list">${evs.map(eventRow).join('')}</section>`).join('') || `<p class="muted reveal">${emptyText([l.path])}.</p>`}
        <section class="sec-block" id="league-standings">${standingsHtml(l)}</section>`,
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
        <dt title="Estimated return per unit staked">Return</dt><dd class="${ev == null ? '' : ev >= 0 ? 'pos' : 'neg'}">${ev == null ? '—' : `${(ev * 100).toFixed(1)}%`}</dd>
        <dt>Kelly ¼</dt><dd>${ev && ev > 0 ? pc(kelly(p, bookOdds) / 4, 1) : '—'}</dd></dl></div>`;
    };
    const paramChips = Object.entries(a.params || {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => `<div><small>${esc(paramLabel(k, a.params.unit))}</small><b>${k === 'setWin' ? pc(v) : Number.isInteger(v) ? v : v.toFixed(2)}</b></div>`).join('');
    const d = detailFor(e.id);
    const dos = dossierSections(e, d, hc, ac);
    const rr = researchRow(e);
    const sections = [['overview', 'Overview'], ['case', 'The case'], ['best', 'Best bets'], ...(e.props?.length ? [['props', 'Player props']] : []), ['history', 'Timeline'], ...dos.map((x) => [x.id, x.label]), ['model', a.kind === 'normal' ? 'Margin model' : a.kind === 'tennis' ? (e.sport === 'esports' ? 'Map model' : 'Set model') : 'Score model'], ['markets', `All markets (${a.marketCount})`], ['book', 'Bookmaker prices'], ['form', 'Records'], ['calc', 'Calculator'], ['notes', 'Model notes']];
    if (a.kind === 'binary') sections.splice(sections.findIndex((x) => x[0] === 'model'), 1);
    return {
      mode: 'match', accent: hc, title: `${e.home} v ${e.away}`,
      sceneOpts: { home: hc, away: ac, pHome: w.home, pAway: w.away, sport: e.sport },
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
        ${e.live ? `<div class="scoreline reveal ${String(e.score || '').length > 12 ? 'long' : ''}"><b>${esc(e.score || '')}</b><small data-clock="${esc(e.id)}">${esc(e.clock || '')}</small></div>${liveCenterHtml(e)}${liveBlock(e)}` : ''}
        <div class="match-actions reveal"><button class="watch-btn ${watch.has(e.id) ? 'on' : ''}" data-watch="${esc(e.id)}" aria-pressed="${watch.has(e.id)}">${watchLabel(watch.has(e.id))}</button>
          <button class="watch-btn ${pins().includes(e.id) ? 'on' : ''}" data-pin="${esc(e.id)}">${pinLabel(pins().includes(e.id))}</button></div>
        ${sourcesLine(e)}
      </section>
      <nav class="subnav reveal" aria-label="Sections">${matchGroups(sections, dos).map(([k, l]) => `<a href="#sec-${k}" data-jump="sec-${k}">${l}</a>`).join('')}</nav>
      ${notice()}
      <section class="panel big reveal" id="sec-overview">
        <h2 class="ph">${e.live ? 'Pre-match ' : ''}Estimated win probability <small>${esc(a.basis)}</small></h2>
        ${probBar([{ label: e.home, p: w.home, color: hc }, ...(twoWay ? [] : [{ label: 'Draw', p: w.draw, color: DRAW_COLOR }]), { label: e.away, p: w.away, color: ac }])}
        <div class="sides ${twoWay ? 'two' : 'three'}">${side(e.home, w.home, hc, book(e.home))}${twoWay ? '' : side('Draw', w.draw, DRAW_COLOR, book('Draw'))}${side(e.away, w.away, ac, book(e.away))}</div>
        ${paramChips ? `<div class="params">${paramChips}<div><small>Markets priced</small><b>${a.marketCount}</b></div></div>` : ''}
      </section>
      ${casePanel(rr)}
      ${bestBetsPanel(e, a)}
      ${propsPanel(e)}
      ${historyPanel(e)}
      ${dos.map((x) => `<section id="sec-${x.id}"><h2 class="sec reveal">${esc(x.label)}</h2>${x.html}</section>`).join('')}
      ${a.kind === 'binary' ? '' : `<section class="panel reveal" id="sec-model">${modelPanel(e, a, hc, ac)}</section>`}
      <section id="sec-markets"><h2 class="sec reveal">Every market <small>ATLAS fair prices · tap to add</small></h2>
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

  ...picksViews,

  notfound() {
    return { mode: 'other', accent: '#d2ff00', title: 'Not found', html: `<section class="hero"><h1>${split('404')}</h1><p class="reveal"><a class="btn" href="#/">Back to dashboard</a></p></section>` };
  },
};

// ---------- pieces ----------
// Home dashboard: today's shortlist → live → absence changes → source health.
function dashboard(ev, live) {
  const pool = prefFilter(ev);
  ensureTrack(() => S.refresh?.());
  // Matches starting within the chosen window (3 to 48 hours; 12 by default).
  const hrs = researchPrefs().shortHours;
  // One list, no modes: Best bets, the likeliest winners across every sport at a price no shorter than
  // the market's fair odds (best price across bookmakers where the Odds API gives several), 1.20 to 2.50.
  const short = orderBets(bestBets(todayEvents(pool, Date.now(), hrs), { cal: trackCalibration(), limit: 10 }));
  const empty = `No best bet in the next ${hrs} hours: no ${Math.round(BEST.min * 100)}%+ pick at odds ${BEST.minOdds.toFixed(2)}–${BEST.maxOdds.toFixed(2)} is priced at or above the market's fair odds.${hrs < 48 ? ' Try a longer window in Filters.' : ''}`;
  const rec = recordLine(trackStats()?.best);
  // Every panel by name, shown in the visitor's saved order with hidden ones left out (Customise).
  const panels = {
    potd: () => potdPanel(pool),
    // Minimal: one folded "Filters" control (window, order, odds and sports), one record line.
    shortlist: () => `<div class="panel dash-short reveal"><h2 class="ph">Best bets <small>likeliest winners at a fair price or better</small></h2>
      <details class="sl-filters"${filtersOpen ? ' open' : ''}><summary>${ico('filter')} Next ${hrs}h · ${esc(orderLabel())}</summary>${windowChips('shours', hrs)}${orderChips()}${prefsBar()}</details>
      ${rec ? `<p class="rec-line">So far: ${rec} · <a href="#/track">record</a></p>` : ''}
      <div class="minilist">${S.loading ? skelRows(4) : short.map((b) => miniPick(b)).join('') || `<p class="muted">${empty}</p>`}</div></div>`,
    live: () => `<div class="panel dash-live reveal"><h2 class="ph">Live now <small>${S.loading ? '' : live.length}</small></h2>
      ${S.loading ? skelRows(3) : live.length ? `<ul class="dash-list">${live.slice(0, 6).map((e) => `<li><a href="#/match/${esc(e.id)}">${sportOf(e.sport).icon} ${esc(e.home)} <b>${esc(e.score || '')}</b> ${esc(e.away)}</a><small data-clock="${esc(e.id)}">${esc(e.clock || '')}</small></li>`).join('')}</ul>` : '<p class="muted">Nothing in play right now.</p>'}</div>`,
    every: () => everyTeaser(),
    changes: () => `${changesPanel(ev, { title: lastVisit() ? 'Since your last visit' : 'What changed', limit: 6, hideEmpty: true })}`,
    record: () => `${trackCard(() => S.refresh?.())}`,
    health: () => `<div class="panel dash-health reveal"><h2 class="ph">Source health <small><a href="#/sources">every source →</a></small></h2>${sourceHealth(ev)}</div>`,
  };
  // A chosen size goes on the panel's own element (the first class list of its markup).
  const sized = (k, html) => { const z = readLayout().size?.[k]; return z && SIZES[z] ? html.replace(/class="panel /, `class="panel lay-${z} `) : html; };
  return `<section class="dash">${homeLayout().filter((k) => panels[k]).map((k) => sized(k, panels[k]())).join('')}${layoutPanel()}</section>`;
}

// The shortlist's folded filters stay open across re-renders once opened (main.js listens).
let filtersOpen = false;
export const setFiltersOpen = (v) => { filtersOpen = Boolean(v); };

// Home panels: order and visibility, saved per visitor (localStorage, best effort). Unknown or missing
// names fall back to the default order, so a new panel always appears.
const HOME_PANELS = [['potd', 'Parlay of the day'], ['shortlist', 'Best bets'], ['live', 'Live now'], ['every', 'Every sport'], ['changes', 'What changed'], ['record', 'Track record'], ['health', 'Source health']];
const LAYOUT_KEY = 'atlas-home-layout';
// Minimal by default: the source-health and what-changed panels start hidden (Customise shows them).
const DEFAULT_HIDDEN = ['health', 'changes'];
// Panel widths on wide screens (phones always show one column): auto is the panel's own width.
const SIZES = { third: 'Third', half: 'Half', full: 'Full' };
const SIZE_CYCLE = ['auto', 'third', 'half', 'full'];
const readLayout = () => { try { return JSON.parse(localStorage.getItem(LAYOUT_KEY)) || {}; } catch { return {}; } };
export function homeLayout(saved = readLayout()) {
  const known = HOME_PANELS.map(([k]) => k);
  const order = [...(saved.order || []).filter((k) => known.includes(k)), ...known.filter((k) => !(saved.order || []).includes(k))];
  return order.filter((k) => !(saved.hidden ?? DEFAULT_HIDDEN).includes(k));
}
// Stays open after a change, so several panels can be moved in a row.
let layoutOpen = false;
export function setHomeLayout(action, key) {
  layoutOpen = true;
  const saved = readLayout(), known = HOME_PANELS.map(([k]) => k);
  const order = [...(saved.order || []).filter((k) => known.includes(k)), ...known.filter((k) => !(saved.order || []).includes(k))];
  let hidden = saved.hidden ?? DEFAULT_HIDDEN;
  const i = order.indexOf(key);
  if (action === 'up' && i > 0) [order[i - 1], order[i]] = [order[i], order[i - 1]];
  if (action === 'down' && i >= 0 && i < order.length - 1) [order[i + 1], order[i]] = [order[i], order[i + 1]];
  if (action === 'toggle') hidden = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
  const size = { ...(saved.size || {}) };
  if (action === 'size') { const next = SIZE_CYCLE[(SIZE_CYCLE.indexOf(size[key] || 'auto') + 1) % SIZE_CYCLE.length]; if (next === 'auto') delete size[key]; else size[key] = next; }
  if (action === 'reset') { try { localStorage.removeItem(LAYOUT_KEY); } catch { /* storage blocked */ } return; }
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ order, hidden, size })); } catch { /* storage blocked: this visit only */ }
}
function layoutPanel() {
  const saved = readLayout(), known = HOME_PANELS.map(([k]) => k);
  const order = [...(saved.order || []).filter((k) => known.includes(k)), ...known.filter((k) => !(saved.order || []).includes(k))];
  const name = Object.fromEntries(HOME_PANELS);
  return `<details class="panel dash-layout reveal"${layoutOpen ? ' open' : ''}><summary>Customise this page</summary><ul class="lay-list">${order.map((k, i) => { const off = (saved.hidden ?? DEFAULT_HIDDEN).includes(k); return `<li class="${off ? 'off' : ''}"><span>${name[k]}</span>
    <button class="chip" data-lay="up" data-lay-key="${k}" aria-label="Move ${name[k]} up"${i === 0 ? ' disabled' : ''}>↑</button><button class="chip" data-lay="down" data-lay-key="${k}" aria-label="Move ${name[k]} down"${i === order.length - 1 ? ' disabled' : ''}>↓</button>
    <button class="chip" data-lay="size" data-lay-key="${k}" aria-label="Width of ${name[k]}: ${SIZES[saved.size?.[k]] || 'Auto'} (tap to change)">${SIZES[saved.size?.[k]] || 'Auto'}</button>
    <button class="chip ${off ? '' : 'on'}" data-lay="toggle" data-lay-key="${k}" aria-pressed="${!off}">${off ? 'Hidden' : 'Shown'}</button></li>`; }).join('')}</ul><button class="btn-ghost" data-lay="reset" data-lay-key="">Reset layout</button></details>`;
}

// Result badge for a leg or a slip: Won / Lost / Void, or the live score while it is being played.
const RESULT = { won: 'Won', lost: 'Lost', void: 'Void', push: 'Void', dnp: 'Void' };
const resultBadge = (status, live) => (RESULT[status] ? `<span class="res res-${status === 'push' || status === 'dnp' ? 'void' : status}">${RESULT[status]}</span>` : live ? `<span class="res res-live">LIVE ${esc(live.score || '')}</span>` : '');
// The day these cards follow: 12:00 to 12:00 in the recorded zone nearest the visitor's (IST unless
// GMT is chosen), shown in the visitor's own time zone too.
const dayZone = () => (POTD_ZONES[tzZone()] ? tzZone() : 'IST');
const dayLabel = (day) => { const z = tzZone(), rz = dayZone(); return `12:00 to 12:00 ${tzAbbr(rz)}${z === rz ? '' : ` · ${fmtTime(day.start, z, 'short')} to ${fmtTime(day.end, z, 'short')} your time`}`; };
const nextIn = (day) => { const left = Math.max(0, day.end - Date.now()); return `${Math.floor(left / 36e5)}h ${Math.floor((left % 36e5) / 6e4)}m`; };
const zoneLink = () => `<button class="zone-link" data-display-toggle aria-label="Change the time zone">${ico('clock')} ${esc(tzAbbr(tzZone()))} · change</button>`;

// Parlay of the day: one slip at 1.70 to 2.00 for the day, 2 to 6 legs, the likeliest combination
// on the board. The saved one (the record's) once the build has saved it; until then the same pick, live.
function potdPanel(ev) {
  const rz = dayZone(), day = potdDay(Date.now(), rz);
  const saved = officialParlay(rz);
  const live = saved ? null : parlayOfDay(ev, { zone: rz, cal: trackCalibration() });
  const byId = new Map(ev.map((e) => [e.id, e]));
  const legs = saved ? saved.legs : (live?.legs || []).map((l) => { const e = byId.get(l.eventId); return { ...l, home: e?.home, away: e?.away, status: 'pending' }; });
  const odds = saved ? saved.odds : live?.odds, p = saved ? saved.p : live?.p;
  const rec = recordLine(trackStats()?.potd);
  const done = saved && RESULT[saved.status];
  const body = legs.length ? `${done ? `<p class="potd-result res-${saved.status}">${saved.status === 'won' ? `Won · paid ${odd(saved.settledOdds ?? odds)}` : saved.status === 'lost' ? `Lost · ${esc(legs.filter((l) => l.status === 'lost').map((l) => l.pick).join(', '))}` : 'Void'}</p>` : ''}
    <ul class="potd-legs">${legs.map((l) => { const e = byId.get(l.eventId); return `<li class="leg-${esc(l.status || 'pending')}"><a href="#/match/${esc(l.eventId)}"><b>${esc(l.pick)}</b><small>${esc(l.market)} · ${esc(l.home || '')} v ${esc(l.away || '')} · ${esc(fmtTime(l.start, tzZone(), 'short'))}</small></a>
      <span class="leg-side">${resultBadge(l.status, e?.live && e)}<span class="leg-p" title="ATLAS chance for this leg">${pc(l.p, 0)}</span>${legButton({ key: `${l.eventId}|${l.market}|${l.pick}`, eventId: l.eventId, sport: l.sport, match: `${l.home} vs ${l.away}`, market: l.market, pick: l.pick, odds: l.odds, p: l.p }, odd(l.odds))}</span></li>`; }).join('')}</ul>
    <div class="potd-sum"><span><small>Total odds</small><b>${odd(odds)}</b></span><span><small>ATLAS chance</small><b>${pc(p, 0)}</b></span><span><small>Break-even</small><b>${pc(1 / odds, 0)}</b></span><span><small>Next parlay in</small><b>${nextIn(day)}</b></span></div>
    <p class="muted potd-note">The likeliest ${legs.length}-leg combination at 1.70 to 2.00 today. At ${odd(odds)} the bookmakers rate a slip like this about ${pc(1 / odds, 0)}: more, shorter legs do not change that. ${(saved || live)?.fairOnly ? 'Every leg is at its fair odds or better.' : 'Some legs are below their fair odds today.'}</p>`
    : `<p class="muted">${S.loading ? 'Loading…' : `No parlay yet for this day: not enough strong legs before 12:00 ${tzAbbr(rz)}. Next one in ${nextIn(day)}.`}</p>`;
  return `<div class="panel dash-potd reveal"><h2 class="ph">Parlay of the day <small>${legs.length ? `${legs.length} legs · ` : ''}${esc(dayLabel(day))}${saved ? '' : legs.length ? ' · not saved yet' : ''}</small>${zoneLink()}</h2>${body}${rec ? `<p class="rec-line">So far: ${rec} · <a href="#/track">record</a></p>` : ''}</div>`;
}

// The match page's menu: five groups, each jumping to its first section on this page (sections a
// sport doesn't have are left out, and a group with none is not shown).
function matchGroups(sections, dos) {
  const has = new Set(sections.map(([k]) => k)), first = (ids) => sections.find(([k]) => ids.includes(k))?.[0];
  const groups = [['Overview', ['overview', 'case', 'best']], ['Markets', ['markets', 'book', 'props', 'calc']], ['Team & player evidence', [...dos.map((x) => x.id), 'form', 'model']], ['News & changes', ['history']], ['History & sources', ['notes']]];
  return groups.map(([l, ids]) => [first(ids.filter((k) => has.has(k))), l]).filter(([k]) => k);
}

function sourceHealth(ev) {
  const newest = (list, f) => list.reduce((t, x) => Math.max(t, f(x) || 0), 0);
  const espn = ev.filter((e) => e.leaguePath && !e.leaguePath.startsWith('atlas/') && e.source !== 'MLB Stats API');
  const reports = ev.flatMap((e) => (e.probables || []).filter((p) => p.report?.league === 'MLB').map((p) => p.report));
  const rows = [
    ['Snapshot build', ev.length, S.fetchedAt, `every league, rebuilt about every 15 min · ${{ fresh: 'on time', delayed: 'delayed', stale: 'overdue', unknown: 'not known yet' }[buildState()]}`],
    ['ESPN scoreboards', espn.length, newest(espn, (e) => e.fetchedAt), 'fixtures, scores, reference odds'],
    ['NPB official', ev.filter((e) => e.leaguePath === 'atlas/npb').length, newest(ev.filter((e) => e.leaguePath === 'atlas/npb'), (e) => e.fetchedAt), 'schedule, starters'],
    ['KBO official', ev.filter((e) => e.leaguePath === 'atlas/kbo').length, newest(ev.filter((e) => e.leaguePath === 'atlas/kbo'), (e) => e.fetchedAt), 'schedule, starters'],
    ['KHL official', ev.filter((e) => e.leaguePath === 'atlas/khl').length, newest(ev.filter((e) => e.leaguePath === 'atlas/khl'), (e) => e.fetchedAt), 'schedule, live scores, records'],
    ['MLB Stats API', reports.length, newest(reports, (r) => r.fetchedAt), 'starter reports'],
    ['FotMob', ev.filter((e) => e.absences).length, newest(ev, (e) => e.absences?.fetchedAt), 'soccer absences'],
  ];
  return `<ul class="health">${rows.map(([n, c, t, what]) => `<li class="${S.loading ? 'idle' : c ? freshClass(t) : 'idle'}"><i></i><b>${n}</b><span>${S.loading ? 'checking…' : c ? `${c} · ${ago(t)}` : 'nothing scheduled'}</span><small>${what}</small></li>`).join('')}</ul>`;
}

// In play: the live estimate from the current score and time left, then a note that the rest is pre-match.
function liveBlock(e) {
  const lw = liveWin(e);
  const rest = `Prices, markets and the score grid below are <b>pre-match</b> and ignore the score${e.score ? ` (${esc(e.score)})` : ''}.`;
  if (!lw) return `<p class="live-warn reveal">In play: every probability on this page is a <b>pre-match estimate</b>. ${rest}</p>`;
  const parts = [[e.home, lw.home], ...(lw.draw != null ? [['Draw', lw.draw]] : []), [e.away, lw.away]];
  return `<div class="live-est reveal"><h3>Live estimate <small>score ${esc(e.score)} · about ${Math.round(lw.left * 100)}% of the game left</small></h3>
    <div class="le-row">${parts.map(([n, p]) => `<div><small>${esc(n)}</small><b>${pc(p, 0)}</b></div>`).join('')}</div>
    <p>${rest} The live estimate runs the pre-match model over the time left; it doesn't know about red cards, injuries or momentum.</p></div>`;
}

// Per-match: where each piece of data came from and how old it is.
function sourcesLine(e) {
  const d = detailFor(e.id);
  const st = (e.probables || []).find((p) => p.report)?.report;
  const parts = [
    ...(e.priceAt && e.bookmaker ? [[e.source || (e.leaguePath?.startsWith('atlas/') ? 'League site' : 'ESPN'), e.fetchedAt ?? null, 'fixture'], [e.bookmaker, e.priceAt, 'price']]
      : [[e.source || (e.leaguePath?.startsWith('atlas/') ? 'League site' : 'ESPN'), e.fetchedAt ?? null, 'fixture & price']]),
    st ? [st.sourceLabel?.replace(/ profile$/, '') || st.league, st.fetchedAt ?? null, 'starters'] : null,
    e.absences ? ['FotMob', e.absences.fetchedAt, e.absences.carried ? 'absences (kept from an earlier read)' : 'absences'] : null,
    d?.ok && !d.native ? ['ESPN summary', d.fetchedAt, 'stats, injuries, form'] : null,
  ].filter(Boolean);
  const down = e.stale ? `<span class="stale"><i></i>Feed down: not updated since ${ago(e.staleSince || e.fetchedAt)}</span>` : '';
  return `<p class="sources reveal">${down}${parts.map(([n, t, what]) => `<span class="${freshClass(t)}"><i></i>${esc(what)}: ${esc(n)} · ${ago(t)}</span>`).join('')}</p>`;
}

export const whyTag = (b) => { const w = whyLine(b); return w ? `<small class="why"><b>Why:</b> ${esc(w)}</small>` : ''; };

// Best bets for one match: 1-3 picks that agree with each other (see coherentBets in picks.js).
export function matchBestBets(e, a) { return coherentBets(e, a, { cal: trackCalibration() }).picks; }

// Player props for this match (DraftKings milestones and anytime scorers), likeliest first, each with
// the player's hit rates and last 10 games (propsview.js).
function propsPanel(e) {
  if (!e.props?.length) return '';
  const rows = allProps([e], Date.now(), { any: true }).map((p) => p.x).sort((a, b) => b.p - a.p).slice(0, 16);
  if (!rows.length) return '';
  return `<section class="sec-block" id="sec-props"><h2 class="sec reveal">Player props <small>${e.live ? 'pre-match prices · ' : ''}DraftKings lines · ATLAS chance vs market · tap a price to add · <a href="#/props">all props</a></small></h2>
    <div class="panel reveal props-list2">${rows.map((x) => propRow(e, x)).join('')}</div></section>`;
}

function bestBetsPanel(e, a) {
  const list = matchBestBets(e, a);
  if (!list.length) return '';
  return `<section class="sec-block" id="sec-best"><h2 class="sec reveal">Best bets for this match <small>${e.live ? 'pre-match estimates · ' : ''}one consistent view: same side, one goals direction · tap to add</small></h2>
    <div class="best-bets">${list.map((b) => {
      const leg = b.book ? { key: `${e.id}|${b.market}|${b.pick}`, eventId: e.id, sport: e.sport, match: `${e.home} vs ${e.away}`, market: b.market, pick: b.pick, odds: b.odds, p: b.q }
        : { key: `${e.id}|fair|${b.market}|${b.pick}`, eventId: e.id, sport: e.sport, match: `${e.home} vs ${e.away}`, market: b.market, pick: b.pick, odds: +b.odds.toFixed(2), p: b.q, derived: true };
      const yn = /^(Yes|No|Over|Under)$/.test(b.pick);
      return `<div class="bb panel reveal"><small>${esc(b.label)}</small><b>${esc(yn ? `${b.market}: ${b.pick}` : b.pick)}</b><p class="muted bb-m">${yn ? '' : `${esc(b.market)} · `}${b.book ? 'bookmaker odds' : 'ATLAS fair odds'}</p>${e.live ? '' : istTag(e.start)}<div class="bb-row"><span>${pc(b.q, 0)}</span><em>${esc(b.why || '')}</em>${legButton(leg, odd(b.odds))}</div></div>`;
    }).join('')}</div></section>`;
}

// A two-word status beside a pick when an input it depends on is still pending (details on hover or
// tap); nothing when every input its sport needs is in.
const PENDING = { price: 'Price updating', goalies: 'Goalies pending', lineups: 'Lineup pending', lineup: 'Lineup pending', starters: 'Starters pending', pitchers: 'Starters pending', injuries: 'Injury news pending', toss: 'Toss pending' };
function statusPill(e) {
  if (e.live) return '';
  const r = readiness(e, { priceAt: priceTime(e) });
  if (r.state === 'ready' || (r.state === 'limited' && !e.stale)) return '';
  const miss = r.checks.find((c) => c.ok === false);
  const word = e.stale ? 'Feed delayed' : miss ? PENDING[miss.key] || `${miss.label} pending` : r.state === 'limited' ? 'Limited data' : 'Checking';
  const why = r.checks.filter((c) => c.ok !== true).map((c) => `${c.label}: ${c.note}`).join('\n');
  return `<small class="pill-status" tabindex="0" title="${esc(why)}">${esc(word)}</small>`;
}

// A pick, minimal: the pick, the match and when; then ATLAS's chance, what the price needs and the
// return, on one line. The reasons, the best bookmaker and the market's own chance are on hover / tap
// (title) and on the match page.
function miniPick(b) {
  const s = sportOf(b.event.sport);
  const rec = recommendationFor(b, trackCalibration());
  const leg = { key: `${b.event.id}|${b.market}|${b.pick}`, eventId: b.event.id, sport: b.event.sport, match: `${b.event.home} vs ${b.event.away}`, market: b.market, pick: b.pick, odds: b.odds, p: b.p, recommendationId: rec.recommendationId, ...(b.prop ? { prop: b.prop } : {}) };
  const edge = `${b.ev >= 0 ? '+' : ''}${(b.ev * 100).toFixed(1)}%`;
  const tip = [whyLine(b) && `Why: ${whyLine(b)}`, b.fair != null && `Market (no margin): ${pc(b.fair, 0)}`, b.book && `Best price: ${b.book}`, `Chance range ${pc(rec.uncertaintyRange[0], 0)}–${pc(rec.uncertaintyRange[1], 0)}`, rec.settlementRules].filter(Boolean).join('\n');
  return `<div class="mini reveal" data-rec="${esc(rec.recommendationId)}" title="${esc(tip)}"><span class="mini-ico">${s.icon}</span>
    <a class="mini-main" href="#/match/${esc(b.event.id)}"><b>${esc(b.pick)}</b><small>${esc(b.event.home)} v ${esc(b.event.away)} · ${b.event.live ? '<span class="live">LIVE</span>' : esc(fmtTime(b.event.start, tzZone(), 'short'))}</small>${statusPill(b.event)}</a>
    <div class="mini-nums"><b title="ATLAS chance">${pc(b.p, 0)}</b><small><span class="mm-need" title="The chance this price needs to break even">needs ${pc(1 / b.odds, 0)} · </span><span class="${b.ev >= 0 ? 'pos' : 'neg'}" title="Estimated return per unit staked${b.ev < 0 ? ': below break-even at this price' : ''}">${edge}</span></small></div>
    ${legButton(leg, odd(b.odds))}</div>`;
}

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
      return `<tr><td>${i ? '' : `${esc(m.name)}<small> margin ${(d.margin * 100).toFixed(1)}%${m.consensusFrom ? ` · fair from ${esc(m.consensusFrom)}` : ''}</small>`}</td><td>${esc(o.name)}</td><td class="num">${odd(o.odds)}${o.book ? `<small>${esc(o.book)}</small>` : ''}</td><td class="num">${pc(1 / o.odds)}</td><td class="num">${pc(fair)}</td><td class="num">${o.model != null ? pc(o.model) : '—'}</td>
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

// Load leagues live in the browser (once per visit each), merge, and redraw. Covers every league,
// including any the hourly snapshot could not fetch.
const liveLoaded = new Set();
// Load leagues straight from ESPN when their page opens. A league that fails is retried (never
// marked as loaded), so a hiccup can't leave a page saying there are no fixtures.
async function liveLoad(paths, tries = 0) {
  const todo = LEAGUES.filter((l) => paths.includes(l.path) && !liveLoaded.has(l.path));
  if (!todo.length) return;
  todo.forEach((l) => liveLoaded.add(l.path));
  const started = Date.now();
  const fresh = await fetchAll(undefined, todo, { days: 4, concurrency: 4 }).catch(() => []);
  const failed = todo.filter((l) => !(leagueStatus.get(l.path)?.ok && leagueStatus.get(l.path).at >= started));
  failed.forEach((l) => liveLoaded.delete(l.path));
  if (fresh.length) {
    applyModel(fresh);
    const map = new Map(S.events.map((e) => [e.id, e]));
    fresh.forEach((f) => map.set(f.id, mergeEvent(map.get(f.id), f)));
    S.events.splice(0, S.events.length, ...map.values());
  }
  S.refresh?.();
  if (failed.length && tries < 4) setTimeout(() => liveLoad(failed.map((l) => l.path), tries + 1), 6000 * (tries + 1));
}
// "No fixtures" only for leagues whose feed actually answered; otherwise we are still loading.
const leagueKnown = (path) => path.startsWith('atlas/') || leagueStatus.get(path)?.ok === true;
const emptyText = (paths) => (paths.every(leagueKnown) ? 'No fixtures in the next 4 days' : 'Loading fixtures…');

function countBy() {
  const out = {};
  for (const e of S.events) { const c = out[e.leaguePath] || (out[e.leaguePath] = { n: 0, live: 0 }); c.n++; if (e.live) c.live++; }
  return out;
}

// League table (ESPN standings endpoint); NPB/KBO have none in the feed. Kept per league for 10
// minutes and drawn straight into the page, so a redraw (new fixtures, a live score) shows the same
// table at once instead of blanking it and asking ESPN again.
const standingsCache = new Map(); // path -> { at, html, pending }
const standingsHtml = (l) => standingsCache.get(l.path)?.html || '';
async function loadStandings(l) {
  if (l.path.startsWith('atlas/')) return;
  const paint = (html) => { const box = document.getElementById('league-standings'); if (box && html && box.innerHTML !== html) box.innerHTML = html; };
  const c = standingsCache.get(l.path);
  if (c?.pending) return c.pending.then(paint);
  if (c && Date.now() - c.at < 10 * 6e4) return paint(c.html);
  const pending = (async () => {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/v2/sports/${l.path}/standings`);
      const j = await r.json();
      const groups = (j.children?.length ? j.children : [j]).map((g) => ({ name: g.name || g.abbreviation || l.name, entries: g.standings?.entries || [] })).filter((g) => g.entries.length);
      if (!groups.length) return '';
      const goals = /^(soccer|hockey)\//.test(l.path);
      return `<h2 class="sec">Standings</h2>${groups.map((g) => `<div class="panel"><h3 class="ph">${esc(g.name)}</h3>${standingsTable(g.entries.map((en) => ({ team: en.team?.displayName || en.team?.name || '', stats: canonStats(en.stats || []) })), { goals })}</div>`).join('')}`;
    } catch { return ''; } // standings optional
  })();
  standingsCache.set(l.path, { ...c, pending });
  const html = await pending;
  // A failed fetch keeps any older table and is tried again on the next visit.
  standingsCache.set(l.path, html ? { at: Date.now(), html } : { at: 0, html: c?.html || '' });
  paint(html || c?.html);
}

export { buildSlips };
