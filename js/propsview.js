// Player props: every DraftKings player line in the next 36 hours on one page, each with the ATLAS
// chance next to the price's own, the player's hit rates (last 5/10/20 games, this season, against
// this opponent, at this venue) and his last 10 games against the line. Filters, sort and search
// are remembered per device. The same row is used on match pages.
import { esc, legButton, ist } from './views.js';
import { pc, odd } from './charts.js';
import { propLabel, propMarket, propLadder } from './props.js';
import { playersData, playersMeta, rowsOf, loadPlayers } from './playerdata.js';
import { shownProp } from './track.js';
import { trackCalibration, trackStats, recordLine, ensureTrack } from './trackview.js';
import { split } from './ui.js';
import { playerPanel } from './playerview.js';
import { propReadiness, readinessBadge } from './propcheck.js';

const KEY = 'atlas-props-v1';
const DEFAULTS = { sport: 'all', stat: 'all', sort: 'edge', min: 0, q: '' };
let st = { ...DEFAULTS };
try { st = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}'), q: '' }; } catch { /* storage blocked */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ...st, q: '' })); } catch { /* storage blocked */ } };

const SPORT_NAME = { basketball: 'Basketball', baseball: 'Baseball', hockey: 'Hockey', soccer: 'Soccer', football: 'Football' };
// 'edge' sorts by the estimated return at the offered price (forecast x odds - 1), not by the gap to
// the market estimate: a forecast a point above the market estimate can still lose money at the price.
const SORTS = [['edge', 'Best return'], ['chance', 'Likeliest'], ['l10', 'Best last 10'], ['time', 'Soonest']];
export const MARGIN_NOTE = 'Market estimate: the chance the price gives, less an assumed 5% bookmaker cut (one price is offered, so the true margin cannot be calculated)';
const MINS = [[0, 'Any chance'], [0.6, '60%+'], [0.7, '70%+']];
const frac = (r) => (r && r[1] ? `${r[0]}/${r[1]}` : '–');
const ratio = (r) => (r && r[1] ? r[0] / r[1] : null);
// Hit-rate cell, coloured by how often he cleared the line.
const hr = (label, r, title = '') => {
  const x = ratio(r);
  const cls = x == null ? '' : x >= 0.7 ? 'hi' : x >= 0.5 ? 'mid' : 'lo';
  return `<span class="hr ${cls}"${title ? ` data-tip="${esc(title)}"` : ''}><i>${esc(label)}</i>${frac(r)}</span>`;
};

// Last 10 games as bars against the line (oldest left): over in green, under in grey.
export function propBars(hist, target) {
  const last = (hist?.last || []).slice().reverse();
  if (!last.length) return '';
  const max = Math.max(target * 1.4, ...last.map((g) => g[0]), 1);
  const W = 10, gap = 3, H = 34, w = last.length * (W + gap) - gap;
  const y = (v) => H - (v / max) * H;
  const bars = last.map(([v, opp, home], i) => `<rect class="${v >= target ? 'ov' : 'un'}" x="${i * (W + gap)}" y="${y(v).toFixed(1)}" width="${W}" height="${Math.max(1.5, H - y(v)).toFixed(1)}" rx="1.5"><title>${esc(`${v} ${home === 1 ? 'vs' : home === 0 ? '@' : ''} ${opp}`.replace(/\s+/g, ' ').trim())}</title></rect>`).join('');
  return `<svg class="pbars" viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" role="img" aria-label="Last ${last.length} games against the line of ${target}">${bars}<line x1="0" x2="${w}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}" /></svg>`;
}

