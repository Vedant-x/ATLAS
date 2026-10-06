import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshot, changes } from '../js/alerts.js';

const ev = (o = {}) => ({ id: 'm', home: 'Yankees', away: 'Rays', start: Date.now() + 3 * 36e5, live: false, score: null,
  probables: [{ side: 'home', name: 'Cole' }, { side: 'away', name: 'Rasmussen' }], absences: { home: [], away: [] },
  markets: [{ name: 'Winner', outcomes: [{ name: 'Yankees', odds: 1.8 }, { name: 'Rays', odds: 2.05 }] }], ...o });

test('alerts fire for starter changes, new absences, big price moves, kick-off and score changes', () => {
  const at = Date.now();
  const before = { ...snapshot(ev()), checkedAt: at - 6e4 };
  const kinds = (e) => changes(e, before, snapshot(e), at).map((m) => m.kind);
  assert.deepEqual(kinds(ev()), []);
  assert.deepEqual(kinds(ev({ probables: [{ side: 'home', name: 'Schlittler' }, { side: 'away', name: 'Rasmussen' }] })), ['starter']);
  assert.deepEqual(kinds(ev({ absences: { home: [{ name: 'Judge' }], away: [] } })), ['injury']);
  assert.deepEqual(kinds(ev({ markets: [{ name: 'Winner', outcomes: [{ name: 'Yankees', odds: 1.6 }, { name: 'Rays', odds: 2.05 }] }] })), ['price']);
  assert.deepEqual(kinds(ev({ markets: [{ name: 'Winner', outcomes: [{ name: 'Yankees', odds: 1.85 }, { name: 'Rays', odds: 2.0 }] }] })), []); // small moves ignored
  assert.deepEqual(kinds(ev({ start: at + 10 * 6e4 })), ['time', 'soon']); // moved forward 170 min, and now starting soon
  const liveBefore = { ...snapshot(ev({ live: true, score: '0 – 0' })), checkedAt: at };
  assert.deepEqual(changes(ev({ live: true, score: '1 – 0' }), liveBefore, snapshot(ev({ live: true, score: '1 – 0' })), at).map((m) => m.kind), ['score']);
  assert.deepEqual(changes(ev(), null, snapshot(ev()), at), []); // first sighting: no alert
});
