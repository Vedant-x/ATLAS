// Record page: every official ATLAS pick (locked before kick-off) and how it turned out.
import { esc, sportOf, ist } from './views.js';
import { summarize, MIN_ODDS, MAX_ODDS, calibration, marketChance, SAFE, BEST, potdDay, walkForward } from './track.js';
import { serviceStats } from './compare.js';
import { FINAL, independentlyConfirmed } from './settle.js';
import { localDay } from './engine.js';
import { modelRecord } from './modelpicks.js';

const pct = (x, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
const units = (x) => `${x > 0 ? '+' : ''}${x.toFixed(2)}u`;
const day = (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
let cache = null;

async function load() {
  if (!cache || Date.now() - cache.at > 5 * 6e4) {
    const res = await fetch(`data/track.json?t=${Math.floor(Date.now() / 6e4)}`);
    if (!res.ok) throw new Error('no track record yet');
    cache = { at: Date.now(), data: await res.json() };
  }
  return cache.data;
}

// For the rest of the site: summary and per-market calibration once the record has loaded. The record
// is re-fetched in the background every 5 minutes, so a page left open keeps up with new results.
export const trackStats = () => (cache ? summarize(cache.data.picks || []) : null);
export const trackCalibration = () => (cache ? calibration(cache.data.picks || []) : null);
// How the unpriced model picks have done per sport (modelpicks.js trusts a sport after 30 results).
export const trackModelRecord = () => (cache ? modelRecord(cache.data.picks || []) : {});
let reloading = false;
export function ensureTrack(refresh) {
  if (cache && Date.now() - cache.at < 5 * 6e4) return;
  if (reloading) return;
  reloading = true;
  const before = cache?.data.updatedAt;
  load().then((d) => { if (d.updatedAt !== before) refresh?.(); }).catch(() => {}).finally(() => { reloading = false; });
}
// Today's official (tracked) slip for a target, exactly as it was saved: or null if none yet.
export function officialSlip(target) {
  const day = localDay();
  return (cache?.data.picks || []).filter((h) => h.type === 'multi' && h.target === target && h.key.split('|')[1] === day).at(-1) || null;
}
// Today's parlay of the day for a time zone, exactly as the record saved it: or null if none yet.
export function officialParlay(zone) {
  const key = `multi|${potdDay(Date.now(), zone).key}|potd-${zone}`;
  return (cache?.data.picks || []).find((h) => h.key === key) || null;
}
// One line of record for a section: "41–16 · 72% hit rate · +4.9u".
// A multiplier's own slip history: each daily official slip with its legs and result.
export function slipHistory(slips = []) {
  return slips.length ? `<ul class="tr-list">${slips.map(pickRow).join('')}</ul>` : '';
}
export function recordLine(st) {
  if (!st || !(st.won + st.lost)) return '';
  return `${st.won}–${st.lost} · ${pct(st.hitRate, 0)} hit rate · <span class="${st.profit >= 0 ? 'pos' : 'neg'}">${units(st.profit)} (ROI ${st.roi == null ? '—' : `${st.roi >= 0 ? '+' : ''}${(st.roi * 100).toFixed(1)}%`})</span>`;
}

const ago = (t) => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const statCards = (s, updatedAt) => `${updatedAt ? `<p class="note reveal">Results updated ${ago(updatedAt)} · picks are graded about two hours after each match ends.</p>` : ''}<div class="tr-stats">
  <div><small>Settled picks</small><b>${s.won + s.lost}</b><span>${s.won} won · ${s.lost} lost${s.push ? ` · ${s.push} push` : ''}</span></div>
  <div><small>Hit rate</small><b>${pct(s.hitRate)}</b><span>ATLAS estimated ${pct(s.expected)}</span></div>
  <div><small>Profit, 1 unit per pick</small><b class="${s.profit >= 0 ? 'pos' : 'neg'}">${units(s.profit)}</b><span>ROI ${pct(s.roi)}</span></div>
  <div><small>Average odds</small><b>${s.avgOdds ? s.avgOdds.toFixed(2) : '—'}</b><span>range ${MIN_ODDS.toFixed(2)} to ${MAX_ODDS.toFixed(2)}</span></div>
  <div><small>Price vs closing line</small><b class="${s.clvN >= 10 ? (s.clv >= 0 ? 'pos' : 'neg') : ''}">${s.clvN >= 10 ? `${s.clv >= 0 ? '+' : ''}${(s.clv * 100).toFixed(1)}%` : '—'}</b><span>${s.clvN >= 10 ? `saved price beat the close on ${pct(s.beatClose, 0)} of ${s.clvN} picks` : 'closing prices are now saved for every pick; shown after 10 settle'}</span></div>
  <div><small>Forecast score (Brier)</small><b>${s.brier == null ? '—' : s.brier.toFixed(3)}</b><span>${s.brierN >= 20 ? `market alone ${s.brierMarket.toFixed(3)} on the same ${s.brierN} picks · lower is better` : 'lower is better · market comparison after 20 picks'}</span></div></div>`;

// Forecast score per row: Brier (lower is better) and, once 10+ picks have a saved market chance,
// whether ATLAS beat the market's own forecast on those picks.
const vsMarket = (r) => (r.brierN >= 10 ? `<span class="${r.brierModel <= r.brierMarket ? 'pos' : 'neg'}">${r.brierModel <= r.brierMarket ? 'beats' : 'trails'} market</span>` : '<span class="muted">—</span>');
const table = (rows, label) => (rows.length ? `<div class="table-wrap"><table class="tr-table"><thead><tr><th>${label}</th><th>Picks</th><th>Hit rate</th><th>Estimated</th><th>Profit</th><th title="Brier score: mean squared error of the chance shown. Lower is better.">Brier</th><th title="Same score for the bookmaker's margin-free chance on the same picks">vs market</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.won + r.lost}</td><td>${pct(r.hitRate)}</td><td>${pct(r.expected)}</td><td class="${r.profit >= 0 ? 'pos' : 'neg'}">${units(r.profit)}</td><td>${r.brier == null ? '—' : r.brier.toFixed(3)}</td><td>${vsMarket(r)}</td></tr>`).join('')}</tbody></table></div>` : '');

const pickRow = (h) => (h.type === 'multi' ? `<li class="tr-${h.status}"><span class="tr-badge">${h.status === 'pending' ? day(h.start) : h.status.toUpperCase()}</span>
  <div><b>${h.target === 'potd' ? 'Parlay of the day' : `${esc(h.target)}x slip`} · ${h.legs.length} legs</b><details class="tr-legs"><summary>${h.legs.map((l) => `<i class="leg-dot leg-${esc(l.status)}" title="${esc(`${l.pick}: ${l.status}`)}"></i>`).join('')}<span>legs</span><span class="sr-only"> ${esc(h.key)}</span></summary><ul>${h.legs.map((l) => `<li><i class="leg-dot leg-${esc(l.status)}"></i><b>${esc(l.pick)}</b><small>${esc(l.home)} v ${esc(l.away)} · ${esc(ist(l.start))}</small></li>`).join('')}</ul></details></div>
  <em>${Number(h.odds).toFixed(2)}</em><i>${pct(h.p, 0)}</i></li>` : `<li class="tr-${h.status}"><span class="tr-badge">${h.status === 'pending' ? day(h.start) : h.status.toUpperCase()}</span>
  <div><b>${esc(h.pick)}</b><small>${sportOf(h.sport).icon} ${esc(h.home)} v ${esc(h.away)} · ${esc(ist(h.start))} · ${esc(h.market)}${h.score ? ` · final ${esc(h.score)}` : ''} · ${h.type === 'value' ? 'value spot' : 'banker'}</small></div>
  <em>${Number(h.odds).toFixed(2)}</em><i>${pct(h.shown ?? h.p, 0)}</i></li>`);

// How far the shown chance trusts ATLAS's own estimate against the price, per sport and market, as
// learned from the settled picks (track.js calibration), with each one's accuracy (Brier score:
// lower is better) for ATLAS alone, the price alone and the blend shown.
// Hit rate by price band against what the price itself implies (its chance less a typical margin):
// the yardstick for a hit rate. 70% at 1.30 is above the price's ~74%? Below? This answers it.
function priceBandPanel(picks) {
  const singles = picks.filter((h) => h.type !== 'multi' && h.type !== 'model' && (h.status === 'won' || h.status === 'lost') && h.odds > 1);
  const bands = [[1.01, 1.25], [1.25, 1.35], [1.35, 1.45], [1.45, 1.6], [1.6, 1.8], [1.8, 10]];
  const rows = bands.map(([lo, hi]) => {
    const l = singles.filter((h) => h.odds >= lo && h.odds < hi);
    return { lo, hi, n: l.length, hit: l.length ? l.filter((h) => h.status === 'won').length / l.length : null, implied: l.length ? l.reduce((a, h) => a + marketChance(h.odds), 0) / l.length : null };
  }).filter((r) => r.n >= 5);
  if (!rows.length) return '';
  return `<div class="panel reveal"><h3 class="ph">Hit rate by price <small>against what the price itself implies</small></h3>
    <p class="muted">A price is a chance: 1.30 means the bookmaker expects about 74% (after its margin), 1.10 about 87%. A hit rate is only good or bad against that. Picks where ATLAS claims to beat the price have landed least often; the Surest list leaves them out.</p>
    <table class="tbl tight"><thead><tr><th>Odds</th><th class="num">Picks</th><th class="num">Hit rate</th><th class="num">Price implies</th><th class="num">Difference</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.lo.toFixed(2)}–${r.hi >= 10 ? '+' : r.hi.toFixed(2)}</td><td class="num">${r.n}</td><td class="num">${pct(r.hit, 0)}</td><td class="num">${pct(r.implied, 0)}</td><td class="num ${r.hit >= r.implied ? 'pos' : 'neg'}">${r.hit >= r.implied ? '+' : '−'}${Math.abs((r.hit - r.implied) * 100).toFixed(0)} pts</td></tr>`).join('')}</tbody></table></div>`;
}

