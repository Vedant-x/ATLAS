import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEvents, checkSources, checkHealth } from '../js/contract.js';
import { siteData } from './fixtures/site.mjs';

test('data contract: the test board passes; broken shapes are named', () => {
  assert.deepEqual(checkEvents(siteData().events), []);
  const ok = { id: 'a', sport: 'football', leaguePath: 'soccer/eng.1', home: 'A', away: 'B', start: Date.UTC(2026, 9, 25), markets: [] };
  const p = checkEvents([
    ok, { ...ok }, // duplicate
    { ...ok, id: 'b', leaguePath: 'soccer/nowhere' },
    { ...ok, id: 'c', start: '2026-10-25' },
    { ...ok, id: 'd', markets: [{ name: 'Winner', outcomes: [{ name: 'A', odds: 0.9 }, { name: 'B', odds: 2 }] }] },
    { ...ok, id: 'e', markets: [{ name: 'Winner', outcomes: [{ name: 'A', odds: 1.5, cons: 0.7 }, { name: 'B', odds: 2.5, cons: 0.5 }] }] },
  ]);
  assert.equal(p.length, 5, p.join('\n'));
  assert.match(p.join('\n'), /duplicate id[\s\S]*not in the catalog[\s\S]*not a time[\s\S]*odds 0\.9[\s\S]*add up to 1\.200/);
  assert.deepEqual(checkEvents([ok], { minEvents: 10 }), ['only 1 events (expected at least 10)']);
  assert.deepEqual(checkSources({ sources: [{ name: 'ESPN', ok: true, status: 'ok' }] }), []);
  assert.equal(checkSources({ sources: [{ name: 'X', ok: 'yes', status: 'fine' }] }).length, 2);
  assert.deepEqual(checkHealth({ ok: true, level: 'degraded', problems: [], alerts: [] }), []);
  assert.equal(checkHealth({}).length, 3);
});
