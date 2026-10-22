import test from 'node:test';
import assert from 'node:assert/strict';

// finalview.js reads the watch store, which needs localStorage.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { finalFrom } = await import('../js/finalview.js');

test('finished match: final score, score by period, goals and cards (not missed chances), team stats', () => {
  const sm = {
    header: { competitions: [{ status: { type: { completed: true, detail: 'FT' } }, competitors: [
      { homeAway: 'home', score: '2', team: { id: '1' }, linescores: [{ displayValue: '1' }, { displayValue: '1' }] },
      { homeAway: 'away', score: '1', team: { id: '2' }, linescores: [{ displayValue: '0' }, { displayValue: '1' }] }] }] },
    keyEvents: [
      { type: { text: 'Goal' }, clock: { displayValue: "23'" }, text: 'Goal! Saka', team: { displayName: 'Arsenal' } },
      { type: { text: 'Attempt Saved' }, clock: { displayValue: "30'" }, text: 'Shot saved' },
      { type: { text: 'Yellow Card' }, clock: { displayValue: "41'" }, participants: [{ athlete: { displayName: 'Ampadu' } }], team: { displayName: 'Leeds' } },
    ],
    boxscore: { teams: [{ homeAway: 'home', statistics: [{ name: 'possessionPct', displayName: 'Possession', displayValue: '61' }] }, { homeAway: 'away', statistics: [{ name: 'possessionPct', displayName: 'Possession', displayValue: '39' }] }] },
  };
  const d = finalFrom(sm);
  assert.equal(d.done, true);
  assert.deepEqual([d.home.score, d.away.score], ['2', '1']);
  assert.deepEqual(d.home.lines, ['1', '1']);
  assert.deepEqual(d.moments.map((m) => m.t), ["23'", "41'"]);
  assert.equal(d.moments[1].text, 'Yellow Card · Ampadu');
  assert.deepEqual(d.stats[0].rows[0], { label: 'Possession', abbr: '', home: '61', away: '39' });
});

test('finished match: US sports list scoring plays with the running score, home first', () => {
  const d = finalFrom({ header: { competitions: [{ status: { type: { completed: true } }, competitors: [] }] }, scoringPlays: [{ period: { number: 1 }, clock: { displayValue: '12:01' }, text: 'Goal by Malkin', team: { displayName: 'Penguins' }, homeScore: 1, awayScore: 0 }] });
  assert.deepEqual(d.moments, [{ t: 'P1 12:01', text: 'Goal by Malkin', team: 'Penguins', score: '1–0' }]);
});
