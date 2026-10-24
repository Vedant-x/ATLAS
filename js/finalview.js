// A watched match after full time: the final score and what happened (ESPN summary: score by period,
// key moments, team stats and top performers). Watched matches leave the feeds when they end; this
// keeps them readable from the watchlist until the visitor removes them.
import { fetchSummary } from './espn.js';
import { teamStats, leaders } from './detail.js';
import { watch } from './alerts.js';
import { esc } from './esc.js';

const cache = new Map(); // id -> { d } once read, or { pending }

// The summary, boiled down to what a finished match page shows.
export function finalFrom(sm) {
  const comp = sm?.header?.competitions?.[0] || {};
  const side = (h) => comp.competitors?.find((c) => c.homeAway === h) || {};
  const H = side('home'), A = side('away'), st = comp.status?.type || {};
  const key = (sm?.keyEvents || []).filter((k) => /goal|card|penalty/i.test(k.type?.text || '') && !/attempt|saved|missed/i.test(k.type?.text || ''))
    .map((k) => ({ t: k.clock?.displayValue || '', text: k.text || [k.type?.text, ...(k.participants || []).map((p) => p.athlete?.displayName)].filter(Boolean).join(' · '), team: k.team?.displayName || '' }));
  const plays = (sm?.scoringPlays || []).map((s) => ({ t: [s.period?.number ? `P${s.period.number}` : '', s.clock?.displayValue].filter(Boolean).join(' '), text: s.text || '', team: s.team?.displayName || '', score: s.homeScore != null ? `${s.homeScore}–${s.awayScore}` : '' }));
  return {
    done: Boolean(st.completed), status: st.detail || st.shortDetail || st.description || '',
    home: { score: H.score ?? null, lines: (H.linescores || []).map((l) => l.displayValue ?? l.value) },
    away: { score: A.score ?? null, lines: (A.linescores || []).map((l) => l.displayValue ?? l.value) },
    moments: (key.length ? key : plays).slice(0, 24),
    stats: teamStats(sm?.boxscore, sm?.header).slice(0, 2),
    leaders: leaders(sm?.leaders, sm?.header),
  };
}

export const finalTried = (id) => cache.has(id);
// Read once per visit; a finished match also saves its final score on the watchlist.
export function loadFinal(id, m) {
  if (cache.has(id)) return cache.get(id).pending || Promise.resolve(cache.get(id).d);
  // Only ESPN matches have a report to read; for the rest the last score seen is the result.
  if (!m?.compId || !m.leaguePath || m.leaguePath.startsWith('atlas/')) { cache.set(id, { d: null }); return Promise.resolve(null); }
  const pending = fetchSummary({ leaguePath: m.leaguePath, compId: m.compId }).then((sm) => {
    const d = finalFrom(sm);
    cache.set(id, { d });
    if (d.done && d.home.score != null) watch.finish(id, `${m.home} ${d.home.score}–${d.away.score} ${m.away}`);
    return d;
  }).catch(() => { cache.set(id, { d: null }); return null; });
  cache.set(id, { pending });
  return pending;
}

export function finalView(id, m, { sportOf, refresh }) {
  const s = sportOf(m.sport), d = cache.get(id)?.d;
  const score = d?.home.score != null ? `${d.home.score} – ${d.away.score}` : m.result?.replace(m.home, '').replace(m.away, '').trim() || m.score || '';
  const periods = d && d.home.lines.length > 1 ? `<div class="table-wrap"><table class="tbl tight fin-lines"><thead><tr><th></th>${d.home.lines.map((_, i) => `<th class="num">${i + 1}</th>`).join('')}<th class="num">T</th></tr></thead><tbody>
    ${[[m.home, d.home], [m.away, d.away]].map(([n, x]) => `<tr><td>${esc(n)}</td>${x.lines.map((v) => `<td class="num">${esc(v)}</td>`).join('')}<td class="num"><b>${esc(x.score)}</b></td></tr>`).join('')}</tbody></table></div>` : '';
  const moments = d?.moments.length ? `<div class="panel reveal"><h2 class="ph">Key moments</h2><ol class="timeline">${d.moments.map((x) => `<li><time>${esc(x.t)}</time><b>${esc(x.text)}</b><small>${esc(x.team)}${x.score ? ` · ${esc(x.score)}` : ''}</small></li>`).join('')}</ol></div>` : '';
  const stats = d?.stats.length ? `<div class="panel reveal"><h2 class="ph">Team stats</h2><div class="table-wrap"><table class="tbl tight"><thead><tr><th></th><th class="num">${esc(m.home)}</th><th class="num">${esc(m.away)}</th></tr></thead><tbody>
    ${d.stats.flatMap((g) => g.rows.slice(0, 14)).map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${esc(r.home ?? '—')}</td><td class="num">${esc(r.away ?? '—')}</td></tr>`).join('')}</tbody></table></div></div>` : '';
  const lead = d && (d.leaders.home.length || d.leaders.away.length) ? `<div class="grid two">${[[m.home, d.leaders.home], [m.away, d.leaders.away]].map(([n, l]) => `<div class="panel reveal"><h3 class="ph">${esc(n)} <small>top performers</small></h3>${l.map((x) => `<div class="leader"><small>${esc(x.cat)}</small><b>${esc(x.name)}</b><span>${esc(x.pos)}</span><em>${esc(x.value)}</em></div>`).join('') || '<p class="muted">None in the feed.</p>'}</div>`).join('')}</div>` : '';
  const loading = !cache.has(id) || cache.get(id).pending;
  const body = d ? `${periods ? `<div class="panel reveal">${periods}</div>` : ''}${moments}${stats}${lead}`
    : `<p class="muted reveal">${m.compId && loading ? 'Loading what happened…' : 'No match report in the feeds for this one: the final score is all ATLAS kept.'}</p>`;
  return {
    mode: 'other', accent: s.color, title: `${m.home} v ${m.away}`,
    after: () => { if (!cache.has(id)) loadFinal(id, m).then(() => refresh?.()); },
    html: `<section class="hero small match-final"><p class="kicker reveal">${s.icon} ${esc(m.league || '')} · FULL TIME${d?.status && !/^(FT|Final)$/i.test(d.status) ? ` · ${esc(d.status.toUpperCase())}` : ''}</p>
      <h1 class="fin-head"><span>${esc(m.home)}</span><b>${esc(score || 'Final')}</b><span>${esc(m.away)}</span></h1>
      <div class="match-actions reveal"><button class="watch-btn on" data-watch="${esc(id)}" aria-pressed="true">Remove from watchlist</button></div></section>
      ${body}`,
  };
}
