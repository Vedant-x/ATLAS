// Research workspace: the pieces that turn ATLAS from a list of picks into a research flow.
//   - candidate table: one row per match with its main pick, market chance, ATLAS chance, edge,
//     evidence readiness, latest change and price age; sortable by likelihood, value or readiness
//   - quick view: a side panel with the match summary that opens without leaving the page
//   - the case: why a pick qualifies, what supports it, what weakens it, what is still unknown,
//     what would change the call, and which factors are actually inside the number
//   - compare (up to 4 pinned matches) and the watchlist
import { ico, kindIco, watchLabel, pinLabel } from './icons.js';
import { esc, sportOf, ist, analysisFor } from './views.js';
import { coherentBets } from './picks.js';
import { trackCalibration } from './trackview.js';
import { readiness, readyBadge, READY_ORDER } from './readiness.js';
import { changesFor, latestChange, needsReview, changesSince, lastVisit, timelineUpdatedAt } from './timeline.js';
import { FORECAST_NOTE } from './changelog.js';
import { watch } from './alerts.js';
import { pc, odd } from './charts.js';

let S;
export function bindResearch(state) { S = state; }

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const ago = (t) => { if (!t) return '—'; const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const timeShort = (t) => new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

// ---------- one research row per match ----------
export function researchRow(e) {
  const a = analysisFor(e);
  const { lean, picks } = coherentBets(e, a, { cal: trackCalibration(), preferBook: true }); // a real price first, where one exists
  const main = picks.find((p) => p.book) || picks[0] || null;
  const r = readiness(e, { priceAt: e.fetchedAt || S?.fetchedAt });
  return { e, a, lean, main, picks, r, change: latestChange(e.id), review: watch.has(e.id) ? needsReview(e.id) : [] };
}

// ---------- candidate table ----------
const RKEY = 'atlas-research-v1';
export const researchPrefs = () => ({ sort: 'likely', hours: 24, shortHours: 12, sport: '', readyOnly: false, pricedOnly: true, ...read(RKEY, {}) });
export const setResearchPrefs = (patch) => write(RKEY, { ...researchPrefs(), ...patch });

export function candidateRows(events, f = researchPrefs()) {
  const now = Date.now();
  const list = events.filter((e) => !e.live && e.start > now && e.start < now + f.hours * 36e5 && e.sport !== 'efootball' && (!f.sport || e.sport === f.sport) && (!f.pricedOnly || e.markets?.length));
  let rows = list.map(researchRow).filter((x) => x.main);
  if (f.readyOnly) rows = rows.filter((x) => x.r.state === 'ready');
  const by = {
    likely: (x, y) => y.main.q - x.main.q,
    value: (x, y) => (y.main.book ? y.main.ev : -1) - (x.main.book ? x.main.ev : -1),
    ready: (x, y) => READY_ORDER[x.r.state] - READY_ORDER[y.r.state] || y.main.q - x.main.q,
    start: (x, y) => x.e.start - y.e.start,
    changed: (x, y) => (y.change?.at || 0) - (x.change?.at || 0),
  }[f.sort] || ((x, y) => y.main.q - x.main.q);
  return rows.sort(by);
}

// Time-window chips shared by the research table and the shortlist.
export const WINDOWS = [3, 6, 12, 24, 48];
export const windowChips = (key, cur) => `<div class="win-chips" role="group" aria-label="Time window"><span>Starting in</span>${WINDOWS.map((h) => `<button class="chip ${cur === h ? 'on' : ''}" data-${key}="${h}" aria-pressed="${cur === h}">${h}h</button>`).join('')}</div>`;
const EMPTY = 'No matches fit these filters. Widen the window, include unpriced matches or pick another sport.';

// Phone layout of one research row: a card with the same facts as the table row.
function card(x) {
  const m = x.main, e = x.e;
  const edge = m.book ? `${m.ev >= 0 ? '+' : ''}${(m.ev * 100).toFixed(1)}%` : '—';
  return `<article class="rs-card ${x.review.length ? 'needs-review' : ''}" data-qv="${esc(e.id)}" tabindex="0">
    <header><span>${sportOf(e.sport).icon} ${esc(e.league)}</span><time>${esc(timeShort(e.start))} IST</time></header>
    <h3>${esc(e.home)} <i>v</i> ${esc(e.away)}</h3>
    <div class="rs-pick"><div><b>${esc(m.pick)}</b><small>${esc(m.market)}${m.book ? '' : ' · ATLAS fair price'}</small></div><span class="rs-odds">${odd(m.odds)}</span></div>
    <div class="rs-nums"><div><small>Market</small><b>${m.fair != null ? pc(m.fair, 0) : '—'}</b></div><div><small>ATLAS</small><b>${pc(m.q, 0)}</b></div><div><small>Edge</small><b class="${m.book ? (m.ev >= 0 ? 'pos' : 'neg') : ''}">${edge}</b></div></div>
    ${x.change ? `<p class="rs-cchange">${kindIco(x.change.kind)} ${esc(x.change.text)} <small>· ${ago(x.change.at)} ago</small></p>` : ''}
    <footer>${readyBadge(x.r)}<span class="rs-cact"><button class="icon-btn ${watch.has(e.id) ? 'on' : ''}" data-watch="${esc(e.id)}" aria-pressed="${watch.has(e.id)}" aria-label="Save to watchlist">${ico(watch.has(e.id) ? 'star-on' : 'star')}</button><button class="icon-btn ${pins().includes(e.id) ? 'on' : ''}" data-pin="${esc(e.id)}" aria-label="Pin to compare">⇄</button></span></footer>
  </article>`;
}

export function candidateTable(events, { limit = 25 } = {}) {
  const f = researchPrefs();
  const rows = candidateRows(events, f).slice(0, limit);
  const th = (k, label, title) => `<th><button class="th-sort ${f.sort === k ? 'on' : ''}" data-rsort="${k}" title="${esc(title)}">${label}${f.sort === k ? ' ↓' : ''}</button></th>`;
  const sports = [...new Set(events.map((e) => e.sport))].filter((s) => s !== 'efootball');
  return `<div class="research panel reveal">
    <div class="rs-head"><h2 class="ph">Research candidates <small>one row per match · its main pick · click a row for the quick view</small></h2>
      <div class="rs-filters">
        <label>Sport<select data-rf="sport"><option value="">All</option>${sports.map((s) => `<option value="${s}" ${f.sport === s ? 'selected' : ''}>${esc(sportOf(s).name)}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" data-rf="readyOnly" ${f.readyOnly ? 'checked' : ''}> Ready only</label>
        <label class="chk"><input type="checkbox" data-rf="pricedOnly" ${f.pricedOnly ? 'checked' : ''}> Priced only</label>
      </div></div>
    ${windowChips('rhours', f.hours)}
    <div class="rs-sorts" role="group" aria-label="Sort">${[['likely', 'Most likely'], ['value', 'Best value'], ['ready', 'Evidence'], ['start', 'Starting soon'], ['changed', 'Latest change']].map(([k, l]) => `<button class="chip ${f.sort === k ? 'on' : ''}" data-rsort="${k}" aria-pressed="${f.sort === k}">${l}</button>`).join('')}</div>
    <div class="table-wrap"><table class="rs-table"><thead><tr>
      ${th('start', 'Match', 'Sort by start time')}<th>Main pick</th><th class="num">Odds</th>
      <th class="num" title="Bookmaker chance with the margin removed">Market</th>
      ${th('likely', 'ATLAS', 'Sort by estimated chance (most likely first)')}
      ${th('value', 'Edge', 'Sort by estimated value at the price (ATLAS chance × odds − 1)')}
      ${th('ready', 'Evidence', 'Sort by evidence readiness: is the information this sport needs in?')}
      ${th('changed', 'Latest change', 'Sort by most recent material change')}<th class="num" title="When the price was last checked">Price</th><th></th></tr></thead>
    <tbody>${rows.map((x) => {
      const m = x.main, e = x.e;
      return `<tr data-qv="${esc(e.id)}" tabindex="0" class="${x.review.length ? 'needs-review' : ''}">
        <td><span class="rs-sport">${sportOf(e.sport).icon}</span><b>${esc(e.home)} v ${esc(e.away)}</b><small>${esc(e.league)} · ${esc(timeShort(e.start))} IST</small></td>
        <td><b>${esc(m.pick)}</b><small>${esc(m.market)}${m.book ? '' : ' · ATLAS fair price'}</small></td>
        <td class="num">${odd(m.odds)}</td>
        <td class="num">${m.fair != null ? pc(m.fair, 0) : '—'}</td>
        <td class="num"><b>${pc(m.q, 0)}</b></td>
        <td class="num ${m.book ? (m.ev >= 0 ? 'pos' : 'neg') : ''}">${m.book ? `${m.ev >= 0 ? '+' : ''}${(m.ev * 100).toFixed(1)}%` : '—'}</td>
        <td>${readyBadge(x.r)}</td>
        <td class="rs-change">${x.change ? `<span title="${esc(x.change.text)}">${kindIco(x.change.kind)} ${esc(x.change.text.slice(0, 48))}${x.change.text.length > 48 ? '…' : ''}</span><small>${ago(x.change.at)} ago</small>` : '<small class="muted">no change recorded</small>'}</td>
        <td class="num"><small>${m.book ? ago(e.fetchedAt || S?.fetchedAt) : '—'}</small></td>
        <td class="rs-act"><button class="icon-btn ${watch.has(e.id) ? 'on' : ''}" data-watch="${esc(e.id)}" aria-pressed="${watch.has(e.id)}" title="${watch.has(e.id) ? 'Watching' : 'Save to watchlist'}">${ico(watch.has(e.id) ? 'star-on' : 'star')}</button>
          <button class="icon-btn ${pins().includes(e.id) ? 'on' : ''}" data-pin="${esc(e.id)}" title="Pin to compare" aria-label="Pin to compare">${ico('compare')}</button></td></tr>`;
    }).join('') || `<tr><td colspan="10"><p class="muted">${EMPTY}</p></td></tr>`}</tbody></table></div>
    <div class="rs-cards">${rows.map(card).join('') || `<p class="muted">${EMPTY}</p>`}</div>
    ${rows.length > 8 ? `<button class="btn-ghost rs-more" data-rmore aria-expanded="false">Show all ${rows.length}</button>` : ''}
    <p class="cap">Edge = ATLAS chance × odds − 1. A pick can be likely and still poor value at a short price. Evidence readiness shows whether the information this sport needs is in; it is not a win chance.</p>
  </div>`;
}

// ---------- what changed ----------
export function changesPanel(events, { limit = 8, title = 'What changed' } = {}) {
  const ids = new Set(events.map((e) => e.id));
  const since = lastVisit();
  const all = changesSince(null).filter((c) => ids.has(c.eventId) && c.start > Date.now() - 36e5);
  const fresh = since ? all.filter((c) => c.at > since) : all;
  const watched = all.filter((c) => watch.has(c.eventId) && needsReview(c.eventId).length);
  const list = [...new Map([...watched, ...fresh].map((c) => [c.id, c])).values()].slice(0, limit);
  return `<div class="changes panel reveal"><h2 class="ph">${title} <small>${since ? `since your last visit (${ago(since)} ago)` : 'last 48 hours'}${timelineUpdatedAt() ? ` · checked ${ago(timelineUpdatedAt())} ago` : ''}</small></h2>
    ${list.length ? `<ul class="ch-list">${list.map(changeItem).join('')}</ul>` : `<p class="muted">${timelineUpdatedAt() ? 'No material changes (starters, lineups, absences, price moves) since you last looked.' : 'The change timeline starts with the next data update.'}</p>`}
  </div>`;
}
export const changeItem = (c) => `<li class="chg ${watch.has(c.eventId) ? 'watched' : ''}"><a href="#/match/${esc(c.eventId)}" data-qv="${esc(c.eventId)}">
  <span class="ch-ico">${kindIco(c.kind)}</span>
  <div><b>${esc(c.home)} v ${esc(c.away)}</b><p>${esc(c.text)}</p>
  <small>${esc(sportOf(c.sport).name)} · seen ${ago(c.at)} ago${c.source ? ` · source: ${esc(c.source)}` : ''}${FORECAST_NOTE[c.forecast] ? ` · <em class="fc-${c.forecast}">${FORECAST_NOTE[c.forecast]}</em>` : ''}${watch.has(c.eventId) ? ' · ★ watched' : ''}</small></div></a></li>`;

// ---------- the case for a pick ----------
const rate = (rec) => { const n = String(rec || '').split('-').map(Number); if (n.length < 2 || n.some((x) => !Number.isFinite(x))) return null; const g = n.reduce((a, b) => a + b, 0); return g ? n[0] / g : null; };
const formPts = (f) => (Array.isArray(f) && f.length ? f.reduce((s, r) => s + (r === 'W' ? 1 : r === 'D' ? 0.5 : 0), 0) / f.length : null);
const eraOf = (e, side) => { const p = (e.probables || []).find((x) => x.side === side); return Number((p?.report || p?.pitching)?.season?.era); };

export function caseFor(x) {
  const { e, main, lean, r } = x;
  if (!main) return null;
  const leanSide = ['home', 'away'].includes(lean) ? lean : null;
  const other = leanSide === 'home' ? 'away' : 'home';
  const team = (s) => (s === 'home' ? e.home : e.away);
  const pro = [], con = [], unknown = [], invalid = [];
  // Price and market.
  if (main.book) {
    pro.push(`Bookmaker price ${odd(main.odds)} implies ${pc(main.fair, 0)} once the margin is removed.`);
    if (main.q < 1 / main.odds) con.push(`At ${odd(main.odds)} it needs ${pc(1 / main.odds, 0)} just to break even; ATLAS has ${pc(main.q, 0)}. Likely, but poor value at this price.`);
    else pro.push(`ATLAS ${pc(main.q, 0)} is above the ${pc(1 / main.odds, 0)} break-even: +${(main.ev * 100).toFixed(1)}% estimated edge.`);
    if (main.q < main.p - 0.01) con.push('This market type has landed less often than estimated in the track record, so ATLAS marks it down.');
    invalid.push(`The price shortens below ${odd(1 / main.q)} (no edge left) or the market chance moves 4+ points against it.`);
  } else con.push('No bookmaker price: the chance comes from ATLAS\'s own model only, which is less reliable than a market.');
  if (leanSide) {
    const rh = rate(e.stats?.[`${leanSide}Record`]), ro = rate(e.stats?.[`${other}Record`]);
    if (rh != null && ro != null) (rh >= ro ? pro : con).push(`Season record: ${team(leanSide)} ${e.stats[`${leanSide}Record`]} v ${team(other)} ${e.stats[`${other}Record`]}.`);
    const fh = formPts(e.stats?.[`${leanSide}Form`]), fo = formPts(e.stats?.[`${other}Form`]);
    if (fh != null && fo != null && Math.abs(fh - fo) >= 0.15) (fh > fo ? pro : con).push(`Recent form: ${team(leanSide)} ${e.stats[`${leanSide}Form`].join('')} v ${team(other)} ${e.stats[`${other}Form`].join('')}.`);
    if (e.sport === 'baseball') {
      const a = eraOf(e, leanSide), b = eraOf(e, other);
      if (Number.isFinite(a) && Number.isFinite(b)) (a <= b ? pro : con).push(`Starting pitchers: ${team(leanSide)} starter ERA ${a.toFixed(2)} v ${b.toFixed(2)}.`);
      invalid.push('Either starting pitcher changes.');
    }
    const outLean = e.absences?.[leanSide]?.length || 0, outOther = e.absences?.[other]?.length || 0;
    if (outLean > outOther + 1) con.push(`${team(leanSide)} have more players listed out (${outLean} v ${outOther}): ${e.absences[leanSide].slice(0, 3).map((p) => p.name).join(', ')}.`);
    else if (outOther > outLean + 1) pro.push(`${team(other)} have more players listed out (${outOther} v ${outLean}).`);
    if (leanSide === 'away' && !e.neutral) con.push(`${team(leanSide)} are the away side.`);
    if (e.sport === 'football') invalid.push(`The confirmed XI for ${team(leanSide)} leaves out a regular starter.`);
  }
  if (e.sport === 'hockey') invalid.push('A backup goalie is confirmed for the side ATLAS leans to.');
  if (e.sport === 'esports') invalid.push('A stand-in replaces a regular player.');
  if (e.sport === 'tennis') invalid.push('A withdrawal or injury report for either player.');
  for (const c of r.checks) if (c.ok === false) unknown.push(`${c.label}: ${c.note}.`); else if (c.ok === null) unknown.push(`${c.label}: ${c.note} (not in our feeds).`);
  const inside = [
    ['Bookmaker price, margin removed', Boolean(e.markets?.length)],
    ['Season record and recent form (a small nudge, at most 8 points)', Boolean(e.markets?.length && e.stats?.homeRecord)],
    ['Track-record correction for this market type', true],
    ['Starting pitchers (only when there is no price; otherwise the price already reflects them)', e.sport === 'baseball' && !e.markets?.length],
    ['Injuries, suspensions and lineups (shown for context only, not in the number)', false],
  ];
  return { pro, con, unknown, invalid, inside };
}

export function casePanel(x) {
  const c = caseFor(x);
  if (!c) return '';
  const li = (arr, empty) => (arr.length ? `<ul>${arr.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`);
  return `<section class="panel reveal case" id="sec-case"><h2 class="ph">The case: ${esc(x.main.pick)} <small>${esc(x.main.market)} · ${x.main.book ? `odds ${odd(x.main.odds)} · ` : ''}ATLAS ${pc(x.main.q, 0)} · ${readyBadge(x.r)}</small></h2>
    <div class="case-grid">
      <div><h3>Supports it</h3>${li(c.pro, 'Nothing beyond the price.')}</div>
      <div><h3>Against it</h3>${li(c.con, 'No clear counterargument in the data we have.')}</div>
      <div><h3>Still unknown</h3>${li(c.unknown, 'Everything this sport needs is in.')}</div>
      <div><h3>Would change the call</h3>${li(c.invalid, '—')}</div>
    </div>
    <details class="inside"><summary>What is inside the number</summary><ul>${c.inside.map(([t, on]) => `<li class="${on ? 'yes' : 'no'}">${ico(on ? 'check' : 'cross')} ${esc(t)}</li>`).join('')}</ul></details>
  </section>`;
}

// Evidence timeline for one match (dossier "History" section).
export function historyPanel(e) {
  const list = changesFor(e.id);
  return `<section class="panel reveal" id="sec-history"><h2 class="ph">Evidence timeline <small>every material change ATLAS recorded for this match</small></h2>
    ${list.length ? `<ol class="timeline">${list.map((c) => `<li><time>${esc(ist(c.at))}</time><b>${kindIco(c.kind)} ${esc(c.text)}</b><small>${c.source ? `Source: ${esc(c.source)}` : ''}${FORECAST_NOTE[c.forecast] ? ` · ${FORECAST_NOTE[c.forecast]}` : ''}</small></li>`).join('')}</ol>` : '<p class="muted">No changes recorded yet: starters, lineups, absences and price moves appear here as they happen.</p>'}
  </section>`;
}

// ---------- quick view (side panel) ----------
export function quickView(id) {
  const e = S.events.find((x) => x.id === id);
  if (!e) return '';
  const x = researchRow(e);
  const w = x.a.win;
  const chg = changesFor(e.id).slice(0, 4);
  return `<header class="qv-head"><span>${sportOf(e.sport).icon} ${esc(e.league)}</span><button class="icon-btn" data-qv-close aria-label="Close quick view">×</button></header>
    <h2>${esc(e.home)} <small>v</small> ${esc(e.away)}</h2>
    <p class="muted">${e.live ? `<span class="live">LIVE ${esc(e.score || '')}</span>` : esc(ist(e.start))}</p>
    <div class="qv-probs">${[[e.home, w.home], ...(w.draw ? [['Draw', w.draw]] : []), [e.away, w.away]].map(([n, p]) => `<div><small>${esc(n)}</small><b>${pc(p, 0)}</b></div>`).join('')}</div>
    ${x.picks.length ? `<h3>Picks</h3><ul class="qv-picks">${x.picks.map((p) => `<li><b>${esc(p.pick)}</b><small>${esc(p.market)} · ${p.book ? `odds ${odd(p.odds)} · market ${pc(p.fair, 0)} · ` : 'fair odds · '}ATLAS ${pc(p.q, 0)}${p.book ? ` · edge ${(p.ev * 100).toFixed(1)}%` : ''}</small></li>`).join('')}</ul>` : ''}
    <h3>Evidence ${readyBadge(x.r)}</h3>
    <ul class="qv-checks">${x.r.checks.map((c) => `<li class="${c.ok === true ? 'ok' : c.ok === false ? 'no' : 'na'}">${ico(c.ok === true ? 'check' : c.ok === false ? 'cross' : 'dash')} <b>${esc(c.label)}</b> <small>${esc(c.note)}</small></li>`).join('')}</ul>
    <h3>Recent changes</h3>${chg.length ? `<ul class="ch-list">${chg.map((c) => `<li class="chg"><span class="ch-ico">${kindIco(c.kind)}</span><div><p>${esc(c.text)}</p><small>${ago(c.at)} ago${FORECAST_NOTE[c.forecast] ? ` · ${FORECAST_NOTE[c.forecast]}` : ''}</small></div></li>`).join('')}</ul>` : '<p class="muted">None recorded yet.</p>'}
    <div class="qv-actions"><a class="btn" href="#/match/${esc(e.id)}">Open full dossier</a>
      <button class="btn-ghost" data-watch="${esc(e.id)}" aria-pressed="${watch.has(e.id)}">${watchLabel(watch.has(e.id), false)}</button>
      <button class="btn-ghost" data-pin="${esc(e.id)}">${pinLabel(pins().includes(e.id), false)}</button></div>`;
}

// ---------- compare ----------
const PKEY = 'atlas-compare';
export const pins = () => read(PKEY, []);
export function togglePin(id) {
  let p = pins();
  p = p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-4);
  write(PKEY, p);
  return p.includes(id);
}
export function compareView() {
  const rows = pins().map((id) => S.events.find((e) => e.id === id)).filter(Boolean).map(researchRow);
  const line = (label, f) => `<tr><th>${label}</th>${rows.map((x) => `<td>${f(x)}</td>`).join('')}</tr>`;
  return {
    mode: 'other', accent: '#4fd1ff', title: 'Compare', sceneOpts: { emblem: 'scale' },
    html: `<section class="hero small"><p class="kicker reveal">SIDE BY SIDE · UP TO 4 MATCHES</p><h1>COMPARE</h1>
      <p class="lede reveal">Pin matches with Compare from the research table, the quick view or a match page.</p></section>
      ${rows.length ? `<div class="panel table-wrap reveal"><table class="cmp"><thead><tr><th></th>${rows.map((x) => `<th><a href="#/match/${esc(x.e.id)}">${sportOf(x.e.sport).icon} ${esc(x.e.home)} v ${esc(x.e.away)}</a><button class="icon-btn" data-pin="${esc(x.e.id)}" title="Unpin">×</button></th>`).join('')}</tr></thead><tbody>
        ${line('Start (IST)', (x) => esc(ist(x.e.start)))}
        ${line('Main pick', (x) => (x.main ? `<b>${esc(x.main.pick)}</b><small>${esc(x.main.market)}</small>` : '—'))}
        ${line('Odds', (x) => (x.main ? odd(x.main.odds) : '—'))}
        ${line('Market chance', (x) => (x.main?.fair != null ? pc(x.main.fair, 0) : '—'))}
        ${line('ATLAS chance', (x) => (x.main ? `<b>${pc(x.main.q, 0)}</b>` : '—'))}
        ${line('Edge', (x) => (x.main?.book ? `<span class="${x.main.ev >= 0 ? 'pos' : 'neg'}">${(x.main.ev * 100).toFixed(1)}%</span>` : '—'))}
        ${line('Evidence', (x) => readyBadge(x.r))}
        ${line('Still unknown', (x) => esc([...x.r.missing, ...x.r.uncovered].join(', ') || 'nothing'))}
        ${line('Latest change', (x) => (x.change ? esc(x.change.text) : '—'))}
        ${line('Against it', (x) => esc(caseFor(x)?.con[0] || '—'))}
      </tbody></table></div>` : '<p class="muted reveal">Nothing pinned yet.</p>'}`,
  };
}

// ---------- watchlist ----------
export function watchlistView() {
  const list = watch.ids().map((id) => S.events.find((e) => e.id === id)).filter(Boolean).sort((a, b) => a.start - b.start);
  const rows = list.map(researchRow);
  return {
    mode: 'other', accent: '#ffb547', title: 'Watchlist', sceneOpts: { emblem: 'star' },
    html: `<section class="hero small"><p class="kicker reveal">SAVED MATCHES · ALERTS ON CHANGES</p><h1>WATCHLIST</h1>
      <p class="lede reveal">Matches you starred. A match is flagged <b>needs review</b> when a starter, lineup, absence or price changes after you last opened it.</p></section>
      ${rows.length ? `<div class="list">${rows.map((x) => `<a class="row wl reveal ${x.review.length ? 'needs-review' : ''}" href="#/match/${esc(x.e.id)}" data-qv="${esc(x.e.id)}">
        <span class="ico">${sportOf(x.e.sport).icon}</span>
        <div class="teams"><b>${esc(x.e.home)} v ${esc(x.e.away)}</b><small>${esc(x.e.league)} · ${x.e.live ? `<span class="live">LIVE ${esc(x.e.score || '')}</span>` : esc(ist(x.e.start))}</small>
          ${x.review.length ? `<small class="nr">⚠ Needs review: ${esc(x.review[0].text)}${x.review.length > 1 ? ` (+${x.review.length - 1} more)` : ''}</small>` : ''}</div>
        <div class="odds">${x.main ? `<span class="stat"><small>${esc(x.main.pick)}</small>${pc(x.main.q, 0)}</span>` : ''}${readyBadge(x.r)}</div></a>`).join('')}</div>` : '<p class="muted reveal">No saved matches. Use Watch on any match or in the research table.</p>'}
      ${changesPanel(list, { title: 'Changes to your matches', limit: 20 })}`,
  };
}
