import test from 'node:test';
import assert from 'node:assert/strict';
import { liveMoments } from '../js/livealerts.js';

const comp = (status, hs, as) => ({ header: { competitions: [{ status, competitors: [
  { homeAway: 'home', score: hs, team: { id: '1', shortDisplayName: 'Arsenal' } },
  { homeAway: 'away', score: as, team: { id: '2', shortDisplayName: 'Leeds' } }] }] } });
const e = { id: 'm1', sport: 'football', home: 'Arsenal', away: 'Leeds' };

test('soccer: goals with scorer and minute, cards, half-time and full time', () => {
  const sm = { ...comp({ period: 1, type: { name: 'STATUS_HALFTIME', state: 'in', detail: 'Halftime' } }, '1', '0'),
    keyEvents: [
      { id: 'k1', type: { text: 'Kickoff' }, clock: { displayValue: "0'" } },
      { id: 'k2', type: { text: 'Goal' }, scoringPlay: true, clock: { displayValue: "23'" }, team: { id: '1', displayName: 'Arsenal' }, participants: [{ athlete: { displayName: 'Bukayo Saka' } }] },
      { id: 'k3', type: { text: 'Yellow Card' }, clock: { displayValue: "41'" }, team: { id: '2', displayName: 'Leeds United' }, participants: [{ athlete: { displayName: 'Ethan Ampadu' } }] },
      { id: 'k4', type: { text: 'Red Card' }, clock: { displayValue: "44'" }, team: { id: '2', displayName: 'Leeds United' }, participants: [{ athlete: { displayName: 'Joe Rodon' } }] },
    ] };
  const m = liveMoments(sm, e);
  assert.deepEqual(m.map((x) => x.kind), ['score', 'card', 'card', 'period']);
  assert.match(m[0].body, /Goal · Bukayo Saka \(Arsenal\) 23'/);
  assert.match(m[1].body, /^Yellow card · Ethan Ampadu/);
  assert.match(m[2].body, /^Red card · Joe Rodon/);
  assert.equal(m[3].body, 'Half-time');
  assert.equal(m[3].title, 'Arsenal 1–0 Leeds');
  assert.equal(new Set(m.map((x) => x.key)).size, m.length, 'every moment has its own key');
  const ft = liveMoments(comp({ period: 2, type: { name: 'STATUS_FULL_TIME', state: 'post', detail: 'FT' } }, '2', '1'), e);
  assert.deepEqual(ft.map((x) => [x.kind, x.title, x.body]), [['final', 'Arsenal 2–1 Leeds', 'Full time']]);
});

test('baseball: every scoring play with the score after it; basketball only periods and final', () => {
  const b = { id: 'b1', sport: 'baseball', home: 'Yankees', away: 'Rays' };
  const sm = { ...comp({ period: 5, type: { name: 'STATUS_IN_PROGRESS', state: 'in' } }, '3', '1'),
    scoringPlays: [{ id: 'p1', type: { text: 'Home Run' }, period: { displayValue: '5th Inning' }, team: { id: '1' }, text: 'Judge homered to left (405 feet).', homeScore: 3, awayScore: 1 }] };
  const m = liveMoments(sm, b);
  assert.equal(m.length, 1);
  assert.equal(m[0].title, 'Arsenal 3–1 Leeds'.replace('Arsenal', 'Arsenal')); // names come from the feed's short names
  assert.match(m[0].body, /^Home Run · Arsenal \(5th Inning\): Judge homered/);
  const nba = { id: 'n1', sport: 'basketball', home: 'A', away: 'B' };
  const q = liveMoments({ ...comp({ period: 2, type: { name: 'STATUS_END_PERIOD', state: 'in', detail: 'End of 2nd Quarter' } }, '55', '50'), scoringPlays: [{ id: 'x', text: 'layup', homeScore: 55, awayScore: 50 }] }, nba);
  assert.deepEqual(q.map((x) => [x.kind, x.body]), [['period', 'End of 2nd Quarter']]);
});
