// Player research: one player's game log (data/players.json, written by the build) with a line you
// can move, filters for which past games count (window, home/away, minutes or at-bats, this
// opponent), the games that match, and four numbers kept apart because they mean different things:
//   hit rate   what happened in the games selected
//   forecast   the ATLAS chance for the next game, with an 80% range (needs a price at this line to
//              blend with; otherwise it is the model alone, and says so)
//   market     the bookmaker's own chance, margin removed
//   break-even what the price needs to win to pay off
import { esc, legButton, ist } from './views.js';
import { pc, odd } from './charts.js';
import { PROP_STATS, GAMELOG_KEYS, propLabel, propMarket, propChance, chanceRange } from './props.js';
import { calibrated } from './track.js';
import { trackCalibration } from './trackview.js';
import { split } from './ui.js';

let data = null, loading = null;
function load(refresh) {
  if (data || loading) return;
  loading = fetch(`data/players.json?t=${Math.floor(Date.now() / 6e5)}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    .then((j) => { data = j; loading = null; refresh?.(); });
}

// Page state: which stat and line, and which past games count.
const st = { key: null, type: null, line: null, win: 20, venue: 'all', minOpp: 0, vs: false };
const OPP_LABEL = { minutes: 'minutes', timeOnIce: 'minutes on ice', atBats: 'at-bats' };
const OPP_STEPS = { minutes: [0, 20, 25, 30, 35], timeOnIce: [0, 12, 15, 18, 21], atBats: [0, 3, 4] };

const shortDate = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const label = (sport, type) => PROP_STATS[sport]?.[type]?.label || type.toLowerCase();
// The player's games as rows the prop model reads (newest first).
function rowsOf(p) {
  const off = 6;
  return p.g.map((g) => {
    const r = {};
    p.c.forEach((c, i) => { if (g[off + i] != null) r[c] = g[off + i]; });
    Object.defineProperties(r, { _date: { value: g[0] }, _oppAbbr: { value: g[1] }, _opp: { value: g[2] }, _home: { value: g[3] === 1 ? true : g[3] === 0 ? false : null }, _season: { value: g[4] === 1 }, _opp2: { value: g[5] } });
    return r;
  });
}
const valueOf = (sport, type, r) => {
  const keys = GAMELOG_KEYS[sport]?.[type];
  return keys && keys.every((k) => Number.isFinite(r[k])) ? keys.reduce((s, k) => s + r[k], 0) : null;
};

// The upcoming match and the lines on offer for this player.
function offers(events, league, id) {
  const cal = trackCalibration();
  const now = Date.now();
  for (const e of events) {
    if (e.live || !(e.start > now) || e.leaguePath?.split('/')[1] !== league) continue;
    const mine = (e.props || []).filter((x) => String(x.id) === String(id));
    if (mine.length) return { e, lines: mine.map((x) => ({ ...x, p: calibrated(x.p, propMarket(x), cal, e.sport) })) };
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

function body(p, events) {
  const [league, id] = st.key.split('|');
  const sport = p.s;
  const { e, lines } = offers(events, league, id);
  const rows = rowsOf(p);
  const offer = lines.find((x) => x.type === st.type && x.target === st.line);
  const home = e ? lines[0]?.side === 'home' ? true : lines[0]?.side === 'away' ? false : null : null;
  const oppId = e && lines[0]?.side ? e.teamIds?.[lines[0].side === 'home' ? 'away' : 'home'] : null;
  const oppName = e && lines[0]?.side ? (lines[0].side === 'home' ? e.away : e.home) : '';
  // The games that count: filters first, then the most recent `win` of them.
  const all = rows.map((r) => ({ r, v: valueOf(sport, st.type, r), date: r._date, opp: r._oppAbbr, home: r._home, played: r._opp2 })).filter((x) => x.v != null);
  const games = all.filter((x) => (st.venue === 'all' || (st.venue === 'home' ? x.home === true : x.home === false))
    && (!st.minOpp || (x.played != null && x.played >= st.minOpp)) && (!st.vs || (oppId && x.r._opp === String(oppId)))).slice(0, st.win || undefined);
  const hits = games.filter((x) => x.v >= st.line).length;
  const avg = games.length ? games.reduce((s, x) => s + x.v, 0) / games.length : null;
  // Forecast: the shown chance for a priced line; the model alone for any other line.
  const model = propChance(offer ? offer.pm ?? 1 / offer.odds : 0.5, sport, st.type, st.line, rows, { home });
  const fc = offer ? offer.p : model.form;
  const range = fc != null ? chanceRange(fc, model.nEff, Boolean(offer)) : null;
  const thin = games.length < 8;
  const nums = `<div class="pl-nums">
    <div><small>Hit rate · ${games.length} game${games.length === 1 ? '' : 's'} selected</small><b>${games.length ? pc(hits / games.length, 0) : '–'}</b><em>${hits}/${games.length}${avg != null ? ` · avg ${avg.toFixed(1)}` : ''}</em></div>
    <div class="pl-fc"><small>ATLAS forecast · next game</small><b>${fc != null ? pc(fc, 0) : '–'}</b><em>${range ? `80% range ${pc(range[0], 0)}–${pc(range[1], 0)}` : 'not enough games'}${offer ? '' : ' · model only, no price at this line'}</em></div>
    <div><small>Market · margin removed</small><b>${offer ? pc(offer.pm ?? 1 / offer.odds, 0) : '–'}</b><em>${offer ? `DraftKings ${odd(offer.odds)}` : 'no price at this line'}</em></div>
    <div><small>Break-even at this price</small><b>${offer ? pc(1 / offer.odds, 0) : '–'}</b><em>${offer ? (fc > 1 / offer.odds ? '<span class="pos">forecast is above it</span>' : '<span class="neg">forecast is below it</span>') : '–'}</em></div>
  </div>
  <p class="pl-evidence ${thin ? 'warn' : ''}">Evidence: ${games.length} game${games.length === 1 ? '' : 's'} after filters${thin ? ' · a small sample: treat the hit rate with care' : ''} · the forecast always uses his last 20 games (recent ones weighted more)${st.vs ? ' · head-to-head games are shown, never trusted on their own' : ''}.</p>`;
  const leg = offer && e ? legButton({ key: `${e.id}|${propMarket(offer)}|${propLabel(offer)}`, eventId: e.id, sport: e.sport, match: `${e.home} vs ${e.away}`, market: propMarket(offer), pick: propLabel(offer), odds: offer.odds, p: offer.p }, `Add ${odd(offer.odds)}`) : '';
  const table = games.length ? `<table class="tbl tight pl-log"><thead><tr><th>Date</th><th>Opponent</th>${p.o ? `<th class="num">${esc(OPP_LABEL[p.o] || 'played')}</th>` : ''}<th class="num">${esc(label(sport, st.type))}</th><th></th></tr></thead><tbody>${games.map((x) => `<tr><td>${esc(shortDate(x.date))}</td><td>${x.home === true ? 'vs' : x.home === false ? '@' : ''} ${esc(x.opp)}</td>${p.o ? `<td class="num">${x.played ?? '–'}</td>` : ''}<td class="num">${x.v}</td><td class="${x.v >= st.line ? 'pos' : 'muted'}">${x.v >= st.line ? '✓' : '✗'}</td></tr>`).join('')}</tbody></table>` : '';
  return { e, lines, oppName, html: `${nums}<div class="pl-act">${leg}</div><div class="panel pl-chart-wrap">${chart(games, st.line)}</div>${table}` };
}

const chip = (k, v, t, on) => `<button class="chip ${on ? 'on' : ''}" data-plf="${k}:${esc(String(v))}">${esc(t)}</button>`;

export function playerView(arg, events, refresh) {
  const key = String(arg || '').replace('~', '|');
  load(refresh);
  if (!data) return { mode: 'bankers', accent: '#3dff9a', title: 'Player', html: `<section class="hero small"><h1>${split('PLAYER')}</h1><p class="muted loading-dots">Loading game logs</p></section>` };
  const p = data[key];
  if (!p) return { mode: 'bankers', accent: '#3dff9a', title: 'Player', html: `<section class="hero small"><h1>${split('PLAYER')}</h1><p class="muted">No game log for this player right now: logs are kept for players with a prop line in the next 36 hours. <a href="#/props">All props</a></p></section>` };
  const [league, id] = key.split('|');
  const { lines } = offers(events, league, id);
  const types = Object.keys(GAMELOG_KEYS[p.s] || {}).filter((t) => rowsOf(p).some((r) => valueOf(p.s, t, r) != null));
  if (st.key !== key) {
    const first = lines.filter((x) => types.includes(x.type)).sort((a, b) => b.p - a.p)[0];
    Object.assign(st, { key, type: first?.type || types[0], line: first?.target ?? 1, win: 20, venue: 'all', minOpp: 0, vs: false });
  }
  const b = body(p, events);
  const steps = OPP_STEPS[p.o] || [];
  const offered = b.lines.filter((x) => x.type === st.type).map((x) => x.target);
  return {
    mode: 'bankers', accent: '#3dff9a', title: p.n,
    html: `<section class="hero small"><p class="kicker reveal">PLAYER RESEARCH${b.e ? ` · NEXT: ${esc(b.oppName ? `${b.lines[0]?.side === 'home' ? 'vs' : '@'} ${b.oppName}` : '')} · ${esc(ist(b.e.start))}` : ''}</p><h1>${split(p.n.toUpperCase())}</h1><p class="lede reveal">${esc(p.t)}${b.e ? ` · <a href="#/match/${encodeURIComponent(b.e.id)}">match dossier</a>` : ''} · <a href="#/props">all props</a></p></section>
      <div class="pl-tools reveal">
        <div class="chips">${types.map((t) => chip('type', t, label(p.s, t), st.type === t)).join('')}</div>
        <div class="pl-line-ctl"><span>Line</span><button class="chip" data-plf="line:-1" aria-label="Lower the line">−</button><input type="range" min="0" max="${Math.max(10, Math.ceil(Math.max(...rowsOf(p).map((r) => valueOf(p.s, st.type, r) ?? 0)) * 1.2))}" step="1" value="${st.line}" data-pl-line aria-label="Line"><b data-pl-line-v>${st.line}+</b><button class="chip" data-plf="line:+1" aria-label="Raise the line">+</button>${offered.length ? `<span class="muted">priced: ${offered.map((t) => `<button class="chip ${t === st.line ? 'on' : ''}" data-plf="set:${t}">${t}+</button>`).join('')}</span>` : ''}</div>
        <div class="chips">${[[5, 'Last 5'], [10, 'Last 10'], [20, 'Last 20'], [0, 'All']].map(([v, t]) => chip('win', v, t, st.win === v)).join('')}<span class="nav-sep" aria-hidden="true"></span>${[['all', 'Home + away'], ['home', 'Home'], ['away', 'Away']].map(([v, t]) => chip('venue', v, t, st.venue === v)).join('')}${b.oppName ? `<span class="nav-sep" aria-hidden="true"></span>${chip('vs', st.vs ? 0 : 1, `vs ${b.oppName}`, st.vs)}` : ''}</div>
        ${steps.length ? `<div class="chips">${steps.map((v) => chip('minOpp', v, v ? `${v}+ ${OPP_LABEL[p.o]}` : `Any ${OPP_LABEL[p.o]}`, st.minOpp === v)).join('')}</div>` : ''}
        <p class="muted pl-soon">Coming next: games with or without a teammate.</p>
      </div>
      <div data-pl-body>${b.html}</div>`,
  };
}

// Chips. Returns true when handled (main.js re-renders).
export function playerClick(t) {
  const f = t.closest('[data-plf]');
  if (!f) return false;
  const [k, v] = f.dataset.plf.split(':');
  if (k === 'line') st.line = Math.max(0, st.line + Number(v));
  else if (k === 'set') st.line = Number(v);
  else if (k === 'type') st.type = v;
  else if (k === 'venue') st.venue = v;
  else if (k === 'vs') st.vs = v === '1';
  else st[k] = Number(v);
  return true;
}
// The line slider: patches the numbers, chart and log in place while it moves.
export function playerInput(el, events) {
  if (!el.matches('[data-pl-line]') || !data?.[st.key]) return false;
  st.line = Number(el.value);
  const out = document.querySelector('[data-pl-line-v]');
  if (out) out.textContent = `${st.line}+`;
  const box = document.querySelector('[data-pl-body]');
  if (box) box.innerHTML = body(data[st.key], events).html;
  return true;
}
