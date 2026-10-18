// Player research: one player's game log (data/players.json, written by the build) with a line you
// can move, filters for which past games count (window, home/away, minutes or at-bats, this
// opponent, with or without a teammate), the games that match, and four numbers kept apart because
// they mean different things:
//   hit rate   what happened in the games selected
//   forecast   the ATLAS chance for the next game, with an 80% range (needs a price at this line to
//              blend with; otherwise it is the model alone, and says so)
//   market     the price's implied chance less an assumed 5% margin (one price, so it cannot be
//              calculated), and the break-even and estimated return at the price
//   break-even what the price needs to win to pay off
// Tonight's absences are listed with what they did to the forecast (out or doubtful: applied;
// questionable: "if he sits" only).
import { esc, legButton, ist } from './views.js';
import { pc, odd } from './charts.js';
import { PROP_STATS, GAMELOG_KEYS, propLabel, propMarket, propChance, chanceRange, splitByTeammate, withoutTeammate } from './props.js';
import { shownProp } from './track.js';
import { trackCalibration } from './trackview.js';
import { split } from './ui.js';
import { propReadiness, analysisPanel } from './propcheck.js';
import { loadPlayers, playersData, playersMeta, retryPlayers, rowsOf, valueOf, opportunityCoverage } from './playerdata.js';

// Page state: which stat and line, and which past games count.
const st = { key: null, type: null, line: null, win: 20, venue: 'all', minOpp: 0, vs: false, mate: '' };
const OPP_LABEL = { minutes: 'minutes', timeOnIcePerGame: 'minutes on ice', atBats: 'at-bats' };
const OPP_STEPS = { minutes: [0, 20, 25, 30, 35], timeOnIcePerGame: [0, 12, 15, 18, 21], atBats: [0, 3, 4] };
const OUT = /^(out|doubtful|injured reserve|suspension)/i;

const shortDate = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const label = (sport, type) => PROP_STATS[sport]?.[type]?.label || type.toLowerCase();
// How old the game logs are, from the file's own build time.
function logAge() {
  const t = playersMeta().updatedAt;
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 6e4);
  return ` · logs built ${m < 1 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`}${m > 45 ? ' (older than usual: the next build will refresh them)' : ''}`;
}
const first = (name) => String(name || '').split(' ').at(-1);

// The upcoming match and the lines on offer for this player.
function offers(events, league, id) {
  const cal = trackCalibration();
  const now = Date.now();
  for (const e of events) {
    if (e.live || !(e.start > now) || e.leaguePath?.split('/')[1] !== league) continue;
    const mine = (e.props || []).filter((x) => String(x.id) === String(id));
    if (mine.length) return { e, lines: mine.map((x) => shownProp(x, propMarket(x), cal, e.sport)) };
  }
  return { e: null, lines: [] };
}

function chart(games, line) {
  if (!games.length) return '<p class="muted">No games match these filters.</p>';
  const g = games.slice().reverse();
  const max = Math.max(line * 1.4, ...g.map((x) => x.v), 1);
  const W = 16, gap = 5, H = 120, pad = 18, w = g.length * (W + gap) - gap;
  const y = (v) => pad + (H - pad) - (v / max) * (H - pad);
  const bars = g.map((x, i) => `<g><rect class="${x.v >= line ? 'ov' : 'un'}" x="${i * (W + gap)}" y="${y(x.v).toFixed(1)}" width="${W}" height="${Math.max(2, H - y(x.v)).toFixed(1)}" rx="2"><title>${esc(`${shortDate(x.date)} ${x.home === true ? 'vs' : x.home === false ? '@' : ''} ${x.opp}: ${x.v}`)}</title></rect><text x="${i * (W + gap) + W / 2}" y="${(y(x.v) - 4).toFixed(1)}" text-anchor="middle">${x.v}</text></g>`).join('');
  return `<svg class="pl-chart" viewBox="0 0 ${w} ${H + 14}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="${g.length} games against the line of ${line}">${bars}<line x1="0" x2="${w}" y1="${y(line).toFixed(1)}" y2="${y(line).toFixed(1)}" /><text class="pl-line" x="${w}" y="${(y(line) - 4).toFixed(1)}" text-anchor="end">${line}+</text>${g.map((x, i) => `<text class="pl-opp" x="${i * (W + gap) + W / 2}" y="${H + 12}" text-anchor="middle">${esc(x.opp.slice(0, 3))}</text>`).join('')}</svg>`;
}

