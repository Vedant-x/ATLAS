// Sources: every outside feed the build reads, and how it did on the last build (data/sources.json):
// what it is used for, whether it answered, how much it gave, and when. A source that is not set up
// (no key) says so; one that failed says why, so coverage is never assumed from a quiet page.
import { esc } from './views.js';

let cache = null, loading = null;
function load(refresh) {
  if (!loading && (!cache || Date.now() - cache.loadedAt > 5 * 6e4)) {
    loading = fetch(`data/sources.json?t=${Math.floor(Date.now() / 6e4)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d) => { cache = { loadedAt: Date.now(), d }; loading = null; refresh?.(); });
  }
}
const ago = (t) => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const STATE = (s) => (s.ok === true ? ['ok', 'Working'] : s.ok === false ? ['failed', 'Failed'] : ['off', 'Not set up']);

export function sourcesView(refresh) {
  load(refresh);
  const d = cache?.d;
  const rank = (x) => (x.ok === false ? 0 : x.ok == null ? 2 : 1); // failures first, then working, then not set up
  const rows = (d?.sources || []).slice().sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(b.name));
  const failed = rows.filter((s) => s.ok === false).length;
  return {
    mode: 'other', accent: '#4fd1ff', title: 'Sources',
    html: `<section class="hero small"><p class="kicker reveal">WHERE THE DATA COMES FROM · LAST BUILD${d?.at ? ` ${esc(ago(d.at)).toUpperCase()}` : ''}</p><h1>SOURCES</h1>
      <p class="lede reveal">Every feed ATLAS reads, rebuilt about every 10 minutes. ESPN gives most fixtures and prices; the rest fill what ESPN leaves out: starters, team news, ratings for matches nobody prices, and real bookmaker odds for leagues ESPN doesn't price.</p></section>
      ${!cache ? '<p class="muted reveal loading-dots">Loading sources</p>' : !d ? '<div class="panel reveal"><p class="muted">The source report is published by the next build.</p></div>' : `
      ${failed ? `<p class="notice reveal"><b>${failed} source${failed > 1 ? 's' : ''} failed on the last build.</b> Matches they cover keep their last good data, marked with its age.</p>` : ''}
      <div class="panel reveal"><div class="table-wrap"><table class="tbl tight sources-tbl"><thead><tr><th>Source</th><th>Used for</th><th>Last build</th><th class="num">Gave</th><th>Note</th></tr></thead>
      <tbody>${rows.map((s) => { const [cls, label] = STATE(s); return `<tr class="src-${cls}"><td><b>${esc(s.name)}</b><small>${esc(s.site)}</small></td><td>${esc(s.what)}</td><td><span class="src-state">${label}</span><small>tried ${esc(ago(s.lastAttemptAt ?? s.at))}</small>${s.ok === false ? `<small>${s.lastSuccessAt ? `last worked ${esc(ago(s.lastSuccessAt))}` : 'no success on record'}${s.errorCategory ? ` · ${esc(s.errorCategory)}` : ''}</small>` : s.status === 'empty' ? '<small>answered, nothing to give</small>' : ''}</td><td class="num">${s.count ?? '—'}</td><td>${esc(s.note || '')}</td></tr>`; }).join('')}</tbody></table></div></div>`}`,
  };
}
