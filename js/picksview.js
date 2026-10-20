// Picks: the bankers list, the edge board and the multiplier builder (2x to 20x, any target, 100x
// and 1000x), one menu entry with these pages as its tabs.
import { SPORTS } from './data.js';
import { devig, todayEvents } from './engine.js';
import { kelly } from './models.js';
import { pc, odd } from './charts.js';
import { split } from './ui.js';
import { prefs } from './prefs.js';
import { trackStats, trackCalibration, trackModelRecord, recordLine, ensureTrack, slipHistory, officialSlip } from './trackview.js';
import { modelPicks } from './modelpicks.js';
import { coverage, COVERAGE_FIELDS } from './coverage.js';
import { rankedBankers, slipPolicy, MAX_ODDS } from './track.js';
import { orderBets, orderChips } from './research.js';
import { fmt, zone } from './tz.js';
import { views, esc, sportOf, notice, when, istTag, legButton, legIndex, whyTag, prefsBar, prefFilter, bookLeg } from './views.js';

let S;
export function bindPicks(state) { S = state; }

// How much an option repeats an earlier one: the most legs it shares with any option above it.
function overlapNote(s, i, all = []) {
  const ids = (x) => new Set(x.legs.map((l) => `${l.eventId}|${l.pick}`));
  const mine = ids(s);
  let best = null;
  all.slice(0, i).forEach((o, j) => { const n = [...ids(o)].filter((k) => mine.has(k)).length; if (n && (!best || n > best.n)) best = { n, j }; });
  return best ? `<span class="overlap">Shares ${best.n} of ${s.legs.length} legs with #${String(best.j + 1).padStart(2, '0')}</span>` : (i ? '<span class="overlap fresh">No legs shared with the options above</span>' : '');
}
// One slip as a compact card: the multiplier, chance and edge up top, a strip with one segment per leg
// (coloured by its chance, hover or long-press for the pick), the weakest leg, and the full legs
// behind "Show legs". Short slips (4 legs or fewer, below 10x) open by default.
const chanceTone = (p) => (p >= 0.8 ? 'c5' : p >= 0.72 ? 'c4' : p >= 0.65 ? 'c3' : p >= 0.58 ? 'c2' : 'c1');
const hourMin = (t) => (Number.isFinite(t) ? fmt(t, zone(), 'short') : '');
function slipCard(s, i, target, all) {
  const startOf = (l) => l.start ?? S.events.find((x) => x.id === l.eventId)?.start;
  const keys = s.legs.map((l) => {
    const leg = { key: `${l.eventId}|${l.market}|${l.pick}`, eventId: l.eventId, sport: l.sport, match: l.match, market: l.market, pick: l.pick, odds: l.odds, p: l.p, ...(l.prop ? { prop: l.prop } : {}) };
    legIndex.set(leg.key, leg);
    return leg.key;
  });
  const legs = orderBets(s.legs, undefined, startOf);
  const edge = s.p * s.odds - 1;
  const weakest = s.legs.reduce((w, l) => (!w || l.p < w.p ? l : w), null);
  const times = s.legs.map(startOf).filter(Number.isFinite).sort((a, b) => a - b);
  const sports = [...new Set(s.legs.map((l) => l.sport))];
  const open = s.legs.length <= 4 && target < 10;
  return `<article class="slipc slipc2 tilt reveal">
    <header><span class="tag">#${String(i + 1).padStart(2, '0')}</span><span class="mult">${s.odds.toFixed(2)}<small>x</small></span></header>
    <div class="sc-stats">
      <div><small>Chance</small><b>${pc(s.p, s.p < 0.01 ? 2 : 1)}</b></div>
      <div><small>Edge</small><b class="${edge >= 0 ? 'pos' : 'neg'}">${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(1)}%</b></div>
      <div><small>Sports</small><b class="sc-sp" title="${esc(sports.map((x) => sportOf(x).name).join(', '))}">${sports.slice(0, 3).map((x) => sportOf(x).icon).join('')}${sports.length > 3 ? `<small>+${sports.length - 3}</small>` : ''}</b></div>
    </div>
    <div class="sc-strip" role="img" aria-label="${s.legs.length} legs by chance">${legs.map((l) => `<i class="${chanceTone(l.p)}" title="${esc(`${l.pick} · ${pc(l.p, 0)} · ${l.odds.toFixed(2)}`)}"></i>`).join('')}</div>
    <p class="sc-line">${times.length ? `<span>${esc(hourMin(times[0]))}${times.length > 1 && times.at(-1) - times[0] > 36e5 ? ` → ${esc(hourMin(times.at(-1)))}` : ''}</span>` : ''}${weakest ? `<span>Weakest: <b>${esc(weakest.pick)}</b> ${pc(weakest.p, 0)}</span>` : ''}</p>
    ${overlapNote(s, i, all)}
    <details class="sc-legs"${open ? ' open' : ''}><summary><span>${s.legs.length} legs</span><span class="sr-only"> of slip ${target}x #${i + 1} at ${s.odds.toFixed(2)}</span><i aria-hidden="true"></i></summary>
      <ul>${legs.map((l) => `<li><span class="sp">${sportOf(l.sport).icon}</span><div><b>${esc(l.pick)}</b><small>${esc(l.market)} · ${esc(l.match)}</small>${istTag(startOf(l))}</div><em>${l.odds.toFixed(2)}</em><i class="${chanceTone(l.p)}">${pc(l.p, 0)}</i></li>`).join('')}</ul>
    </details>
    <footer>
      <p class="slip-note">${edge >= 0 ? 'Priced above its estimated chance' : 'Priced below its estimated chance'} · legs treated as independent${s.search?.wider ? ` · <b>wider search</b>: nothing fit the strict rules, so legs rated ${Math.round(s.search.minP * 100)}%+ at up to ${s.search.maxLegOdds.toFixed(2)}, total within ${Math.round(s.search.tolerance * 100)}% of ${target}x` : ''}</p>
      <button class="btn-ghost" data-addall="${esc(keys.join('~'))}" data-cursor="ADD ALL">Add all to slip</button>
    </footer></article>`;
}

