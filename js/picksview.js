// Picks: Best bets (the likeliest winners at or near a fair price, the shortlist folded in), and the
// Multipliers pages (slips from 2x to 1000x), each its own menu entry.
import { todayEvents } from './engine.js';
import { pc, odd } from './charts.js';
import { split } from './ui.js';
import { prefs } from './prefs.js';
import { trackStats, trackCalibration, recordLine, ensureTrack, slipHistory, officialSlip } from './trackview.js';
import { slipPolicy, bestBoard, likeliest, MULTI_TARGETS } from './track.js';
import { liveBets } from './inplay.js';
import { orderBets, orderChips, researchPrefs } from './research.js';
import { fmt, zone } from './tz.js';
import { views, esc, sportOf, notice, istTag, legIndex, prefFilter, miniPick, nearBestHtml, exclusionLine, bestFilters } from './views.js';

let S;
export function bindPicks(state) { S = state; }

// How much an option repeats an earlier one: the most legs it shares with any option above it.
function overlapNote(s, i, all = []) {
  const ids = (x) => new Set(x.legs.map((l) => `${l.eventId}|${l.pick}`));
  const mine = ids(s);
  let best = null;
  all.slice(0, i).forEach((o, j) => { const n = [...ids(o)].filter((k) => mine.has(k)).length; if (n && (!best || n > best.n)) best = { n, j }; });
  return best ? `<span class="overlap">Shares ${best.n} of ${s.legs.length} legs with #${String(best.j + 1).padStart(2, '0')}</span>` : '';
}
// One slip as a compact card: the multiplier, chance and edge up top, a strip with one segment per leg
// (coloured by its chance, hover or long-press for the pick), the weakest leg, and the full legs
// behind "Show legs". Short slips (4 legs or fewer, below 10x) open by default.
const chanceTone = (p) => (p >= 0.8 ? 'c5' : p >= 0.72 ? 'c4' : p >= 0.65 ? 'c3' : p >= 0.58 ? 'c2' : 'c1');
const hourMin = (t) => (Number.isFinite(t) ? fmt(t, zone(), 'short') : '');
function slipCard(s, i, target, all) {
  const startOf = (l) => l.start ?? S.events.find((x) => x.id === l.eventId)?.start;
  const keys = s.legs.map((l) => {
    const leg = { key: `${l.eventId}|${l.market}|${l.pick}`, eventId: l.eventId, sport: l.sport, match: l.match, market: l.market, pick: l.pick, odds: l.odds, p: l.p, ...(l.prop ? { prop: l.prop } : {}) };
    legIndex.set(leg.key, leg);
    return leg.key;
  });
  const legs = orderBets(s.legs, undefined, startOf);
  const edge = s.p * s.odds - 1;
  const weakest = s.legs.reduce((w, l) => (!w || l.p < w.p ? l : w), null);
  const times = s.legs.map(startOf).filter(Number.isFinite).sort((a, b) => a - b);
  const sports = [...new Set(s.legs.map((l) => l.sport))];
  const open = s.legs.length <= 4 && target < 10;
  return `<article class="slipc slipc2 tilt reveal">
    <header><span class="tag">#${String(i + 1).padStart(2, '0')}</span><span class="mult">${s.odds.toFixed(2)}<small>x</small></span></header>
    <div class="sc-stats">
      <div data-tip="${esc(`The market's chance, legs taken as independent. Break-even ${pc(1 / s.odds, s.odds >= 100 ? 2 : 1)}; return ${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(1)}% by the market's chance`)}"><small>Chance</small><b>${pc(s.p, s.p < 0.01 ? 2 : 1)}</b></div>
      <div><small>Sports</small><b class="sc-sp" data-tip="${esc(sports.map((x) => sportOf(x).name).join(', '))}">${sports.slice(0, 3).map((x) => sportOf(x).icon).join('')}${sports.length > 3 ? `<small>+${sports.length - 3}</small>` : ''}</b></div>
    </div>
    <div class="sc-strip" role="img" aria-label="${s.legs.length} legs by chance">${legs.map((l) => `<i class="${chanceTone(l.p)}" data-tip="${esc(`${l.pick} · ${pc(l.p, 0)} · ${l.odds.toFixed(2)}`)}"></i>`).join('')}</div>
    <p class="sc-line">${times.length ? `<span>${esc(hourMin(times[0]))}${times.length > 1 && times.at(-1) - times[0] > 36e5 ? ` → ${esc(hourMin(times.at(-1)))}` : ''}</span>` : ''}${weakest ? `<span>Weakest: <b>${esc(weakest.pick)}</b> ${pc(weakest.p, 0)}</span>` : ''}</p>
    ${overlapNote(s, i, all)}
    <details class="sc-legs"${open ? ' open' : ''}><summary><span>${s.legs.length} legs</span><span class="sr-only"> of slip ${target}x #${i + 1} at ${s.odds.toFixed(2)}</span><i aria-hidden="true"></i></summary>
      <ul>${legs.map((l) => `<li><span class="sp">${sportOf(l.sport).icon}</span><div><b>${esc(l.pick)}</b><small>${esc(l.market)} · ${esc(l.match)}</small>${istTag(startOf(l))}</div><em>${l.odds.toFixed(2)}</em><i class="${chanceTone(l.p)}">${pc(l.p, 0)}</i></li>`).join('')}</ul>
    </details>
    <footer>
      ${s.search?.wider ? `<p class="slip-note" data-tip="Nothing fit the strict rules, so legs rated ${Math.round(s.search.minP * 100)}%+ at up to ${s.search.maxLegOdds.toFixed(2)}, total within ${Math.round(s.search.tolerance * 100)}% of ${target}x">Wider search</p>` : ''}
      <button class="btn-ghost" data-addall="${esc(keys.join('~'))}" data-cursor="ADD ALL">Add all to slip</button>
    </footer></article>`;
}

