import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRead, dueForRead, selectionId } from '../js/settle.js';
import { summarize, calibration, observations, settleMulti } from '../js/track.js';

const H = 36e5, D = 864e5, T0 = Date.parse('2026-10-10T12:00:00Z');
const pick = (over = {}) => ({ key: 'e1|Winner|Arsenal', type: 'banker', eventId: 'e1', market: 'Winner', pick: 'Arsenal', sport: 'football', odds: 1.5, p: 0.7, start: T0, status: 'pending', recordedAt: T0 - H, ...over });

test('canonical id: the same bet saved as a banker, a best bet and a slip leg is one selection', () => {
  const a = selectionId({ eventId: 'e1', market: 'Winner', pick: 'Arsenal' });
  assert.equal(selectionId({ eventId: 'e1', market: 'winner', pick: '  arsenal ' }), a);
  assert.equal(selectionId({ eventId: 'e1', market: 'Moneyline', pick: 'Arsenal' }), a);
  assert.notEqual(selectionId({ eventId: 'e1', market: 'Winner', pick: 'Leeds' }), a);
  assert.equal(selectionId({ eventId: 'e2', market: 'Player Points', pick: 'X 20+', prop: { id: 7, type: 'Points', target: 20 } }), 'e2|prop|7|points|20');
  assert.equal(selectionId({ market: 'Winner', pick: 'Arsenal' }), null);
});

test('a result is confirmed by a second read; a different second read opens a dispute that is logged', () => {
  const audit = [], p = pick();
  assert.equal(applyRead(p, { status: 'won', score: '2-1' }, { now: T0 + 3 * H, source: 'ESPN summary', audit }), 'won');
  assert.equal(audit.length, 0, 'a first result is not a correction');
  assert.equal(dueForRead(p, T0 + 4 * H), false, 'not re-read straight away');
  assert.equal(dueForRead(p, T0 + 7 * H), true, 'read once more to confirm');
  assert.equal(applyRead(p, { status: 'won', score: '2-1' }, { now: T0 + 7 * H, audit }), 'confirmed');
  assert.ok(p.confirmedAt);
  assert.equal(dueForRead(p, T0 + 20 * H), false);

  const q = pick({ key: 'e9|Winner|Arsenal', eventId: 'e9' });
  applyRead(q, { status: 'won', score: '1-0' }, { now: T0 + 3 * H, audit });
  assert.equal(applyRead(q, { status: 'lost', score: '1-1' }, { now: T0 + 7 * H, source: 'ESPN summary', audit }), 'disputed');
  assert.equal(q.status, 'disputed');
  assert.deepEqual(audit.map((a) => [a.from, a.to]), [['won', 'disputed']]);
  assert.equal(audit[0].prevScore, '1-0');
  // A disputed pick is out of every total until two reads in a row agree.
  assert.equal(summarize([q]).all.won + summarize([q]).all.lost, 0);
  assert.equal(applyRead(q, { status: 'lost', score: '1-1' }, { now: T0 + 8 * H, audit }), 'lost');
  assert.deepEqual(audit.map((a) => [a.from, a.to]), [['won', 'disputed'], ['disputed', 'lost']]);
  assert.equal(q.score, '1-1');
});

test('postponed waits, then voids after 72 hours with the reason logged on the record', () => {
  const audit = [], p = pick();
  assert.equal(applyRead(p, { postponed: true }, { now: T0 + 3 * H, audit }), 'postponed');
  assert.equal(p.status, 'postponed');
  assert.equal(dueForRead(p, T0 + 4 * H), true);
  assert.equal(applyRead(p, { postponed: true }, { now: T0 + 80 * H, audit }), 'void');
  assert.equal(p.status, 'void');
  // Played on the new date within 72 h instead: graded normally.
  const q = pick();
  applyRead(q, { postponed: true }, { now: T0 + 3 * H, audit });
  assert.equal(applyRead(q, { status: 'lost', score: '0-1' }, { now: T0 + 30 * H, audit }), 'lost');
});