// Other lines for the same prop, the way most bookmakers write them ("over 24.5"), with ATLAS's chance
// and fair odds at each, and a price check for whatever line and price another bookmaker shows. The
// chances come from the player's game logs (props.js propLadder) and are shifted by the same
// track-record calibration as the offered line, so the offered row matches the chance shown above.
function otherLines(e, x) {
  if (x.yes) return '';
  const league = e.leaguePath?.split('/')[1];
  const p = playersData()?.[`${league}|${x.id}`];
  if (!p) return '';
  const rows = rowsOf(p), home = x.side ? x.side === 'home' : null;
  const opts = { home, scale: x.adj?.find((a) => a.applied)?.scale ?? 1, without: x.adj?.find((a) => a.applied)?.without ?? null };
  const mkt = x.pm ?? 1 / x.odds;
  const near = propLadder(mkt, e.sport, x.type, x.target, rows, opts);
  if (!near.length) return '';
  const k = x.p / (near.find((l) => l.offered)?.p || x.p);
  const adj = (q) => Math.min(0.97, Math.max(0.03, q * k));
  // Every whole-number threshold up to well past the line, for the price check.
  const maxT = Math.max(x.target * 2 + 2, x.target + 10);
  const step = x.target >= 100 ? 5 : 1;
  const ts = []; for (let t = 1; t <= maxT && ts.length < 60; t += step) ts.push(t);
  const all = Object.fromEntries(propLadder(mkt, e.sport, x.type, x.target, rows, { ...opts, thresholds: ts }).map((l) => [l.t, +adj(l.p).toFixed(4)]));
  return `<details class="pp2-lines"><summary>Other lines · over / under at any line</summary>
    <table class="tbl tight"><thead><tr><th>Line</th><th class="num">ATLAS over</th><th class="num">Fair odds over / under</th></tr></thead><tbody>${near.map((l) => { const q = adj(l.p); return `<tr${l.offered ? ' class="on"' : ''}><td>Over ${l.line}${l.offered ? ' <small>· this price</small>' : ''}</td><td class="num">${pc(q, 0)}</td><td class="num">${(1 / q).toFixed(2)} / ${(1 / (1 - q)).toFixed(2)}</td></tr>`; }).join('')}</tbody></table>
    <div class="pp2-check" data-ladder='${esc(JSON.stringify(all))}' data-step="${step}"><b>Check another bookmaker's price</b>
      <label>Over <input type="number" inputmode="decimal" step="0.5" min="0.5" value="${x.target - 0.5}" data-lc="line" aria-label="Line"></label>
      <label>at <input type="number" inputmode="decimal" step="0.01" min="1.01" placeholder="odds" data-lc="odds" aria-label="Odds"></label>
      <output data-lc="out" class="muted">Enter the line and price you see.</output></div>
  </details>`;
}
// Price check: chance at the line typed, break-even and estimated return at the price typed.
export function lineCheck(box) {
  const map = JSON.parse(box.dataset.ladder || '{}'), step = Number(box.dataset.step) || 1;
  const line = Number(box.querySelector('[data-lc="line"]').value), odds = Number(box.querySelector('[data-lc="odds"]').value);
  const out = box.querySelector('[data-lc="out"]');
  if (!(line > 0)) { out.textContent = 'Enter the line and price you see.'; return; }
  let t = Math.floor(line) + 1;
  if (step > 1) t = Math.max(1, Math.round(t / step) * step);
  const p = map[t];
  if (p == null) { out.textContent = 'That line is outside what the game logs can say.'; return; }
  if (!(odds > 1)) { out.innerHTML = `Over ${line}: ATLAS <b>${pc(p, 0)}</b> · fair odds ${(1 / p).toFixed(2)} (under ${(1 / (1 - p)).toFixed(2)})`; return; }
  const ret = p * odds - 1;
  out.innerHTML = `Over ${line} at ${odds.toFixed(2)}: ATLAS <b>${pc(p, 0)}</b> · break-even ${pc(1 / odds, 0)} · estimated return <span class="${ret >= 0 ? 'pos' : 'neg'}">${ret >= 0 ? '+' : '−'}${Math.abs(ret * 100).toFixed(0)}%</span>`;
}
if (typeof document !== 'undefined') document.addEventListener('input', (ev) => { const box = ev.target.closest?.('.pp2-check'); if (box) lineCheck(box); });

