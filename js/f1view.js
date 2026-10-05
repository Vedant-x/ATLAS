// Formula 1 page: the Grand Prix weekend on now (or next), with the circuit drawn in 3D behind it,
// the session timeline, live timing during sessions, the ATLAS race model (win, podium, points,
// teammate battles, constructors), best bets and both championships. Data: data/f1.json (built every
// few minutes), live timing straight from ESPN and OpenF1 in the browser.
import { ESPN_F1, OPENF1, liveSession } from './f1.js';
import { split } from './ui.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pc = (p, d = 0) => `${(p * 100).toFixed(d)}%`;
const odd = (p) => (p > 0 ? (1 / p).toFixed(p > 0.5 ? 2 : 1) : '—');
const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
function until(t) {
  const m = Math.round((t - Date.now()) / 6e4);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m}m`;
  if (m < 48 * 60) return `in ${Math.floor(m / 60)}h ${m % 60}m`;
  return `in ${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

let cache = null;
export const f1Data = () => cache?.data || null;
export async function loadF1(force = false) {
  if (!force && cache && Date.now() - cache.at < 4 * 6e4) return cache.data;
  try {
    const res = await fetch(`data/f1.json?t=${Math.floor(Date.now() / 6e4)}`);
    if (res.ok) cache = { at: Date.now(), data: await res.json() };
  } catch { /* keep what we have */ }
  return cache?.data || null;
}

// Small card used on the sports grids.
export function f1Teaser() {
  const d = f1Data();
  if (!d) return 'Grand Prix weekend';
  const next = d.race.sessions.find((s) => s.state !== 'post');
  const live = liveSession(d.race.sessions);
  return live ? `<span class="live">${esc(live.name)} live</span> · ${esc(d.race.name)}` : `${esc(d.race.name)}${next ? ` · ${esc(next.name)} ${until(next.start)}` : ''}`;
}

// ---------- live timing ----------
const live = { order: [], gaps: {}, laps: null, flag: '', messages: [], source: '', at: 0, since: null, pos: {} };
async function json(u, ms = 6000) { const r = await fetch(u, { signal: AbortSignal.timeout(ms), cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.json(); }

export async function pollF1Live(d, scene) {
  const ses = liveSession(d.race.sessions);
  if (!ses) return false;
  // ESPN: running order and session status (always available).
  try {
    const j = await json(ESPN_F1);
    const ev = j.events?.[0];
    const c = ev?.competitions?.find((x) => x.status?.type?.state === 'in') || ev?.competitions?.find((x) => x.type?.abbreviation === ses.code);
    if (c) {
      live.order = [...(c.competitors || [])].sort((a, b) => (a.order || 99) - (b.order || 99)).map((x) => ({ name: x.athlete?.displayName || '', pos: x.order }));
      live.detail = c.status?.type?.shortDetail || '';
      live.source = 'ESPN';
    }
  } catch { /* keep last */ }
  // OpenF1: gaps, laps, race control and car positions on the map (when the feed is open).
  try {
    const since = new Date(Date.now() - 20000).toISOString();
    const [iv, rc, loc] = await Promise.all([
      json(`${OPENF1}/intervals?session_key=latest&date>${since}`).catch(() => []),
      json(`${OPENF1}/race_control?session_key=latest&date>${new Date(Date.now() - 15 * 6e4).toISOString()}`).catch(() => []),
      json(`${OPENF1}/location?session_key=latest&date>${new Date(Date.now() - 5000).toISOString()}`).catch(() => []),
    ]);
    for (const x of iv) live.gaps[x.driver_number] = { gap: x.gap_to_leader, int: x.interval };
    if (rc.length) { live.messages = rc.slice(-4).reverse().map((m) => m.message); const f = [...rc].reverse().find((m) => m.flag); live.flag = f?.flag || live.flag; }
    for (const p of loc) live.pos[p.driver_number] = p;
    if (iv.length || loc.length) live.source = live.source ? `${live.source} + OpenF1` : 'OpenF1';
  } catch { /* ESPN only */ }
  live.at = Date.now();
  // Cars on the 3D circuit: real positions when OpenF1 sends them.
  const t = d.track?.transform;
  if (t && scene?.setCars) {
    const cars = Object.entries(live.pos).map(([num, p]) => {
      const dr = d.drivers.find((x) => String(x.number) === String(num));
      return { x: (p.x - t.cx) / t.scale, y: (p.y - t.cy) / t.scale, color: dr?.colour || '#ffffff' };
    });
    if (cars.length) scene.setCars(cars);
  }
  const el = document.getElementById('f1-live');
  if (el) el.outerHTML = liveTower(d, ses);
  return true;
}

function liveTower(d, ses) {
  const byName = (n) => d.drivers.find((x) => n && (n.toLowerCase().includes(x.family.toLowerCase())));
  const rows = live.order.slice(0, 22).map((o, i) => {
    const dr = byName(o.name);
    const g = dr ? live.gaps[dr.number] : null;
    const gap = i === 0 ? 'Leader' : g?.gap != null ? (typeof g.gap === 'number' ? `+${g.gap.toFixed(3)}` : esc(g.gap)) : '';
    return `<li style="--tc:${esc(dr?.colour || '#888')}"><b>${o.pos || i + 1}</b><span>${esc(dr?.code || o.name)}</span><em>${esc(dr?.team || '')}</em><i>${gap}</i></li>`;
  }).join('');
  return `<section class="panel f1-live reveal in" id="f1-live"><h2 class="ph"><span class="live">LIVE</span> ${esc(ses.name)} <small>${esc(live.detail || '')}${live.flag ? ` · flag: ${esc(live.flag)}` : ''} · ${esc(live.source || 'connecting…')}</small></h2>
    ${rows ? `<ol class="f1-tower">${rows}</ol>` : '<p class="muted">Live timing loads in a moment…</p>'}
    ${live.messages.length ? `<ul class="f1-rc">${live.messages.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</section>`;
}

// ---------- page ----------
const leg = (d, market, pick, p, legButton) => legButton({ key: `f1|${d.season}|${d.round}|${market}|${pick}`, eventId: `f1-${d.season}-${d.round}`, sport: 'f1', match: d.race.name, market, pick, odds: +(1 / p).toFixed(2), p, derived: true }, odd(p));

function bestBets(d) {
  const out = [];
  const fav = d.drivers[0];
  if (fav) out.push({ label: 'Race winner', pick: fav.name, p: fav.win, why: `${d.gridKnown && fav.grid ? `starts P${fav.grid}, ` : ''}average finish ${fav.avgFinish5?.toFixed(1) ?? '—'} over the last five` });
  const pod = d.drivers.filter((x) => x.podium >= 0.5).sort((a, b) => b.podium - a.podium)[0];
  if (pod) out.push({ label: 'Podium finish', pick: pod.name, p: pod.podium, why: 'top-three in most simulations' });
  const pts = d.drivers.filter((x) => x.points >= 0.75 && x.points < 0.97).sort((a, b) => b.points - a.points)[0];
  if (pts) out.push({ label: 'Points finish (top 10)', pick: pts.name, p: pts.points, why: `retirement risk ${pc(pts.dnfRate)}` });
  const h = [...d.h2h].map((x) => (x.pA >= x.pB ? { team: x.team, pick: x.a, other: x.b, p: x.pA } : { team: x.team, pick: x.b, other: x.a, p: x.pB })).sort((a, b) => b.p - a.p)[0];
  if (h) out.push({ label: `Teammate battle · ${h.team}`, pick: `${h.pick} ahead of ${h.other}`, p: h.p, why: 'finishes ahead in most simulations' });
  const team = d.teams[0];
  if (team) out.push({ label: 'Winning constructor', pick: team.name, p: team.win, why: 'either driver wins' });
  return out;
}

export function f1View(S, { legButton, notice }) {
  const d = f1Data();
  const after = () => {
    loadF1().then((x) => { if (x && !d) S.refresh?.(); if (x?.track) S.scene?.setTrack?.(x.track.points); });
  };
  if (!d) {
    return { mode: 'race', accent: '#ff2a2a', title: 'Formula 1', after,
      html: `<section class="hero"><p class="kicker reveal">FORMULA 1 · WORLD CHAMPIONSHIP</p><h1>${split('FORMULA 1')}</h1><p class="lede reveal">Loading the Grand Prix weekend…</p></section>` };
  }
  const ses = d.race.sessions;
  const now = Date.now();
  const liveS = liveSession(ses, now);
  const next = ses.find((s) => s.start > now);
  const top = d.drivers.slice(0, 10);
  const maxWin = Math.max(...top.map((x) => x.win), 0.01);
  const bb = bestBets(d);
  return {
    mode: 'race', accent: '#ff2a2a', title: `${d.race.name} · F1`, sceneOpts: { track: d.track?.points || null },
    after: () => { after(); S.scene?.setTrack?.(d.track?.points || null); if (liveS) pollF1Live(d, S.scene); },
    html: `
    <section class="hero f1-hero">
      <p class="kicker reveal">🏎️ ROUND ${d.round} / ${d.rounds} · ${esc(d.race.locality.toUpperCase())}, ${esc(d.race.country.toUpperCase())}</p>
      <h1>${split(d.race.name.toUpperCase())}</h1>
      <p class="lede reveal">${esc(d.race.circuit)} · ${liveS ? `<span class="live">${esc(liveS.name)} LIVE</span>` : next ? `${esc(next.name)} <b data-start="${next.start}">${until(next.start)}</b>` : 'Weekend complete'}</p>
      <div class="f1-sessions reveal">${ses.map((s) => `<div class="f1-s ${s.state === 'post' ? 'done' : liveS === s ? 'on' : ''}"><small>${esc(s.code)}</small><b>${esc(s.name)}</b><em>${s.state === 'post' && s.top[0] ? `🏁 ${esc(s.top[0])}` : liveS === s ? 'LIVE' : esc(when(s.start))}</em></div>`).join('')}</div>
      ${d.track ? `<p class="f1-trackline reveal">Circuit map from real car data · ${esc(d.track.from)}</p>` : '<p class="f1-trackline reveal">Circuit map appears after the first practice session at a new track.</p>'}
    </section>
    ${notice ? notice() : ''}
    ${liveS ? liveTower(d, liveS) : ''}
    <section class="panel big reveal"><h2 class="ph">Who wins? <small>ATLAS race model · ${d.sims.toLocaleString()} simulated races · ${d.gridKnown ? 'starting grid + form' : 'season form (grid not set yet)'} · no bookmaker price</small></h2>
      <div class="f1-bars">${top.map((x) => `<div class="f1-bar" style="--tc:${esc(x.colour || '#ff2a2a')}"><span class="nm"><b>${esc(x.code)}</b> ${esc(x.name)}<small>${esc(x.team)}${x.grid ? ` · P${x.grid}` : ''}</small></span>
        <div class="meter"><i class="grow" style="--w:${((x.win / maxWin) * 100).toFixed(1)}%"></i></div><span class="pv">${pc(x.win, 1)}</span>${leg(d, 'Race winner', x.name, x.win, legButton)}</div>`).join('')}</div>
    </section>
    <section class="sec-block"><h2 class="sec reveal"><span>◆</span>Best bets for this Grand Prix <small>highest-confidence picks from the model</small></h2>
      <div class="best-bets">${bb.map((b) => `<div class="bb panel reveal"><small>${esc(b.label)}</small><b>${esc(b.pick)}</b><div class="bb-row"><span>${pc(b.p)}</span><em>${esc(b.why)}</em>${leg(d, b.label, b.pick, b.p, legButton)}</div></div>`).join('')}</div></section>
    <section class="panel reveal"><h2 class="ph">Every driver <small>chance to win · podium · top 6 · points · average finish · fair odds</small></h2>
      <div class="table-wrap"><table class="f1-table"><thead><tr><th>Driver</th><th>Grid</th><th>Last 5</th><th>Win</th><th>Podium</th><th>Top 6</th><th>Points</th><th>Avg</th><th>Podium odds</th></tr></thead>
      <tbody>${d.drivers.map((x) => `<tr style="--tc:${esc(x.colour || '#888')}"><td class="drv"><b>${esc(x.code)}</b> ${esc(x.name)}<small>${esc(x.team)}</small></td><td>${x.grid ? `P${x.grid}` : '—'}</td><td class="l5">${x.last5.map((r) => `<i class="${r === 'DNF' ? 'dnf' : Number(r) <= 3 ? 'pod' : Number(r) <= 10 ? 'pts' : ''}">${esc(r)}</i>`).join('')}</td>
        <td>${pc(x.win, 1)}</td><td>${pc(x.podium)}</td><td>${pc(x.top6)}</td><td>${pc(x.points)}</td><td>${x.avgPos.toFixed(1)}</td><td>${leg(d, 'Podium finish', x.name, x.podium, legButton)}</td></tr>`).join('')}</tbody></table></div></section>
    <div class="two">
      <section class="panel reveal"><h2 class="ph">Teammate battles <small>who finishes ahead</small></h2>
        <ul class="f1-h2h">${d.h2h.map((h) => `<li><small>${esc(h.team)}</small><div class="h2h-bar"><span>${esc(h.a)} <b>${pc(h.pA)}</b></span><div class="meter two"><i style="--w:${(h.pA * 100).toFixed(1)}%"></i></div><span><b>${pc(h.pB)}</b> ${esc(h.b)}</span></div></li>`).join('')}</ul></section>
      <section class="panel reveal"><h2 class="ph">Winning constructor</h2>
        <ul class="f1-teams">${d.teams.slice(0, 8).map((t) => `<li><span>${esc(t.name)}</span><b>${pc(t.win, 1)}</b>${leg(d, 'Winning constructor', t.name, t.win, legButton)}</li>`).join('')}</ul></section>
    </div>
    <div class="two">
      <section class="panel reveal"><h2 class="ph">Drivers' championship</h2><ol class="f1-stand">${d.standings.slice(0, 12).map((x) => `<li style="--tc:${esc(x.colour || '#888')}"><b>${x.pos}</b><span>${esc(x.name)}<small>${esc(x.team)}</small></span><em>${x.points} pts</em></li>`).join('')}</ol></section>
      <section class="panel reveal"><h2 class="ph">Constructors' championship</h2><ol class="f1-stand">${d.constructors.map((x) => `<li><b>${x.pos}</b><span>${esc(x.name)}</span><em>${x.points} pts</em></li>`).join('')}</ol></section>
    </div>
    <section class="panel reveal"><h2 class="ph">Coming up</h2>
      ${d.lastRace ? `<p class="muted">Last race: <b>${esc(d.lastRace.name)}</b> · podium ${d.lastRace.podium.map(esc).join(', ')}</p>` : ''}
      <ul class="f1-next">${d.upcoming.map((r) => `<li><b>R${r.round}</b><span>${esc(r.name)}</span><em>${esc(r.locality)} · ${new Date(`${r.date}T12:00:00Z`).toLocaleDateString([], { day: 'numeric', month: 'short' })}</em></li>`).join('')}</ul></section>
    <p class="note reveal">How the model works: each driver's expected finish blends the last five races, the season average and recent qualifying (and the starting grid once it's set); ${d.sims.toLocaleString()} races are simulated with random retirements at each driver's own rate. Probabilities are estimates, not certainties. Data: Jolpica (results, standings), ESPN (sessions), OpenF1 (team colours, circuit map, live timing).</p>`,
  };
}
