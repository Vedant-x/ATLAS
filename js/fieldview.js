// Golf and motor racing pages (data/fields.json, built every few minutes; models in fields.js).
// Golf: each tour's event this week, the leaderboard and ATLAS's win / top-5 / top-10 / top-20
// chances. Racing: NASCAR Cup and IndyCar, the next race with win / podium / top-10 chances from the
// season standings. No bookmaker prices: every price shown is ATLAS's own (fair odds).
import { split } from './ui.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pc = (p, d = 0) => `${(p * 100).toFixed(d)}%`;
const par = (x) => (x == null ? '–' : x === 0 ? 'E' : x > 0 ? `+${x}` : String(x));
const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

let cache = null;
export const fieldsData = () => cache?.data || null;
export async function loadFields(force = false) {
  if (!force && cache && Date.now() - cache.at < 4 * 6e4) return cache.data;
  try {
    const res = await fetch(`data/fields.json?t=${Math.floor(Date.now() / 6e4)}`);
    if (res.ok) cache = { at: Date.now(), data: await res.json() };
  } catch { /* keep what we have */ }
  return cache?.data || null;
}

// Card line on the sports grid.
export function fieldsTeaser(sport) {
  const d = fieldsData();
  if (!d) return sport === 'golf' ? 'Tournaments this week' : 'NASCAR & IndyCar';
  if (sport === 'golf') {
    const live = d.golf.filter((t) => t.state === 'in');
    return live.length ? `<span class="live">${live.length} live</span> · ${esc(live[0].name)}` : `${d.golf.length} tournament${d.golf.length === 1 ? '' : 's'} this week`;
  }
  const next = d.racing.filter((r) => r.next).sort((a, b) => a.next.start - b.next.start)[0];
  return next ? `${esc(next.seriesName)} · ${when(next.next.start)}` : `${d.racing.length} series`;
}

const leg = (key, eventId, sport, match, market, pick, p, legButton) => (p > 0.005 && p < 0.97 && legButton
  ? legButton({ key, eventId, sport, match, market, pick, odds: +(1 / p).toFixed(2), p, derived: true }, (1 / p).toFixed(p > 0.5 ? 2 : 1)) : '');

function golfSection(t, legButton) {
  const top = t.players.slice(0, 12), maxWin = Math.max(...top.map((x) => x.win), 0.01);
  const ev = `golf-${t.id}`, live = t.state === 'in', pre = t.state === 'pre';
  const g = (x, market, p) => leg(`${ev}|${market}|${x.name}`, ev, 'golf', t.name, market, x.name, p, legButton);
  const formNote = t.formEvents?.length ? `form from ${t.formEvents.length} recent event${t.formEvents.length === 1 ? '' : 's'}` : 'no recent form on record';
  return `<section class="panel big reveal"><h2 class="ph">${esc(t.name)} <small>${esc(t.tourName)} · ${live ? `<span class="live">${esc(t.detail || `Round ${t.round}`)}</span>` : pre ? `starts ${when(t.start)}` : 'Final'} · ${t.fieldSize} players · ${pre ? formNote : `leaderboard + ${formNote}`}</small></h2>
    ${t.players.length ? '' : '<p class="muted">The field has not been announced yet: chances appear once the players are listed.</p>'}
    <div class="f1-bars">${top.map((x) => `<div class="f1-bar" style="--tc:#5cd68b"><span class="nm"><b>${pre ? '' : esc(par(x.toPar))}</b> ${esc(x.name)}<small>${esc(x.country)}${x.rounds?.length ? ` · ${x.rounds.join('-')}` : ''}${x.left && !pre ? ` · ${x.left} holes left` : ''}</small></span>
      <div class="meter"><i class="grow" style="--w:${((x.win / maxWin) * 100).toFixed(1)}%"></i></div><span class="pv">${pc(x.win, 1)}</span>${g(x, 'Tournament winner', x.win)}</div>`).join('')}</div>
    ${t.players.length ? `<details class="more-leagues"><summary>Every player · top 5, top 10, top 20</summary>
      <div class="table-wrap"><table class="f1-table"><thead><tr><th>Player</th><th>Score</th><th>Win</th><th>Top 5</th><th>Top 10</th><th>Top 20</th><th>Top 10 odds</th></tr></thead>
      <tbody>${t.players.map((x) => `<tr><td class="drv">${esc(x.name)}<small>${esc(x.country)}${x.formRounds ? ` · ${x.formRounds} recent rounds` : ''}</small></td><td>${pre ? '–' : esc(par(x.toPar))}</td><td>${pc(x.win, 1)}</td><td>${pc(x.top5)}</td><td>${pc(x.top10)}</td><td>${pc(x.top20)}</td><td>${g(x, 'Top 10 finish', x.top10)}</td></tr>`).join('')}</tbody></table></div>
    </details>` : ''}</section>`;
}

