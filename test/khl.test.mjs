import test from 'node:test';
import assert from 'node:assert/strict';
import { khlLive, khlEvent, khlRecords } from '../js/khl.js';
import { applyAsiaLive } from '../js/asia-live.js';

// Shapes as the KHL feed (khl.api.webcaster.pro/api/khl_mobile/events_v2) returns them, October 2026.
const team = (khl_id, name, location) => ({ id: khl_id, khl_id, name, location, image: `https://img/${khl_id}.png` });
const ev = (id, a, b, o = {}) => ({ event: { id, khl_id: 900000 + id, game_state_key: 'not_yet_started', period: null, start_at: Date.UTC(2026, 9, 12, 16, 30), score: '0:0',
  scores: { first_period: null, second_period: null, third_period: null, overtime: null, bullitt: null }, team_a: a, team_b: b, location: 'Moscow', stage_name: 'Регулярный чемпионат 2026/2027', ...o } });
const dyn = team(719, 'Динамо М', 'Москва'), cska = team(2, 'ЦСКА', 'Москва'), ska = team(24, 'СКА', 'Санкт-Петербург');

test('KHL: Russian feed names become English clubs; team_a is home; no prices, a model line from records', () => {
  const records = khlRecords([
    ev(1, dyn, cska, { game_state_key: 'finished', score: '3:1', start_at: 1 }),
    ev(2, cska, ska, { game_state_key: 'finished', score: '2:3', start_at: 2, scores: { overtime: '0:1' } }),
    ev(3, ska, dyn, { game_state_key: 'finished', score: '4:2', start_at: 3 }),
  ]);
  assert.deepEqual(records[2], { w: 0, l: 1, otl: 1, form: ['L', 'L'] }, 'CSKA: regulation loss, then an overtime loss');
  const e = khlEvent(ev(10, dyn, cska), records);
  assert.equal(e.home, 'Dynamo Moscow'); assert.equal(e.away, 'CSKA Moscow');
  assert.equal(e.leaguePath, 'atlas/khl'); assert.equal(e.sport, 'hockey'); assert.equal(e.id, 'atlas_khl-10');
  assert.equal(e.stats.homeRecord, '1-1-0'); assert.equal(e.stats.awayRecord, '0-1-1');
  assert.deepEqual(e.markets, []);
});

test('KHL live: score, period, period lines; finished games leave the board', () => {
  const live = khlLive(ev(20, dyn, cska, { game_state_key: 'in_progress', period: 3, score: '2:5', scores: { first_period: '0:1', second_period: '2:3', third_period: '0:1' } }));
  assert.deepEqual(live, { id: 'atlas_khl-20', status: 'live', score: '2 – 5', clock: '3rd period', period: 3, lines: { home: [0, 2, 0], away: [1, 3, 1] } });
  assert.equal(khlLive(ev(21, dyn, cska, { game_state_key: 'finished', score: '3:2', scores: { first_period: '1:0', second_period: '1:1', third_period: '0:1', bullitt: '1:0' } })).clock, 'Final (SO)');
  const events = [khlEvent(ev(20, dyn, cska)), khlEvent(ev(21, ska, dyn))];
  const out = applyAsiaLive(events, { at: Date.now(), games: [live, { id: 'atlas_khl-21', status: 'final' }] });
  assert.equal(out.length, 1, 'the finished game drops off');
  assert.equal(out[0].live, true); assert.equal(out[0].score, '2 – 5'); assert.deepEqual(out[0].lines.home, [0, 2, 0]);
});
