import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNpbScoreboard, kboLive, applyAsiaLive } from '../js/asia-live.js';

// Real npb.jp header markup (pre-game), plus in-play and finished variants of the same block.
const box = (score, state) => `<div class="score_box"> <a href="/scores/2026/1005/e-h-25/"> <div> <img src="/img/common/logo/2026/logo_e_s.gif" class="logo_left"> <img src="/img/common/logo/2026/logo_h_s.gif" class="logo_right"> <div class="score">${score}</div> <div class="state">${state}</div> </div> </a> </div>`;

test('NPB scoreboard: before, during and after a game', () => {
  const [pre] = parseNpbScoreboard(box('-', '（楽天モバイル）<br class="hide_pc">18:00'));
  assert.deepEqual([pre.id, pre.status, pre.score], ['atlas_npb-20261005-e-h', 'pre', null]);
  const [live] = parseNpbScoreboard(box('3-2', '7回裏'));
  assert.deepEqual([live.status, live.score, live.clock, live.period], ['live', '3 – 2', 'Bot 7th', 7]);
  const [fin] = parseNpbScoreboard(box('5-4', '試合終了'));
  assert.equal(fin.status, 'final');
});

test('KBO rows map to live states with innings', () => {
  const [g] = kboLive([{ G_ID: '20261005LGHT0', GAME_STATE_SC: '2', CANCEL_SC_ID: '0', B_SCORE_CN: '4', T_SCORE_CN: '1', GAME_INN_NO: '6', GAME_TB_SC: 'T' }]);
  assert.deepEqual([g.id, g.status, g.score, g.clock], ['atlas_kbo-20261005LGHT0', 'live', '4 – 1', 'Top 6th']);
  assert.equal(kboLive([{ G_ID: 'x', GAME_STATE_SC: '3', CANCEL_SC_ID: '0' }])[0].status, 'final');
  assert.equal(kboLive([{ G_ID: 'y', GAME_STATE_SC: '1', CANCEL_SC_ID: '1' }])[0].status, 'cancelled');
});

test('live file updates scores, keeps starters, and removes finished games', () => {
  const report = { name: 'Starter' };
  const events = [
    { id: 'atlas_kbo-A', live: false, score: null, probables: [{ side: 'home', report }] },
    { id: 'atlas_kbo-B', live: true, score: '1 – 0' },
    { id: 'other', live: false },
  ];
  const out = applyAsiaLive(events, { at: 1, games: [{ id: 'atlas_kbo-A', status: 'live', score: '0 – 0', clock: 'Top 1st' }, { id: 'atlas_kbo-B', status: 'final', score: '3 – 2' }] });
  assert.deepEqual(out.map((e) => e.id), ['atlas_kbo-A', 'other']);
  assert.equal(out[0].live, true);
  assert.equal(out[0].probables[0].report, report);
  assert.equal(applyAsiaLive(out, { at: 2, games: [{ id: 'atlas_kbo-A', status: 'live', score: '0 – 0', clock: 'Top 1st' }] }), null); // nothing changed
});

test('NPB box score gives both starters (first pitcher in each table), home = bottom table', async () => {
  const { npbBoxStarters } = await import('../js/asia-live.js');
  const html = '<div id="table_top_p"><table id="tablefix_t_p"><tr><td class="player"><a href="/bis/players/81585138.html">上茶谷</a></td></tr></table></div>'
    + '<div id="table_bottom_p"><table id="tablefix_b_p"><tr><td class="player"><a href="/bis/players/51655114.html">前田健</a></td></tr><tr><td><a href="/bis/players/12345678.html">x</a></td></tr></table></div>';
  assert.deepEqual(npbBoxStarters(html), { home: '51655114', away: '81585138' });
  assert.equal(npbBoxStarters('<p>pre-game</p>'), null);
});