test('no result yet: waits, becomes unresolved after 4 days, and is retried for 30 days', () => {
  const p = pick();
  assert.equal(applyRead(p, { status: null }, { now: T0 + 3 * H }), 'waiting');
  assert.equal(applyRead(p, { status: null }, { now: T0 + 5 * D }), 'unresolved');
  assert.equal(dueForRead(p, T0 + 5 * D + H), false, 'not straight away');
  assert.equal(dueForRead(p, T0 + 5 * D + 7 * H), true, 'every few hours');
  assert.equal(dueForRead(p, T0 + 31 * D), false, 'gives up after 30 days');
  assert.equal(applyRead(p, { status: 'won', score: '3-0' }, { now: T0 + 6 * D }), 'won');
});

test('a postponed or disputed leg keeps its slip pending; a DNP leg drops out like a void', () => {
  const leg = (status, odds = 1.4) => ({ status, odds });
  assert.equal(settleMulti({ legs: [leg('won'), leg('postponed')] }).status, 'pending');
  assert.equal(settleMulti({ legs: [leg('won'), leg('disputed')] }).status, 'pending');
  assert.deepEqual(settleMulti({ legs: [leg('won', 1.5), leg('dnp'), leg('void')] }), { status: 'won', odds: 1.5 });
});

test('rebuilding the history in any order gives the same totals and calibration', () => {
  const h = [];
  for (let i = 0; i < 40; i++) {
    const st = i % 3 ? 'won' : 'lost';
    h.push(pick({ key: `e${i}|Winner|A`, eventId: `e${i}`, pick: 'A', odds: 1.3 + (i % 5) / 10, p: 0.6 + (i % 4) / 20, status: st, recordedAt: T0 + i * H, start: T0 + i * H + D }));
    // The same selection again later (a best-bet copy), with a different forecast: the first forecast counts.
    if (i % 4 === 0) h.push(pick({ key: `best|e${i}|Winner|A`, type: 'best', eventId: `e${i}`, pick: 'A', odds: 1.5, p: 0.9, status: st, recordedAt: T0 + i * H + 60e3, start: T0 + i * H + D }));
  }
  const shuffled = [...h].sort((a, b) => (a.key > b.key ? 1 : -1)).reverse();
  assert.deepEqual(summarize(shuffled).all, summarize(h).all);
  assert.deepEqual(calibration(shuffled), calibration(h));
  assert.deepEqual(observations(shuffled).list.map((o) => [o.key, o.p]).sort(), observations(h).list.map((o) => [o.key, o.p]).sort());
});

test('copies of one selection that disagree (won vs push) are flagged, not counted', () => {
  const o = observations([pick({ status: 'won' }), pick({ key: 'best|e1|Winner|Arsenal', type: 'best', status: 'push' })]);
  assert.deepEqual(o.conflicts, ['e1|winner|arsenal']);
});

test('out-of-sample check: each week is scored with a calibration fitted only on earlier results', async () => {
  const { walkForward } = await import('../js/track.js');
  const h = [];
  for (let i = 0; i < 300; i++) {
    const at = T0 + i * 4 * H;
    h.push(pick({ key: `w${i}|Winner|A`, eventId: `w${i}`, pick: 'A', odds: 1.6, p: 0.7, status: i % 5 < 3 ? 'won' : 'lost', recordedAt: at, start: at + 2 * H }));
  }
  const w = walkForward(h);
  assert.ok(w.weeks.length >= 3);
  // Training sets only grow week by week and never include the week being scored.
  for (let i = 1; i < w.weeks.length; i++) assert.ok(w.weeks[i].train > w.weeks[i - 1].train);
  for (const wk of w.weeks) assert.ok(wk.train <= h.filter((x) => x.start < wk.from).length);
  assert.ok(w.total.brier.raw > 0 && w.total.logLoss.market > 0);
  assert.equal(walkForward([]), null);
});

test('quiet hours: no system notifications inside the window, including one past midnight', async () => {
  const { quietNow } = await import('../js/livealerts.js');
  const at = (h) => new Date(2026, 9, 18, h, 30);
  assert.equal(quietNow({ quiet: [22, 7] }, at(23)), true);
  assert.equal(quietNow({ quiet: [22, 7] }, at(3)), true);
  assert.equal(quietNow({ quiet: [22, 7] }, at(12)), false);
  assert.equal(quietNow({ quiet: [0, 9] }, at(8)), true);
  assert.equal(quietNow({}, at(3)), false);
});
