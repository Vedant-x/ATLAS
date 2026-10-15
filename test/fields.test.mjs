import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGolf, golfForm, golfChances, parseStandings, raceChances, raceResult, toPar } from '../js/fields.js';

// A field of 30: player k shoots 68 + k/10 each round (better players lower).
const round = (n, strokes, holes = 18) => ({ period: n, value: strokes, displayValue: String(strokes - 71), linescores: Array.from({ length: holes }, () => ({})) });
const espnEvent = (id, rounds, { state = 'post', lead = null } = {}) => ({
  id, name: `Event ${id}`, date: '2026-10-08T04:00Z', endDate: '2026-10-11T04:00Z',
  competitions: [{ status: { period: rounds, type: { state } }, competitors: Array.from({ length: 30 }, (_, k) => {
    const rs = Array.from({ length: rounds }, (_, r) => round(r + 1, 68 + Math.round(k / 3)));
    const total = rs.reduce((a, r) => a + r.value - 71, 0) + (lead && k === 29 ? lead : 0);
    return { id: `p${k}`, order: k + 1, athlete: { displayName: `Player ${k}`, flag: { alt: 'USA' } }, score: total === 0 ? 'E' : String(total), linescores: rs };
  }) }],
});

test('to-par strings', () => {
  assert.equal(toPar('E'), 0); assert.equal(toPar('-16'), -16); assert.equal(toPar('+3'), 3); assert.equal(toPar(''), null);
});

test('golf: form from past events favours the players who beat the field', () => {
  const past = [parseGolf(espnEvent('1', 4), 'pga'), parseGolf(espnEvent('2', 4), 'pga')];
  const form = golfForm(past);
  assert.ok(form.get('p0').d > 0 && form.get('p29').d < 0);
  const next = parseGolf(espnEvent('3', 0, { state: 'pre' }), 'pga');
  const ch = golfChances(next, form, { sims: 4000 });
  assert.equal(ch.length, 30);
  const sum = ch.reduce((a, x) => a + x.win, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `win chances sum to 1: ${sum}`);
  const best = ch.find((x) => x.id === 'p0'), worst = ch.find((x) => x.id === 'p29');
  assert.ok(best.win > worst.win * 3, `${best.win} vs ${worst.win}`);
  assert.ok(best.top20 > best.top10 && best.top10 > best.top5 && best.top5 >= best.win);
});

test('golf: a big lead with one round left makes the leader a strong favourite', () => {
  const live = parseGolf(espnEvent('4', 3, { state: 'in' }), 'pga');
  const best = Math.min(...live.field.map((p) => p.toPar));
  live.field.find((p) => p.id === 'p29').toPar = best - 12; // 12 clear after 54 holes
  const ch = golfChances(live, new Map(), { sims: 4000 });
  assert.ok(ch[0].id === 'p29' && ch[0].win > 0.8, JSON.stringify(ch[0]));
  assert.equal(ch[0].left, 18);
});

test('golf: a finished event gives the winner certainty', () => {
  const done = parseGolf(espnEvent('5', 4), 'pga');
  const ch = golfChances(done, new Map(), { sims: 2000 });
  assert.equal(ch[0].left, 0);
  assert.ok(ch[0].win > 0.3, 'the lowest score wins (ties split)');
});

test('racing: standings parse and drivers with wins are favoured', () => {
  const st = (name, v) => ({ name, value: v });
  const j = { children: [{ standings: { entries: [
    { athlete: { id: '1', displayName: 'A Winner' }, stats: [st('rank', 1), st('points', 900), st('starts', 30), st('wins', 6), st('top5', 15), st('top10', 20)] },
    { athlete: { id: '2', displayName: 'B Steady' }, stats: [st('rank', 2), st('points', 850), st('starts', 30), st('wins', 1), st('top5', 10), st('top10', 22)] },
    ...Array.from({ length: 30 }, (_, i) => ({ athlete: { id: `x${i}`, displayName: `Driver ${i}` }, stats: [st('rank', i + 3), st('points', 600 - i * 15), st('starts', 30), st('wins', 0), st('top5', 1), st('top10', 3)] })),
  ] } }] };
  const d = parseStandings(j);
  assert.equal(d[0].name, 'A Winner'); assert.equal(d[0].wins, 6); assert.equal(d[0].points, 900);
  const ch = raceChances(d, { sims: 4000 });
  assert.equal(ch[0].name, 'A Winner');
  assert.ok(Math.abs(ch.reduce((a, x) => a + x.win, 0) - 1) < 1e-9);
  assert.ok(ch[0].win < 0.4, `a field of 32 keeps the favourite well short of certain: ${ch[0].win}`);
});

test('racing: last result from a finished scoreboard event', () => {
  const ev = { name: 'GP', date: '2026-09-06T18:30Z', competitions: [{ status: { type: { state: 'post' } }, competitors: [{ order: 2, athlete: { displayName: 'B' } }, { order: 1, athlete: { displayName: 'A' } }] }] };
  assert.deepEqual(raceResult(ev).top, ['A', 'B']);
  assert.equal(raceResult({ competitions: [{ status: { type: { state: 'pre' } } }] }), null);
});

test('golf: a round in progress is not taken for a finished one, and play-complete is still in progress', () => {
  const ev = { id: '7', name: 'Shanghai', date: new Date(Date.now() - 864e5).toISOString(), endDate: new Date(Date.now() + 2 * 864e5).toISOString(),
    competitions: [{ status: { period: 1, type: { state: 'post', completed: false } }, competitors: [
      { id: 'a', order: 1, athlete: { displayName: 'A' }, score: '-8', linescores: [{ period: 1, value: 48, displayValue: '-8' }] },
      ...Array.from({ length: 30 }, (_, k) => ({ id: `b${k}`, order: k + 2, athlete: { displayName: `B${k}` }, score: '-3', linescores: [{ period: 1, value: 69, displayValue: '-3' }] })),
    ] }] };
  const e = parseGolf(ev, 'lpga');
  assert.equal(e.state, 'in');
  assert.equal(e.field[0].rounds[0].holes, 12);
  assert.equal(golfForm([e]).get('a'), undefined, 'a partial round adds no strength');
  const ch = golfChances(e, new Map(), { sims: 4000 });
  assert.ok(ch[0].id === 'a' && ch[0].win < 0.6, `a five-shot lead with 60 holes left is far from certain: ${ch[0].win}`);
});
