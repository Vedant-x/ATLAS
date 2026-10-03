import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCricket, sectionOf } from '../js/cricket.js';
import { analyse } from '../js/models.js';

const ev = (id, cls, state, start, home = 'India', away = 'West Indies') => ({ id, competitions: [{ date: new Date(start).toISOString(), class: cls, neutralSite: false, description: '1st Test', status: { type: { state, detail: 'Day 2' }, summary: 'Stumps' },
  competitors: [{ homeAway: 'home', score: state === 'in' ? '321/4 (90 ov)' : '', team: { displayName: home, color: '1f4fa0' } }, { homeAway: 'away', score: '', team: { displayName: away } }] }] });

test('score panel becomes ATLAS cricket events filed by type', () => {
  const now = Date.now();
  const json = { scores: [
    { leagues: [{ id: '24289', name: 'West Indies tour of India' }], events: [ev('1', { internationalClassId: '1', eventType: 'Test' }, 'in', now - 864e5), ev('2', { internationalClassId: '1', eventType: 'Test' }, 'post', now - 3 * 864e5)] },
    { leagues: [{ id: '24139', name: 'Canada Super60' }], events: [ev('3', { internationalClassId: '0', eventType: 'T10' }, 'pre', now + 36e5, 'Toronto', 'Montreal'), ev('4', { internationalClassId: '0' }, 'pre', now + 36e5, 'TBA', 'Montreal')] },
  ] };
  const out = parseCricket(json, now);
  assert.deepEqual(out.map((e) => e.id), ['cricket-1', 'cricket-3']); // finished and TBA dropped
  assert.equal(out[0].leaguePath, 'atlas/cricket-intl');
  assert.equal(out[1].leaguePath, 'atlas/cricket-t20');
  assert.match(out[0].score, /321\/4/);
  assert.equal(sectionOf({ internationalClassId: '0', eventType: 'ODI' }, 'National Cricket League'), 'atlas/cricket-dom');
  // Tests carry a draw chance; home side favoured off a neutral ground.
  const a = analyse(out[0]);
  assert.ok(a.win.draw > 0.2 && a.win.home > a.win.away);
});
