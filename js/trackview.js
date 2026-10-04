// Record page: every official ATLAS pick (locked before kick-off) and how it turned out.
import { esc, sportOf } from './views.js';
import { summarize, MIN_ODDS } from './track.js';

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

const statCards = (s) => `<div class="tr-stats">
  <div><small>Settled picks</small><b>${s.won + s.lost}</b><span>${s.won} won · ${s.lost} lost${s.push ? ` · ${s.push} push` : ''}</span></div>
  <div><small>Hit rate</small><b>${pct(s.hitRate)}</b><span>ATLAS estimated ${pct(s.expected)}</span></div>
  <div><small>Profit, 1 unit per pick</small><b class="${s.profit >= 0 ? 'pos' : 'neg'}">${units(s.profit)}</b><span>ROI ${pct(s.roi)}</span></div>
  <div><small>Average odds</small><b>${s.avgOdds ? s.avgOdds.toFixed(2) : '—'}</b><span>minimum ${MIN_ODDS.toFixed(2)}</span></div></div>`;

const table = (rows, label) => (rows.length ? `<table class="tr-table"><thead><tr><th>${label}</th><th>Picks</th><th>Hit rate</th><th>Estimated</th><th>Profit</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.won + r.lost}</td><td>${pct(r.hitRate)}</td><td>${pct(r.expected)}</td><td class="${r.profit >= 0 ? 'pos' : 'neg'}">${units(r.profit)}</td></tr>`).join('')}</tbody></table>` : '');

const pickRow = (h) => `<li class="tr-${h.status}"><span class="tr-badge">${h.status === 'pending' ? day(h.start) : h.status.toUpperCase()}</span>
  <div><b>${esc(h.pick)}</b><small>${sportOf(h.sport).icon} ${esc(h.home)} v ${esc(h.away)} · ${esc(h.market)}${h.score ? ` · final ${esc(h.score)}` : ''} · ${h.type === 'value' ? 'value spot' : 'banker'}</small></div>
  <em>${Number(h.odds).toFixed(2)}</em><i>${pct(h.p, 0)}</i></li>`;

function body(data) {
  const s = summarize(data.picks || []);
  if (!s.all.won && !s.all.lost) {
    return `<div class="panel reveal"><h3 class="ph">Tracking has started</h3><p class="muted">Every banker and value spot (odds ${MIN_ODDS.toFixed(2)}+) is now saved before kick-off and graded from the final score. Results appear here as matches finish.</p></div>
      ${s.pending.length ? `<div class="panel reveal"><h3 class="ph">Waiting on results <small>${s.pending.length}</small></h3><ul class="tr-list">${s.pending.slice(0, 30).map(pickRow).join('')}</ul></div>` : ''}`;
  }
  const typeName = { banker: 'Bankers (est. 60%+)', value: 'Value spots (model above price)' };
  return `${statCards(s.all)}
    <div class="two">
      <div class="panel reveal"><h3 class="ph">By pick type</h3>${table(s.byType.map((r) => ({ ...r, name: typeName[r.key] || r.key })), 'Type')}</div>
      <div class="panel reveal"><h3 class="ph">By sport</h3>${table(s.bySport.map((r) => ({ ...r, name: `${sportOf(r.key).icon} ${sportOf(r.key).name}` })), 'Sport')}</div>
    </div>
    <div class="panel reveal"><h3 class="ph">Are the estimates honest? <small>calibration</small></h3>
      <p class="muted">When ATLAS says 65%, it should land about 65% of the time. Small samples swing a lot.</p>
      <div class="tr-cal">${s.buckets.map((b) => `<div><small>Estimated ${b.label}</small><div class="tr-bars"><i style="--w:${((b.predicted || 0) * 100).toFixed(0)}%"></i><i class="act" style="--w:${((b.actual || 0) * 100).toFixed(0)}%"></i></div><span>${b.n ? `${pct(b.predicted, 0)} estimated · ${pct(b.actual, 0)} actual · ${b.n} picks` : 'no picks yet'}</span></div>`).join('')}</div></div>
    <div class="panel reveal"><h3 class="ph">Latest results</h3><ul class="tr-list">${s.recent.map(pickRow).join('')}</ul></div>
    ${s.pending.length ? `<div class="panel reveal"><h3 class="ph">Waiting on results <small>${s.pending.length}</small></h3><ul class="tr-list">${s.pending.slice(0, 20).map(pickRow).join('')}</ul></div>` : ''}`;
}

export const trackViews = {
  track() {
    return {
      mode: 'other', accent: '#3dff9a', title: 'Track record',
      html: `<section class="hero small"><p class="kicker reveal">EVERY PICK · LOCKED BEFORE KICK-OFF · GRADED FROM FINAL SCORES</p><h1>TRACK RECORD</h1>
        <p class="lede reveal">The real results of ATLAS's bankers and value spots, published before each match and never edited afterwards.</p></section>
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
  if (!cache) { load().then(() => refresh?.()).catch(() => {}); return ''; }
  const s = summarize(cache.data.picks || []);
  const a = s.all;
  if (!a.won && !a.lost) return `<a class="panel dash-track reveal" href="#/track"><h3 class="ph">Track record <small>tracking started</small></h3><p class="muted">${s.pending.length} picks locked before kick-off, waiting on results.</p></a>`;
  const last = s.recent.slice(0, 10).map((h) => `<i class="tr-dot ${h.status}" title="${esc(h.pick)}: ${h.status}"></i>`).join('');
  return `<a class="panel dash-track reveal" href="#/track"><h3 class="ph">Track record <small>every pick, locked before kick-off</small></h3>
    <div class="dt-row"><div><b>${a.won}–${a.lost}</b><small>won–lost</small></div><div><b>${pct(a.hitRate, 0)}</b><small>hit rate (est. ${pct(a.expected, 0)})</small></div><div><b class="${a.profit >= 0 ? 'pos' : 'neg'}">${units(a.profit)}</b><small>1 unit per pick</small></div></div>
    <div class="dt-last">${last}<span>latest results →</span></div></a>`;
}
