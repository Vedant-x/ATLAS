import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceStats, compareServices } from '../js/compare.js';

const sels = (wins, losses, odds = 1.9) => [...Array(wins).fill('won'), ...Array(losses).fill('lost')].map((status, i) => ({ date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, odds, status }));

test('one service in the comparison format: abstentions, drawdown, ROI interval', () => {
  const s = serviceStats({ service: 'ATLAS', evidence: 'ledger', opportunities: 30, selections: [{ date: '2026-10-01', odds: 2, status: 'lost' }, { date: '2026-10-02', odds: 2, status: 'lost' }, { date: '2026-10-03', odds: 2, status: 'won' }, { date: '2026-10-04', odds: 2, status: 'void' }] });
  assert.equal(s.abstentions, 26);
  assert.equal(s.won, 1); assert.equal(s.lost, 2); assert.equal(s.void, 1);
  assert.equal(s.profit, -1);
  assert.equal(s.maxDrawdown, 2);
  assert.equal(s.evidence, 'Reproduced from a complete ledger');
  assert.ok(s.roiCI[0] < s.roi && s.roi < s.roiCI[1]);
});

test('services are ranked only within one evidence category and kind, and only when the evidence separates them', () => {
  const close = compareServices([
    { service: 'A', evidence: 'ledger', selections: sels(55, 45) },
    { service: 'B', evidence: 'ledger', selections: sels(52, 48) },
    { service: 'C', evidence: 'provider', selections: sels(90, 10) }, // a provider claim is never ranked against ledgers
  ]);
  const ledger = close.find((g) => g.evidence === 'Reproduced from a complete ledger');
  assert.equal(ledger.verdict, 'insufficient evidence to rank');
  assert.equal(ledger.ranking, null);
  assert.equal(close.find((g) => g.evidence === 'Provider-reported').verdict, 'one service: nothing to rank');
  const apart = compareServices([{ service: 'A', evidence: 'ledger', selections: sels(700, 300) }, { service: 'B', evidence: 'ledger', selections: sels(400, 600) }]);
  assert.deepEqual(apart[0].ranking, ['A', 'B']);
});
