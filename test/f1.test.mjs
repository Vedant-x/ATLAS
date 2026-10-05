import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionsOf, currentRace, driverForm, expectedPosition, simulateRace, normalizeTrack, liveSession, espnSessions } from '../js/f1.js';

const race = (round, date, extra = {}) => ({ round: String(round), raceName: `GP ${round}`, date, time: '12:00:00Z', ...extra });

test('sessions in order, sprint weekends included', () => {
  const s = sessionsOf(race(17, '2026-10-11', { FirstPractice: { date: '2026-10-09', time: '08:30:00Z' }, SprintQualifying: { date: '2026-10-09', time: '12:30:00Z' }, Sprint: { date: '2026-10-10', time: '09:00:00Z' }, Qualifying: { date: '2026-10-10', time: '13:00:00Z' } }));
  assert.deepEqual(s.map((x) => x.code), ['FP1', 'SQ', 'Sprint', 'Qual', 'Race']);
  assert.equal(s.at(-1).start, Date.parse('2026-10-11T12:00:00Z'));
});

test('the next Grand Prix takes over 6 hours after the previous race', () => {
  const cal = [race(16, '2026-10-04'), race(17, '2026-10-11'), race(18, '2026-10-25')];
  assert.equal(currentRace(cal, Date.parse('2026-10-04T15:00:00Z')).round, '16');
  assert.equal(currentRace(cal, Date.parse('2026-10-04T19:00:00Z')).round, '17');
  assert.equal(currentRace(cal, Date.parse('2026-12-30T00:00:00Z')), null);
});

const res = (d, pos, status = 'Finished') => ({ Driver: { driverId: d }, position: String(pos), positionText: status === 'Finished' ? String(pos) : 'R', status });
test('driver form: averages, last five, retirements', () => {
  const f = driverForm([
    { round: '1', Results: [res('ver', 1), res('nor', 2), res('lec', 3, 'Accident')] },
    { round: '2', Results: [res('ver', 2), res('nor', 1), res('lec', 4)] },
  ], [{ round: '2', QualifyingResults: [{ Driver: { driverId: 'ver' }, position: '1' }] }]);
  assert.equal(f.get('ver').avgFinish, 1.5);
  assert.deepEqual(f.get('lec').last5, ['DNF', '4']);
  assert.ok(f.get('lec').dnfRate > f.get('ver').dnfRate);
  assert.equal(f.get('ver').avgQuali5, 1);
});

test('race model: probabilities add up, the grid matters, favourites look like F1', () => {
  const field = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, name: `Driver ${i}`, team: `Team ${Math.floor(i / 2)}`, dnfRate: 0.08, expected: expectedPosition({ avgFinish5: i + 1.5, avgFinish: i + 2, avgQuali5: i + 1 }) }));
  const m = simulateRace(field, { sims: 8000 });
  const sum = (k) => m.drivers.reduce((s, d) => s + d[k], 0);
  assert.ok(Math.abs(sum('win') - 1) < 1e-9);
  assert.ok(Math.abs(sum('podium') - 3) < 1e-9);
  assert.ok(Math.abs(sum('points') - 10) < 1e-9);
  assert.equal(m.drivers[0].id, 'd0');
  assert.ok(m.drivers[0].win > 0.2 && m.drivers[0].win < 0.55, `favourite ${m.drivers[0].win}`);
  assert.equal(m.h2h.length, 10);
  assert.ok(Math.abs(m.h2h[0].pA + m.h2h[0].pB - 1) < 1e-9);
  // Pole helps: same form, starting 1st vs 10th.
  assert.ok(expectedPosition({ avgFinish5: 5 }, 1) < expectedPosition({ avgFinish5: 5 }, 10));
});

test('circuit outline is centred, scaled to ±1 and downsampled', () => {
  const locs = Array.from({ length: 400 }, (_, i) => ({ x: 1000 + 500 * Math.cos(i / 400 * 2 * Math.PI), y: -300 + 250 * Math.sin(i / 400 * 2 * Math.PI) }));
  const t = normalizeTrack(locs);
  assert.ok(t.points.length >= 200 && t.points.length <= 400);
  assert.ok(Math.max(...t.points.map((p) => Math.abs(p[0]))) <= 1.0001);
  assert.equal(t.transform.cx, 1000);
  assert.equal(normalizeTrack([{ x: 1, y: 2 }]), null);
});

test('live session detection and ESPN classification', () => {
  const s = [{ code: 'Qual', start: Date.parse('2026-10-10T13:00:00Z') }, { code: 'Race', start: Date.parse('2026-10-11T12:00:00Z') }];
  assert.equal(liveSession(s, Date.parse('2026-10-11T13:30:00Z')).code, 'Race');
  assert.equal(liveSession(s, Date.parse('2026-10-11T09:00:00Z')), null);
  const e = espnSessions({ competitions: [{ type: { abbreviation: 'Race' }, date: '2026-10-04T07:00Z', status: { type: { state: 'post', shortDetail: 'Final' } }, competitors: [{ order: 2, athlete: { displayName: 'Kimi Antonelli' } }, { order: 1, winner: true, athlete: { displayName: 'Max Verstappen' } }] }] });
  assert.equal(e[0].order[0].name, 'Max Verstappen');
});