// The plain answer to "does ATLAS beat the market?": its forecasts against the bookmaker's own
// margin-free chance on the same picks (Brier, lower is better), and profit at the prices taken.
// The fair test: forecasts scored on results the calibration had not seen (track.js walkForward), next
// to the market's own forecast, and the ROI with its 95% interval. Small samples say so.
function outOfSample(picks, all) {
  const w = walkForward(picks);
  const t = w?.total;
  const roi = all?.roiCI ? `ROI ${pct(all.roi)} (95% interval ${pct(all.roiCI[0])} to ${pct(all.roiCI[1])})` : '';
  if (!t) return roi ? `<div class="panel reveal"><h3 class="ph">Out-of-sample check</h3><p>${roi}. Not enough history yet for a week-by-week test.</p></div>` : '';
  const f = (x) => x.toFixed(4);
  const better = t.brier.shown < t.brier.market;
  const close = Math.abs(t.brier.shown - t.brier.market) < 0.002;
  return `<div class="panel reveal"><h3 class="ph">Out-of-sample check <small>fitted on earlier results only, scored on the next week · ${w.weeks.length} week${w.weeks.length === 1 ? '' : 's'} · ${t.n} forecasts</small></h3>
    <table class="tbl tight"><thead><tr><th></th><th class="num">Brier</th><th class="num">Log loss</th></tr></thead><tbody>
    <tr><td>ATLAS as shown (calibrated)</td><td class="num">${f(t.brier.shown)}</td><td class="num">${f(t.logLoss.shown)}</td></tr>
    <tr><td>ATLAS model alone</td><td class="num">${f(t.brier.raw)}</td><td class="num">${f(t.logLoss.raw)}</td></tr>
    <tr><td>Market price (less an assumed ${(w.margin * 100).toFixed(1)}% margin)</td><td class="num">${f(t.brier.market)}</td><td class="num">${f(t.logLoss.market)}</td></tr></tbody></table>
    <p>${close ? 'On results it had not seen, ATLAS and the market forecast about equally well: no measurable edge yet.' : better ? 'On results it had not seen, ATLAS forecast slightly better than the market.' : 'On results it had not seen, the market forecast better than ATLAS.'} ${t.n < 1000 ? 'The sample is small: treat this as provisional.' : ''} ${roi}.</p></div>`;
}
function verdict(a) {
  if (!(a.won + a.lost)) return '';
  const beats = a.brierN >= 20 ? a.brierModel <= a.brierMarket : null;
  const head = beats == null ? 'Too few picks with a saved market chance to compare ATLAS with the market yet.'
    : beats ? `On ${a.brierN} picks with a saved market chance, ATLAS's forecasts were closer to the results than the bookmaker's own (score ${a.brierModel.toFixed(4)} against ${a.brierMarket.toFixed(4)}; lower is better).`
      : `On ${a.brierN} picks with a saved market chance, the bookmaker's own forecast was closer to the results than ATLAS's (score ${a.brierMarket.toFixed(4)} against ${a.brierModel.toFixed(4)}; lower is better).`;
  const money = a.roi == null ? '' : a.roi >= 0 ? ` One unit on every pick would be ${units(a.profit)} up (ROI ${pct(a.roi)}).` : ` One unit on every pick would be ${units(a.profit)} down (ROI ${pct(a.roi)}): a high hit rate at short odds can still lose.`;
  const take = beats && a.roi >= 0 ? 'That is evidence of an edge on this sample, not proof: results are by model version below.' : 'Until ATLAS both beats the market\'s forecast and shows a profit, treat the picks as research to check, not a proven edge.';
  return `<div class="panel verdict reveal ${beats && a.roi >= 0 ? 'v-ok' : 'v-warn'}"><h3 class="ph">Does ATLAS beat the market?</h3><p>${head}${money} ${take}</p></div>`;
}

