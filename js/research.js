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
import { readiness, readyBadge } from './readiness.js';
import { changesFor, latestChange, needsReview, changesSince, lastVisit, timelineUpdatedAt } from './timeline.js';
import { FORECAST_NOTE } from './changelog.js';
import { watch, notifyPermission } from './alerts.js';
import { pc, odd } from './charts.js';

let S;
export function bindResearch(state) { S = state; }

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const ago = (t) => { if (!t) return '—'; const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? '<1 min' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

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
export const researchPrefs = () => ({ shortHours: 12, ...read(RKEY, {}) });
export const setResearchPrefs = (patch) => write(RKEY, { ...researchPrefs(), ...patch });

// Time-window chips for the shortlist.
export const WINDOWS = [3, 6, 12, 24, 48];
export const windowChips = (key, cur) => `<div class="win-chips" role="group" aria-label="Time window"><span>Starting in</span>${WINDOWS.map((h) => `<button class="chip ${cur === h ? 'on' : ''}" data-${key}="${h}" aria-pressed="${cur === h}">${h}h</button>`).join('')}</div>`;

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
    mode: 'other', accent: '#4fd1ff', title: 'Compare',
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
// Live alerts: whether notifications are on, or the button to turn them on.
export function alertPanel() {
  const perm = notifyPermission();
  const state = perm === 'granted' ? '<span class="al-on">Notifications on</span>'
    : perm === 'denied' ? '<span class="al-off">Notifications are blocked for this site: allow them in your browser\'s site settings</span>'
      : perm === 'unsupported' ? '<span class="al-off">This browser can\'t show notifications here (on iPhone, add ATLAS to your Home Screen first)</span>'
        : '<button class="btn-ghost" data-notify-on>Turn on notifications</button>';
  return `<div class="panel alerts-panel reveal"><h3 class="ph">Live alerts <small>for matches you watch or have in your slip</small></h3>
    <div class="al-row">${state}</div></div>`;
}
// A watched match that has ended: kept with its result until cleared.
const doneRow = (id, m) => `<div class="row wl done reveal">
        <span class="ico">${sportOf(m.sport).icon}</span>
        <div class="teams"><b>${esc(m.home)} v ${esc(m.away)}</b><small>${esc(m.league)} · ${esc(ist(m.start))}</small></div>
        <div class="odds"><span class="fin">Finished</span>${m.result ? `<b class="fin-score">${esc(m.result)}</b>` : m.score ? `<b class="fin-score">${esc(m.home)} ${esc(m.score)} ${esc(m.away)}</b>` : ''}
          <button class="icon-btn on" data-watch="${esc(id)}" aria-pressed="true" aria-label="Remove from watchlist">${ico('star-on')}</button></div></div>`;
export function watchlistView() {
  watch.remember(S.events);
  const list = watch.ids().map((id) => S.events.find((e) => e.id === id)).filter(Boolean).sort((a, b) => a.start - b.start);
  const rows = list.map(researchRow);
  const doneIds = watch.finished(S.events);
  const done = doneIds.filter((id) => watch.meta(id)?.home).sort((a, b) => watch.meta(b).start - watch.meta(a).start);
  return {
    mode: 'other', accent: '#ffb547', title: 'Watchlist',
    html: `<section class="hero small"><p class="kicker reveal">SAVED MATCHES · LIVE ALERTS</p><h1>WATCHLIST</h1></section>
      ${alertPanel()}
      ${rows.length ? `<div class="list">${rows.map((x) => `<a class="row wl reveal ${x.review.length ? 'needs-review' : ''}" href="#/match/${esc(x.e.id)}" data-qv="${esc(x.e.id)}">
        <span class="ico">${sportOf(x.e.sport).icon}</span>
        <div class="teams"><b>${esc(x.e.home)} v ${esc(x.e.away)}</b><small>${esc(x.e.league)} · ${x.e.live ? `<span class="live">LIVE ${esc(x.e.score || '')}</span>` : esc(ist(x.e.start))}</small>
          ${x.review.length ? `<small class="nr">⚠ Needs review: ${esc(x.review[0].text)}${x.review.length > 1 ? ` (+${x.review.length - 1} more)` : ''}</small>` : ''}</div>
        <div class="odds">${x.main ? `<span class="stat"><small>${esc(x.main.pick)}</small>${pc(x.main.q, 0)}</span>` : ''}${readyBadge(x.r)}</div></a>`).join('')}</div>` : !doneIds.length ? '<p class="muted reveal">No saved matches. Use Watch on any match or in the research table.</p>' : ''}
      ${doneIds.length ? `<div class="wl-done-head reveal"><h3 class="ph">Finished</h3><button class="btn-ghost" data-clear-finished>Clear finished (${doneIds.length})</button></div>
      ${done.length ? `<div class="list">${done.map((id) => doneRow(id, watch.meta(id))).join('')}</div>` : ''}` : ''}
      ${changesPanel(list, { title: 'Changes to your matches', limit: 20 })}`,
  };
}
