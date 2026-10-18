// Prop readiness and the analysis panel.
//
// propReadiness: whether the evidence for one player prop is in, current and consistent, in the same
// states as match readiness (readiness.js), so a prop is never shown as "ready" on stale or
// contradicted information:
//   conflict  the line is offered but the player is listed out or doubtful
//   stale     the price or the game logs are old
//   waiting   his own status, or a key teammate's, is still questionable
//   unknown   the price, the game logs or the injury report has no time on it: its freshness can't
//             be checked, so it is never passed as fresh
//   limited   thin or no game history, or no injury report for the match
//   ready     everything the forecast uses is in and current
//
// analysisPanel: the one panel every prop forecast is shown in, with the numbers kept apart: hit rate,
// forecast (with its rough range and sample), market estimate, break-even and return at the price,
// readiness, data age and what is missing.
import { READY_LABEL } from './readiness.js';

const OUT = /^(out|doubtful|injured reserve|suspension)/i;
const QUESTIONABLE = /^(questionable|day-to-day)/i;
const mins = (t, now) => (t ? Math.max(0, Math.round((now - t) / 6e4)) : null);

export function propReadiness(e, x, { now = Date.now(), priceAt = null, logsAt = null } = {}) {
  const list = [];
  const add = (key, label, ok, note, flag) => list.push({ key, label, ok, note, flag });
  // `fresh: 'unknown'` marks a check whose time is missing.
  const pAge = mins(priceAt ?? e.fetchedAt, now);
  if (pAge == null) add('price', 'Price', null, 'offered, but the time it was checked is unknown', 'unknown');
  else add('price', 'Price', pAge <= 60, `checked ${pAge < 1 ? 'just now' : `${pAge} min ago`}`);
  const n = x.hist?.l20?.[1] || 0;
  add('history', 'Game history', n >= 8 ? true : n ? false : null, n ? `${n} recent games` : 'no games on record: the price alone');
  const lAge = mins(logsAt, now);
  if (lAge != null) add('logs', 'Game logs', lAge <= 45, `built ${lAge} min ago`);
  else if (n) add('logs', 'Game logs', null, 'the time they were built is unknown', 'unknown');
  // The injury report counts only with the time it was read, and only while it is under 12 hours old.
  const injAt = Number.isFinite(e.injuryChecked) ? e.injuryChecked : Number.isFinite(e.injuries?.at) ? e.injuries.at : null;
  const listed = e.injuries ? `, ${(e.injuries.home?.length || 0) + (e.injuries.away?.length || 0)} listed` : ', nobody listed';
  if (!(e.injuryChecked || e.injuries)) add('injuries', 'Injury report', null, 'no injury report for this match');
  else if (injAt == null) add('injuries', 'Injury report', null, `${e.injuries?.source || 'ESPN'}${listed}, time read unknown`, 'unknown');
  else { const h = (now - injAt) / 36e5; add('injuries', 'Injury report', h <= 12, `${e.injuries?.source || 'ESPN'}${listed}, read ${h < 1 ? `${Math.max(0, Math.round(h * 60))} min` : `${Math.round(h)} h`} ago`); }
  const me = x.side ? (e.injuries?.[x.side] || []).find((i) => String(i.id) === String(x.id)) : null;
  if (me) add('status', 'His status', OUT.test(me.status) ? false : QUESTIONABLE.test(me.status) ? false : true, me.status, OUT.test(me.status) ? 'conflict' : QUESTIONABLE.test(me.status) ? 'wait' : null);
  const unsure = (x.adj || []).filter((a) => !a.applied && QUESTIONABLE.test(a.status || ''));
  if (unsure.length) add('teammates', 'Teammate status', false, `${unsure.map((a) => a.name).join(', ')} questionable`, 'wait');
  if (e.sport === 'hockey') add('goalies', 'Starting goalies', null, 'no confirmed-goalie feed');

  let state;
  if (list.some((c) => c.flag === 'conflict')) state = 'conflict';
  else if (list.some((c) => ['price', 'logs', 'injuries'].includes(c.key) && c.ok === false)) state = 'stale';
  else if (list.some((c) => c.flag === 'wait')) state = 'waiting';
  else if (list.some((c) => c.flag === 'unknown')) state = 'unknown';
  else if (list.some((c) => c.ok === false || c.ok === null)) state = 'limited';
  else state = 'ready';
  const label = state === 'conflict' ? 'Conflicting reports' : state === 'waiting' ? `Waiting on ${list.find((c) => c.flag === 'wait').key === 'status' ? 'his status' : 'a teammate'}` : READY_LABEL[state];
  return { state, label, checks: list, missing: list.filter((c) => c.ok === false).map((c) => `${c.label}: ${c.note}`), uncovered: list.filter((c) => c.ok === null).map((c) => `${c.label}: ${c.note}`) };
}