// Today's official slip for a tracked target, exactly as saved to the record (legs, odds, chance).
// Where a builder's legs come from, for the page kicker (track.js slipPolicy).
const windowLabel = (target) => (slipPolicy(target).hours >= 48 ? `NEXT ${Math.round(slipPolicy(target).hours / 24)} DAYS` : `NEXT ${slipPolicy(target).hours} HOURS`);
// A builder's own record, shown after its bets: the summary line plus every graded official slip.
function recordBlock(title, r) {
  if (!r?.slips?.length) return '';
  return `<h2 class="sec reveal">${title}${r.won + r.lost ? ` <small>${recordLine(r)}</small>` : ''}</h2><div class="panel reveal">${slipHistory(r.slips)}</div>`;
}
// Today's official slip while it can still be followed: not started yet, or in progress. A settled
// one moves to the history below (settled slips never sit above what is available now).
function officialBlock(target) {
  const o = officialSlip(target);
  if (!o || o.status !== 'pending') return '';
  const started = o.legs.some((l) => l.start <= Date.now());
  return `<div class="panel official reveal"><h3 class="ph">${started ? 'In progress' : 'Today\'s official'} ${target}x slip <small>${o.legs.length} legs · ${Number(o.odds).toFixed(2)}x · chance ${pc(o.shown ?? o.p, o.p < 0.01 ? 2 : 1)}</small></h3>${slipHistory([o])}</div>`;
}
// The builder's own record beside it, with its sample size: a singles hit rate never stands in for it.
function recordSummary(target, r) {
  const n = (r?.won || 0) + (r?.lost || 0);
  return n ? `<p class="rec-line reveal">Record: ${recordLine(r)}</p>` : '';
}
// Why no slip could be built: name the rule that blocked it instead of quietly loosening it.
function emptySlips(target) {
  const mo = prefs.get().minOdds;
  return `<p class="muted">No ${target}x slip right now. ${mo > 1.2 ? 'Try lower minimum odds or a smaller target.' : 'Try a smaller target.'}</p>`;
}

// ---------- Best bets (never empty) and the multipliers row ----------
// A live pick: the in-play chance (inplay.js, from the score, the clock and the pre-match market) and
// its fair odds. No live price is read, so the take-it rule is the visitor's: Stake's live price above
// the fair odds. Never recorded (no price was taken).
export const livePick = (b) => `<div class="mini live-pick reveal" data-tip="${esc(`${b.market} · ${b.event.league}\nLive chance from the score (${b.score}), the time left and the pre-match market's chance\nFair odds ${odd(b.fairOdds)}: a live price above them is worth it; below them is the bookmaker's cut\nNot saved to the record: no price was taken`)}">
  <span class="mini-ico">${sportOf(b.event.sport).icon}</span>
  <a class="mini-main" href="#/match/${esc(b.event.id)}"><b>${esc(b.pick)}</b><small>${esc(b.event.home)} <b>${esc(b.score || '')}</b> ${esc(b.event.away)} · <span class="live">LIVE</span> ${esc(b.clock)}</small></a>
  <div class="mini-nums"><b data-tip="Live chance">${pc(b.p, 0)}</b><small><span class="mm-need">fair ${odd(b.fairOdds)} · </span><span class="pos">take ${odd(b.fairOdds)}+</span></small></div></div>`;