// One prop, with its match (e) for the slip leg and the opponent. `withMatch` adds the fixture line.
export function propRow(e, x, { withMatch = false, sel = '' } = {}) {
  const league = e.leaguePath?.split('/')[1];
  const pkey = `${league}~${x.id}~${x.type}~${x.target}`; // research opens on this exact stat and line
  const leg = { key: `${e.id}|${propMarket(x)}|${propLabel(x)}`, eventId: e.id, sport: e.sport, match: `${e.home} vs ${e.away}`, market: propMarket(x), pick: propLabel(x), odds: x.odds, p: x.p, prop: { id: String(x.id), league, type: x.type, target: x.target } };
  const team = x.side === 'home' ? e.home : x.side === 'away' ? e.away : '';
  const opp = x.side === 'home' ? e.away : x.side === 'away' ? e.home : '';
  const h = x.hist;
  const mkt = x.pm ?? 1 / x.odds;
  const gap = x.p - mkt;
  const ret = x.p * x.odds - 1;
  const where = x.side ? `${x.side === 'home' ? 'vs' : '@'} ${opp}` : `${e.home} v ${e.away}`;
  const rates = h ? [hr('L5', h.l5), hr('L10', h.l10), hr('L20', h.l20), h.season ? hr('Season', h.season, 'this season\'s games among the last 20 stored') : '', h.vs ? hr(`vs ${opp.split(' ').at(-1)}`, h.vs) : '', h.venue ? hr(h.home ? 'Home' : 'Away', h.venue) : ''].join('') : '';
  // Only what helps decide: a warning badge (stale price, conflicting reports), never "limited coverage".
  const rd = propReadiness(e, x, { logsAt: playersMeta().updatedAt });
  return `<div class="pp2${sel && sel === pkey ? ' sel' : ''}">
    <div class="pp2-head"><div><b>${esc(propLabel(x))}</b><small>${x.hist ? `<a class="pp2-who" href="#/props/${esc(`${league}~${x.id}~${encodeURIComponent(x.type)}~${x.target}`)}">Research ›</a> ` : ''}${esc(team)} · ${esc(where)}${withMatch ? ` · <a href="#/match/${encodeURIComponent(e.id)}">${esc(ist(e.start))}</a>` : ''}</small></div>${legButton(leg, odd(x.odds))}</div>
    <div class="pp2-num">${['stale', 'conflict'].includes(rd.state) ? readinessBadge(rd) : ''}<span class="pp2-p" data-tip="ATLAS forecast for this game"><i>ATLAS</i> ${pc(x.p, 0)}</span><span class="muted" data-tip="Break-even: the chance this price needs to pay off">needs ${pc(1 / x.odds, 0)}</span><span class="${ret >= 0 ? 'pos' : 'neg'}" data-tip="Estimated return at this price: forecast x odds - 1. ${esc(edgeWords(gap, ret))}. ${MARGIN_NOTE}">return ${ret >= 0 ? '+' : '−'}${Math.abs(ret * 100).toFixed(0)}%</span>${h ? `<span class="muted">avg ${h.avg}</span>` : ''}${x.why ? `<span class="pp2-why" data-tip="ATLAS before this: ${pc(x.pBase, 0)}">${esc(x.why)}</span>` : ''}</div>
    ${h ? `<div class="pp2-hist"><div class="pp2-rates">${rates}</div>${propBars(h, x.target)}</div>` : ''}
    ${otherLines(e, x)}
  </div>`;
}

// Every prop in the next 36 hours, with the calibrated chance the rest of the site shows.
// The forecast against the market's estimate and against break-even, in words, so a positive gap
// next to a negative return reads as what it is rather than a contradiction.
export const edgeWords = (gap, ret) => (gap > 0 && ret < 0 ? `above the market estimate (+${Math.round(gap * 100)} pts), still below break-even at this price`
  : gap > 0 ? `above the market estimate (+${Math.round(gap * 100)} pts) and above break-even`
    : `${Math.abs(Math.round(gap * 100))} pts below the market estimate`);

export function allProps(events, now = Date.now(), { any = false } = {}) {
  const cal = trackCalibration();
  const out = [];
  for (const e of events) {
    if (!e.props?.length || (!any && (e.live || !(e.start > now)))) continue;
    for (const x of e.props) {
      // No game history: ATLAS would only repeat the bookmaker's price, so the prop is left out.
      if (!(x.odds >= 1.2) || !x.hist) continue;
      out.push({ e, x: shownProp(x, propMarket(x), cal, e.sport) });
    }
  }
  return out;
}

const chip = (attr, val, label, on) => `<button class="chip ${on ? 'on' : ''}" data-pf="${attr}:${esc(String(val))}">${esc(label)}</button>`;

function filtered(list) {
  const q = st.q.trim().toLowerCase();
  let l = list.filter(({ e, x }) => (st.sport === 'all' || e.sport === st.sport) && (st.stat === 'all' || x.label === st.stat) && x.p >= st.min
    && (!q || x.player.toLowerCase().includes(q) || e.home.toLowerCase().includes(q) || e.away.toLowerCase().includes(q)));
  const by = {
    edge: (a, b) => (b.x.p * b.x.odds) - (a.x.p * a.x.odds),
    chance: (a, b) => b.x.p - a.x.p,
    l10: (a, b) => (ratio(b.x.hist?.l10) ?? -1) - (ratio(a.x.hist?.l10) ?? -1) || b.x.p - a.x.p,
    time: (a, b) => a.e.start - b.e.start || b.x.p - a.x.p,
  }[st.sort] || (() => 0);
  l = l.sort(by);
  return l;
}

