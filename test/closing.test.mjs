import test from 'node:test';
import assert from 'node:assert/strict';
import { closingLine, updateClosing } from '../js/track.js';
import { closeLineText } from '../js/honest.js';

const now = Date.parse('2026-10-31T12:00:00Z');
const pick = (odds, close, extra = {}) => ({ type: 'edge', model: '2026.10.16', eventId: 'e1', market: 'Match Result', pick: 'Nice', odds, close, closeAt: now - 2 * 36e5, start: now - 36e5, status: 'pending', ...extra });

test('the closing fair chance is saved with the closing price, until kick-off', () => {
  const h = [pick(2.75, null, { start: now + 36e5 })];
  const events = [{ id: 'e1', markets: [{ name: 'Match Result', outcomes: [{ name: 'Nice', odds: 2.55, cons: 0.3812 }, { name: 'Draw', odds: 3.6, cons: 0.27 }] }] }];
  assert.equal(updateClosing(h, events, now), 1);
  assert.deepEqual([h[0].close, h[0].closeFair], [2.55, 0.3812]);
  events[0].markets[0].outcomes[0].cons = 0.5;
  updateClosing(h, events, now + 2 * 36e5);
  assert.equal(h[0].closeFair, 0.3812, 'after kick-off nothing changes');
});

test('the closing line counts the current rules only, from kick-off, whatever the result', () => {
  const h = [
    pick(2.75, 2.55, { closeFair: 0.3812 }), // beat the close, above closing fair (2.75 × 0.3812 = 1.048)
    pick(1.8, 1.9, { type: 'best', status: 'won', closeFair: 0.52 }), // trailed the close, below fair (0.936)
    pick(2.0, 2.0, { status: 'lost' }), // same price, no fair chance saved
    pick(2.2, 2.0, { start: now + 36e5 }), // not kicked off yet
    pick(2.2, 2.0, { model: '2026.10.15' }), // older rules
    pick(2.2, 2.0, { status: 'void' }),
    pick(2.2, 2.0, { type: 'multi' }),
    pick(2.2, 2.0, { closeAt: now - 10 * 36e5 }), // "closing" price saved 9 hours before kick-off: not the close
  ];
  const c = closingLine(h, now);
  assert.deepEqual([c.n, c.late, c.beat, c.same, c.fairN, c.fairBeat], [3, 1, 1, 1, 2, 1]);
  const t = closeLineText(c);
  assert.equal(t.head, '1 of 3 picks got a better price than the last one before kick-off (1 the same)');
  assert.ok(t.lines.some((l) => /too few to judge yet/.test(l)), 'a thin sample gives counts, never a verdict');
  assert.ok(!t.lines.some((l) => /%/.test(l)));
  assert.ok(t.lines.includes('1 pick had no price saved in the last 3 hours before kick-off and is left out'));
  assert.equal(closeLineText(closingLine([], now)).head, 'No pick under the current rules has kicked off yet');
});

test('a price taken at Stake is followed at Stake, not at the best other book', () => {
  const h = [pick(2.75, null, { start: now + 36e5, atStake: true, book: 'Stake' })];
  const events = [{ id: 'e1', markets: [{ name: 'Match Result', outcomes: [{ name: 'Nice', odds: 2.9, stake: 2.6, cons: 0.37 }, { name: 'Draw', odds: 3.6, cons: 0.27 }] }] }];
  updateClosing(h, events, now);
  assert.equal(h[0].close, 2.6);
  delete events[0].markets[0].outcomes[0].stake;
  updateClosing(h, events, now + 6e5);
  assert.deepEqual([h[0].close, h[0].closeAt], [2.6, now], 'no Stake price in this build: the close stays as last seen at Stake');
});