// Picks: one menu entry, these pages as its tabs.
const builderNav = (on) => `<nav class="builder-nav reveal" aria-label="Picks">${[['bankers', '#/bankers', 'Bankers'], ['every', '#/every', 'Every sport'], ['edge', '#/edge', 'Edge board'], ['x', '#/x/2', 'Multipliers'], ['target', '#/target', 'Target'], ['mega', '#/mega', 'Mega']].map(([k, h, l]) => `<a class="chip ${k === on ? 'on' : ''}" href="${h}"${k === on ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;

// Today's official slip for a tracked target, exactly as saved to the record (legs, odds, chance).
// Where a builder's legs come from, for the page kicker (track.js slipPolicy).
const windowLabel = (target) => (slipPolicy(target).hours >= 48 ? `NEXT ${Math.round(slipPolicy(target).hours / 24)} DAYS` : `NEXT ${slipPolicy(target).hours} HOURS`);
// A builder's own record, shown after its bets: the summary line plus every graded official slip.
function recordBlock(title, r) {
  if (!r?.slips?.length) return '';
  return `<h2 class="sec reveal">${title}${r.won + r.lost ? ` <small>${recordLine(r)}</small>` : ''}</h2><div class="panel reveal">${slipHistory(r.slips)}</div>`;
}
function officialBlock(target) {
  const o = officialSlip(target);
  if (!o) return '';
  return `<div class="panel official reveal"><h3 class="ph">Today's official ${target}x slip <small>saved to the ${target}x track record · ${o.legs.length} legs · ${Number(o.odds).toFixed(2)}x · chance ${pc(o.shown ?? o.p, o.p < 0.01 ? 2 : 1)}</small></h3>${slipHistory([o])}</div>`;
}
// Why no slip could be built: name the rule that blocked it instead of quietly loosening it.
function emptySlips(target) {
  const mo = prefs.get().minOdds;
  return `<p class="muted">No slip reaches about ${target}x within the rules, even with the wider search (legs rated 35%+ after the track-record check, total within 20% of the target): minimum odds ${mo.toFixed(2)} per leg${prefs.get().sports?.length ? ', your selected sports only' : ''}, no two legs sharing a team, matches ${windowLabel(target).toLowerCase().replace('next', 'in the next')}. ${mo > 1.2 ? 'Lowering your minimum odds or ' : ''}A smaller target will usually work.</p>`;
}

// Bankers filtered through the track record: market types that have underperformed their estimates
// need a stronger estimate to make the list (see calibration in track.js).
// Same function the official record uses, so a pick shows the same chance here and on the Record page.
function smartBankers(events, { min = 0.7, limit = 10, minOdds = 1 } = {}) {
  return rankedBankers(events, { cal: trackCalibration(), min, minOdds, limit });
}

// Likely is not the same as good value: the chance a pick needs just to break even at its price, and
// the market's own margin-free chance, next to ATLAS's estimate.
const priceCheck = (b) => `ATLAS ${pc(b.p, 0)}${b.fair != null ? ` · market ${pc(b.fair, 0)}` : ''} · break-even ${pc(1 / b.odds, 0)}`;

function bigPick(b, value) {
  const e = b.event, s = sportOf(e.sport);
  const leg = { key: `${e.id}|${b.market}|${b.pick}`, eventId: e.id, sport: e.sport, match: `${e.home} vs ${e.away}`, market: b.market, pick: b.pick, odds: b.odds, p: b.p, ...(b.prop ? { prop: b.prop } : {}) };
  return `<article class="row tilt reveal" style="--c:${s.color}">
    <a class="row-link" href="#/match/${esc(e.id)}" data-cursor="OPEN" aria-label="${esc(b.pick)}"></a>
    <span class="ico">${s.icon}</span>
    <div class="teams"><b>${esc(b.pick)}</b><small>${esc(b.market)} · ${esc(e.home)} v ${esc(e.away)} · ${esc(e.league)} · ${when(e)}</small><small class="pcheck">${priceCheck(b)}</small>${whyTag(b)}</div>
    <div class="row-prob">${gaugeMini(b.p)}</div>
    <div class="odds"><span class="stat"><small>chance</small>${pc(b.p, 1)}</span><span class="stat ${b.ev >= 0 ? 'pos' : ''}"><small>edge</small>${(b.ev * 100).toFixed(1)}%</span>${legButton(leg, `<small>odds</small>${odd(b.odds)}`)}</div>
    ${value ? '<span class="conf conf-high">VALUE</span>' : '<span class="conf conf-medium">BANKER</span>'}
  </article>`;
}
const gaugeMini = (p) => `<div class="meter tall"><i class="grow" style="--w:${(p * 100).toFixed(1)}%"></i></div>`;

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
    .sort((a, b) => (f.sort === 'p' ? b.p - a.p : f.sort === 'odds' ? a.o.odds - b.o.odds : f.sort === 'start' ? a.e.start - b.e.start : f.sort === 'start-desc' ? b.e.start - a.e.start : b.ev - a.ev))
    .slice(0, 300);
  return `<p class="cap">${list.length} of ${rows.length} prices</p><table class="tbl edge-tbl"><thead><tr><th></th><th>Match</th><th>Market</th><th>Pick</th><th>Odds</th><th>Fair</th><th>Model</th><th>Edge</th><th>Kelly ¼</th><th></th></tr></thead><tbody>
    ${list.map((r) => `<tr><td class="ic">${sportOf(r.e.sport).icon}</td><td class="mt"><a href="#/match/${esc(r.e.id)}">${esc(r.e.home)} v ${esc(r.e.away)}</a><small>${esc(r.e.league)} · ${when(r.e)}</small></td><td class="mk">${esc(r.m.name)}</td><td class="pk"><b>${esc(r.o.name)}</b></td>
      <td class="num" data-l="Odds">${odd(r.o.odds)}</td><td class="num" data-l="Fair">${pc(r.fair)}</td><td class="num" data-l="Model">${r.o.model != null ? pc(r.o.model) : '—'}</td><td class="num ${r.ev >= 0 ? 'pos' : 'neg'}" data-l="Edge">${(r.ev * 100).toFixed(1)}%</td><td class="num" data-l="Kelly ¼">${r.ev > 0 ? pc(kelly(r.p, r.o.odds) / 4) : '—'}</td><td class="add">${legButton(bookLeg(r.e, r.m, r.o, r.p), '+')}</td></tr>`).join('')}
    </tbody></table>`;
}