export function propsList(events, sel = '') {
  const l = filtered(allProps(events));
  if (!l.length) return '<p class="muted">No props match these filters right now. Lines appear about a day before each game.</p>';
  return `${l.slice(0, 120).map(({ e, x }) => propRow(e, x, { withMatch: true, sel })).join('')}${l.length > 120 ? `<p class="muted">Showing 120 of ${l.length}: narrow it with a filter or search.</p>` : ''}`;
}

// The research view: the props list, and beside it (wide screens) or instead of it (phones) the
// research panel for the player picked from it.
export function propsView(events, refresh, sel = '') {
  ensureTrack(refresh);
  loadPlayers(refresh); // game logs, for other lines
  const all = allProps(events);
  const sports = [...new Set(all.map((p) => p.e.sport))];
  if (st.sport !== 'all' && !sports.includes(st.sport)) st.sport = 'all';
  const stats = [...new Set(all.filter((p) => st.sport === 'all' || p.e.sport === st.sport).map((p) => p.x.label))].sort();
  if (st.stat !== 'all' && !stats.includes(st.stat)) st.stat = 'all';
  const matches = new Set(all.map((p) => p.e.id)).size;
  const modelled = all.filter((p) => p.x.hist).length;
  const moved = all.filter((p) => p.x.why).length;
  const rec = trackStats()?.byFamily?.find((f) => f.key === 'prop');
  const pn = sel ? playerPanel(sel, events, refresh) : null;
  return {
    mode: 'bankers', accent: '#3dff9a', title: pn?.name ? `${pn.name} · Props` : 'Player props',
    html: `<section class="hero small"><p class="kicker reveal">NEXT 36 HOURS · ${all.length} LINES · ${matches} MATCHES${moved ? ` · ${moved} MOVED BY ABSENCES` : ''}</p><h1>${split('PLAYER PROPS')}</h1>
      <p class="lede reveal">The ATLAS forecast weighs each player's last 20 games (recent ones count more, games without an injured teammate when he is out tonight) against the bookmaker's price. ${modelled} of ${all.length} lines have game history.</p></section>
      <div class="rs${pn ? ' has-sel' : ''}">
      <div class="rs-list">
      <div class="props-tools reveal">
        <input class="props-q" type="search" placeholder="Search player or team" value="${esc(st.q)}" data-props-search aria-label="Search player or team">
        <div class="chips">${chip('sport', 'all', 'All sports', st.sport === 'all')}${sports.map((s) => chip('sport', s, SPORT_NAME[s] || s, st.sport === s)).join('')}</div>
        <div class="chips">${chip('stat', 'all', 'All stats', st.stat === 'all')}${stats.map((s) => chip('stat', s, s, st.stat === s)).join('')}</div>
        <div class="chips">${SORTS.map(([k, t]) => chip('sort', k, t, st.sort === k)).join('')}<span class="nav-sep" aria-hidden="true"></span>${MINS.map(([k, t]) => chip('min', k, t, st.min === k)).join('')}</div>
      </div>
      <div class="panel props-list2" data-props-list>${propsList(events, sel)}</div>
      ${recordLine(rec) ? `<p class="rec-line reveal">ATLAS props record · ${recordLine(rec)} · <a href="#/track">see every pick</a></p>` : '<p class="rec-line reveal muted">Props in the shortlist are graded from the box score after each game: the record builds up on the Results page.</p>'}
      </div>
      ${pn ? `<aside class="rs-panel" aria-label="Player research"><div class="rs-head"><a class="rs-back" href="#/props">← All props</a><h2>${esc(pn.name || 'Player')}</h2>${pn.name ? `<small>${esc(pn.team || '')}${pn.next ? ` · ${esc(pn.next)}` : ''}${pn.e ? ` · <a href="#/match/${encodeURIComponent(pn.e.id)}">dossier</a>` : ''}</small>` : ''}</div>${pn.html}</aside>` : ''}
      </div>`,
  };
}

// Clicks and typing on the page. Returns true when it handled the event (main.js re-renders).
export function propsClick(t) {
  const f = t.closest('[data-pf]');
  if (f) {
    const [k, ...rest] = f.dataset.pf.split(':');
    const v = rest.join(':');
    st[k] = k === 'min' ? Number(v) : v;
    if (k === 'sport') st.stat = 'all';
    save();
    return true;
  }
  return false;
}
export function propsSearch(value) { st.q = value; }