// Bankers, Surest and the unpriced model picks side by side: each is its own way of recommending.
function modesPanel(s) {
  const rows = [['Bankers (shortlist)', s.all, true], ['Surest', s.safe, true], ['Best bets', s.best, true], ['Singles near 2.00', s.two, true], ['Model only (no price)', s.model, false]].filter(([, r]) => r && r.won + r.lost);
  if (rows.length < 2) return '';
  return `<div class="panel reveal"><h3 class="ph">By recommendation type <small>each kept as its own record</small></h3>
    <table class="tbl tight"><thead><tr><th>Type</th><th class="num">Settled</th><th class="num">Hit rate</th><th class="num">Estimated</th><th class="num">Profit</th><th class="num" title="Mean squared error of the chance shown; lower is better">Brier</th></tr></thead>
    <tbody>${rows.map(([name, r, priced]) => `<tr><td>${name}</td><td class="num">${r.won + r.lost}</td><td class="num">${pct(r.hitRate)}</td><td class="num">${pct(r.expected)}</td><td class="num ${priced ? (r.profit >= 0 ? 'pos' : 'neg') : ''}">${priced ? units(r.profit) : 'no price'}</td><td class="num">${r.brier == null ? '—' : r.brier.toFixed(3)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ATLAS's own ledger in the format a fair comparison with another service would use (compare.js), and
// the honest state of any comparison: none has been run.
function comparisonPanel(picks) {
  const rows = [['Best bets (singles)', 'best'], ['Singles near 2.00', 'two'], ['Shortlist bankers', 'banker']].map(([label, type]) => [label, serviceStats({ service: 'ATLAS', evidence: 'ledger', selections: picks.filter((h) => h.type === type && ['won', 'lost', 'push', 'void'].includes(h.status)).map((h) => ({ date: new Date(h.start).toISOString(), odds: h.odds, status: h.status, p: h.shown ?? h.p, close: h.close })) })]).filter(([, st]) => st.selections);
  if (!rows.length) return '';
  const f = (x, d = 2) => (x == null ? '—' : x.toFixed(d));
  return `<div class="panel reveal"><h3 class="ph">ATLAS in the comparison format <small>reproduced from its complete ledger · no comparison with another service has been run</small></h3>
    <div class="table-wrap"><table class="tbl tight"><thead><tr><th>Record</th><th class="num">Settled</th><th class="num">Odds (avg · middle half)</th><th class="num">ROI (95% interval)</th><th class="num">Max drawdown</th><th class="num">Brier</th></tr></thead><tbody>
    ${rows.map(([label, st]) => `<tr><td>${label}</td><td class="num">${st.won + st.lost}</td><td class="num">${f(st.avgOdds)} · ${f(st.oddsQuartiles[0])}–${f(st.oddsQuartiles[2])}</td><td class="num">${pct(st.roi)}${st.roiCI ? ` (${pct(st.roiCI[0])} to ${pct(st.roiCI[1])})` : ''}</td><td class="num">${f(st.maxDrawdown)}u</td><td class="num">${f(st.brier, 3)}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted">Any claim against another service needs the same sports, dates, odds band, deadline and prices for both, every selection and abstention kept, and is ranked only when the evidence separates them (protocol in docs/comparison-protocol.md).</p></div>`;
}

// Settlement audit: results under dispute (two reads disagreed; out of every total until they
// agree), copies of one selection that disagree, and every change to a result that was already
// final, with the old and new result, the source and the reason (the log is append-only).
function correctionsPanel(data) {
  const picks = data.picks || [], log = data.corrections || [], conflicts = data.conflicts || [];
  const all = picks.flatMap((h) => [h, ...(h.legs || [])]);
  const disputed = all.filter((x) => x.status === 'disputed');
  const fin = all.filter((x) => x.type !== 'multi' && FINAL.has(x.status));
  const indep = fin.filter(independentlyConfirmed).length, same = fin.filter((x) => x.confirmedAt && !independentlyConfirmed(x)).length;
  if (!log.length && !disputed.length && !conflicts.length && !(indep + same)) return '';
  const when = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<div class="panel reveal"><h3 class="ph">Settlement audit <small>${disputed.length} disputed · ${conflicts.length} copies disagreeing · ${log.length} correction${log.length === 1 ? '' : 's'} logged</small></h3>
    <p class="muted">A result is read twice before it is trusted: the second read comes from an independent source where one covers the league (NHL, MLB, NBA and WNBA official feeds; FotMob for soccer), otherwise from the same feed again. If the reads disagree it is held out of every total until two reads in a row agree. A changed result is never overwritten silently: the log keeps the old one.</p>
    <p class="muted">Final results: ${indep} confirmed by an independent source · ${same} by a second read of the same source · ${fin.length - indep - same} not yet confirmed.</p>
    ${log.length ? `<table class="tbl tight"><thead><tr><th>When</th><th>Selection</th><th>From</th><th>To</th><th>Why</th></tr></thead><tbody>${log.slice(-20).reverse().map((c) => `<tr><td>${when(c.at)}</td><td>${esc(c.key || c.sel || '')}</td><td>${esc(c.from)}${c.prevScore ? ` <small>${esc(c.prevScore)}</small>` : ''}</td><td>${esc(c.to)}${c.score ? ` <small>${esc(c.score)}</small>` : ''}</td><td>${esc(c.reason || '')} <small>${esc(c.source || '')}</small></td></tr>`).join('')}</tbody></table>` : ''}</div>`;
}

// Picks on matches no bookmaker priced: hit rate against their own forecasts, by sport. No profit:
// there was no price to take.
function modelPanel(m) {
  if (!m || !(m.won + m.lost)) return '';
  return `<div class="panel reveal"><h3 class="ph">Model-only picks <small>matches with no bookmaker price · ${m.won}–${m.lost} · ${pct(m.hitRate, 0)} landed against ${pct(m.expected, 0)} forecast</small></h3>
    <p class="muted">Rated by ATLAS from rankings, ratings, records and form, shown with fair odds on <a href="#/every">Every sport</a>. A sport's model picks are trusted fully only after 30 results; until then they are pulled toward 50/50.</p>
    <table class="tbl tight"><thead><tr><th>Sport</th><th class="num">Settled</th><th class="num">Hit rate</th><th class="num">Forecast</th><th class="num">Brier</th></tr></thead>
    <tbody>${m.bySport.map((r) => `<tr><td>${sportOf(r.key).icon} ${esc(sportOf(r.key).name)}</td><td class="num">${r.won + r.lost}</td><td class="num">${pct(r.hitRate)}</td><td class="num">${pct(r.expected)}</td><td class="num">${r.brier == null ? '—' : r.brier.toFixed(3)}</td></tr>`).join('')}</tbody></table></div>`;
}

function trustPanel(picks) {
  const cal = calibration(picks);
  const famName = { winner: 'winner', result: '1X2 result', spread: 'handicap', total: 'totals', prop: 'player props' };
  const rows = Object.entries(cal).filter(([k, r]) => k.includes(':') && r.w != null && r.priced >= 20).sort((a, b) => b[1].priced - a[1].priced);
  if (!rows.length) return '';
  return `<div class="panel reveal"><h3 class="ph">How much ATLAS trusts itself <small>learned from settled picks</small></h3>
    <p class="muted">Where the bookmaker's price has predicted results better than ATLAS's own estimate, the chance shown leans toward the price. It leans only as far as the results justify, and it moves as more picks settle. Brier score: lower is better.</p>
    <table class="tbl tight"><thead><tr><th>Sport · market</th><th class="num">Picks</th><th class="num">Weight on ATLAS</th><th class="num">ATLAS alone</th><th class="num">Price alone</th><th class="num">Shown</th></tr></thead><tbody>${rows.map(([k, r]) => {
      const [sp, fam] = k.split(':');
      return `<tr><td>${sportOf(sp).icon} ${esc(sportOf(sp).name)} · ${esc(famName[fam] || fam)}</td><td class="num">${r.priced}</td><td class="num">${pct(r.w, 0)}</td><td class="num">${r.brier.model.toFixed(3)}</td><td class="num">${r.brier.market.toFixed(3)}</td><td class="num"><b>${r.brier.blend.toFixed(3)}</b></td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function body(data) {
  const s = summarize(data.picks || []);
  if (!s.all.won && !s.all.lost) {
    return `<div class="panel reveal"><h3 class="ph">Tracking has started</h3><p class="muted">Every shortlist pick (rated 60%+, odds ${MIN_ODDS.toFixed(2)} to ${MAX_ODDS.toFixed(2)}) is saved before kick-off and graded from the final score. Results appear here as matches finish.</p></div>
      ${s.pending.length ? `<div class="panel reveal"><h3 class="ph">Waiting on results <small>${s.pending.length}</small></h3><ul class="tr-list">${s.pending.slice(0, 30).map(pickRow).join('')}</ul></div>` : ''}`;
  }
  const famName = { winner: 'Winner / moneyline', result: '1X2 result', spread: 'Spread / handicap', total: 'Totals (over/under)' };
  return `${verdict(s.all)}${outOfSample(data.picks || [], s.all)}${statCards(s.all, data.updatedAt)}${s.outside.won + s.outside.lost ? `<p class="note reveal">Shortlist picks only (rated 60%+, odds ${MIN_ODDS.toFixed(2)} to ${MAX_ODDS.toFixed(2)}). ${s.outside.won + s.outside.lost} earlier picks outside these rules (value spots and longer prices, ${s.outside.won} won, ${s.outside.lost} lost) are not counted.</p>` : ''}${s.unresolved ? `<p class="note reveal">${s.unresolved} pick${s.unresolved > 1 ? 's' : ''} could not be graded (no final result found) and ${s.unresolved > 1 ? 'are' : 'is'} left out rather than counted as void.</p>` : ''}
    <div class="grid two">
      <div class="panel reveal"><h3 class="ph">By sport</h3>${table(s.bySport.map((r) => ({ ...r, name: `${sportOf(r.key).icon} ${sportOf(r.key).name}` })), 'Sport')}</div>
      <div class="panel reveal"><h3 class="ph">By market <small>the model needs more confidence where a market has underperformed</small></h3>${table(s.byFamily.map((r) => ({ ...r, name: famName[r.key] || r.key })), 'Market')}</div>
      
    </div>
    <div class="panel reveal"><h3 class="ph">Multipliers and mega <small>separate records</small></h3><p class="muted">Each multiplier keeps its own record on its own page, so slips never mix with single picks here.</p><div class="chip-row">${[2, 3, 4, 5, 10, 20].map((x) => `<a class="chip" href="#/x/${x}">${x}×</a>`).join('')}<a class="chip" href="#/mega">Mega 100× / 1000×</a></div></div>
    ${s.byModel.length > 1 ? `<div class="panel reveal"><h3 class="ph">By model version <small>each pick is stamped with the model that made it</small></h3>${table(s.byModel.map((r) => ({ ...r, name: r.key })), 'Model')}</div>` : ''}
    <div class="panel reveal"><h3 class="ph">Are the estimates honest? <small>calibration</small></h3>
      <p class="muted">When ATLAS says 65%, it should land about 65% of the time. Small samples swing a lot.</p>
      <div class="tr-cal">${s.buckets.map((b) => `<div><small>Estimated ${b.label}</small>${b.n ? `<div class="tr-bars"><i style="--w:${((b.predicted || 0) * 100).toFixed(0)}%"></i><i class="act" style="--w:${((b.actual || 0) * 100).toFixed(0)}%"></i></div>` : ''}<span>${b.n ? `${pct(b.predicted, 0)} estimated · ${pct(b.actual, 0)} actual · ${b.n} picks` : 'no picks yet'}</span></div>`).join('')}</div></div>
    ${s.safe?.won + s.safe?.lost ? `<div class="panel reveal"><h3 class="ph">Surest picks <small>odds ${SAFE.minOdds.toFixed(2)}–${SAFE.maxOdds.toFixed(2)}, ATLAS not above the price · its own record</small></h3><p>${recordLine(s.safe)}</p></div>` : ''}
    ${s.best?.won + s.best?.lost ? `<div class="panel reveal"><h3 class="ph">Best bets <small>odds ${BEST.minOdds.toFixed(2)}–${BEST.maxOdds.toFixed(2)}, best price across bookmakers, never shorter than the market's fair odds · its own record</small></h3><p>${recordLine(s.best)}</p></div>` : ''}
    ${modesPanel(s)}
    ${modelPanel(s.model)}
    ${correctionsPanel(data)}
    ${comparisonPanel(data.picks || [])}
    ${priceBandPanel(data.picks || [])}
    ${trustPanel(data.picks || [])}
    <div class="panel reveal"><h3 class="ph">Latest results</h3><ul class="tr-list">${s.recent.map(pickRow).join('')}</ul></div>
    ${s.pending.length ? `<div class="panel reveal"><h3 class="ph">Waiting on results <small>${s.pending.length}</small></h3><ul class="tr-list">${s.pending.slice(0, 20).map(pickRow).join('')}</ul></div>` : ''}`;
}

export const trackViews = {
  track() {
    return {
      mode: 'other', accent: '#3dff9a', title: 'Track record',
      html: `<section class="hero small"><p class="kicker reveal">EVERY PICK · LOCKED BEFORE KICK-OFF · GRADED FROM FINAL SCORES</p><h1>TRACK RECORD</h1>
        <p class="lede reveal">Every shortlist pick, saved before kick-off and graded from the final score.</p></section>
        <div id="track-body">${cache ? body(cache.data) : '<p class="muted">Loading results…</p>'}</div>`,
      after: () => {
        load().then((d) => {
          const el = document.getElementById('track-body');
          if (el) { el.innerHTML = body(d); el.querySelectorAll('.reveal').forEach((x) => x.classList.add('in')); }
        }).catch(() => {
          const el = document.getElementById('track-body');
          if (el) el.innerHTML = '<div class="panel"><p class="muted">The track record starts with the next site update: picks are saved before kick-off and graded after the final whistle.</p></div>';
        });
      },
    };
  },
};

// Home dashboard card: the record so far (loads in the background, then the page redraws).
// One line near the top of Today: the last 30 days of the shortlist record, the reason to trust the
// rest of the page. Left out until 10 picks in that window have settled.
export function trackStrip(refresh) {
  ensureTrack(refresh);
  if (!cache) return '';
  const since = Date.now() - 30 * 864e5;
  const a = summarize((cache.data.picks || []).filter((h) => h.start >= since)).all;
  if (a.won + a.lost < 10) return '';
  const clv = a.clvN >= 10 ? ` · <span>price beat the close on <b>${pct(a.beatClose, 0)}</b></span>` : '';
  return `<a class="track-strip reveal" href="#/track"><small>Last 30 days</small>
    <span><b>${a.won}–${a.lost}</b> won–lost</span> · <span><b>${pct(a.hitRate, 0)}</b> hit rate (est. ${pct(a.expected, 0)})</span> · <span>avg odds <b>${a.avgOdds.toFixed(2)}</b></span> · <span>ROI <b class="${a.profit >= 0 ? 'pos' : 'neg'}">${a.roi >= 0 ? '+' : ''}${(a.roi * 100).toFixed(1)}%</b></span>${clv}
    <em>Every pick saved before kick-off →</em></a>`;
}

export function trackCard(refresh) {
  ensureTrack(refresh);
  if (!cache) return '';
  const s = summarize(cache.data.picks || []);
  const a = s.all;
  if (!a.won && !a.lost) return `<a class="panel dash-track reveal" href="#/track"><h2 class="ph">Track record <small>tracking started</small></h2><p class="muted">${s.pending.length} picks locked before kick-off, waiting on results.</p></a>`;
  const last = s.recent.slice(0, 10).map((h) => `<i class="tr-dot ${h.status}" title="${esc(h.pick)}: ${h.status}"></i>`).join('');
  return `<a class="panel dash-track reveal" href="#/track"><h2 class="ph">Track record <small>every pick, locked before kick-off</small></h2>
    <div class="dt-row"><div><b>${a.won}–${a.lost}</b><small>won–lost</small></div><div><b>${pct(a.hitRate, 0)}</b><small>hit rate (est. ${pct(a.expected, 0)})</small></div><div><b class="${a.profit >= 0 ? 'pos' : 'neg'}">${a.roi == null ? '—' : `${a.roi >= 0 ? '+' : ''}${(a.roi * 100).toFixed(1)}%`}</b><small>ROI · ${units(a.profit)}</small></div>${a.brierN >= 20 ? `<div><b class="${a.brierModel <= a.brierMarket ? 'pos' : 'neg'}">${a.brierModel <= a.brierMarket ? 'Beats' : 'Trails'}</b><small>the market's own forecast</small></div>` : ''}</div>
    <ul class="dt-types">${s.bySport.slice(0, 4).map((r) => `<li><span>${sportOf(r.key).icon} ${esc(sportOf(r.key).name)}</span><b>${pct(r.hitRate, 0)}</b><small>${r.won}–${r.lost}</small></li>`).join('')}</ul>
    <div class="dt-last">${last}<span>latest results →</span></div></a>`;
}
