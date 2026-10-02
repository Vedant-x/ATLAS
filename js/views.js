// Page templates. Each view returns { html, mode, accent, sceneOpts?, title, after? }.
import { SPORTS } from './data.js';
import { devig, buildSlips } from './engine.js';
import { bankers, valueSpots } from './intel.js';
import { analyse, winProbs, kelly } from './models.js';
import { probBar, gauge, heatmap, distBars, formStrip, outcomeBars, valueTrack, pc, odd } from './charts.js';
import { split } from './ui.js';
import { slip } from './slip.js';
import { CATALOG, sportById, leagueByPath, leagueKey, leagueFromKey } from './catalog.js';
import { detailFor, loadDetail as fetchDetail } from './detail.js';
import { dossierSections } from './dossier.js';

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

function notice() {
  const o = S.odds;
  const stake = o?.status === 'connected' || o?.status === 'partial';
  return `<div class="notice reveal"><span class="led ${S.demo ? '' : 'on'}"></span>
    <b>${S.demo ? 'DEMO DATA' : esc(S.source)}</b> · updated <span data-ago>just now</span> ·
    ${S.demo ? 'live feeds unreachable, prices are simulated.' : stake ? `<b class="ok">Stake prices live</b> (${o.selections.length})` : S.server ? `Stake not connected (<a href="desk.html#connections">connect</a>): showing ESPN reference odds and ATLAS model lines.` : 'Showing ESPN reference odds and ATLAS model lines. Stake prices need the ATLAS server (npm start).'}
    <em>Probabilities are estimates, not guarantees.</em></div>`;
}

// ---------- rows & cards ----------
function eventRow(e) {
  const s = sportOf(e.sport), w = winProbs(e);
  const hc = safeColor(e.colors?.home, s.color), ac = safeColor(e.colors?.away, AWAY_COLOR);
  const main = e.markets?.[0];
  const d = main ? devig(main) : null;
  return `<article class="row tilt reveal" style="--c:${s.color}">
    <a class="row-link" href="#/match/${esc(e.id)}" data-cursor="OPEN" aria-label="${esc(e.home)} vs ${esc(e.away)}"></a>
    <span class="ico">${s.icon}</span>
    <div class="teams"><b>${esc(e.home)}</b><b>${esc(e.away)}</b><small>${esc(e.league)} · ${when(e)}</small></div>
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
      <span>Win chance <b>${pc(s.p, s.p < 0.01 ? 2 : 1)}</b></span><span>Edge <b class="${s.p * s.odds - 1 >= 0 ? 'pos' : 'neg'}">${((s.p * s.odds - 1) * 100).toFixed(1)}%</b></span>
      <button class="btn-ghost" data-addall="${esc(keys.join('~'))}" data-cursor="ADD ALL">Add all to slip</button>
    </footer></article>`;
}

