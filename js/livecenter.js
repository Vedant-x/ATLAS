// Live scoreboard for a match in play, every sport: period-by-period score, the game situation
// (count and bases, down and distance, who's batting), goals/cards/scoring plays, the latest plays,
// live team stats and the scorecard for cricket. ESPN matches are read from ESPN's match summary
// (browser-friendly) every few seconds while the page is open; NPB/KBO/esports/eSoccer use what the
// live lane publishes. `parseLive` is pure so it can be tested.

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const CRICKET = 'https://site.web.api.espn.com/apis/site/v2/sports/cricket';
const cache = new Map(); // event id → { at, data }
export const liveFor = (id) => cache.get(id)?.data || null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const txt = (v) => (v == null ? '' : String(v));
const athlete = (x) => x?.athlete?.displayName || x?.athlete?.shortName || x?.displayName || '';

export function parseLive(sm, e) {
  const comp = sm?.header?.competitions?.[0] || {};
  const side = (teamId) => comp.competitors?.find((c) => String(c.team?.id ?? c.id) === String(teamId))?.homeAway || null;
  const C = (k) => comp.competitors?.find((c) => c.homeAway === k) || {};
  const h = C('home'), a = C('away');
  const out = { status: comp.status?.type?.detail || comp.status?.type?.shortDetail || '', lines: null, situation: null, events: [], plays: [], stats: [], winProb: null, card: null };

  // Period-by-period (innings, quarters, halves, periods, sets).
  const hl = (h.linescores || []).map((l) => txt(l.displayValue ?? l.value)), al = (a.linescores || []).map((l) => txt(l.displayValue ?? l.value));
  if (e.sport !== 'cricket' && (hl.length || al.length)) {
    const n = Math.max(hl.length, al.length, e.sport === 'baseball' ? 9 : 0);
    out.lines = {
      heads: Array.from({ length: n }, (_, i) => (e.sport === 'baseball' ? String(i + 1) : e.sport === 'football' ? (i < 2 ? `${i + 1}H` : i < 4 ? `ET${i - 1}` : 'Pens') : e.sport === 'tennis' ? `S${i + 1}` : e.sport === 'hockey' && i >= 3 ? (i === 3 ? 'OT' : 'SO') : (e.sport === 'basketball' || e.sport === 'americanfootball') && i >= 4 ? `OT${i > 4 ? i - 3 : ''}` : String(i + 1))),
      home: hl, away: al,
      totals: { home: txt(h.score), away: txt(a.score) },
      extra: e.sport === 'baseball' && (h.hits != null || a.hits != null) ? [['H', txt(h.hits), txt(a.hits)], ['E', txt(h.errors), txt(a.errors)]] : [],
    };
  }

  // Situation: baseball count/bases, gridiron down and distance.
  const s = sm?.situation;
  if (s && e.sport === 'baseball' && (s.balls != null || s.outs != null)) {
    out.situation = { kind: 'baseball', balls: s.balls ?? 0, strikes: s.strikes ?? 0, outs: s.outs ?? 0, bases: [Boolean(s.onFirst), Boolean(s.onSecond), Boolean(s.onThird)], batter: athlete(s.batter), pitcher: athlete(s.pitcher), last: s.lastPlay?.text || '' };
  } else if (s && e.sport === 'americanfootball' && (s.downDistanceText || s.shortDownDistanceText)) {
    out.situation = { kind: 'gridiron', text: s.downDistanceText || s.shortDownDistanceText, possession: s.possessionText || '', redZone: Boolean(s.isRedZone), last: s.lastPlay?.text || '' };
  }

  // Key moments: goals, cards and subs (soccer), scoring plays elsewhere.
  if (sm?.keyEvents?.length) {
    out.events = sm.keyEvents.filter((k) => /goal|card|penalty|own goal|substitution|var/i.test(k.type?.text || '') && !/kickoff|start|end/i.test(k.type?.text || ''))
      .map((k) => ({ clock: k.clock?.displayValue || '', type: k.type?.text || '', text: k.text || k.shortText || k.type?.text || '', side: side(k.team?.id), goal: Boolean(k.scoringPlay) || /goal/i.test(k.type?.text || '') }));
  } else if (sm?.scoringPlays?.length) {
    out.events = sm.scoringPlays.map((p) => ({ clock: [p.period?.displayValue || (p.period?.number ? `P${p.period.number}` : ''), p.clock?.displayValue].filter(Boolean).join(' '), type: p.type?.text || 'Score', text: p.text || '', side: side(p.team?.id), goal: true, score: p.homeScore != null ? `${p.homeScore} – ${p.awayScore}` : '' }));
  }
  out.events = out.events.slice(-12).reverse();

  // Latest plays.
  const plays = sm?.plays || [];
  out.plays = plays.slice(-6).reverse().map((p) => ({ clock: [p.period?.displayValue, p.clock?.displayValue].filter(Boolean).join(' · '), text: p.text || p.type?.text || '', scoring: Boolean(p.scoringPlay), side: side(p.team?.id) })).filter((p) => p.text);
  if (!out.plays.length && sm?.commentary?.length) out.plays = sm.commentary.slice(-6).reverse().map((c) => ({ clock: c.time?.displayValue || '', text: c.text || '' })).filter((p) => p.text);

  // Live team stats (first 8 that both sides report).
  const teams = sm?.boxscore?.teams || [];
  const th = teams.find((t) => (t.homeAway || side(t.team?.id)) === 'home'), ta = teams.find((t) => (t.homeAway || side(t.team?.id)) === 'away');
  if (th && ta) {
    const flat = (t) => (t.statistics || []).flatMap((x) => (Array.isArray(x.stats) ? x.stats : [x]));
    const fa = flat(ta);
    out.stats = flat(th).map((x) => { const y = fa.find((z) => (z.name || z.label) === (x.name || x.label)); return y ? { label: x.label || x.displayName || x.name, home: txt(x.displayValue ?? x.value), away: txt(y.displayValue ?? y.value) } : null; })
      .filter((r) => r && r.label && (r.home !== '' || r.away !== '')).slice(0, 8);
  }

  const wp = sm?.winprobability;
  if (wp?.length) { const last = wp[wp.length - 1]; if (Number.isFinite(last.homeWinPercentage)) out.winProb = last.homeWinPercentage; }

  // Cricket: current innings scorecard (batting and bowling).
  if (e.sport === 'cricket' && sm?.matchcards?.length) {
    const cards = sm.matchcards;
    const bat = [...cards].reverse().find((c) => /bat/i.test(c.headline || '') && c.playerDetails?.length);
    const bowl = bat ? cards.find((c) => /bowl/i.test(c.headline || '') && c.inningsNumber === bat.inningsNumber) : null;
    out.card = {
      innings: bat ? `${bat.teamName || ''} · ${bat.runs || ''} ${bat.total || ''}`.trim() : '',
      batting: (bat?.playerDetails || []).map((p) => ({ name: p.playerName, how: p.dismissal || '', r: p.runs, b: p.ballsFaced, f: p.fours, s: p.sixes })),
      bowling: (bowl?.playerDetails || []).map((p) => ({ name: p.playerName, o: p.overs, m: p.maidens, r: p.conceded ?? p.runs, w: p.wickets })),
    };
    out.innings = (h.linescores || []).concat(a.linescores || []).filter((l) => l.runs != null || l.score).map((l) => ({ side: (h.linescores || []).includes(l) ? 'home' : 'away', period: l.period, score: l.score || `${l.runs}/${l.wickets}`, current: Boolean(l.isCurrent) }));
  }
  return out;
}

