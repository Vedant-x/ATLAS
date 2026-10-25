// Picks: Best bets (the likeliest winners at a fair price or better), Value bets (prices above the
// sharp market's fair odds) and 2x / 3x slips, one menu entry with these pages as its tabs.
import { todayEvents } from './engine.js';
import { pc } from './charts.js';
import { split } from './ui.js';
import { prefs } from './prefs.js';
import { trackStats, trackCalibration, recordLine, ensureTrack, slipHistory, officialSlip } from './trackview.js';
import { slipPolicy, bestBets, valueBets, MULTI_TARGETS } from './track.js';
import { orderBets, orderChips, orderLabel, researchPrefs, windowChips } from './research.js';
import { ico } from './icons.js';
import { fmt, zone } from './tz.js';
import { views, esc, sportOf, notice, istTag, legIndex, prefsBar, prefFilter, miniPick, valuePick, stakeGap } from './views.js';

let S;
export function bindPicks(state) { S = state; }

// How much an option repeats an earlier one: the most legs it shares with any option above it.
function overlapNote(s, i, all = []) {
  const ids = (x) => new Set(x.legs.map((l) => `${l.eventId}|${l.pick}`));
  const mine = ids(s);
  let best = null;
  all.slice(0, i).forEach((o, j) => { const n = [...ids(o)].filter((k) => mine.has(k)).length; if (n && (!best || n > best.n)) best = { n, j }; });
  return best ? `<span class="overlap">Shares ${best.n} of ${s.legs.length} legs with #${String(best.j + 1).padStart(2, '0')}</span>` : (i ? '<span class="overlap fresh">No legs shared with the options above</span>' : '');
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
      <div><small>Chance</small><b>${pc(s.p, s.p < 0.01 ? 2 : 1)}</b></div>
      <div><small>Break-even</small><b>${pc(1 / s.odds, s.odds >= 100 ? 2 : 1)}</b></div>
      <div data-tip="Estimated return per unit staked"><small>Return</small><b class="${edge >= 0 ? 'pos' : 'neg'}">${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(1)}%</b></div>
      <div><small>Sports</small><b class="sc-sp" data-tip="${esc(sports.map((x) => sportOf(x).name).join(', '))}">${sports.slice(0, 3).map((x) => sportOf(x).icon).join('')}${sports.length > 3 ? `<small>+${sports.length - 3}</small>` : ''}</b></div>
    </div>
    <div class="sc-strip" role="img" aria-label="${s.legs.length} legs by chance">${legs.map((l) => `<i class="${chanceTone(l.p)}" data-tip="${esc(`${l.pick} · ${pc(l.p, 0)} · ${l.odds.toFixed(2)}`)}"></i>`).join('')}</div>
    <p class="sc-line">${times.length ? `<span>${esc(hourMin(times[0]))}${times.length > 1 && times.at(-1) - times[0] > 36e5 ? ` → ${esc(hourMin(times.at(-1)))}` : ''}</span>` : ''}${weakest ? `<span>Weakest: <b>${esc(weakest.pick)}</b> ${pc(weakest.p, 0)}</span>` : ''}</p>
    ${overlapNote(s, i, all)}
    <details class="sc-legs"${open ? ' open' : ''}><summary><span>${s.legs.length} legs</span><span class="sr-only"> of slip ${target}x #${i + 1} at ${s.odds.toFixed(2)}</span><i aria-hidden="true"></i></summary>
      <ul>${legs.map((l) => `<li><span class="sp">${sportOf(l.sport).icon}</span><div><b>${esc(l.pick)}</b><small>${esc(l.market)} · ${esc(l.match)}</small>${istTag(startOf(l))}</div><em>${l.odds.toFixed(2)}</em><i class="${chanceTone(l.p)}">${pc(l.p, 0)}</i></li>`).join('')}</ul>
    </details>
    <footer>
      <p class="slip-note">${edge >= 0 ? 'Priced above its estimated chance' : 'Priced below its estimated chance'} · legs treated as independent${s.search?.wider ? ` · <b>wider search</b>: nothing fit the strict rules, so legs rated ${Math.round(s.search.minP * 100)}%+ at up to ${s.search.maxLegOdds.toFixed(2)}, total within ${Math.round(s.search.tolerance * 100)}% of ${target}x` : ''}</p>
      <button class="btn-ghost" data-addall="${esc(keys.join('~'))}" data-cursor="ADD ALL">Add all to slip</button>
    </footer></article>`;
}

// Picks: one menu entry, these pages as its tabs.
const builderNav = (on) => `<nav class="builder-nav reveal" aria-label="Picks">${[['picks', '#/picks', 'Best bets'], ['value', '#/value', 'Value bets'], ['x', '#/x/2', 'Slips']].map(([k, h, l]) => `<a class="chip ${k === on ? 'on' : ''}" href="${h}"${k === on ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;

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
  return `<div class="panel official reveal"><h3 class="ph">${started ? 'In progress' : 'Today\'s official'} ${target}x slip <small>saved to the ${target}x track record · ${o.legs.length} legs · ${Number(o.odds).toFixed(2)}x · chance ${pc(o.shown ?? o.p, o.p < 0.01 ? 2 : 1)} · break-even ${pc(1 / o.odds, 1)}</small></h3>${slipHistory([o])}</div>`;
}
// The builder's own record beside it, with its sample size: a singles hit rate never stands in for it.
function recordSummary(target, r) {
  const n = (r?.won || 0) + (r?.lost || 0);
  return `<p class="rec-line reveal">${target}x record: ${n ? `${recordLine(r)} · ${n} settled slip${n === 1 ? '' : 's'}${n < 50 ? ' (a small sample: no conclusion yet)' : ''}` : 'no settled slips yet'} · each slip needs ${pc(1 / target, 1)} to break even</p>`;
}
// The retired longer slips, with their final record (from the Results data).
function retiredNote() {
  const r = (trackStats()?.retired || []).filter((x) => /slips/i.test(x.name));
  const won = r.reduce((a, x) => a + x.won, 0), n = r.reduce((a, x) => a + x.won + x.lost, 0);
  return n ? `<p class="muted reveal">Longer slips (4x to 1000x) were retired after winning ${won} of ${n}: <a href="#/track">their record</a>.</p>` : '';
}
// Fewer options than asked for: say why, never pad the list.
const fewNote = (list, target, want = 5) => (list.length && list.length < want ? `<p class="muted reveal">Only ${list.length} slip${list.length === 1 ? '' : 's'} meet${list.length === 1 ? 's' : ''} the rules right now (legs ATLAS rates likely enough, your minimum odds per leg, no two legs sharing a team, matches ${windowLabel(target).toLowerCase().replace('next', 'in the next')}). ATLAS doesn't add weaker slips to fill the page.</p>` : '');
// Why no slip could be built: name the rule that blocked it instead of quietly loosening it.
function emptySlips(target) {
  const mo = prefs.get().minOdds;
  return `<p class="muted">No slip reaches about ${target}x within the rules, even with the wider search (legs rated 35%+ after the track-record check, total within 20% of the target): minimum odds ${mo.toFixed(2)} per leg${prefs.get().sports?.length ? ', your selected sports only' : ''}, no two legs sharing a team, matches ${windowLabel(target).toLowerCase().replace('next', 'in the next')}. ${mo > 1.2 ? 'Lowering your minimum odds or ' : ''}A smaller target will usually work.</p>`;
}

export const picksViews = {
  // Best bets: the likeliest winners at a fair price or better (track.js bestBets), the full list.
  picks() {
    const ev = prefFilter(S.events), minOdds = prefs.get().minOdds || 1, hrs = researchPrefs().shortHours;
    ensureTrack(() => S.refresh?.());
    const list = orderBets(bestBets(todayEvents(ev, Date.now(), hrs), { cal: trackCalibration(), limit: 2000 }).filter((b) => b.odds >= minOdds).slice(0, 40));
    const rec = recordLine(trackStats()?.best);
    return {
      mode: 'bankers', accent: '#00ffc3', title: 'Best bets',
      html: `<section class="hero small"><p class="kicker reveal">NEXT ${hrs} HOURS · LIKELIEST AT A FAIR PRICE</p><h1>${split('BEST BETS')}</h1>${builderNav('picks')}</section>
        ${notice()}
        <details class="sl-filters reveal"><summary>${ico('filter')} Next ${hrs}h · ${esc(orderLabel())}${minOdds > 1 ? ` · odds ${minOdds.toFixed(2)}+` : ''}</summary>${windowChips('shours', hrs)}${orderChips()}${prefsBar()}</details>
        ${rec ? `<p class="rec-line reveal">So far: ${rec} · <a href="#/track">every result</a></p>` : ''}
        <div class="minilist">${list.map((b) => miniPick(b)).join('') || `<p class="muted">Nothing in the next ${hrs} hours is both likely enough and priced at the market's fair odds or better.${hrs < 48 ? ' A longer window may find some.' : ''}</p>`}</div>`,
    };
  },

  // Value bets: prices above the sharp market's fair odds (track.js valueBets), the full list.
  value() {
    ensureTrack(() => S.refresh?.());
    const list = valueBets(todayEvents(prefFilter(S.events), Date.now(), 48), { cal: trackCalibration(), limit: 40 });
    const rec = recordLine(trackStats()?.edge);
    return {
      mode: 'bankers', accent: '#3dff9a', title: 'Value bets',
      html: `<section class="hero small"><p class="kicker reveal">NEXT 48 HOURS · PRICED ABOVE THE SHARP MARKET</p><h1>${split('VALUE BETS')}</h1>${builderNav('value')}
        <p class="lede reveal">A bookmaker paying more than the market's fair odds (Pinnacle's, with its cut taken out). Stake's price first where it clears them, at long prices too (the bar rises with the odds). Good at the price shown, or at any bookmaker from the "take" price up.</p></section>
        ${notice()}
        ${rec ? `<p class="rec-line reveal">So far: ${rec} · <a href="#/track">every result</a></p>` : ''}
        <div class="minilist">${list.map(valuePick).join('') || `<p class="muted">No price beats the sharp market in the next 48 hours right now. They come and go as bookmakers move; this list updates with every price check.</p>${stakeGap(prefFilter(S.events))}`}</div>`,
    };
  },

  // 2x and 3x slips (longer ones were retired: see their record on the Results page).
  x([n]) {
    const target = Math.round(Number(n) * 100) / 100;
    if (!MULTI_TARGETS.includes(target)) return views.notfound();
    const list = S.slips(target, { count: 5 });
    ensureTrack(() => S.refresh?.());
    const r = trackStats()?.byTarget?.find((t) => t.target === target);
    return {
      mode: 'x', accent: target === 2 ? '#d2ff00' : '#00ffc3', title: `${target}x slips`,
      html: `<section class="hero small"><p class="kicker reveal">SLIPS · BREAK-EVEN ${pc(1 / target, 1)} · ${windowLabel(target)}</p><h1>${split(`${target}X SLIPS`)}</h1>${builderNav('x')}
        <nav class="tabs reveal">${MULTI_TARGETS.map((x) => `<a href="#/x/${x}" class="${x === target ? 'on' : ''}">${x}x</a>`).join('')}</nav></section>
        ${notice()}${recordSummary(target, r)}${orderChips()}
        ${officialBlock(target)}
        <h2 class="sec reveal">Available now</h2>
        <section class="grid slips">${list.map((s, i, arr) => slipCard(s, i, target, arr)).join('') || emptySlips(target)}</section>${fewNote(list, target)}
        ${recordBlock(`Settled ${target}x slips`, r)}
        ${retiredNote()}`,
    };
  },
};