// ---------- views ----------
export const views = {
  home() {
    const ev = S.events;
    const live = ev.filter((e) => e.live);
    const upcoming = [...ev].filter((e) => !e.live).sort((a, b) => a.start - b.start);
    const bk = bankers(ev, { limit: 6 });
    const val = valueSpots(ev, { limit: 6 });
    const featured = bk[0]?.event || upcoming[0];
    const modelled = ev.reduce((n, e) => n + (e.markets?.length ? 1 : 0), 0);
    const counts = Object.fromEntries(SPORTS.map((s) => [s.id, ev.filter((e) => e.sport === s.id)]));
    return {
      mode: 'home', accent: '#d2ff00', title: 'Dashboard',
      html: `
      <section class="hero">
        <p class="kicker reveal">ATLAS · SPORTS INTELLIGENCE SYSTEM</p>
        <h1>${split('EVERY SPORT.')}<br>${split('EVERY EDGE.')}</h1>
        <p class="lede reveal">Live fixtures, official feeds, bookmaker prices with the margin stripped out, and a model that prices every market: correct scores, handicaps, totals, set betting. One screen.</p>
        <div class="cta reveal"><a class="btn" href="#/edge" data-magnetic data-cursor="GO">Open edge board</a><a class="btn-ghost" href="#/bankers" data-magnetic data-cursor="GO">Today's bankers</a></div>
        <div class="stats reveal">
          <div><b data-count-to="${ev.length}">0</b><span>events tracked</span></div>
          <div><b data-count-to="${SPORTS.filter((s) => counts[s.id]?.length).length}">0</b><span>sports live</span></div>
          <div><b data-count-to="${modelled}">0</b><span>priced by market</span></div>
          <div><b class="hot" data-count-to="${live.length}">0</b><span>in play</span></div>
        </div>
        <div class="scroll-hint" aria-hidden="true"><i></i>SCROLL</div>
      </section>
      ${notice()}
      ${live.length ? `<section class="sec-block"><h2 class="sec reveal"><span>01</span>In play</h2><div class="hscroll">${live.map((e) => `<a class="livec tilt" href="#/match/${esc(e.id)}" style="--c:${sportOf(e.sport).color}"><small>${sportOf(e.sport).icon} ${esc(e.league)} · ${esc(e.clock || '')}</small><b>${esc(e.home)}</b><b>${esc(e.away)}</b><em>${esc(e.score || '—')}</em></a>`).join('')}</div></section>` : ''}
      ${featured ? featuredCard(featured) : ''}
      <section class="sec-block"><h2 class="sec reveal"><span>${live.length ? '03' : '02'}</span>Sports</h2>
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
      ${S.news?.length ? `<section class="sec-block"><h2 class="sec reveal"><span>◆</span>Headlines</h2><div class="grid news">${S.news.slice(0, 9).map((n) => `<a class="newsc tilt reveal" href="${safeHref(n.url)}" target="_blank" rel="noopener noreferrer" data-cursor="READ"><small>${esc(n.sport)} · ${esc(n.source)}</small><b>${esc(n.title)}</b></a>`).join('')}</div></section>` : ''}
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
    const by = countBy();
    const list = S.events.filter((e) => e.sport === id).sort((a, b) => (b.live - a.live) || a.start - b.start);
    return {
      mode: 'sport', accent: sp.color, title: sp.name,
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
      after: () => loadStandings(l),
      html: `<section class="hero small"><p class="kicker reveal"><a href="#/sports">ALL SPORTS</a> / <a href="#/sport/${sp.id}">${esc(sp.name)}</a> / ${esc(l.group)}</p><h1>${split(l.name.toUpperCase())}</h1></section>
        ${notice()}
        ${[...days.entries()].map(([d, evs]) => `<h2 class="sec reveal"><span>${evs.length}</span>${esc(d)}</h2><section class="list">${evs.map(eventRow).join('')}</section>`).join('') || '<p class="muted reveal">No fixtures in the next 4 days.</p>'}
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
    const paramChips = Object.entries(a.params || {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => `<div><small>${esc(paramLabel(k, a.params.unit))}</small><b>${k === 'setWin' ? pc(v) : v.toFixed(2)}</b></div>`).join('');
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
        <p class="kicker reveal">${s.icon} ${esc(e.league)} · ${when(e)} · ${e.bookmaker ? esc(e.bookmaker) : 'no bookmaker price'} ${confBadge(a.confidence)}</p>
        <h1 class="vs"><span style="--tc:${hc}">${split(e.home.toUpperCase())}</span><small>VS</small><span style="--tc:${ac}">${split(e.away.toUpperCase())}</span></h1>
        ${e.live ? `<div class="scoreline reveal"><b>${esc(e.score || '')}</b><small>${esc(e.clock || '')}</small></div>` : ''}
      </section>
      <nav class="subnav reveal">${sections.map(([k, l]) => `<a href="#sec-${k}" data-jump="sec-${k}">${l}</a>`).join('')}</nav>
      ${notice()}
      <section class="panel big reveal" id="sec-overview">
        <h2 class="ph">Win probability <small>${esc(a.basis)}</small></h2>
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
    const list = S.slips(target, { count: 5, maxLegs: target <= 5 ? 3 : 5, tolerance: 0.08 });
    return {
      mode: 'x', accent: ['#d2ff00', '#00ffc3', '#4fd1ff', '#b08cff'][[2, 3, 4, 5].indexOf(target)] || '#ff9f43', title: `${target}x slips`,
      html: `<section class="hero small"><p class="kicker reveal">MULTIPLIER · BREAK-EVEN ${pc(1 / target, 1)}</p><h1>${split(`${target}X SLIPS`)}</h1>
        <nav class="tabs reveal">${[2, 3, 4, 5, 10, 20].map((x) => `<a href="#/x/${x}" class="${x === target ? 'on' : ''}">${x}x</a>`).join('')}</nav></section>
        ${notice()}
        <p class="lede reveal">Combinations whose total odds land near ${target}x, ranked by edge and true win chance. A fairly priced ${target}x slip wins about ${pc(1 / target, 0)} of the time; each extra leg adds another bookmaker margin.</p>
        <section class="grid slips">${list.map((s, i) => slipCard(s, i, target)).join('') || '<p class="muted">Not enough priced events for this target right now.</p>'}</section>`,
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
    const list = bankers(S.events, { limit: 40 });
    const val = valueSpots(S.events, { limit: 20 });
    return {
      mode: 'bankers', accent: '#00ffc3', title: 'Bankers',
      html: `<section class="hero small"><p class="kicker reveal">EASY-WIN RADAR · ALL SPORTS</p><h1>${split('BANKERS')}</h1>
        <p class="lede reveal">Every pick on the board at 70%+ model chance. Short prices, small returns, and they still lose roughly one time in four to one time in ten.</p></section>
        ${notice()}
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
  return `<p class="cap">${list.length} of ${rows.length} prices</p><table class="tbl"><thead><tr><th></th><th>Match</th><th>Market</th><th>Pick</th><th>Odds</th><th>Fair</th><th>Model</th><th>Edge</th><th>Kelly ¼</th><th></th></tr></thead><tbody>
    ${list.map((r) => `<tr><td>${sportOf(r.e.sport).icon}</td><td><a href="#/match/${esc(r.e.id)}">${esc(r.e.home)} v ${esc(r.e.away)}</a><small>${esc(r.e.league)} · ${when(r.e)}</small></td><td>${esc(r.m.name)}</td><td><b>${esc(r.o.name)}</b></td>
      <td class="num">${odd(r.o.odds)}</td><td class="num">${pc(r.fair)}</td><td class="num">${r.o.model != null ? pc(r.o.model) : '—'}</td><td class="num ${r.ev >= 0 ? 'pos' : 'neg'}">${(r.ev * 100).toFixed(1)}%</td><td class="num">${r.ev > 0 ? pc(kelly(r.p, r.o.odds) / 4) : '—'}</td><td>${legButton(bookLeg(r.e, r.m, r.o, r.p), '+')}</td></tr>`).join('')}
    </tbody></table>`;
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