// Scoreboard from the event alone (tennis sets from the scoreboard, esports maps, NPB/KBO inning).
function fromEvent(e) {
  const out = { status: e.clock || '', lines: null, situation: null, events: [], plays: [], stats: [], winProb: null, card: null };
  if (e.lines && (e.lines.home.length || e.lines.away.length)) {
    const n = Math.max(e.lines.home.length, e.lines.away.length);
    out.lines = { heads: Array.from({ length: n }, (_, i) => (e.sport === 'tennis' ? `S${i + 1}` : String(i + 1))), home: e.lines.home, away: e.lines.away, totals: (() => { const [x, y] = String(e.score || '').split(' – '); return { home: x || '', away: y || '' }; })(), extra: [] };
  }
  if (e.esports?.maps?.length) out.maps = e.esports.maps;
  return out;
}

// Fetch (at most every 8 s per match) and cache the live scoreboard for an ESPN or cricket match.
export async function refreshLiveCenter(e) {
  if (!e?.live || !e.compId) return null;
  const c = cache.get(e.id);
  if (c && Date.now() - c.at < 8000) return c.data;
  let url = null;
  if (e.sport === 'cricket' && e.seriesId) url = `${CRICKET}/${e.seriesId}/summary?event=${e.compId}`;
  else if (e.leaguePath && !e.leaguePath.startsWith('atlas/')) url = `${BASE}/${e.leaguePath}/summary?event=${e.compId}`;
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!res.ok) return c?.data || null;
    const data = parseLive(await res.json(), e);
    cache.set(e.id, { at: Date.now(), data });
    return data;
  } catch { return c?.data || null; }
}

