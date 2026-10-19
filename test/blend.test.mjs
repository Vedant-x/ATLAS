import test from 'node:test';
import assert from 'node:assert/strict';
import { calibration, calibrated, marketChance } from '../js/track.js';

// Settled picks where the price was right and ATLAS was overconfident: 1.50 favourites (price ~64%)
// that ATLAS rated 85% and that won 64% of the time.
const settled = (n, { p = 0.85, odds = 1.5, rate = 0.64, sport = 'hockey', market = 'Moneyline' } = {}) =>
  Array.from({ length: n }, (_, i) => ({ type: 'banker', eventId: `${sport}-${market}-${i}`, market, pick: `T${i}`, sport, p, odds, status: Math.floor((i + 1) * rate) > Math.floor(i * rate) ? 'won' : 'lost' }));

test('the record learns to lean toward the price where the price predicted better', () => {
  const cal = calibration(settled(120));
  const r = cal['hockey:winner'];
  assert.ok(r.w < 0.6, `weight on ATLAS ${r.w}`);
  assert.ok(r.brier.blend < r.brier.model, 'the blend scores better than ATLAS alone');
  const shown = calibrated(0.85, 'Moneyline', cal, 'hockey', 1.5);
  assert.ok(shown < 0.78 && shown > marketChance(1.5), `shown ${shown}`);
});

test('few settled picks barely move the estimate; no price means no blend', () => {
  const cal = calibration(settled(12));
  const r = cal['hockey:winner'];
  assert.ok(r.w > 0.75, `a small sample keeps most weight on ATLAS: ${r.w}`);
  assert.equal(calibrated(0.7, 'Moneyline', {}, 'hockey', 1.5), 0.7, 'no record: unchanged');
  assert.equal(calibrated(0.7, 'Moneyline', { winner: { factor: 1, w: 0.2, blendFactor: 1 } }, 'hockey'), 0.7, 'no price: not blended');
});

test('where ATLAS beat the price the weight stays on ATLAS', () => {
  // ATLAS said 80% at 1.60 (price ~60%) and they won 80% of the time.
  const cal = calibration(settled(100, { p: 0.8, odds: 1.6, rate: 0.8 }));
  assert.ok(cal['hockey:winner'].w > 0.95, `weight ${cal['hockey:winner'].w}`);
});

test('a prop shows one chance everywhere: the calibrated one, never calibrated twice', async () => {
  const { shownProp, calibration, calibrated } = await import('../js/track.js');
  const cal = calibration(Array.from({ length: 60 }, (_, i) => ({ type: 'banker', eventId: `p${i}`, market: 'Player points', pick: `P${i}`, sport: 'basketball', odds: 1.8, p: 0.6, status: i % 2 ? 'won' : 'lost' })));
  const raw = { id: '1', p: 0.6, odds: 1.8 };
  const once = shownProp(raw, 'Player points', cal, 'basketball');
  assert.equal(once.p, calibrated(0.6, 'Player points', cal, 'basketball', 1.8));
  assert.equal(once.pRaw, 0.6);
  assert.deepEqual(shownProp(once, 'Player points', cal, 'basketball'), once, 'applying it again changes nothing');
});
