// Match-dossier sections built from js/detail.js output (ESPN) or native NPB/KBO starter data.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const safeHref = (u) => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '#');
const dt = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' }) : esc(v || ''); };
const res = (r) => `<i class="f f-${esc(String(r || '').charAt(0).toUpperCase())}">${esc(String(r || '–').charAt(0))}</i>`;

function table(headers, rows, cls = '') {
  return `<div class="table-wrap"><table class="tbl ${cls}"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

// ---------- starters ----------
function espnStarter(p, team, color) {
  const pr = p.profile;
  const line = (arr) => (arr?.length ? `<div class="statline">${arr.map((x) => `<div><small>${esc(x.label)}</small><b>${esc(x.value)}</b></div>`).join('')}</div>` : '<p class="muted">No line in feed.</p>');
  return `<div class="starter panel reveal" style="--tc:${color}">
    <header><span class="role">${esc(p.role || 'Starter')} · ${esc(team)}</span><h3>${esc(p.name)}</h3>${p.status ? `<em>${esc(p.status)}</em>` : ''}${p.record ? `<em>${esc(p.record)}</em>` : ''}</header>
    ${pr ? `<h4>${esc(pr.title)} · season</h4>${line(pr.season)}${pr.career ? `<h4>Career</h4>${line(pr.career)}` : ''}
      ${pr.log?.length ? `<h4>Last ${pr.log.length} games</h4>${table(['Date', 'Opp', 'Result', ...pr.labels], pr.log.map((g) => `<tr><td>${dt(g.date)}</td><td>${esc(g.opp)}</td><td>${esc(g.result)}</td>${g.cells.map((c) => `<td class="num">${esc(c)}</td>`).join('')}</tr>`), 'tight')}` : ''}
      ${pr.note ? `<p class="note">📰 ${esc(pr.note)}</p>` : ''}` : '<p class="muted">Player profile unavailable right now.</p>'}
  </div>`;
}

// Full starter report (MLB Stats API, NPB, KBO): bio, season, form, recent starts, splits, vs opponent,
// year by year, injuries. Missing pieces are simply left out.
const v = (x) => (x == null || x === '' ? '—' : x);
const chips = (o, keys) => keys.filter(([k]) => o?.[k] != null && o[k] !== '').map(([k, l]) => `<div><small>${l}</small><b>${esc(o[k])}</b></div>`).join('');
const KEYS = [['w', 'W'], ['l', 'L'], ['era', 'ERA'], ['whip', 'WHIP'], ['g', 'G'], ['gs', 'GS'], ['ip', 'IP'], ['so', 'SO'], ['bb', 'BB'], ['k9', 'K/9'], ['bb9', 'BB/9'], ['hr9', 'HR/9'], ['kbb', 'K/BB'], ['avg', 'Opp AVG'], ['ops', 'Opp OPS'], ['qs', 'QS'], ['ppStart', 'P/start']];
function formBadge(f, seasonEra, label) {
  if (!f) return '';
  const d = Number(f.era) - Number(seasonEra);
  const trend = !Number.isFinite(d) ? '' : d <= -0.5 ? '<i class="up">▲ hot</i>' : d >= 0.75 ? '<i class="down">▼ cold</i>' : '<i>● steady</i>';
  return `<div class="form-chip"><small>${esc(label)} (${f.games})</small><b>${esc(f.era)} ERA</b><span>${esc(f.whip)} WHIP · ${esc(f.k9)} K/9 · ${esc(f.ip)} IP</span>${trend}</div>`;
}
function reportCard(p, team, color) {
  const r = p.report || {};
  if (!r.name && !r.season) return `<div class="starter panel reveal" style="--tc:${color}"><header><span class="role">Probable starter · ${esc(team)}</span><h3>${esc(p.name || 'TBA')}</h3></header><p class="muted">Profile unavailable from ${esc(r.league || 'the league')} right now.</p></div>`;
  const bio = [r.throws ? `${r.throws === 'L' ? 'Left' : 'Right'}-handed` : '', r.age ? `age ${r.age}` : '', [r.height, r.weight].filter(Boolean).join(' / ')].filter(Boolean).join(' · ');
  const rest = r.rest != null ? `<em class="${r.rest <= 3 ? 'warn' : ''}">${r.rest} day${r.rest === 1 ? '' : 's'} since last outing${r.rest <= 3 ? ' (short rest)' : ''}</em>` : '';
  const showHr = r.recent?.some((g) => g.hr != null), showP = r.recent?.some((g) => g.pitches != null);
  return `<div class="starter panel reveal" style="--tc:${color}">
    <header><span class="role">${esc(p.role || 'SP')} · ${esc(team)} · ${esc(r.league || '')}</span><h3>${esc(r.name || p.name)}${r.nameLocal ? ` <small class="local">${esc(r.nameLocal)}</small>` : ''}</h3>${bio ? `<em>${esc(bio)}</em>` : ''}${rest}</header>
    ${r.season ? `<h4>${esc(r.season.label)}</h4><div class="statline">${chips(r.season, KEYS)}</div>` : '<p class="muted">No season line yet (debut or no innings).</p>'}
    ${r.form3 || r.form5 ? `<h4>Recent form</h4><div class="form-row">${formBadge(r.form3, r.season?.era, 'Last 3 starts')}${formBadge(r.form5, r.season?.era, 'Last 5 starts')}</div>` : ''}
    ${r.post ? `<h4>${esc(r.post.label)}</h4><div class="statline">${chips(r.post, KEYS)}</div>` : ''}
    ${r.recent?.length ? `<h4>Last ${r.recent.length} outings</h4>${table(['Date', 'Opp', 'Res', 'IP', 'H', 'ER', 'BB', 'SO', ...(showHr ? ['HR'] : []), ...(showP ? ['P'] : [])], r.recent.map((g) => `<tr${g.start ? '' : ' class="relief"'}><td>${dt(g.date)}${g.post ? ' <small>PS</small>' : ''}</td><td title="${esc(g.opp)}">${esc(g.ha || '')} ${esc(String(g.opp).split(' ').pop())}</td><td>${esc(g.result || (g.start ? 'ND' : '—'))}</td>${[g.ip, g.h, g.er, g.bb, g.so, ...(showHr ? [g.hr] : []), ...(showP ? [g.pitches] : [])].map((c) => `<td class="num">${esc(v(c))}</td>`).join('')}</tr>`), 'tight')}${r.recentNote ? `<p class="cap">${esc(r.recentNote)}</p>` : ''}` : ''}
    ${r.vsOpp ? `<h4>vs ${esc(r.vsOpp.opp)}${r.vsOpp.label ? ` · ${esc(r.vsOpp.label)}` : ' · career'}</h4><div class="statline">${chips(r.vsOpp, [['g', 'G'], ['pa', 'PA'], ['ip', 'IP'], ['era', 'ERA'], ['avg', 'AVG'], ['ops', 'OPS'], ['hr', 'HR'], ['so', 'SO'], ['bb', 'BB']])}</div>` : ''}
    ${r.splits?.length ? `<h4>Splits</h4>${table(['Split', 'IP', 'ERA', 'WHIP', 'AVG', 'OPS', 'SO', 'BB'], r.splits.map((x) => `<tr><td>${esc(x.label)}</td>${[x.ip, x.era, x.whip, x.avg, x.ops, x.so, x.bb].map((c) => `<td class="num">${esc(v(c))}</td>`).join('')}</tr>`), 'tight')}` : ''}
    ${r.years?.length ? `<h4>Year by year</h4>${table(['Year', 'Team', 'G', 'W-L', 'IP', 'ERA', 'WHIP', 'K/9', 'BB/9'], r.years.map((y) => `<tr><td>${esc(y.year)}</td><td>${esc(y.team || '')}</td><td class="num">${esc(v(y.g))}</td><td class="num">${esc(v(y.w))}-${esc(v(y.l))}</td><td class="num">${esc(v(y.ip))}</td><td class="num">${esc(v(y.era))}</td><td class="num">${esc(v(y.whip))}</td><td class="num">${esc(v(y.k9))}</td><td class="num">${esc(v(y.bb9))}</td></tr>`), 'tight')}` : ''}
    ${r.career ? `<h4>${esc(r.career.label || 'Career')}</h4><div class="statline">${chips(r.career, KEYS.filter(([k]) => !['ppStart', 'qs'].includes(k)))}</div>` : ''}
    ${r.injuries?.length ? `<h4>Injury history</h4><ul class="inj-list">${r.injuries.map((i) => `<li><b>${esc(i.date)}</b> ${esc(i.text)}</li>`).join('')}</ul>` : `<p class="cap">No injured-list stints on record${r.league === 'NPB' ? ' (NPB does not publish them)' : ' in the last two seasons'}.</p>`}
    ${r.source ? `<p class="note"><a href="${safeHref(r.source)}" target="_blank" rel="noopener noreferrer">${esc(r.sourceLabel || 'Official profile')} ↗</a></p>` : ''}
  </div>`;
}

// Side-by-side: who has the better arm today. Lower is better except K/9 and K/BB.
function matchupTable(home, away, H, A, hc, ac) {
  const a = home.report, b = away.report;
  const rows = [
    ['Season ERA', a.season?.era, b.season?.era, -1], ['WHIP', a.season?.whip, b.season?.whip, -1], ['K/9', a.season?.k9, b.season?.k9, 1],
    ['BB/9', a.season?.bb9, b.season?.bb9, -1], ['HR/9', a.season?.hr9, b.season?.hr9, -1], ['K/BB', a.season?.kbb, b.season?.kbb, 1],
    ['Opp AVG', a.season?.avg, b.season?.avg, -1], ['Last 3 starts ERA', a.form3?.era, b.form3?.era, -1], ['Last 5 starts ERA', a.form5?.era, b.form5?.era, -1],
    ['vs today\'s opponent (AVG)', a.vsOpp?.avg, b.vsOpp?.avg, -1], ['Days of rest', a.rest, b.rest, 0], ['Career ERA', a.career?.era, b.career?.era, -1],
  ].filter(([, x, y]) => x != null || y != null);
  let ha = 0, aa = 0;
  const body = rows.map(([label, x, y, dir]) => {
    const nx = parseFloat(x), ny = parseFloat(y);
    const win = dir && Number.isFinite(nx) && Number.isFinite(ny) && nx !== ny ? ((nx - ny) * dir > 0 ? 'h' : 'a') : '';
    if (win === 'h') ha++; if (win === 'a') aa++;
    return `<tr><td class="num ${win === 'h' ? 'better' : ''}">${esc(v(x))}</td><td class="mid">${esc(label)}</td><td class="num ${win === 'a' ? 'better' : ''}">${esc(v(y))}</td></tr>`;
  });
  const verdict = ha === aa ? 'Even matchup on paper.' : `${ha > aa ? esc(a.name || H) : esc(b.name || A)} has the edge in ${Math.max(ha, aa)} of ${ha + aa} compared categories.`;
  return `<div class="panel reveal matchup"><div class="cmp-head"><b style="color:${hc}">${esc(a.name || H)}</b><span>vs</span><b style="color:${ac}">${esc(b.name || A)}</b></div>
    <div class="table-wrap"><table class="tbl tight mtable"><tbody>${body.join('')}</tbody></table></div><p class="note">${verdict} Pitching is one input; the win model also prices the line and records.</p></div>`;
}

// ---------- sections ----------
export function dossierSections(e, d, hc, ac) {
  const S = [];
  const H = e.home, A = e.away;
  const side = (s) => (s === 'home' ? [H, hc] : [A, ac]);

  // Starters (pitchers / goalies)
  const reports = (e.probables || []).filter((p) => p.report).sort((a, b) => (a.side === 'home' ? 0 : 1) - (b.side === 'home' ? 0 : 1));
  const native = reports.length > 0;
  const starters = native ? reports : d?.probables || [];
  const goalies = d?.goalies && (d.goalies.home?.length || d.goalies.away?.length);
  if (starters.length || goalies) {
    const cards = starters.sort((a, b) => (a.side === 'home' ? 0 : 1) - (b.side === 'home' ? 0 : 1)).map((p) => (p.report ? reportCard(p, side(p.side)[0], side(p.side)[1]) : espnStarter(p, side(p.side)[0], side(p.side)[1]))).join('');
    const g = goalies ? ['home', 'away'].map((s) => (d.goalies[s] || []).map((x) => `<div class="starter panel reveal" style="--tc:${side(s)[1]}"><header><span class="role">Goalie · ${esc(side(s)[0])}</span><h3>${esc(x.name)}</h3></header><div class="statline">${Object.entries(x.stats).map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div></div>`).join('')).join('') : '';
    const hp = reports.find((p) => p.side === 'home'), ap = reports.find((p) => p.side === 'away');
    const mu = hp?.report?.season && ap?.report?.season ? matchupTable(hp, ap, H, A, hc, ac) : '';
    S.push({ id: 'starters', label: e.sport === 'baseball' ? 'Starting pitchers' : e.sport === 'hockey' ? 'Goalies' : 'Starters', html: `${mu}<div class="grid two starters">${cards}${g}</div>` });
  } else if (e.sport === 'baseball') {
    S.push({ id: 'starters', label: 'Starting pitchers', html: '<p class="muted">Starters not announced yet. Leagues usually confirm them the day before.</p>' });
  }

  if (!d && !native) {
    S.push({ id: 'intel', label: 'Match intel', html: '<div class="panel"><p class="muted loading-dots">Loading injuries, team stats, form, head-to-head and standings</p></div>' });
    return S;
  }
  if (d?.error) { S.push({ id: 'intel', label: 'Match intel', html: `<div class="panel"><p class="muted">Detail feed unavailable right now (${esc(d.error)}).</p></div>` }); return S; }
  if (!d || d.native) return S;

  // Injuries / absences: ESPN's injury report where it has one, FotMob's unavailable list for soccer.
  const ab = d.absences;
  const injN = (d.injuries.home?.length || 0) + (d.injuries.away?.length || 0) + (ab ? ab.home.length + ab.away.length : 0);
  const covered = Boolean(d.injuryFeed || ab);
  const sources = [d.injuryFeed, ab?.source].filter(Boolean).join(' + ');
  const espnRows = (list) => list.map((i) => `<tr><td><b>${esc(i.name)}</b></td><td>${esc(i.pos)}</td><td><span class="inj inj-${esc(String(i.status).toLowerCase().replace(/[^a-z]/g, ''))}">${esc(i.status)}</span></td><td>${esc([i.type, i.detail, i.side].filter(Boolean).join(' · '))}</td><td>${i.returnDate ? dt(i.returnDate) : '—'}</td></tr>`);
  const abRows = (list) => list.map((i) => { const doubt = /doubtful/i.test(i.expectedReturn); return `<tr><td><b>${esc(i.name)}</b></td><td></td><td><span class="inj inj-${doubt ? 'doubtful' : i.type === 'Suspended' ? 'suspension' : 'out'}">${esc(doubt ? `${i.type} · doubtful` : i.type)}</span></td><td>${i.updated ? `updated ${dt(i.updated)}` : ''}</td><td>${esc(doubt ? 'Doubtful to play' : i.expectedReturn || '—')}</td></tr>`; });
  const empty = covered
    ? `<p class="muted">${esc(sources)} lists nobody out for this side.</p>`
    : `<p class="muted">No injury source covers this competition, so absences are <b>unknown</b> here (not "none"). Check team news before betting.</p>`;
  S.push({ id: 'injuries', label: covered ? `Injuries (${injN})` : 'Injuries (no feed)', html: `${covered ? `<p class="note">Source: ${esc(sources)}${ab?.lineupType === 'predicted' ? ' · lineups predicted' : ''}. Late changes can still happen; confirmed XIs appear about an hour before kick-off.</p>` : ''}<div class="grid two">${['home', 'away'].map((s) => {
    const rows = [...espnRows(d.injuries[s] || []), ...(ab ? abRows(ab[s] || []) : [])];
    return `<div class="panel reveal" style="border-top:3px solid ${side(s)[1]}"><h3 class="ph">${esc(side(s)[0])}</h3>${rows.length ? table(['Player', 'Pos', 'Status', 'Detail', 'Expected back'], rows, 'tight') : empty}</div>`;
  }).join('')}</div>` });

  // Team stats comparison
  if (d.teamStats.length) {
    S.push({ id: 'teamstats', label: 'Team stats', html: `<div class="panel reveal"><div class="cmp-head"><b style="color:${hc}">${esc(H)}</b><span></span><b style="color:${ac}">${esc(A)}</b></div>${d.teamStats.map((g) => `<h4 class="cmp-group">${esc(g.group)}</h4>${g.rows.slice(0, 18).map((r) => {
      const hv = parseFloat(r.home), av = parseFloat(r.away), tot = Math.abs(hv) + Math.abs(av);
      const hw = Number.isFinite(hv) && Number.isFinite(av) && tot ? (Math.abs(hv) / tot) * 100 : 50;
      return `<div class="cmp"><span class="cv">${esc(r.home ?? '—')}${r.homeRank ? `<small>${esc(r.homeRank)}</small>` : ''}</span><div class="cbar"><i style="width:${hw.toFixed(1)}%;background:${hc}"></i><i style="width:${(100 - hw).toFixed(1)}%;background:${ac}"></i><em>${esc(r.label)}</em></div><span class="cv r">${esc(r.away ?? '—')}${r.awayRank ? `<small>${esc(r.awayRank)}</small>` : ''}</span></div>`;
    }).join('')}`).join('')}</div>` });
  }

  // Recent form
  if (d.last5.home?.length || d.last5.away?.length) {
    S.push({ id: 'recent', label: 'Recent form', html: `<div class="grid two">${['home', 'away'].map((s) => `<div class="panel reveal" style="border-top:3px solid ${side(s)[1]}"><h3 class="ph">${esc(side(s)[0])} <small>${(d.last5[s] || []).map((g) => res(g.result)).join('')}</small></h3>${table(['Date', '', 'Opponent', 'Score', 'Res', 'Comp'], (d.last5[s] || []).map((g) => `<tr><td>${dt(g.date)}</td><td>${esc(g.atVs)}</td><td>${esc(g.opp)}</td><td class="num">${esc(g.score)}</td><td>${res(g.result)}</td><td><small>${esc(g.comp)}</small></td></tr>`), 'tight')}</div>`).join('')}</div>` });
  }

  // Head to head
  if (d.series.length) {
    S.push({ id: 'h2h', label: 'Head to head', html: `<div class="panel reveal">${d.series.map((s) => `<h3 class="ph">${esc(s.title)} <small>${esc(s.summary)}</small></h3>${s.games.length ? table(['Date', 'Home', 'Score', 'Away'], s.games.map((g) => `<tr><td>${dt(g.date)}</td><td class="${g.winner === 'home' ? 'win' : ''}">${esc(g.home)}</td><td class="num">${g.hs != null ? `${esc(g.hs)} – ${esc(g.as)}` : esc(g.state || '')}</td><td class="${g.winner === 'away' ? 'win' : ''}">${esc(g.away)}</td></tr>`), 'tight') : ''}`).join('')}</div>` });
  }

  // Standings
  if (d.standings.length) {
    const cols = (en) => Object.keys(en.stats).filter((k) => !/^(OTL?|PPG|OPP PPG|DIFF|L10|HOME|AWAY|CONF|DIV|VS.*|RS|RA|PCT)$/i.test(k) || ['PCT', 'L10'].includes(k)).slice(0, 9);
    S.push({ id: 'standings', label: 'Standings', html: d.standings.map((g) => {
      const c = cols(g.entries[0] || { stats: {} });
      return `<div class="panel reveal"><h3 class="ph">${esc(g.name || 'Standings')}</h3>${table(['#', 'Team', ...c], g.entries.map((en, i) => `<tr class="${en.ours ? 'ours' : ''}"><td class="num">${i + 1}</td><td><b>${esc(en.team)}</b></td>${c.map((k) => `<td class="num">${esc(en.stats[k] ?? '')}</td>`).join('')}</tr>`), 'tight')}</div>`;
    }).join('') });
  }

  // Leaders
  if (d.leaders.home?.length || d.leaders.away?.length) {
    S.push({ id: 'leaders', label: 'Key players', html: `<div class="grid two">${['home', 'away'].map((s) => `<div class="panel reveal" style="border-top:3px solid ${side(s)[1]}"><h3 class="ph">${esc(side(s)[0])}</h3>${(d.leaders[s] || []).map((l) => `<div class="leader"><small>${esc(l.cat)}</small><b>${esc(l.name)}</b><span>${esc(l.pos)}</span><em>${esc(l.value)}</em></div>`).join('') || '<p class="muted">No leaders in feed yet.</p>'}</div>`).join('')}</div>` });
  }

  // Lineups
  if (d.lineups) {
    S.push({ id: 'lineups', label: 'Lineups', html: `<div class="grid two">${['home', 'away'].map((s) => { const l = d.lineups[s]; return `<div class="panel reveal" style="border-top:3px solid ${side(s)[1]}"><h3 class="ph">${esc(side(s)[0])}${l?.formation ? ` <small>${esc(l.formation)}</small>` : ''}</h3>${l ? `<ol class="lineup">${l.players.map((p) => `<li><span>${esc(p.pos)}</span>${esc(p.name)}<em>${p.jersey ? '#' + esc(p.jersey) : ''}</em></li>`).join('')}</ol>` : '<p class="muted">Not published yet.</p>'}</div>`; }).join('')}</div>` });
  }

  // Conditions, predictor, betting trends, news
  const facts = [];
  if (d.predictor) facts.push(`<div><small>ESPN matchup predictor</small><b>${esc(H)} ${(d.predictor.home * 100).toFixed(1)}% · ${esc(A)} ${(d.predictor.away * 100).toFixed(1)}%</b></div>`);
  if (d.venue) facts.push(`<div><small>Venue</small><b>${esc(d.venue.name)}</b><span>${esc(d.venue.city)}${d.venue.grass != null ? ` · ${d.venue.grass ? 'grass' : 'turf/indoor'}` : ''}</span></div>`);
  if (d.weather) facts.push(`<div><small>Weather</small><b>${d.weather.temp != null ? `${esc(d.weather.temp)}°F` : ''}${d.weather.cond ? ` · ${esc(d.weather.cond)}` : ''}</b><span>${d.weather.gust != null ? `gusts ${esc(d.weather.gust)} mph` : ''}${d.weather.precip != null ? ` · precip ${esc(d.weather.precip)}%` : ''}</span></div>`);
  if (d.line) facts.push(`<div><small>Line (${esc(d.line.provider || 'book')})</small><b>${esc(d.line.details || '')}</b><span>${d.line.total != null ? `O/U ${esc(d.line.total)}` : ''}${d.line.spread != null ? ` · spread ${esc(d.line.spread)}` : ''}</span></div>`);
  if (d.officials.length) facts.push(`<div><small>Officials</small><b>${d.officials.map(esc).join(', ')}</b></div>`);
  d.ats.forEach((t) => facts.push(`<div><small>Against the spread · ${esc(side(t.side)[0])}</small><b>${t.records.map(esc).join(' · ')}</b></div>`));
  if (facts.length) S.push({ id: 'conditions', label: 'Conditions & trends', html: `<div class="panel reveal facts">${facts.join('')}</div>` });
  if (d.news.length) S.push({ id: 'news', label: 'News', html: `<div class="grid news">${d.news.map((n) => `<a class="newsc tilt reveal" href="${safeHref(n.url)}" target="_blank" rel="noopener noreferrer"><small>ESPN</small><b>${esc(n.headline)}</b><span class="muted">${esc(n.desc || '')}</span></a>`).join('')}</div>` });
  return S;
}