// ---------- rendering ----------
const dot = (on, cls = '') => `<i class="lc-dot ${on ? 'on' : ''} ${cls}"></i>`;

export function liveCenterHtml(e) {
  if (!e.live) return '';
  const d = { ...fromEvent(e), ...Object.fromEntries(Object.entries(liveFor(e.id) || {}).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))) };
  if (!d.lines && fromEvent(e).lines) d.lines = fromEvent(e).lines;
  const H = esc(e.home), A = esc(e.away);
  const parts = [];
  if (d.lines) {
    const L = d.lines;
    parts.push(`<div class="lc-box table-wrap"><table class="lc-lines"><thead><tr><th></th>${L.heads.map((x) => `<th>${esc(x)}</th>`).join('')}<th class="t">${e.sport === 'tennis' ? 'Sets' : 'T'}</th>${L.extra.map((x) => `<th>${x[0]}</th>`).join('')}</tr></thead>
      <tbody>${[['home', H], ['away', A]].map(([k, n], r) => `<tr><td class="n">${n}</td>${L.heads.map((_, i) => `<td>${esc(L[k][i] ?? '')}</td>`).join('')}<td class="t">${esc(L.totals[k])}</td>${L.extra.map((x) => `<td>${esc(x[r + 1])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
  }
  if (d.innings?.length) parts.push(`<div class="lc-innings">${d.innings.map((i) => `<span class="${i.current ? 'cur' : ''}"><small>${i.side === 'home' ? H : A} · inns ${i.period}</small><b>${esc(i.score)}</b></span>`).join('')}</div>`);
  if (d.maps?.length) {
    parts.push(`<div class="lc-maps">${d.maps.map((m) => `<div class="lc-map ${m.status}"><small>Map ${m.n}${m.map ? ` · ${esc(m.map)}` : ''}</small><b>${m.score ? esc(m.score) : m.status === 'live' ? 'LIVE' : '—'}</b>${m.winner ? `<em>${m.winner === 'home' ? H : A}</em>` : ''}</div>`).join('')}</div>`);
  }
  const s = d.situation;
  if (s?.kind === 'baseball') {
    parts.push(`<div class="lc-sit"><div class="lc-diamond" aria-label="Bases">${['third', 'second', 'first'].map((b, i) => `<i class="b ${b} ${s.bases[2 - i] ? 'on' : ''}"></i>`).join('')}</div>
      <div class="lc-count"><span>B ${dot(s.balls > 0)}${dot(s.balls > 1)}${dot(s.balls > 2)}</span><span>S ${dot(s.strikes > 0, 'k')}${dot(s.strikes > 1, 'k')}</span><span>O ${dot(s.outs > 0, 'o')}${dot(s.outs > 1, 'o')}</span></div>
      <div class="lc-who">${s.batter ? `<small>At bat</small><b>${esc(s.batter)}</b>` : ''}${s.pitcher ? `<small>Pitching</small><b>${esc(s.pitcher)}</b>` : ''}</div>
      ${s.last ? `<p class="lc-last">${esc(s.last)}</p>` : ''}</div>`);
  } else if (s?.kind === 'gridiron') {
    parts.push(`<div class="lc-sit grid"><b class="${s.redZone ? 'rz' : ''}">${esc(s.text)}</b>${s.possession ? `<small>${esc(s.possession)}</small>` : ''}${s.last ? `<p class="lc-last">${esc(s.last)}</p>` : ''}</div>`);
  }
  if (d.winProb != null) parts.push(`<div class="lc-wp"><small>ESPN live win probability</small><div class="lc-wpbar"><i style="--w:${(d.winProb * 100).toFixed(1)}%"></i></div><span>${H} ${(d.winProb * 100).toFixed(0)}% · ${A} ${(100 - d.winProb * 100).toFixed(0)}%</span></div>`);
  if (d.events.length) parts.push(`<div class="lc-col"><h4>Key moments</h4><ul class="lc-events">${d.events.map((x) => `<li class="${x.side || ''} ${x.goal ? 'goal' : ''} ${/red/i.test(x.type) ? 'red' : /yellow/i.test(x.type) ? 'yellow' : ''}"><time>${esc(x.clock)}</time><span>${esc(x.text)}</span>${x.score ? `<b>${esc(x.score)}</b>` : ''}</li>`).join('')}</ul></div>`);
  if (d.plays.length) parts.push(`<div class="lc-col"><h4>Latest</h4><ul class="lc-plays">${d.plays.map((p) => `<li class="${p.scoring ? 'goal' : ''}"><time>${esc(p.clock)}</time><span>${esc(p.text)}</span></li>`).join('')}</ul></div>`);
  if (d.card?.batting?.length) {
    parts.push(`<div class="lc-col wide"><h4>Scorecard <small>${esc(d.card.innings)}</small></h4><div class="table-wrap"><table class="lc-card"><thead><tr><th>Batter</th><th></th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr></thead><tbody>${d.card.batting.map((b) => `<tr><td>${esc(b.name)}</td><td class="muted">${esc(b.how)}</td><td>${esc(b.r)}</td><td>${esc(b.b)}</td><td>${esc(b.f)}</td><td>${esc(b.s)}</td></tr>`).join('')}</tbody></table></div>
      ${d.card.bowling.length ? `<div class="table-wrap"><table class="lc-card"><thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th></tr></thead><tbody>${d.card.bowling.map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(b.o)}</td><td>${esc(b.m)}</td><td>${esc(b.r)}</td><td>${esc(b.w)}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`);
  }
  if (d.stats.length) parts.push(`<div class="lc-col"><h4>Live stats</h4><table class="lc-stats">${d.stats.map((r) => `<tr><td>${esc(r.home)}</td><th>${esc(r.label)}</th><td>${esc(r.away)}</td></tr>`).join('')}</table></div>`);
  return `<div class="live-center" id="live-center" data-live-center="${esc(e.id)}"><h3><span class="live">LIVE</span> Scoreboard <small data-clock="${esc(e.id)}">${esc(e.clock || d.status || '')}</small></h3>
    ${parts.length ? `<div class="lc-grid">${parts.join('')}</div>` : '<p class="muted">Live details load in a moment…</p>'}</div>`;
}
