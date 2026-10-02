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

function nativeStarter(p, team, color, league) {
  const s = p.pitching || {};
  const cells = (o, keys) => keys.filter(([k]) => o?.[k] != null && o[k] !== '').map(([k, l]) => `<div><small>${l}</small><b>${esc(o[k])}</b></div>`).join('');
  const keys = [['era', 'ERA'], ['whip', 'WHIP'], ['w', 'W'], ['l', 'L'], ['g', 'G'], ['ip', 'IP'], ['so', 'SO'], ['bb', 'BB'], ['h', 'H'], ['hr', 'HR'], ['k9', 'K/9'], ['avg', 'AVG'], ['qs', 'QS']];
  return `<div class="starter panel reveal" style="--tc:${color}">
    <header><span class="role">Probable starter · ${esc(team)}</span><h3>${esc(p.name || s.name || 'TBA')}</h3><em>${esc(league)} official</em></header>
    ${s.season ? `<h4>${new Date().getFullYear()} season</h4><div class="statline">${cells(s.season, keys)}</div>` : '<p class="muted">No season line yet (debut or no innings).</p>'}
    ${s.career ? `<h4>Career</h4><div class="statline">${cells(s.career, keys)}</div>` : ''}
    ${s.seasons?.length > 1 ? `<h4>Recent seasons</h4>${table(['Year', 'G', 'W-L', 'IP', 'ERA', 'WHIP', 'SO'], s.seasons.map((y) => `<tr><td>${esc(y.year)}</td><td class="num">${esc(y.g)}</td><td class="num">${esc(y.w)}-${esc(y.l)}</td><td class="num">${esc(y.ip)}</td><td class="num">${esc(y.era)}</td><td class="num">${esc(y.whip)}</td><td class="num">${esc(y.so)}</td></tr>`), 'tight')}` : ''}
    ${s.recent?.length ? `<h4>Last ${s.recent.length} appearances</h4>${table(['Date', 'Opp', 'Res', 'IP', 'H', 'ER', 'BB', 'SO', 'ERA'], s.recent.map((g) => `<tr><td>${esc(g.date)}</td><td>${esc(g.opp)}</td><td>${esc(g.result)}</td><td class="num">${esc(g.ip)}</td><td class="num">${esc(g.h)}</td><td class="num">${esc(g.er)}</td><td class="num">${esc(g.bb)}</td><td class="num">${esc(g.so)}</td><td class="num">${esc(g.era)}</td></tr>`), 'tight')}` : ''}
    ${s.source ? `<p class="note"><a href="${safeHref(s.source)}" target="_blank" rel="noopener noreferrer">Official profile ↗</a></p>` : ''}
  </div>`;
}

// ---------- sections ----------
export function dossierSections(e, d, hc, ac) {
  const S = [];
  const H = e.home, A = e.away;
  const side = (s) => (s === 'home' ? [H, hc] : [A, ac]);

  // Starters (pitchers / goalies)
  const native = e.probables?.some((p) => p.pitching);
  const starters = native ? e.probables : d?.probables || [];
  const goalies = d?.goalies && (d.goalies.home?.length || d.goalies.away?.length);
  if (starters.length || goalies) {
    const cards = starters.sort((a, b) => (a.side === 'home' ? -1 : 1)).map((p) => (native ? nativeStarter(p, side(p.side)[0], side(p.side)[1], e.league) : espnStarter(p, side(p.side)[0], side(p.side)[1]))).join('');
    const g = goalies ? ['home', 'away'].map((s) => (d.goalies[s] || []).map((x) => `<div class="starter panel reveal" style="--tc:${side(s)[1]}"><header><span class="role">Goalie · ${esc(side(s)[0])}</span><h3>${esc(x.name)}</h3></header><div class="statline">${Object.entries(x.stats).map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div></div>`).join('')).join('') : '';
    S.push({ id: 'starters', label: e.sport === 'baseball' ? 'Starting pitchers' : e.sport === 'hockey' ? 'Goalies' : 'Starters', html: `<div class="grid two starters">${cards}${g}</div>` });
  } else if (e.sport === 'baseball') {
    S.push({ id: 'starters', label: 'Starting pitchers', html: '<p class="muted">Starters not announced yet. Leagues usually confirm them the day before.</p>' });
  }

  if (!d && !native) {
    S.push({ id: 'intel', label: 'Match intel', html: '<div class="panel"><p class="muted loading-dots">Loading injuries, team stats, form, head-to-head and standings</p></div>' });
    return S;
  }
  if (d?.error) { S.push({ id: 'intel', label: 'Match intel', html: `<div class="panel"><p class="muted">Detail feed unavailable right now (${esc(d.error)}).</p></div>` }); return S; }
  if (!d || d.native) return S;

  // Injuries
  const injN = (d.injuries.home?.length || 0) + (d.injuries.away?.length || 0);
  S.push({ id: 'injuries', label: `Injuries (${injN})`, html: `<div class="grid two">${['home', 'away'].map((s) => {
    const list = d.injuries[s] || [];
    return `<div class="panel reveal" style="border-top:3px solid ${side(s)[1]}"><h3 class="ph">${esc(side(s)[0])}</h3>${list.length ? table(['Player', 'Pos', 'Status', 'Injury', 'Since', 'Expected back'], list.map((i) => `<tr><td><b>${esc(i.name)}</b></td><td>${esc(i.pos)}</td><td><span class="inj inj-${esc(String(i.status).toLowerCase().replace(/[^a-z]/g, ''))}">${esc(i.status)}</span></td><td>${esc([i.type, i.detail, i.side].filter(Boolean).join(' · '))}</td><td>${i.date ? dt(i.date) : ''}</td><td>${i.returnDate ? dt(i.returnDate) : '—'}</td></tr>`), 'tight') : '<p class="muted">No players listed. That means none reported, not a guarantee of full fitness.</p>'}</div>`;
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