// ---------- every sport ----------
// A model-only pick: no price in our feeds, so its fair odds and "worth it at X or better".
function modelCard(b) {
  const e = b.event, s = sportOf(e.sport);
  const leg = { key: `${e.id}|fair|${b.market}|${b.pick}`, eventId: e.id, sport: e.sport, match: `${e.home} vs ${e.away}`, market: b.market, pick: b.pick, odds: b.fairOdds, p: b.p, derived: true };
  return `<article class="row tilt reveal model-pick" style="--c:${s.color}">
    <a class="row-link" href="#/match/${esc(e.id)}" data-cursor="OPEN" aria-label="${esc(b.pick)}"></a>
    <span class="ico">${s.icon}</span>
    <div class="teams"><b>${esc(b.pick)}</b><small>${esc(b.market)} · ${esc(e.home)} v ${esc(e.away)} · ${esc(e.league)} · ${when(e)}</small>
      <small class="pcheck">ATLAS ${pc(b.p, 0)} · no bookmaker price in our feeds · <b>worth it at ${odd(b.fairOdds)} or better</b></small>${whyTag(b)}<small class="basis">${esc(String(b.basis).replace(/ \(no bookmaker price\)$/, ''))}</small></div>
    <div class="row-prob">${gaugeMini(b.p)}</div>
    <div class="odds"><span class="stat"><small>chance</small>${pc(b.p, 1)}</span><span class="stat"><small>fair odds</small>${odd(b.fairOdds)}</span>${legButton(leg, '<small>add at fair</small>+')}</div>
    <span class="conf conf-low" title="Rated by ATLAS's model from the evidence named, with no bookmaker price to check it against">MODEL</span>
  </article>`;
}
const covDot = (state) => `<i class="cov-dot" aria-hidden="true"></i><span class="sr-only">${state}: </span>`;
function coverageTable(cov) {
  const sports = SPORTS.filter((s) => cov[s.id]);
  if (!sports.length) return '';
  return `<div class="panel reveal"><h2 class="ph">What ATLAS knows, by sport <small>matches live or in the next 48 hours</small></h2>
    <p class="cov-key"><span class="cov-available">${covDot('available')}available</span><span class="cov-partial">${covDot('partial')}partial</span><span class="cov-stale">${covDot('stale')}stale</span><span class="cov-unavailable">${covDot('unavailable')}unavailable</span></p>
    <div class="table-wrap"><table class="tbl tight coverage"><thead><tr><th>Sport</th>${COVERAGE_FIELDS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
    <tbody>${sports.map((s) => `<tr><td><b>${s.icon} ${esc(s.name)}</b></td>${COVERAGE_FIELDS.map(([k]) => { const f = cov[s.id].fields[k]; return `<td class="cov-${f.state}" title="${esc(f.state)}">${covDot(f.state)}${esc(f.note)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
// Every sport's best picks for the next 48 hours: priced picks through the shortlist's own rules,
// and, for matches no bookmaker prices, the model's pick from real evidence.
// Worked out once a minute (or when the board changes), not on every redraw: live scores redraw the
// page every few seconds and the model picks are not free on a board of a thousand-plus matches.
let everyMemo = null;
export function everyData() {
  const now = Date.now(), H = 48;
  const sig = `${S.events.length}|${S.fetchedAt}|${trackModelRecord() ? Object.keys(trackModelRecord()).length : 0}`;
  if (everyMemo && everyMemo.sig === sig && now - everyMemo.at < 6e4) return everyMemo.data;
  const soon = S.events.filter((e) => !e.live && e.start > now && e.start < now + H * 36e5);
  const cal = trackCalibration(), record = trackModelRecord();
  const cov = coverage(S.events, { now, hours: H, fetchedAt: S.fetchedAt });
  const sections = SPORTS.map((s) => {
    const evs = soon.filter((e) => e.sport === s.id);
    if (!evs.length) return null;
    const priced = rankedBankers(evs, { cal, min: 0.6, limit: 12, mix: true });
    const model = modelPicks(evs, { now, hours: H, record });
    const all = [...priced.map((b) => ({ b, kind: 'priced' })), ...model.map((b) => ({ b, kind: 'model' }))].sort((x, y) => y.b.p - x.b.p);
    return { s, evs, all, priced: priced.length, model: model.length };
  }).filter(Boolean);
  const data = { H, cov, sections, total: sections.reduce((n, x) => n + x.all.length, 0) };
  everyMemo = { sig, at: now, data };
  return data;
}

// Home: one line per sport with picks, linking into the Every sport page.
export function everyTeaser() {
  if (S.loading) return '';
  const { sections, total } = everyData();
  const withPicks = sections.filter((x) => x.all.length);
  if (!withPicks.length) return '';
  return `<div class="panel every-teaser reveal"><h2 class="ph">Every sport <small>${total} picks across ${withPicks.length} sport${withPicks.length === 1 ? '' : 's'} · next 48 hours, priced and model-rated</small></h2>
    <nav class="win-chips" aria-label="Picks by sport">${withPicks.map((x) => `<a class="chip" href="#/every" data-every="${x.s.id}">${x.s.icon} ${esc(x.s.name)} <b>${x.all.length}</b></a>`).join('')}<a class="chip on" href="#/every">See them all →</a></nav></div>`;
}

function everySport() {
  const { H, cov, sections, total } = everyData();
  const card = (y) => (y.kind === 'model' ? modelCard(y.b) : bigPick(y.b));
  const jump = sections.filter((x) => x.all.length).map((x) => `<a class="chip" href="#sec-every-${x.s.id}" data-jump="sec-every-${x.s.id}">${x.s.icon} ${esc(x.s.name)} <b>${x.all.length}</b></a>`).join('');
  const block = (x) => {
    const head = `<h2 class="sec reveal" id="sec-every-${x.s.id}"><span>${x.all.length}</span>${x.s.icon} ${esc(x.s.name)} <small>${x.evs.length} match${x.evs.length === 1 ? '' : 'es'} · ${x.priced} priced pick${x.priced === 1 ? '' : 's'} · ${x.model} model pick${x.model === 1 ? '' : 's'}</small></h2>`;
    if (!x.all.length) {
      const f = cov[x.s.id]?.fields;
      const unpriced = x.evs.filter((e) => !e.markets?.length).length;
      const why = [
        unpriced < x.evs.length ? 'no priced selection reaches 60%' : 'no bookmaker prices in our feeds',
        unpriced ? (f?.model.state === 'unavailable' ? 'not enough evidence (rankings, ratings, records, form) for the model to rate the unpriced matches' : 'the model rates none of the unpriced matches at 60% or more') : null,
      ].filter(Boolean).join(', and ');
      return `${head}<p class="muted reveal">No pick: ${why}. ATLAS doesn't invent a favourite.</p>`;
    }
    const top = x.all.slice(0, 6), rest = x.all.slice(6);
    return `${head}<div class="list">${top.map(card).join('')}</div>${rest.length ? `<details class="more-picks reveal"><summary>${rest.length} more ${esc(x.s.name)} pick${rest.length === 1 ? '' : 's'}</summary><div class="list">${rest.map(card).join('')}</div></details>` : ''}`;
  };
  return {
    mode: 'bankers', accent: '#00ffc3', title: 'Every sport',
    html: `<section class="hero small"><p class="kicker reveal">EVERY SPORT · NEXT ${H} HOURS · ${total} PICKS</p><h1>${split('EVERY SPORT')}</h1>${builderNav('every')}
      <p class="lede reveal">The strongest pick ATLAS can make for each match, sport by sport. <b>Priced</b> picks are rated against a bookmaker's price (BANKER). <b>Model</b> picks are for matches no bookmaker in our feeds prices: ATLAS rates them from rankings, ratings, records, form and starters, shows the fair odds, and they are worth taking only at that price or better. Model picks keep their own track record.</p></section>
      ${notice()}
      ${jump ? `<nav class="win-chips every-jump reveal" aria-label="Sports">${jump}</nav>` : ''}
      ${coverageTable(cov)}
      ${sections.map(block).join('')}
      ${sections.length ? '' : '<p class="muted reveal">Nothing scheduled in the next 48 hours.</p>'}`,
  };
}

export const picksViews = {
  every: everySport,

  edge() {
    return {
      mode: 'edge', accent: '#4fd1ff', title: 'Edge board',
      html: `<section class="hero small"><p class="kicker reveal">EVERY PRICE · EVERY SPORT · RANKED</p><h1>${split('EDGE BOARD')}</h1>${builderNav('edge')}
        <p class="lede reveal">Every bookmaker outcome on the board with its fair probability (margin removed), the ATLAS model probability, edge and quarter-Kelly stake.</p></section>
        ${notice()}
        <div class="filters panel reveal">
          <label>Sport<select data-ef="sport"><option value="">All</option>${SPORTS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select></label>
          <label>Min odds<input data-ef="min" type="number" step="0.05" value="1.01" min="1"></label>
          <label>Max odds<input data-ef="max" type="number" step="0.5" value="20" min="1"></label>
          <label>Sort<select data-ef="sort"><option value="ev">Edge</option><option value="p">Win chance</option><option value="odds">Odds</option><option value="start" selected>Start: soonest first</option><option value="start-desc">Start: latest first</option></select></label>
          <label class="grow1">Search<input data-ef="q" type="search" placeholder="Team, league, market…"></label>
          <label class="chk"><input data-ef="pos" type="checkbox"> Positive edge only</label>
        </div>
        <div class="panel table-wrap reveal" id="edge-table">${edgeTable({ sort: 'start' })}</div>`,
    };
  },

  x([n]) {
    const target = Math.round(Number(n) * 100) / 100;
    if (![2, 3, 4, 5, 10, 20].includes(target)) return views.notfound();
    const list = S.slips(target, { count: 5 });
    ensureTrack(() => S.refresh?.());
    const r = trackStats()?.byTarget?.find((t) => t.target === target);
    return {
      mode: 'x', accent: ['#d2ff00', '#00ffc3', '#4fd1ff', '#b08cff'][[2, 3, 4, 5].indexOf(target)] || '#ff9f43', title: `${target}x slips`,
      html: `<section class="hero small"><p class="kicker reveal">MULTIPLIER · BREAK-EVEN ${pc(1 / target, target >= 100 ? 2 : 1)} · ${windowLabel(target)}</p><h1>${split(`${target}X SLIPS`)}</h1>${builderNav('x')}
        <nav class="tabs reveal">${[2, 3, 4, 5, 10, 20].map((x) => `<a href="#/x/${x}" class="${x === target ? 'on' : ''}">${x}x</a>`).join('')}</nav></section>
        ${notice()}${orderChips()}
        ${officialBlock(target)}
        <h2 class="sec reveal">${officialSlip(target) ? 'More options' : 'Options'}</h2>
        <section class="grid slips">${list.map((s, i, arr) => slipCard(s, i, target, arr)).join('') || emptySlips(target)}</section>
        ${recordBlock(`${target}x track record`, r)}`,
    };
  },

  // Target: the user picks any multiplier and gets the best slips for it, built from bankers.
  target([n]) {
    const t = Math.round(Number(n) * 100) / 100;
    const has = t >= 1.2 && t <= 100000;
    const list = has ? S.slips(t, { count: 5 }) : [];
    const presets = [1.5, 2.5, 7.5, 15, 50, 250];
    return {
      mode: 'x', accent: '#ff9f43', title: has ? `Target ${t}x` : 'Target',
      html: `<section class="hero small"><p class="kicker reveal">${has ? `BREAK-EVEN ${pc(1 / t, t >= 100 ? 2 : 1)} · ${windowLabel(t)}` : 'ANY MULTIPLIER'}</p><h1>${split(has ? `TARGET ${t}X` : 'TARGET')}</h1>${builderNav('target')}
        <form class="xtarget reveal" data-xtarget><label>Target multiplier<input type="number" name="t" min="1.2" max="100000" step="0.1" value="${has ? t : ''}" placeholder="e.g. 7.5" inputmode="decimal" aria-label="Target multiplier"></label><button class="btn">Build slips</button></form>
        <nav class="tabs reveal">${presets.map((x) => `<a href="#/target/${x}" class="${x === t ? 'on' : ''}">${x}x</a>`).join('')}</nav></section>
        ${notice()}${has ? orderChips() : ''}
        ${has ? `<section class="grid slips">${list.map((s, i, arr) => slipCard(s, i, t, arr)).join('') || emptySlips(t)}</section>` : ''}`,
    };
  },

  mega() {
    ensureTrack(() => S.refresh?.());
    const ts = trackStats();
    return {
      mode: 'mega', accent: '#ff3d6e', title: 'Mega bets',
      html: `<section class="hero small"><p class="kicker reveal">100X AND 1000X · ${windowLabel(100)}</p><h1>${split('MEGA BETS')}</h1>${builderNav('mega')}
</section>
        ${notice()}${orderChips()}
        ${[100, 1000].map((t) => { return `<h2 class="sec reveal">${t}x</h2>
          ${officialBlock(t)}
          <section class="grid slips">${S.slips(t, { count: 3 }).map((s, i, arr) => slipCard(s, i, t, arr)).join('') || emptySlips(t)}</section>`; }).join('')}
        ${recordBlock('Mega track record', ts?.mega)}`,
    };
  },

  bankers() {
    const ev = prefFilter(S.events), minOdds = prefs.get().minOdds;
    ensureTrack(() => S.refresh?.());
    const day = todayEvents(ev); // next 12 hours
    const list = orderBets(smartBankers(day, { limit: 40, minOdds }));
    const ts = trackStats();
    return {
      mode: 'bankers', accent: '#00ffc3', title: 'Bankers',
      html: `<section class="hero small"><p class="kicker reveal">NEXT 12 HOURS · ODDS ${minOdds.toFixed(2)}–${MAX_ODDS.toFixed(2)}</p><h1>${split('BANKERS')}</h1>${builderNav('bankers')}</section>
        ${notice()}${prefsBar()}${orderChips()}
        <div class="list">${list.map((b) => bigPick(b)).join('') || '<p class="muted">No 70%+ favourites in the next 12 hours right now. The board refreshes as new matches come into range.</p>'}</div>
        ${recordLine(ts?.all) ? `<p class="rec-line reveal">Track record · ${recordLine(ts.all)} · <a href="#/track">see every pick</a></p>` : ''}`,
    };
  },
};
