import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeEvent, mergeProbables, samePerson, overlayLive } from '../js/merge.js';

const report = { name: 'Gerrit Cole', season: { era: '3.61' } };

test('a live refresh keeps starter reports, absences and lineups', () => {
  const old = { id: 'm', score: null, probables: [{ side: 'home', name: 'Gerrit Cole', role: 'SP', report }, { side: 'away', name: 'Drew Rasmussen', role: 'SP', report: { name: 'Drew Rasmussen' } }], absences: { home: [{ name: 'Judge' }], away: [] }, predictor: { home: 0.6, away: 0.4 } };
  const fresh = { id: 'm', score: '1 – 0', live: true, probables: [{ side: 'home', id: '32081', name: 'Gerrit Cole', role: 'Probable Starter' }, { side: 'away', id: '9', name: 'Drew Rasmussen' }] };
  const m = mergeEvent(old, fresh);
  assert.equal(m.score, '1 – 0');
  assert.equal(m.probables.find((p) => p.side === 'home').report, report);
  assert.ok(m.probables.find((p) => p.side === 'away').report);
  assert.deepEqual(m.absences, old.absences);
  assert.deepEqual(m.predictor, old.predictor);
});

test('a starter change drops the old report; a feed without starters keeps ours', () => {
  const old = [{ side: 'home', name: 'Gerrit Cole', report }];
  const changed = mergeProbables(old, [{ side: 'home', name: 'Cam Schlittler' }]);
  assert.equal(changed[0].report, undefined);
  assert.equal(changed[0].changedFrom, 'Gerrit Cole');
  assert.equal(mergeProbables(old, [])[0].report, report);
  assert.ok(samePerson('Cole, Gerrit', 'Gerrit Cole') && samePerson('José Ramírez Jr.', 'Jose Ramirez') && !samePerson('Will Smith', 'Joe Smith'));
});

test('a snapshot reload never rolls back a fresher live score or revives a finished game', () => {
  const now = Date.now();
  const snap = [
    { id: 'a', leaguePath: 'x', start: now - 36e5, live: true, score: '0 – 0', fetchedAt: now - 3 * 36e5, probables: [{ side: 'home', report }] },
    { id: 'b', leaguePath: 'x', start: now - 3 * 36e5, live: true, score: '2 – 2', fetchedAt: now - 3 * 36e5 }, // finished since
    { id: 'c', leaguePath: 'x', start: now + 36e5, live: false, fetchedAt: now - 3 * 36e5 },
  ];
  const cur = [{ id: 'a', leaguePath: 'x', start: now - 36e5, live: true, score: '2 – 1', fetchedAt: now - 5e3 }, { id: 'c', leaguePath: 'x', start: now + 36e5, fetchedAt: now - 5e3 }];
  const out = overlayLive(snap, cur);
  assert.deepEqual(out.map((e) => e.id), ['a', 'c']);
  assert.equal(out[0].score, '2 – 1');
  assert.equal(out[0].probables[0].report, report); // snapshot enrichments kept
});
