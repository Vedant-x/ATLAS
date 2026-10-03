import test from 'node:test';
import assert from 'node:assert/strict';
import { lineProblems, validateReport } from '../js/validate.js';

test('a shifted KBO career line (ERA 82 = appearances) is rejected', () => {
  // Real values for James Naile: 82 G, 2.76 ERA. Shifted columns put 82 into ERA.
  assert.ok(lineProblems({ era: '82', g: '45', ip: '470.2', er: '144' }).length > 0);
  assert.deepEqual(lineProblems({ era: '2.76', g: '82', ip: '470.2', er: '144' }), []);
});

test('ERA must agree with earned runs and innings', () => {
  assert.deepEqual(lineProblems({ era: '3.62', ip: '710.1', er: '286' }), []);
  assert.ok(lineProblems({ era: '1.50', ip: '710.1', er: '286' }).some((p) => /gives 3.62/.test(p)));
  assert.deepEqual(lineProblems({ era: '-.--', ip: '0.0', er: '0' }), []); // no innings: not an error
});

test('recent rows with fractional earned runs are dropped and the report keeps the rest', () => {
  const warns = [];
  const r = validateReport({ league: 'KBO', name: 'Test', season: { era: '3.45', ip: '120.0', er: '46', g: '21', w: '8', l: '3' },
    recent: [{ date: '2026-09-27', ip: '6.0', h: '5', er: '0.261', bb: '1', so: '7' }, { date: '2026-09-21', ip: '6.1', h: '4', er: '1', bb: '0', so: '8' }] }, (m) => warns.push(m));
  assert.equal(r.recent.length, 1);
  assert.equal(r.recent[0].er, '1');
  assert.ok(r.season);
  assert.match(warns.join(' '), /dropped 1 recent/);
});