const pc = (p, d = 0) => (Number.isFinite(p) ? `${(p * 100).toFixed(d)}%` : '–');
const sign = (x, d = 0) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}`;
const escAttr = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const readinessBadge = (r) => `<span class="ready ready-${r.state}" title="${escAttr(r.checks.map((c) => `${c.ok === true ? '✓' : c.ok === false ? '✗' : '–'} ${c.label}: ${c.note}`).join('\n'))}">${escAttr(r.label)}</span>`;

// a: { hits, n, avg, forecast, range, nEff, priced, odds, marketEst, why, readiness, priceAge, logsAge, filtersNote }
export function analysisPanel(a) {
  const be = a.priced ? 1 / a.odds : null;
  const ret = a.priced && a.forecast != null ? a.forecast * a.odds - 1 : null;
  const gap = a.priced && a.forecast != null ? a.forecast - a.marketEst : null;
  const thin = a.n < 8;
  const missing = [...(a.readiness?.missing || []), ...(a.readiness?.uncovered || [])];
  return `<div class="an-panel">
    <div class="an-head">${a.readiness ? readinessBadge(a.readiness) : ''}<span class="muted">${a.priced ? `DraftKings ${a.odds.toFixed(2)}` : 'no price at this line'}</span></div>
    <div class="pl-nums">
      <div><small>Hit rate · ${a.n} game${a.n === 1 ? '' : 's'} selected</small><b>${a.n ? pc(a.hits / a.n) : '–'}</b><em>${a.hits}/${a.n}${a.avg != null ? ` · avg ${a.avg.toFixed(1)}` : ''}${a.filtersNote ? ` · ${a.filtersNote}` : ''}</em></div>
      <div class="pl-fc"><small>ATLAS forecast · next game</small><b>${pc(a.forecast)}</b><em>${a.priced ? '' : 'model only, no price at this line'}${a.why ? `${a.priced ? '' : ' · '}${escAttr(a.why)}` : ''}</em></div>
      <div title="The price's implied chance less an assumed 5% margin: one price is offered, so the true margin cannot be calculated"><small>Market estimate · assumed 5% margin</small><b>${a.priced ? pc(a.marketEst) : '–'}</b><em>${gap != null ? `forecast ${sign(gap)} pts vs it${gap > 0 && ret < 0 ? ', still below break-even' : ''}` : '–'}</em></div>
      <div><small>Break-even · return at this price</small><b>${a.priced ? pc(be) : '–'}</b><em>${ret != null ? `estimated return <span class="${ret >= 0 ? 'pos' : 'neg'}">${sign(ret, 1)}%</span>` : '–'}</em></div>
    </div>
    <dl class="an-strip">
      <div><dt>Uncertainty</dt><dd>${a.range ? `approx. 80% range ${pc(a.range[0])}–${pc(a.range[1])}` : 'not enough games'}</dd></div>
      <div><dt>Sample</dt><dd class="${thin ? 'warn' : ''}">${a.n} game${a.n === 1 ? '' : 's'} after filters${a.nEff ? ` · forecast weighs ${a.nEff.toFixed(0)} effective games` : ''}${thin ? ' · small' : ''}</dd></div>
      <div><dt>Data age</dt><dd>${a.priceAge != null ? `price ${a.priceAge} min` : 'price –'} · ${a.logsAge != null ? `logs ${a.logsAge} min` : 'logs –'}</dd></div>
      <div><dt>Missing</dt><dd class="${missing.length ? 'warn' : ''}">${missing.length ? escAttr(missing.join(' · ')) : 'nothing the forecast uses'}</dd></div>
    </dl>
  </div>`;
}