// Tonight's absences on his side and what each does to this line.
function tonight(p, rows, offer, home) {
  const data = playersData();
  const mates = (p.tm || []).filter((m) => m[2]);
  if (!mates.length) return '';
  const items = mates.map(([key, name, status]) => {
    const w = withoutTeammate(p.s, st.type, st.line, rows, rowsOf(data[key]));
    if (!w) return `<li><b>${esc(name)}</b> · ${esc(status)} · <span class="muted">he has played every game with ${esc(first(name))} in this log: no "without" games to learn from</span></li>`;
    const applied = OUT.test(status) && w.fresh;
    const already = OUT.test(status) && !w.fresh;
    const base = propChance(offer ? offer.pm ?? 1 / offer.odds : 0.5, p.s, st.type, st.line, rows, { home });
    const ifOut = propChance(offer ? offer.pm ?? 1 / offer.odds : 0.5, p.s, st.type, st.line, rows, { home, scale: w.scale, without: w.without });
    const a = offer ? base.p : base.form, b = offer ? ifOut.p : ifOut.form;
    return `<li><b>${esc(name)}</b> · ${esc(status)} · without him: avg ${w.avgWithout} in ${w.without[1]} games (${w.without[0]}/${w.without[1]} cleared ${st.line}+) vs ${w.avgWith} with him · ${applied ? `<span class="pos">applied</span>: forecast ${pc(a, 0)} → ${pc(b, 0)}` : already ? `<span class="muted">already missed ${5 - w.recentWith} of his last 5 games: his recent form reflects it, so it is not applied again</span>` : `if he sits: ${pc(a, 0)} → ${pc(b, 0)}`}</li>`;
  }).join('');
  return `<div class="panel pl-tonight"><h3 class="ph">Tonight's absences <small>from ESPN's injury report · out and doubtful are applied to the forecast, questionable only as "if he sits"</small></h3><ul>${items}</ul></div>`;
}

