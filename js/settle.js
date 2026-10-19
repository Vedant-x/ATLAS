// Settlement: how a recorded selection gets its result, kept apart from the forecast that picked it.
//
// - Every selection has one canonical id (selectionId): the same pick saved as a shortlist banker, a
//   surest pick, a best bet or a slip leg is one selection with one outcome.
// - A result read from a provider is applied with applyRead. A final result (won, lost, push, void,
//   dnp) is re-read once before it is trusted (confirmed), from an independent second source where one
//   covers the league (results2.js), else from the same provider; if the second read disagrees the
//   selection is "disputed" and stays out of every total until two reads in a row agree.
// - Every change to a result that was already final is appended to an audit log (from, to, when,
//   source, reason): the record keeps the latest result, the log keeps every earlier one.
// - Postponed matches wait for the new date; only after POSTPONED_VOID_HOURS do they become void (a
//   common bookmaker rule; books differ). A result not found yet is retried, and one still missing
//   after UNRESOLVED_AFTER_DAYS is "unresolved", retried every few hours for RETRY_DAYS more.
// - DNP (did not play) only from an explicit did-not-play flag, never from a missing statistic.

export const FINAL = new Set(['won', 'lost', 'push', 'void', 'dnp']);
// Statuses that still wait on a read: never counted in any total.
export const OPEN = new Set(['pending', 'postponed', 'disputed', 'unresolved']);
export const POSTPONED_VOID_HOURS = 72;
export const UNRESOLVED_AFTER_DAYS = 4;
export const RETRY_DAYS = 30;
export const RETRY_HOURS = 6;
export const CONFIRM_AFTER_HOURS = 3;
// A final result still waiting for its confirming read.
export const awaitingConfirm = (p) => FINAL.has(p.status) && !p.confirmedAt;
// Confirmed by a source other than the one that settled it (results2.js). Records settled before
// settledBy was saved were all graded from ESPN (bo3.gg for esports).
export const settledSource = (p) => p.settledBy || (String(p.leaguePath || '').startsWith('atlas/') ? 'bo3.gg' : 'ESPN summary');
export const independentlyConfirmed = (p) => Boolean(p.confirmedAt && p.confirmedBy && p.confirmedBy !== settledSource(p));

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const MARKET_ALIAS = { moneyline: 'winner', 'match winner': 'winner', '1x2': 'match result' };
// The canonical id of a selection: its event, market, selection and line (player props by player,
// stat and threshold). Two records with the same id are the same bet.
export function selectionId(r) {
  if (!r?.eventId) return null;
  if (r.prop) return `${r.eventId}|prop|${r.prop.id}|${norm(r.prop.type)}|${r.prop.target}`;
  const m = norm(r.market);
  return `${r.eventId}|${MARKET_ALIAS[m] || m}|${norm(r.pick)}`;
}

// Should this record be read again now? Pending once the match should be over (2h+ after start);
// postponed and disputed every run; a final result once more, CONFIRM_AFTER_HOURS after it was set,
// to confirm it; unresolved every RETRY_HOURS for RETRY_DAYS.
export function dueForRead(p, now = Date.now()) {
  if (!(p.start < now - 2 * 36e5)) return false;
  if (p.status === 'pending' || p.status === 'postponed' || p.status === 'disputed') return true;
  if (FINAL.has(p.status)) return !p.confirmedAt && p.gradedAt != null && now - p.gradedAt >= CONFIRM_AFTER_HOURS * 36e5 && now - p.gradedAt < 7 * 864e5;
  if (p.status === 'unresolved') return p.start > now - RETRY_DAYS * 864e5 && !(p.triedAt > now - RETRY_HOURS * 36e5);
  return false;
}

// Apply one read to one record. read: { status: 'won'|'lost'|'push'|'void'|'dnp', score } for a
// result, { postponed: true }, { void: true, reason } or { status: null } (nothing to grade yet).
// audit: the append-only log (entries are pushed onto it). Returns what happened, for the counts.
export function applyRead(p, read, { now = Date.now(), source = 'unknown', audit = [] } = {}) {
  p.triedAt = now;
  const log = (to, reason, score = null) => audit.push({ at: now, sel: p.sel || selectionId(p), key: p.key, from: p.status, to, prevScore: p.score ?? null, score, source, reason });
  const set = (status, score, reason) => {
    // Changing a result that was already final (or disputed) is a correction: logged, never silent.
    if (FINAL.has(p.status) || p.status === 'disputed') log(status, reason, score ?? null);
    p.status = status; p.gradedAt = now; p.settledBy = source;
    if (score != null) p.score = score;
    delete p.confirmedAt; delete p.confirmedBy; delete p.disputedWith;
  };
  const next = read.postponed ? 'postponed' : read.void ? 'void' : read.status || null;
  if (!next) {
    // Nothing to grade yet: after UNRESOLVED_AFTER_DAYS a pending record is unresolved (still retried).
    if (p.status === 'pending' && p.start < now - UNRESOLVED_AFTER_DAYS * 864e5) { p.status = 'unresolved'; return 'unresolved'; }
    return 'waiting';
  }
  if (next === 'postponed') {
    if (p.status === 'void') { p.confirmedAt = now; p.confirmedBy = source; return 'confirmed'; } // already voided as postponed
    if (p.start < now - POSTPONED_VOID_HOURS * 36e5) { set('void', null, `postponed for more than ${POSTPONED_VOID_HOURS} h`); return 'void'; }
    if (p.status !== 'postponed') { if (FINAL.has(p.status)) log('postponed', 'provider now reports the match postponed'); p.status = 'postponed'; }
    return 'postponed';
  }
  const score = read.score ?? null;
  if (p.status === 'pending' || p.status === 'postponed' || p.status === 'unresolved') { set(next, score, read.reason || 'first result'); return next; }
  if (FINAL.has(p.status)) {
    // The confirming read: the same result confirms it; a different one opens a dispute.
    if (next === p.status) { p.confirmedAt = now; p.confirmedBy = source; return 'confirmed'; }
    log('disputed', `second read says ${next}`, score);
    p.disputedWith = next; p.status = 'disputed'; p.disputedAt = now;
    return 'disputed';
  }
  if (p.status === 'disputed') {
    // Settled once the last two reads agree.
    if (next === p.disputedWith) { set(next, score, 'two reads in a row agree'); p.confirmedAt = now; p.confirmedBy = source; return next; }
    p.disputedWith = next;
    return 'disputed';
  }
  return 'waiting';
}
