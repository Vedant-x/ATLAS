// Picks: Best current (live and starting soon), the Shortlist, Best bets (the likeliest winners at a
// fair price or better), Value bets (prices above the sharp market's fair odds) and slips from 2x to
// 1000x, one menu entry with these pages as its tabs.
import { todayEvents } from './engine.js';
import { pc, odd } from './charts.js';
import { split } from './ui.js';
import { prefs } from './prefs.js';
import { trackStats, trackCalibration, recordLine, ensureTrack, slipHistory, officialSlip } from './trackview.js';
import { slipPolicy, bestBets, valueBets, shortlist, MULTI_TARGETS } from './track.js';
import { liveBets } from './inplay.js';
import { orderBets, orderChips, orderLabel, researchPrefs, windowChips } from './research.js';
import { ico } from './icons.js';
import { fmt, zone } from './tz.js';
import { views, esc, sportOf, notice, istTag, legIndex, prefsBar, prefFilter, miniPick, valuePick, stakeGap, nearBestHtml, nearValueHtml, exclusionLine } from './views.js';

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
      <div data-tip="The market's chance, legs taken as independent"><small>Chance</small><b>${pc(s.p, s.p < 0.01 ? 2 : 1)}</b></div>
      <div><small>Break-even</small><b>${pc(1 / s.odds, s.odds >= 100 ? 2 : 1)}</b></div>
      <div data-tip="Return per unit staked by the market's chance: below zero, the bookmakers' cut on every leg"><small>Return</small><b class="${edge >= 0 ? 'pos' : 'neg'}">${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(1)}%</b></div>
      <div><small>Sports</small><b class="sc-sp" data-tip="${esc(sports.map((x) => sportOf(x).name).join(', '))}">${sports.slice(0, 3).map((x) => sportOf(x).icon).join('')}${sports.length > 3 ? `<small>+${sports.length - 3}</small>` : ''}</b></div>
    </div>
    <div class="sc-strip" role="img" aria-label="${s.legs.length} legs by chance">${legs.map((l) => `<i class="${chanceTone(l.p)}" data-tip="${esc(`${l.pick} · ${pc(l.p, 0)} · ${l.odds.toFixed(2)}`)}"></i>`).join('')}</div>
    <p class="sc-line">${times.length ? `<span>${esc(hourMin(times[0]))}${times.length > 1 && times.at(-1) - times[0] > 36e5 ? ` → ${esc(hourMin(times.at(-1)))}` : ''}</span>` : ''}${weakest ? `<span>Weakest: <b>${esc(weakest.pick)}</b> ${pc(weakest.p, 0)}</span>` : ''}</p>
    ${overlapNote(s, i, all)}
    <details class="sc-legs"${open ? ' open' : ''}><summary><span>${s.legs.length} legs</span><span class="sr-only"> of slip ${target}x #${i + 1} at ${s.odds.toFixed(2)}</span><i aria-hidden="true"></i></summary>
      <ul>${legs.map((l) => `<li><span class="sp">${sportOf(l.sport).icon}</span><div><b>${esc(l.pick)}</b><small>${esc(l.market)} · ${esc(l.match)}</small>${istTag(startOf(l))}</div><em>${l.odds.toFixed(2)}</em><i class="${chanceTone(l.p)}">${pc(l.p, 0)}</i></li>`).join('')}</ul>
    </details>
    <footer>
      <p class="slip-note">${edge >= 0 ? 'Priced above the market\'s chance' : 'Priced below the market\'s chance (each leg pays the bookmaker\'s cut)'} · legs treated as independent${s.search?.wider ? ` · <b>wider search</b>: nothing fit the strict rules, so legs rated ${Math.round(s.search.minP * 100)}%+ at up to ${s.search.maxLegOdds.toFixed(2)}, total within ${Math.round(s.search.tolerance * 100)}% of ${target}x` : ''}</p>
      <button class="btn-ghost" data-addall="${esc(keys.join('~'))}" data-cursor="ADD ALL">Add all to slip</button>
    </footer></article>`;
}

// Picks: one menu entry, these pages as its tabs.
const builderNav = (on) => `<nav class="builder-nav reveal" aria-label="Picks">${[['current', '#/current', 'Best current'], ['shortlist', '#/shortlist', 'Shortlist'], ['picks', '#/picks', 'Best bets'], ['value', '#/value', 'Value bets'], ['x', '#/x/2', 'Slips']].map(([k, h, l]) => `<a class="chip ${k === on ? 'on' : ''}" href="${h}"${k === on ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;

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
// Slips made under the earlier rules, with their final record (from the Results data).
function earlierNote() {
  const r = (trackStats()?.retired || []).filter((x) => /slips/i.test(x.name));
  const won = r.reduce((a, x) => a + x.won, 0), n = r.reduce((a, x) => a + x.won + x.lost, 0);
  return n ? `<p class="muted reveal">Slips under the earlier rules (ATLAS's own chance, any price) won ${won} of ${n}: <a href="#/track">their record</a>. These records start again from 5 Nov.</p>` : '';
}
// Fewer options than asked for: say why, never pad the list.
const fewNote = (list, target, want = 5) => (list.length && list.length < want ? `<p class="muted reveal">Only ${list.length} slip${list.length === 1 ? '' : 's'} meet${list.length === 1 ? 's' : ''} the rules right now (legs ATLAS rates likely enough, your minimum odds per leg, no two legs sharing a team, matches ${windowLabel(target).toLowerCase().replace('next', 'in the next')}). ATLAS doesn't add weaker slips to fill the page.</p>` : '');
// Why no slip could be built: name the rule that blocked it instead of quietly loosening it.
function emptySlips(target) {
  const mo = prefs.get().minOdds;
  return `<p class="muted">No slip reaches about ${target}x within the rules, even with the wider search (legs rated 35%+ after the track-record check, total within 20% of the target): minimum odds ${mo.toFixed(2)} per leg${prefs.get().sports?.length ? ', your selected sports only' : ''}, no two legs sharing a team, matches ${windowLabel(target).toLowerCase().replace('next', 'in the next')}. ${mo > 1.2 ? 'Lowering your minimum odds or ' : ''}A smaller target will usually work.</p>`;
}

// ---------- Best current, the Shortlist and the multipliers row (home panels and pages) ----------
// A live pick: the in-play chance (inplay.js, from the score, the clock and the pre-match market) and
// its fair odds. No live price is read, so the take-it rule is the visitor's: Stake's live price above
// the fair odds.
const livePick = (b) => `<div class="mini live-pick reveal" data-tip="${esc(`${b.market} · ${b.event.league}\nLive chance from the score (${b.score}), the time left and the pre-match market's chance\nFair odds ${odd(b.fairOdds)}: a live price above them is worth it; below them is the bookmaker's cut\nNot saved to the record: no price was taken`)}">
  <span class="mini-ico">${sportOf(b.event.sport).icon}</span>
  <a class="mini-main" href="#/match/${esc(b.event.id)}"><b>${esc(b.pick)}</b><small>${esc(b.event.home)} <b>${esc(b.score || '')}</b> ${esc(b.event.away)} · <span class="live">LIVE</span> ${esc(b.clock)}</small></a>
  <div class="mini-nums"><b data-tip="Live chance">${pc(b.p, 0)}</b><small><span class="mm-need">fair ${odd(b.fairOdds)} · </span><span class="pos">take ${odd(b.fairOdds)}+</span></small></div></div>`;
const SOON_HOURS = 3;
// Best current: the likeliest results in play now, then the shortlist's picks starting within 3 hours
// (their prices are the freshest the board has).
export function currentLists(pool) {
  const live = liveBets(pool.filter((e) => e.live), { limit: 20 });
  const soon = shortlist(todayEvents(pool, Date.now(), SOON_HOURS), { cal: trackCalibration(), limit: 20 });
  return { live, soon };
}
export function currentPanel(pool) {
  const { live, soon } = currentLists(pool);
  const rows = [...live.slice(0, 5).map(livePick), ...soon.slice(0, Math.max(3, 8 - Math.min(5, live.length))).map((b) => miniPick(b))];
  return `<div class="panel dash-current reveal"><h2 class="ph">Best current <small>live now and starting within ${SOON_HOURS} hours · <a href="#/current">all</a></small></h2>
    <div class="minilist">${S.loading ? '' : rows.join('') || `<p class="muted">Nothing in play with a clear favourite, and nothing on the shortlist starting within ${SOON_HOURS} hours.</p>`}</div></div>`;
}
export function shortlistPanel(pool) {
  const hrs = researchPrefs().shortHours, minOdds = prefs.get().minOdds || 1;
  const list = orderBets(shortlist(todayEvents(pool, Date.now(), hrs), { cal: trackCalibration(), limit: 40 }).filter((b) => b.odds >= minOdds)).slice(0, 10);
  const rec = recordLine(trackStats()?.short);
  return `<div class="panel dash-bankers reveal"><h2 class="ph">Shortlist <small>likeliest winners at odds 1.30 to 2.20 · next ${hrs}h · <a href="#/shortlist">all</a></small></h2>
    ${rec ? `<p class="rec-line">So far: ${rec} · <a href="#/track">record</a></p>` : ''}
    <div class="minilist">${S.loading ? '' : list.map((b) => miniPick(b)).join('') || `<p class="muted">No match in the next ${hrs} hours has a price close enough to fair.</p>`}</div></div>`;
}
// One card per multiplier: the top slip's total odds, legs and the market's chance.
export function multiPanel() {
  const cards = MULTI_TARGETS.map((t) => { const s = S.slips(t, { count: 1 })[0]; return `<a class="mult-card" href="#/x/${t}"><b>${t}x</b>${s ? `<span>${s.odds.toFixed(2)} · ${s.legs.length} legs</span><small>chance ${pc(s.p, s.p < 0.01 ? 2 : 1)}</small>` : '<small>no slip now</small>'}</a>`; }).join('');
  return `<div class="panel dash-multi reveal"><h2 class="ph">Multipliers <small>2x to 1000x · one leg per match · <a href="#/x/2">all slips</a></small></h2><div class="mult-row">${S.loading ? '' : cards}</div>
    <p class="note">Each leg pays the bookmaker's cut again, so the longer the slip, the further its market return falls below zero.</p></div>`;
}

export const picksViews = {
  // Best current: live picks with their fair odds, and the shortlist starting soon.
  current() {
    const pool = prefFilter(S.events);
    ensureTrack(() => S.refresh?.());
    const { live, soon } = currentLists(pool);
    return {
      mode: 'bankers', accent: '#ff3d6e', title: 'Best current',
      html: `<section class="hero small"><p class="kicker reveal">LIVE NOW · STARTING WITHIN ${SOON_HOURS} HOURS</p><h1>${split('BEST CURRENT')}</h1>${builderNav('current')}
        <p class="lede reveal">In play: each match's likeliest result from the score, the time left and the pre-match market's chance, with its fair odds. Take it only where Stake's live price is above them. Starting soon: the shortlist's picks with the freshest prices.</p></section>
        ${notice()}
        <h2 class="sec reveal">Live now <small>${live.length}</small></h2>
        <div class="minilist">${live.map(livePick).join('') || '<p class="muted">No match in play has a result 60% to 97% likely right now (football, basketball, ice hockey and American football are read).</p>'}</div>
        <h2 class="sec reveal">Starting within ${SOON_HOURS} hours <small>${soon.length}</small></h2>
        <div class="minilist">${soon.map((b) => miniPick(b)).join('') || `<p class="muted">Nothing on the shortlist starts within ${SOON_HOURS} hours.</p>`}</div>`,
    };
  },

  // The Shortlist: the likeliest winners at odds 1.30 to 2.20, priced within 3% of fair (track.js shortlist).
  shortlist() {
    const ev = prefFilter(S.events), minOdds = prefs.get().minOdds || 1, hrs = researchPrefs().shortHours;
    ensureTrack(() => S.refresh?.());
    const list = orderBets(shortlist(todayEvents(ev, Date.now(), hrs), { cal: trackCalibration(), limit: 60 }).filter((b) => b.odds >= minOdds));
    const rec = recordLine(trackStats()?.short);
    return {
      mode: 'bankers', accent: '#00ffc3', title: 'Shortlist',
      html: `<section class="hero small"><p class="kicker reveal">NEXT ${hrs} HOURS · ODDS 1.30 TO 2.20</p><h1>${split('SHORTLIST')}</h1>${builderNav('shortlist')}
        <p class="lede reveal">The likeliest winners on the board, one per match, by the market's own chance (its cut taken out). No price more than 3% under fair (5% where only one bookmaker prices the match), Stake's price first. Most sit a little under fair: a "+" means the price beats it.</p></section>
        ${notice()}
        <details class="sl-filters reveal"><summary>${ico('filter')} Next ${hrs}h · ${esc(orderLabel())}${minOdds > 1 ? ` · odds ${minOdds.toFixed(2)}+` : ''}</summary>${windowChips('shours', hrs)}${orderChips()}${prefsBar()}</details>
        ${rec ? `<p class="rec-line reveal">So far: ${rec} · <a href="#/track">every result</a></p>` : ''}
        <div class="minilist">${list.map((b) => miniPick(b)).join('') || `<p class="muted">No match in the next ${hrs} hours has a price close enough to fair.</p>`}</div>`,
    };
  },

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
        <div class="minilist">${list.map((b) => miniPick(b)).join('') || `<p class="muted">No qualifying bets in the next ${hrs} hours with your filters.${exclusionLine(todayEvents(ev, Date.now(), hrs))}</p>${nearBestHtml(ev, hrs)}`}</div>`,
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
        <div class="minilist">${list.map(valuePick).join('') || `<p class="muted">No price beats the sharp market in the next 48 hours right now. They come and go as bookmakers move; this list updates with every price check.</p>${stakeGap(prefFilter(S.events))}${nearValueHtml(prefFilter(S.events))}`}</div>`,
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
      html: `<section class="hero small"><p class="kicker reveal">SLIPS · BREAK-EVEN ${pc(1 / target, 1)} · ${windowLabel(target)}</p><h1>${split(`${target}X SLIPS`)}</h1>${builderNav('x')}
        <nav class="tabs reveal">${MULTI_TARGETS.map((x) => `<a href="#/x/${x}" class="${x === target ? 'on' : ''}">${x}x</a>`).join('')}</nav></section>
        ${notice()}${recordSummary(target, r)}${orderChips()}
        ${officialBlock(target)}
        <h2 class="sec reveal">Available now</h2>
        <section class="grid slips">${list.map((s, i, arr) => slipCard(s, i, target, arr)).join('') || emptySlips(target)}</section>${fewNote(list, target)}
        ${recordBlock(`Settled ${target}x slips`, r)}
        ${earlierNote()}`,
    };
  },
};