function body(p, events) {
  const data = playersData();
  const [league, id] = st.key.split('|');
  const sport = p.s;
  const { e, lines } = offers(events, league, id);
  const rows = rowsOf(p);
  const offer = lines.find((x) => x.type === st.type && x.target === st.line);
  const home = e ? lines[0]?.side === 'home' ? true : lines[0]?.side === 'away' ? false : null : null;
  const oppId = e && lines[0]?.side ? e.teamIds?.[lines[0].side === 'home' ? 'away' : 'home'] : null;
  const oppName = e && lines[0]?.side ? (lines[0].side === 'home' ? e.away : e.home) : '';
  // With or without a teammate: from his own game log.
  const [mateKey, mateMode] = st.mate ? [st.mate.slice(0, st.mate.lastIndexOf('|')), st.mate.slice(st.mate.lastIndexOf('|') + 1)] : [];
  const mateSplit = mateKey && data[mateKey] ? splitByTeammate(rows, rowsOf(data[mateKey])) : null;
  const keep = mateSplit ? new Set(mateSplit[mateMode === 'with' ? 'with' : 'without']) : null;
  // The games that count: filters first, then the most recent `win` of them.
  const all = rows.map((r) => ({ r, v: valueOf(sport, st.type, r), date: r._date, opp: r._oppAbbr, home: r._home, played: r._played })).filter((x) => x.v != null);
  const games = all.filter((x) => (st.venue === 'all' || (st.venue === 'home' ? x.home === true : x.home === false))
    && (!st.minOpp || (x.played != null && x.played >= st.minOpp)) && (!st.vs || (oppId && x.r._opp === String(oppId)))
    && (!keep || keep.has(x.r))).slice(0, st.win || undefined);
  const hits = games.filter((x) => x.v >= st.line).length;
  const avg = games.length ? games.reduce((s, x) => s + x.v, 0) / games.length : null;
  // Forecast: the shown chance for a priced line; the model alone (with tonight's applied absences)
  // for any other line.
  const applied = (p.tm || []).filter((m) => m[2] && OUT.test(m[2])).map((m) => withoutTeammate(sport, st.type, st.line, rows, rowsOf(data[m[0]]))).filter((w) => w?.fresh)
    .sort((a, b) => Math.abs(b.scale - 1) - Math.abs(a.scale - 1));
  const scale = Math.min(1.4, Math.max(0.7, applied.reduce((m, x) => m * x.scale, 1)));
  const model = propChance(offer ? offer.pm ?? 1 / offer.odds : 0.5, sport, st.type, st.line, rows, { home, scale, without: applied[0]?.without });
  const fc = offer ? offer.p : model.form;
  const range = fc != null ? chanceRange(fc, model.nEff, Boolean(offer)) : null;
  const thin = games.length < 8;
  const mateName = mateKey ? data[mateKey]?.n : '';
  // The prop on offer (or, for an unpriced line, the player's nearest one) for readiness.
  const ref = offer || lines.find((x) => x.type === st.type) || lines[0];
  const pmeta = playersMeta();
  const rd = e && ref ? propReadiness(e, ref, { logsAt: pmeta.updatedAt }) : null;
  const age = (t) => (t ? Math.max(0, Math.round((Date.now() - t) / 6e4)) : null);
  const nums = analysisPanel({
    hits, n: games.length, avg, forecast: fc, range, nEff: model.nEff, priced: Boolean(offer), odds: offer?.odds,
    marketEst: offer ? offer.pm ?? 1 / offer.odds : null, why: offer?.why, readiness: rd,
    priceAge: age(e?.fetchedAt), logsAge: age(pmeta.updatedAt), filtersNote: mateName ? `${mateMode} ${mateName}` : '',
  });
  const notes = `
  <p class="pl-evidence ${thin ? 'warn' : ''}">Evidence: ${games.length} game${games.length === 1 ? '' : 's'} after filters${mateName ? ` (${mateMode} ${esc(mateName)})` : ''}${thin ? ' · a small sample: treat the hit rate with care' : ''} · the forecast always uses his last 20 games (recent ones weighted more)${st.vs ? ' · head-to-head games are shown, never trusted on their own' : ''}.</p>
  <p class="pl-evidence">Game history: up to 20 recent games per player (last season fills a young season), so "Season" means this season's games among them, not the whole season${logAge()}.</p>`;
  const numsAll = nums + notes;
  const leg = offer && e ? legButton({ key: `${e.id}|${propMarket(offer)}|${propLabel(offer)}`, eventId: e.id, sport: e.sport, match: `${e.home} vs ${e.away}`, market: propMarket(offer), pick: propLabel(offer), odds: offer.odds, p: offer.p, prop: { id: String(offer.id), league, type: offer.type, target: offer.target } }, `Add ${odd(offer.odds)}`) : '';
  const table = games.length ? `<table class="tbl tight pl-log"><thead><tr><th>Date</th><th>Opponent</th>${p.o ? `<th class="num">${esc(OPP_LABEL[p.o] || 'played')}</th>` : ''}<th class="num">${esc(label(sport, st.type))}</th><th></th></tr></thead><tbody>${games.map((x) => `<tr><td>${esc(shortDate(x.date))}</td><td>${x.home === true ? 'vs' : x.home === false ? '@' : ''} ${esc(x.opp)}</td>${p.o ? `<td class="num">${x.played ?? '–'}</td>` : ''}<td class="num">${x.v}</td><td class="${x.v >= st.line ? 'pos' : 'muted'}">${x.v >= st.line ? '✓' : '✗'}</td></tr>`).join('')}</tbody></table>` : '';
  return { e, lines, oppName, html: `${numsAll}<div class="pl-act">${leg}</div>${tonight(p, rows, offer, home)}<div class="panel pl-chart-wrap">${chart(games, st.line)}</div>${table}` };
}