// Best bets, never empty, within the filters the visitor chose:
//  - live: each live match's likeliest result (50% to 97%) with its fair odds (inplay.js);
//  - the board (track.js bestBoard: a fair price or better, then within 3% of fair) in the chosen
//    window;
//  - then, up to BEST_MIN, the likeliest results at any price in that window (track.js likeliest),
//    each card showing how far under fair its price is. Only the board's picks are recorded.
// The window is the visitor's: it is widened (12, 24, 48 hours) only when nothing in it has a price
// at all, and the note says so. Minimum odds and sports apply throughout.
const BEST_MIN = 12;
export function bestList(pool, hrs, minOdds = 1) {
  const now = Date.now(), cal = trackCalibration(), ok = (b) => b.odds >= minOdds;
  const live = liveBets(pool.filter((e) => e.live), { min: 0.5, limit: 20 }).filter((b) => b.fairOdds >= minOdds);
  let list = [], hours = hrs, filled = 0;
  for (hours of [hrs, ...[12, 24, 48].filter((h) => h > hrs)]) {
    const ev = todayEvents(pool, now, hours);
    list = bestBoard(ev, { cal, limit: 60 }).filter(ok);
    if (list.length < BEST_MIN) {
      const held = new Set(list.map((b) => b.event.id));
      const more = likeliest(ev, { limit: 60, now }).filter((b) => ok(b) && !held.has(b.event.id)).slice(0, BEST_MIN - list.length).map((b) => ({ ...b, anyPrice: true }));
      filled = more.length;
      list = [...list, ...more];
    } else filled = 0;
    if (list.length) break;
  }
  return { live, list, hours, filled };
}
// Under the list when it had to reach further: how far, and what the fill-ins are.
export const bestNote = ({ hours, filled }, hrs) => [hours > hrs ? `Nothing in the next ${hrs}h has a price yet, so the next ${hours}h are shown.` : '', filled ? `${filled} marked "any price" are the likeliest results whatever their price (not saved to the record): each is under fair by the % shown.` : ''].filter(Boolean).join(' ');

// ---------- The multipliers row (home panel) ----------
// One card per multiplier: today's official slip as the record saved it (total odds, legs, chance).
// Read from the record, not built here: building eight slips at load cost a phone too much time.
export function multiPanel() {
  ensureTrack(() => S.refresh?.());
  const cards = MULTI_TARGETS.map((t) => { const s = officialSlip(t); return `<a class="mult-card" href="#/x/${t}"><b>${t}x</b>${s ? `<span>${Number(s.odds).toFixed(2)} · ${s.legs.length} legs</span><small>chance ${pc(s.shown ?? s.p, (s.shown ?? s.p) < 0.01 ? 2 : 1)}</small>` : '<small>open to build</small>'}</a>`; }).join('');
  return `<div class="panel dash-multi reveal"><h2 class="ph">Multipliers</h2><div class="mult-row">${S.loading ? '' : cards}</div></div>`;
}

export const picksViews = {
  // Best bets: the likeliest winners at a fair price or better, the shortlist folded in (within 3% of
  // fair, odds 1.30 to 2.20), one per match (track.js bestBoard), the full list.
  picks() {
    const ev = prefFilter(S.events), minOdds = prefs.get().minOdds || 1, hrs = researchPrefs().shortHours;
    ensureTrack(() => S.refresh?.());
    const best = bestList(ev, hrs, minOdds), list = orderBets(best.list);
    return {
      mode: 'bankers', accent: '#00ffc3', title: 'Best bets',
      html: `<section class="hero small"><h1>${split('BEST BETS')}</h1></section>
        ${notice()}
        ${bestFilters(best, hrs, minOdds)}
        ${best.live.length ? `<h2 class="sec reveal">Live now <small>${best.live.length}</small></h2><div class="minilist">${best.live.map(livePick).join('')}</div>` : ''}
        <div class="minilist">${list.map((b) => miniPick(b)).join('') || `<p class="muted">No match on the board has a price right now.${exclusionLine(todayEvents(ev, Date.now(), hrs))}</p>${nearBestHtml(ev, hrs)}`}</div>
`,
    };
  },

  // Slips from 2x to 1000x, board legs (picks.js boardLeg), each target with its own record.
  x([n]) {
    const target = Math.round(Number(n) * 100) / 100;
    if (!MULTI_TARGETS.includes(target)) return views.notfound();
    const list = S.slips(target, { count: 5 });
    ensureTrack(() => S.refresh?.());
    const r = trackStats()?.byTarget?.find((t) => t.target === target);
    return {
      mode: 'x', accent: target === 2 ? '#d2ff00' : '#00ffc3', title: `${target}x slips`,
      html: `<section class="hero small"><p class="kicker reveal">MULTIPLIERS · BREAK-EVEN ${pc(1 / target, 1)} · ${windowLabel(target)}</p><h1>${split(`${target}X SLIPS`)}</h1>
        <nav class="tabs reveal">${MULTI_TARGETS.map((x) => `<a href="#/x/${x}" class="${x === target ? 'on' : ''}">${x}x</a>`).join('')}</nav></section>
        ${notice()}${recordSummary(target, r)}${orderChips()}
        ${officialBlock(target)}
        
        <section class="grid slips">${list.map((s, i, arr) => slipCard(s, i, target, arr)).join('') || emptySlips(target)}</section>
        ${recordBlock(`Settled ${target}x slips`, r)}
`,
    };
  },
};