function raceSection(r, legButton) {
  const top = r.drivers.slice(0, 12), maxWin = Math.max(...top.map((x) => x.win), 0.01);
  const ev = `race-${r.series}-${r.next?.start || r.season || ''}`, name = r.next?.name || r.seriesName;
  const g = (x, market, p) => leg(`${ev}|${market}|${x.name}`, ev, 'motorsport', name, market, x.name, p, legButton);
  return `<section class="panel big reveal"><h2 class="ph">${esc(r.seriesName)} <small>${r.next ? `${esc(r.next.name)} · ${r.next.state === 'in' ? '<span class="live">LIVE</span>' : when(r.next.start)}` : 'no race scheduled this week'}${r.last ? ` · last race ${esc(r.last.name)}: ${esc(r.last.top.slice(0, 3).join(', '))}` : ''}</small></h2>
    ${r.drivers.length ? `<p class="muted">Chances from the season standings (${r.drivers.some((x) => x.wins != null) ? 'points, wins, top 5s and top 10s per start' : 'championship points: the feed has no wins or top 5s for this series'}). No practice or qualifying pace and no track type: treat as a rough guide.</p>
    <div class="f1-bars">${top.map((x) => `<div class="f1-bar" style="--tc:#ffb347"><span class="nm"><b>P${x.pos ?? '–'}</b> ${esc(x.name)}<small>${x.points != null ? `${x.points} pts` : ''}${x.wins != null ? ` · ${x.wins} win${x.wins === 1 ? '' : 's'}` : ''}${x.top5 != null ? ` · ${x.top5} top 5s` : ''}</small></span>
      <div class="meter"><i class="grow" style="--w:${((x.win / maxWin) * 100).toFixed(1)}%"></i></div><span class="pv">${pc(x.win, 1)}</span>${r.next ? g(x, 'Race winner', x.win) : ''}</div>`).join('')}</div>
    <details class="more-leagues"><summary>Every driver · podium, top 5, top 10</summary>
      <div class="table-wrap"><table class="f1-table"><thead><tr><th>Driver</th><th>Pts</th><th>Win</th><th>Podium</th><th>Top 5</th><th>Top 10</th></tr></thead>
      <tbody>${r.drivers.map((x) => `<tr><td class="drv">${esc(x.name)}<small>P${x.pos ?? '–'}</small></td><td>${x.points ?? '–'}</td><td>${pc(x.win, 1)}</td><td>${pc(x.podium)}</td><td>${pc(x.top5p)}</td><td>${pc(x.top10p)}</td></tr>`).join('')}</tbody></table></div></details>`
    : '<p class="muted">Standings not available right now.</p>'}</section>`;
}

// sport: 'golf' | 'motorsport'; only: a tour or series id (league page).
export function fieldView(S, sport, { legButton, notice, only = null } = {}) {
  const d = fieldsData();
  const golf = sport === 'golf';
  const title = golf ? 'GOLF' : 'MOTOR RACING';
  const after = () => { loadFields().then((x) => { if (x && !d) S.refresh?.(); }); };
  if (!d) return { mode: 'race', accent: golf ? '#5cd68b' : '#ffb347', title: golf ? 'Golf' : 'Motor racing', after,
    html: `<section class="hero"><p class="kicker reveal">${golf ? 'PGA · LPGA · DP WORLD · CHAMPIONS' : 'NASCAR · INDYCAR · MOTOGP'}</p><h1>${split(title)}</h1><p class="lede reveal">Loading…</p></section>` };
  const list = golf ? d.golf.filter((t) => !only || t.tour === only) : d.racing.filter((r) => !only || r.series === only);
  return {
    mode: 'race', accent: golf ? '#5cd68b' : '#ffb347', title: golf ? 'Golf' : 'Motor racing', after,
    html: `<section class="hero"><p class="kicker reveal">${golf ? '⛳ PGA · LPGA · DP WORLD · CHAMPIONS' : '🏁 NASCAR · INDYCAR · MOTOGP'} · ATLAS MODEL · NO BOOKMAKER PRICE</p><h1>${split(title)}</h1>
      <p class="lede reveal">${golf ? 'This week\'s tournaments: the leaderboard and each player\'s chance to win, finish top 5, top 10 or top 20.' : 'The next race in each series and each driver\'s or rider\'s chance to win, finish on the podium or in the top 10.'}</p></section>
      ${notice ? notice() : ''}
      ${list.length ? list.map((x) => (golf ? golfSection(x, legButton) : raceSection(x, legButton))).join('') : '<section class="panel reveal"><p class="muted">Nothing scheduled right now.</p></section>'}
      <p class="note reveal">${golf ? `How the golf model works: each player's strength is how many strokes per round he has beaten the field by this week and in the tour's previous four events, pulled toward the field when there are few rounds. The rest of the tournament is simulated from each player's current score with a spread of about 2.9 strokes per round; ties for the lead are settled as a playoff. Before round 1 the chances come from form alone.` : 'How the racing model works: a strength per driver from the season so far (points, wins, top 5s and top 10s per start), then thousands of simulated finishing orders.'} Data: ESPN. Updated ${when(d.updatedAt)}.</p>`,
  };
}
