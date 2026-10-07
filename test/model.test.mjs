import test from 'node:test';
import assert from 'node:assert/strict';
import { applyModel } from '../js/intel.js';
import { calibration, calibrated, diversify } from '../js/track.js';
import { bankerSlips } from '../js/picks.js';

const now = Date.parse('2026-10-07T08:00:00Z');
const nhl = (i, o = {}) => ({ id: `n${i}`, sport: 'hockey', league: 'NHL', home: `H${i}`, away: `A${i}`, start: now + 36e5, compId: String(i),
  stats: { homeRecord: '20-5-2', awayRecord: '8-17-2', homeForm: ['W', 'W', 'W', 'L', 'W'], awayForm: ['L', 'L', 'W', 'L', 'L'] }, records: { home: { home: '12-1-1' }, away: { road: '3-10-1' } },
  markets: [{ name: 'Winner', outcomes: [{ name: `H${i}`, odds: 1.7 }, { name: `A${i}`, odds: 2.2 }] },
    { name: 'Spread', line: -1.5, outcomes: [{ name: `H${i} -1.5`, odds: 2.9 }, { name: `A${i} +1.5`, odds: 1.37 }] },
    { name: 'Total 6.5', outcomes: [{ name: 'Over 6.5', odds: 2.0 }, { name: 'Under 6.5', odds: 1.8 }] }], ...o });

test('the model moves the spread line with the win chance instead of repeating its price', () => {
  const [e] = applyModel([nhl(1)]);
  const win = e.markets[0], sp = e.markets[1];
  assert.ok(win.outcomes[0].model > 1 / 1.7 / (1 / 1.7 + 1 / 2.2), 'strong home record lifts the home win chance');
  assert.ok(sp.outcomes[0].model != null && sp.outcomes[1].model != null, 'spread gets model values');
  const fairDog = (1 / 1.37) / (1 / 1.37 + 1 / 2.9);
  assert.ok(sp.outcomes[1].model < fairDog, 'the weaker side covering +1.5 becomes less likely when the favourite looks stronger');
  assert.ok(Math.abs(sp.outcomes[0].model + sp.outcomes[1].model - 1) < 1e-3);
  assert.deepEqual(sp.modelInputs, ['records']);
});

test('baseball starters and soccer absences feed the model', () => {
  const sp = (era) => ({ report: { league: 'MLB', season: { era: String(era) }, form3: { era: String(era) } } });
  const mk = (h, a) => ({ id: 'b', sport: 'baseball', league: 'MLB', home: 'NYY', away: 'TB', start: now, probables: [{ side: 'home', ...sp(h) }, { side: 'away', ...sp(a) }],
    markets: [{ name: 'Winner', outcomes: [{ name: 'NYY', odds: 1.8 }, { name: 'TB', odds: 2.05 }] }] });
  const [ace] = applyModel([mk(2.4, 5.6)]), [bad] = applyModel([mk(5.6, 2.4)]);
  assert.ok(ace.markets[0].outcomes[0].model > bad.markets[0].outcomes[0].model);
  assert.ok(ace.markets[0].modelInputs.includes('starting pitchers'));
  const soc = (h, a) => applyModel([{ id: 's', sport: 'football', league: 'EPL', home: 'X', away: 'Y', start: now, absences: { home: h, away: a },
    markets: [{ name: 'Match Result', outcomes: [{ name: 'X', odds: 2.0 }, { name: 'Draw', odds: 3.5 }, { name: 'Y', odds: 3.8 }] }] }])[0].markets[0].outcomes[0].model;
  assert.ok(soc([], [{}, {}, {}]) > soc([{}, {}, {}], []), 'more absentees on a side lowers its chance');
});

test('track-record correction is per sport once a sport has enough settled picks', () => {
  const pick = (sport, status) => ({ type: 'banker', market: 'Spread', sport, p: 0.7, status });
  const h = [...Array.from({ length: 10 }, (_, i) => pick('hockey', i < 5 ? 'won' : 'lost')), ...Array.from({ length: 20 }, () => pick('football', 'won'))];
  const cal = calibration(h);
  assert.ok(calibrated(0.7, 'Spread', cal, 'hockey') < 0.6, 'hockey spreads that land 50% at 70% estimates are marked down');
  assert.ok(calibrated(0.7, 'Spread', cal, 'football') >= 0.7);
});

test('pick lists and slips are varied: no single bet type fills them', () => {
  const list = [...Array.from({ length: 10 }, (_, i) => ({ event: { id: `s${i}`, sport: 'hockey' }, market: 'Spread', p: 0.72 })),
    ...Array.from({ length: 4 }, (_, i) => ({ event: { id: `w${i}`, sport: 'basketball' }, market: 'Winner', p: 0.68 }))];
  const out = diversify(list, 10);
  assert.ok(out.filter((b) => b.market === 'Spread').length <= 5, 'spreads capped at half on a thin board');
  assert.equal(out.filter((b) => b.market === 'Winner').length, 4);
  const evs = Array.from({ length: 10 }, (_, i) => nhl(i, { stats: {} })).concat(Array.from({ length: 6 }, (_, i) => ({ id: `w${i}`, sport: 'basketball', league: 'NBA', home: `BH${i}`, away: `BA${i}`, start: now + 36e5,
    markets: [{ name: 'Winner', outcomes: [{ name: `BH${i}`, odds: 1.35 }, { name: `BA${i}`, odds: 3.3 }] }] })));
  const slip = bankerSlips(evs, 5, { count: 1, minOdds: 1.3 })[0];
  const spreads = slip.legs.filter((l) => l.market === 'Spread').length;
  assert.ok(spreads <= Math.max(2, Math.ceil(slip.legs.length / 2)), `slip legs ${slip.legs.map((l) => l.market).join(',')}`);
});
