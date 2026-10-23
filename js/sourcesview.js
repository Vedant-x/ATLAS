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
// Transport and usefulness apart: a feed that answers but gives nothing usable is not "Working".
const STATE = (s) => (s.status === 'paused' ? ['paused', 'Paused'] : s.ok === false ? ['failed', 'Failed'] : s.ok !== true ? ['off', 'Not set up']
  : s.status === 'empty' || s.count === 0 ? ['empty', 'Answered, nothing usable'] : ['ok', 'Working']);

// What ATLAS does not have, and why: said plainly, so nobody reads a gap as coverage.
const MISSING = [
  ['Stake\'s own prices', 'Stake publishes no odds feed and blocks automated reads. ATLAS shows one real bookmaker\'s price (DraftKings, via ESPN) and, on the main leagues, the typical price across a dozen bookmakers: the best guide to what Stake will offer. Check Stake\'s price before betting.'],
  ['Starting lineups outside soccer', 'NBA and NHL lineups are announced about 30 minutes before the start and no free feed carries them. Soccer lineups come from FotMob; NHL starting goalies from Daily Faceoff; NBA picks wait for the injury report instead.'],
  ['Referees', 'No free source records how referees call games, and names alone say nothing about a bet.'],
  ['Player data for tennis, cricket and esports', 'No free per-player feed. Tennis uses rankings (ATLAS\'s own tennis ratings call only 57% of results, so they are not used); cricket and esports use team-level data.'],
  ['College volleyball, soccer, hockey and field hockey', 'No bookmaker feed here prices them, so they are left off the board (they were a third of it). Their league pages still load them from ESPN when opened.'],
];
const missingPanel = () => `<details class="panel reveal fold"><summary><h2 class="ph">Not covered <small>${MISSING.length} gaps, and why</small></h2></summary>
  <dl class="missing">${MISSING.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>`;

export function sourcesView(refresh) {
  load(refresh);
  const d = cache?.d;
  const rank = (x) => ({ failed: 0, paused: 1, empty: 2, ok: 3, off: 4 })[STATE(x)[0]]; // failures, paused, answered-but-empty, working, not set up
  const rows = (d?.sources || []).slice().sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(b.name));
  const failed = rows.filter((s) => s.ok === false && s.status !== 'paused').length, pausedN = rows.filter((s) => s.status === 'paused').length;
  return {
    mode: 'other', accent: '#4fd1ff', title: 'Sources',
    html: `<section class="hero small"><p class="kicker reveal">WHERE THE DATA COMES FROM · LAST BUILD${d?.at ? ` ${esc(ago(d.at)).toUpperCase()}` : ''}</p><h1>SOURCES</h1>
      <p class="lede reveal">Every feed ATLAS reads, rebuilt about every 20 minutes. ESPN gives most fixtures and prices; the rest fill what ESPN leaves out: starters, team news, ratings for matches nobody prices, and real bookmaker odds for leagues ESPN doesn't price.</p></section>
      ${!cache ? '<p class="muted reveal loading-dots">Loading sources</p>' : !d ? '<div class="panel reveal"><p class="muted">The source report is published by the next build.</p></div>' : `
      ${failed ? `<p class="notice reveal"><b>${failed} source${failed > 1 ? 's' : ''} failed on the last build.</b> Matches they cover keep their last good data, marked with its age.</p>` : ''}
      ${pausedN ? `<p class="notice reveal"><b>${pausedN} source${pausedN > 1 ? 's are' : ' is'} paused</b> after failing 3 builds in a row, and retried every 6 hours. ATLAS uses its own ratings and the rankings in their place.</p>` : ''}
      <div class="panel reveal"><div class="table-wrap"><table class="tbl tight sources-tbl"><thead><tr><th>Source</th><th>Used for</th><th>Last build</th><th class="num">Gave</th><th>Note</th></tr></thead>
      <tbody>${rows.map((s) => { const [cls, label] = STATE(s); return `<tr class="src-${cls}"><td><b>${esc(s.name)}</b><small>${esc(s.site)}</small></td><td>${esc(s.what)}</td><td><span class="src-state">${label}</span><small>tried ${esc(ago(s.lastAttemptAt ?? s.at))}</small>${s.ok === false ? `<small>${s.lastSuccessAt ? `last worked ${esc(ago(s.lastSuccessAt))}` : 'no success on record'}${s.errorCategory ? ` · ${esc(s.errorCategory)}` : ''}</small>` : ''}</td><td class="num">${s.count ?? '—'}</td><td>${esc(s.note || '')}</td></tr>`; }).join('')}</tbody></table></div></div>
      ${missingPanel()}`}`,
  };
}