const chip = (k, v, t, on) => `<button class="chip ${on ? 'on' : ''}" data-plf="${k}:${esc(String(v))}">${esc(t)}</button>`;

// The research panel for one player: controls and body. Used on its own page and beside the props
// list on wide screens. null while the logs load or when there is no log.
export function playerPanel(arg, events, refresh) {
  // arg: "<league>~<athlete id>" with, from a props row, "~<stat type>~<line>" so research opens on
  // exactly the line that was tapped.
  const [lg, pid, selType, selLine] = String(arg || '').split('~');
  const key = `${lg}|${pid}`;
  const data = loadPlayers(refresh);
  const pm = playersMeta();
  if (!data) {
    return pm.failed
      ? { title: 'Player', html: '<p class="muted">Could not load the game logs. ATLAS tries again in a minute. <button class="chip" data-plf="retry:1">Retry now</button></p>' }
      : { title: 'Player', loading: true, html: '<p class="muted loading-dots">Loading game logs</p>' };
  }
  const p = data[key];
  if (!p) return { title: 'Player', html: '<p class="muted">No game log for this player right now: logs are kept for players with a prop line in the next 36 hours. <a href="#/props">All props</a></p>' };
  const [league, id] = key.split('|');
  const { lines } = offers(events, league, id);
  const rows = rowsOf(p);
  const types = Object.keys(GAMELOG_KEYS[p.s] || {}).filter((t) => rows.some((r) => valueOf(p.s, t, r) != null));
  const sel = selType && types.includes(selType) ? `${selType}~${selLine}` : '';
  if (st.key !== key || (sel && st.sel !== sel)) {
    const top = lines.filter((x) => types.includes(x.type)).sort((a, b) => b.p - a.p)[0];
    const type = sel ? selType : top?.type || types[0];
    const line = sel && Number.isFinite(Number(selLine)) ? Number(selLine) : top?.target ?? 1;
    Object.assign(st, { key, sel, type, line, win: 20, venue: 'all', minOpp: 0, vs: false, mate: '' });
  }
  // The minutes / at-bats filter needs that column in most games; hockey logs, for one, lack it.
  const oppCover = opportunityCoverage(p);
  if (oppCover < 0.6) st.minOpp = 0;
  const b = body(p, events);
  const steps = OPP_STEPS[p.o] || [];
  const offered = b.lines.filter((x) => x.type === st.type).map((x) => x.target);
  const mates = (p.tm || []).filter((m) => data[m[0]]);
  const next = b.e ? `${b.oppName ? `${b.lines[0]?.side === 'home' ? 'vs' : '@'} ${b.oppName} · ` : ''}${ist(b.e.start)}` : '';
  return {
    title: p.n, name: p.n, team: p.t, e: b.e, next,
    html: `<div class="pl-tools">
        <div class="chips">${types.map((t) => chip('type', t, label(p.s, t), st.type === t)).join('')}</div>
        <div class="pl-line-ctl"><span>Line</span><button class="chip" data-plf="line:-1" aria-label="Lower the line">−</button><input type="range" min="0" max="${Math.max(10, Math.ceil(Math.max(...rows.map((r) => valueOf(p.s, st.type, r) ?? 0)) * 1.2))}" step="1" value="${st.line}" data-pl-line aria-label="Line"><b data-pl-line-v>${st.line}+</b><button class="chip" data-plf="line:+1" aria-label="Raise the line">+</button>${offered.length ? `<span class="muted">priced: ${offered.map((t) => `<button class="chip ${t === st.line ? 'on' : ''}" data-plf="set:${t}">${t}+</button>`).join('')}</span>` : ''}</div>
        <div class="chips">${[[5, 'Last 5'], [10, 'Last 10'], [20, 'Last 20'], [0, `All ${rows.length} stored`]].map(([v, t]) => chip('win', v, t, st.win === v)).join('')}<span class="nav-sep" aria-hidden="true"></span>${[['all', 'Home + away'], ['home', 'Home'], ['away', 'Away']].map(([v, t]) => chip('venue', v, t, st.venue === v)).join('')}${b.oppName ? `<span class="nav-sep" aria-hidden="true"></span>${chip('vs', st.vs ? 0 : 1, `vs ${b.oppName}`, st.vs)}` : ''}</div>
        ${steps.length && oppCover >= 0.6 ? `<div class="chips">${steps.map((v) => chip('minOpp', v, v ? `${v}+ ${OPP_LABEL[p.o]}` : `Any ${OPP_LABEL[p.o]}`, st.minOpp === v)).join('')}${oppCover < 0.95 ? `<span class="muted pl-cover">${Math.round(oppCover * 100)}% of games list ${OPP_LABEL[p.o]}</span>` : ''}</div>` : steps.length ? `<p class="muted pl-cover">No ${OPP_LABEL[p.o] || 'playing-time'} filter: ESPN's ${p.s} game logs do not list it${oppCover ? ` (only ${Math.round(oppCover * 100)}% of games)` : ''}.</p>` : ''}
        ${mates.length ? `<div class="chips pl-mates"><span class="muted">Teammate:</span>${chip('mate', '', 'Any', !st.mate)}${mates.map(([k, n, s]) => `${chip('mate', `${k}|without`, `Without ${first(n)}${s ? ` (${s.toLowerCase()})` : ''}`, st.mate === `${k}|without`)}${chip('mate', `${k}|with`, `With ${first(n)}`, st.mate === `${k}|with`)}`).join('')}</div>` : ''}
      </div>
      <div data-pl-body>${b.html}</div>`,
  };
}

export function playerView(arg, events, refresh) {
  const pn = playerPanel(arg, events, refresh);
  return {
    mode: 'bankers', accent: '#3dff9a', title: pn.title,
    html: `<section class="hero small"><p class="kicker reveal">PLAYER RESEARCH${pn.next ? ` · NEXT: ${esc(pn.next)}` : ''}</p><h1>${split((pn.name || 'PLAYER').toUpperCase())}</h1>${pn.name ? `<p class="lede reveal">${esc(pn.team || '')}${pn.e ? ` · <a href="#/match/${encodeURIComponent(pn.e.id)}">match dossier</a>` : ''} · <a href="#/props">all props</a></p>` : ''}</section>${pn.html}`,
  };
}

// Chips. Returns true when handled (main.js re-renders).
export function playerClick(t) {
  const f = t.closest('[data-plf]');
  if (!f) return false;
  const raw = f.dataset.plf, i = raw.indexOf(':');
  const k = raw.slice(0, i), v = raw.slice(i + 1);
  if (k === 'line') st.line = Math.max(0, st.line + Number(v));
  else if (k === 'set') st.line = Number(v);
  else if (k === 'type') st.type = v;
  else if (k === 'venue') st.venue = v;
  else if (k === 'vs') st.vs = v === '1';
  else if (k === 'mate') st.mate = v;
  else if (k === 'retry') retryPlayers();
  else st[k] = Number(v);
  return true;
}
// The line slider: patches the numbers, chart and log in place while it moves.
export function playerInput(el, events) {
  const data = playersData();
  if (!el.matches('[data-pl-line]') || !data?.[st.key]) return false;
  st.line = Number(el.value);
  const out = document.querySelector('[data-pl-line-v]');
  if (out) out.textContent = `${st.line}+`;
  const box = document.querySelector('[data-pl-body]');
  if (box) box.innerHTML = body(data[st.key], events).html;
  return true;
}
