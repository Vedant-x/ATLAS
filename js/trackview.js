// Record page: every official ATLAS pick (locked before kick-off) and how it turned out.
import { esc, sportOf, ist } from './views.js';
import { summarize, MIN_ODDS, MAX_ODDS, calibration } from './track.js';
import { localDay } from './engine.js';

const pct = (x, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
const units = (x) => `${x > 0 ? '+' : ''}${x.toFixed(2)}u`;
const day = (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
let cache = null;

async function load() {
  if (!cache || Date.now() - cache.at > 5 * 6e4) {
    const res = await fetch(`data/track.json?t=${Math.floor(Date.now() / 6e4)}`);
    if (!res.ok) throw new Error('no track record yet');
    cache = { at: Date.now(), data: await res.json() };
  }
  return cache.data;
}

// For the rest of the site: summary and per-market calibration once the record has loaded. The record
// is re-fetched in the background every 5 minutes, so a page left open keeps up with new results.
export const trackStats = () => (cache ? summarize(cache.data.picks || []) : null);
export const trackCalibration = () => (cache ? calibration(cache.data.picks || []) : null);
let reloading = false;
export function ensureTrack(refresh) {
  if (cache && Date.now() - cache.at < 5 * 6e4) return;
  if (reloading) return;
  reloading = true;
  const before = cache?.data.updatedAt;
  load().then((d) => { if (d.updatedAt !== before) refresh?.(); }).catch(() => {}).finally(() => { reloading = false; });
}
// Today's official (tracked) slip for a target, exactly as it was saved: or null if none yet.
export function officialSlip(target) {
  const day = localDay();
  return (cache?.data.picks || []).filter((h) => h.type === 'multi' && h.target === target && h.key.split('|')[1] === day).at(-1) || null;
}
// One line of record for a section: "41–16 · 72% hit rate · +4.9u".
// A multiplier's own slip history: each daily official slip with its legs and result.
export function slipHistory(slips = []) {
  return slips.length ? `<ul class="tr-list">${slips.map(pickRow).join('')}</ul>` : '';
}
export function recordLine(st) {
  if (!st || !(st.won + st.lost)) return '';
  return `${st.won}–${st.lost} · ${pct(st.hitRate, 0)} hit rate · <span class="${st.profit >= 0 ? 'pos' : 'neg'}">${units(st.profit)}</span>`;
}

const ago = (t) => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const statCards = (s, updatedAt) => `${updatedAt ? `<p class="note reveal">Results updated ${ago(updatedAt)} · picks are graded about two hours after each match ends.</p>` : ''}<div class="tr-stats">
  <div><small>Settled picks</small><b>${s.won + s.lost}</b><span>${s.won} won · ${s.lost} lost${s.push ? ` · ${s.push} push` : ''}</span></div>
  <div><small>Hit rate</small><b>${pct(s.hitRate)}</b><span>ATLAS estimated ${pct(s.expected)}</span></div>
  <div><small>Profit, 1 unit per pick</small><b class="${s.profit >= 0 ? 'pos' : 'neg'}">${units(s.profit)}</b><span>ROI ${pct(s.roi)}</span></div>
  <div><small>Average odds</small><b>${s.avgOdds ? s.avgOdds.toFixed(2) : '—'}</b><span>range ${MIN_ODDS.toFixed(2)} to ${MAX_ODDS.toFixed(2)}</span></div>
  <div><small>Price vs closing line</small><b class="${s.clvN >= 10 ? (s.clv >= 0 ? 'pos' : 'neg') : ''}">${s.clvN >= 10 ? `${s.clv >= 0 ? '+' : ''}${(s.clv * 100).toFixed(1)}%` : '—'}</b><span>${s.clvN >= 10 ? `saved price beat the close on ${pct(s.beatClose, 0)} of ${s.clvN} picks` : 'closing prices are now saved for every pick; shown after 10 settle'}</span></div>
  <div><small>Forecast score (Brier)</small><b>${s.brier == null ? '—' : s.brier.toFixed(3)}</b><span>${s.brierN >= 20 ? `market alone ${s.brierMarket.toFixed(3)} on the same ${s.brierN} picks · lower is better` : 'lower is better · market comparison after 20 picks'}</span></div></div>`;

// Forecast score per row: Brier (lower is better) and, once 10+ picks have a saved market chance,
// whether ATLAS beat the market's own forecast on those picks.
const vsMarket = (r) => (r.brierN >= 10 ? `<span class="${r.brierModel <= r.brierMarket ? 'pos' : 'neg'}">${r.brierModel <= r.brierMarket ? 'beats' : 'trails'} market</span>` : '<span class="muted">—</span>');
const table = (rows, label) => (rows.length ? `<div class="table-wrap"><table class="tr-table"><thead><tr><th>${label}</th><th>Picks</th><th>Hit rate</th><th>Estimated</th><th>Profit</th><th title="Brier score: mean squared error of the chance shown. Lower is better.">Brier</th><th title="Same score for the bookmaker's margin-free chance on the same picks">vs market</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.won + r.lost}</td><td>${pct(r.hitRate)}</td><td>${pct(r.expected)}</td><td class="${r.profit >= 0 ? 'pos' : 'neg'}">${units(r.profit)}</td><td>${r.brier == null ? '—' : r.brier.toFixed(3)}</td><td>${vsMarket(r)}</td></tr>`).join('')}</tbody></table></div>` : '');

const pickRow = (h) => (h.type === 'multi' ? `<li class="tr-${h.status}"><span class="tr-badge">${h.status === 'pending' ? day(h.start) : h.status.toUpperCase()}</span>
  <div><b>${esc(h.target)}x slip · ${h.legs.length} legs</b><small>${h.legs.map((l) => `<i class="leg-dot leg-${esc(l.status)}" title="${esc(l.status)}"></i>${esc(l.pick)} (${esc(l.home)} v ${esc(l.away)}, ${esc(ist(l.start))})`).join(' · ')}</small></div>
  <em>${Number(h.odds).toFixed(2)}</em><i>${pct(h.p, 0)}</i></li>` : `<li class="tr-${h.status}"><span class="tr-badge">${h.status === 'pending' ? day(h.start) : h.status.toUpperCase()}</span>
  <div><b>${esc(h.pick)}</b><small>${sportOf(h.sport).icon} ${esc(h.home)} v ${esc(h.away)} · ${esc(ist(h.start))} · ${esc(h.market)}${h.score ? ` · final ${esc(h.score)}` : ''} · ${h.type === 'value' ? 'value spot' : 'banker'}</small></div>
  <em>${Number(h.odds).toFixed(2)}</em><i>${pct(h.shown ?? h.p, 0)}</i></li>`);

function body(data) {
  const s = summarize(data.picks || []);
  if (!s.all.won && !s.all.lost) {
    return `<div class="panel reveal"><h3 class="ph">Tracking has started</h3><p class="muted">Every shortlist pick (rated 60%+, odds ${MIN_ODDS.toFixed(2)} to ${MAX_ODDS.toFixed(2)}) is saved before kick-off and graded from the final score. Results appear here as matches finish.</p></div>
      ${s.pending.length ? `<div class="panel reveal"><h3 class="ph">Waiting on results <small>${s.pending.length}</small></h3><ul class="tr-list">${s.pending.slice(0, 30).map(pickRow).join('')}</ul></div>` : ''}`;
  }
  const famName = { winner: 'Winner / moneyline', result: '1X2 result', spread: 'Spread / handicap', total: 'Totals (over/under)' };
  return `${statCards(s.all, data.updatedAt)}${s.outside.won + s.outside.lost ? `<p class="note reveal">Shortlist picks only (rated 60%+, odds ${MIN_ODDS.toFixed(2)} to ${MAX_ODDS.toFixed(2)}). ${s.outside.won + s.outside.lost} earlier picks outside these rules (value spots and longer prices, ${s.outside.won} won, ${s.outside.lost} lost) are not counted.</p>` : ''}${s.unresolved ? `<p class="note reveal">${s.unresolved} pick${s.unresolved > 1 ? 's' : ''} could not be graded (no final result found) and ${s.unresolved > 1 ? 'are' : 'is'} left out rather than counted as void.</p>` : ''}
    <div class="grid two">
      <div class="panel reveal"><h3 class="ph">By sport</h3>${table(s.bySport.map((r) => ({ ...r, name: `${sportOf(r.key).icon} ${sportOf(r.key).name}` })), 'Sport')}</div>
      <div class="panel reveal"><h3 class="ph">By market <small>the model needs more confidence where a market has underperformed</small></h3>${table(s.byFamily.map((r) => ({ ...r, name: famName[r.key] || r.key })), 'Market')}</div>
      
    </div>
    <div class="panel reveal"><h3 class="ph">Multipliers and mega <small>separate records</small></h3><p class="muted">Each multiplier keeps its own record on its own page, so slips never mix with single picks here.</p><div class="chip-row">${[2, 3, 4, 5, 10, 20].map((x) => `<a class="chip" href="#/x/${x}">${x}×</a>`).join('')}<a class="chip" href="#/mega">Mega 100× / 1000×</a></div></div>
    ${s.byModel.length > 1 ? `<div class="panel reveal"><h3 class="ph">By model version <small>each pick is stamped with the model that made it</small></h3>${table(s.byModel.map((r) => ({ ...r, name: r.key })), 'Model')}</div>` : ''}
    <div class="panel reveal"><h3 class="ph">Are the estimates honest? <small>calibration</small></h3>
      <p class="muted">When ATLAS says 65%, it should land about 65% of the time. Small samples swing a lot.</p>
      <div class="tr-cal">${s.buckets.map((b) => `<div><small>Estimated ${b.label}</small>${b.n ? `<div class="tr-bars"><i style="--w:${((b.predicted || 0) * 100).toFixed(0)}%"></i><i class="act" style="--w:${((b.actual || 0) * 100).toFixed(0)}%"></i></div>` : ''}<span>${b.n ? `${pct(b.predicted, 0)} estimated · ${pct(b.actual, 0)} actual · ${b.n} picks` : 'no picks yet'}</span></div>`).join('')}</div></div>
    <div class="panel reveal"><h3 class="ph">Latest results</h3><ul class="tr-list">${s.recent.map(pickRow).join('')}</ul></div>
    ${s.pending.length ? `<div class="panel reveal"><h3 class="ph">Waiting on results <small>${s.pending.length}</small></h3><ul class="tr-list">${s.pending.slice(0, 20).map(pickRow).join('')}</ul></div>` : ''}`;
}

export const trackViews = {
  track() {
    return {
      mode: 'other', accent: '#3dff9a', title: 'Track record',
      html: `<section class="hero small"><p class="kicker reveal">EVERY PICK · LOCKED BEFORE KICK-OFF · GRADED FROM FINAL SCORES</p><h1>TRACK RECORD</h1>
        <p class="lede reveal">Every shortlist pick, saved before kick-off and graded from the final score.</p></section>
        <div id="track-body">${cache ? body(cache.data) : '<p class="muted">Loading results…</p>'}</div>`,
      after: () => {
        load().then((d) => {
          const el = document.getElementById('track-body');
          if (el) { el.innerHTML = body(d); el.querySelectorAll('.reveal').forEach((x) => x.classList.add('in')); }
        }).catch(() => {
          const el = document.getElementById('track-body');
          if (el) el.innerHTML = '<div class="panel"><p class="muted">The track record starts with the next site update: picks are saved before kick-off and graded after the final whistle.</p></div>';
        });
      },
    };
  },
};

// Home dashboard card: the record so far (loads in the background, then the page redraws).
export function trackCard(refresh) {
  ensureTrack(refresh);
  if (!cache) return '';
  const s = summarize(cache.data.picks || []);
  const a = s.all;
  if (!a.won && !a.lost) return `<a class="panel dash-track reveal" href="#/track"><h2 class="ph">Track record <small>tracking started</small></h2><p class="muted">${s.pending.length} picks locked before kick-off, waiting on results.</p></a>`;
  const last = s.recent.slice(0, 10).map((h) => `<i class="tr-dot ${h.status}" title="${esc(h.pick)}: ${h.status}"></i>`).join('');
  return `<a class="panel dash-track reveal" href="#/track"><h2 class="ph">Track record <small>every pick, locked before kick-off</small></h2>
    <div class="dt-row"><div><b>${a.won}–${a.lost}</b><small>won–lost</small></div><div><b>${pct(a.hitRate, 0)}</b><small>hit rate (est. ${pct(a.expected, 0)})</small></div><div><b class="${a.profit >= 0 ? 'pos' : 'neg'}">${units(a.profit)}</b><small>1 unit per pick</small></div></div>
    <ul class="dt-types">${s.bySport.slice(0, 4).map((r) => `<li><span>${sportOf(r.key).icon} ${esc(sportOf(r.key).name)}</span><b>${pct(r.hitRate, 0)}</b><small>${r.won}–${r.lost}</small></li>`).join('')}</ul>
    <div class="dt-last">${last}<span>latest results →</span></div></a>`;
}
