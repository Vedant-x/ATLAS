import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameTeam, absencesFor } from '../js/fotmob.js';

test('team names match on distinctive words, accents ignored', () => {
  assert.ok(sameTeam('Leeds United', 'Leeds'));
  assert.ok(sameTeam('Atlético Madrid', 'Atletico de Madrid'));
  assert.ok(sameTeam('France', 'France'));
  assert.ok(!sameTeam('France', 'Italy'));
});

test('absences are linked by kickoff and team names', async () => {
  const start = Date.parse('2026-10-10T18:45:00Z');
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => (String(url).includes('matchDetails')
      ? { content: { lineup: { lineupType: 'predicted', homeTeam: { unavailable: [{ name: 'Kylian Mbappé', unavailability: { type: 'injury', expectedReturn: 'Late October 2026', lastUpdated: '2026-10-01T10:00:00Z' } }] }, awayTeam: { unavailable: [{ name: 'X', unavailability: { type: 'suspension', expectedReturn: 'Doubtful' } }] } } } }
      : { leagues: [{ name: 'Nations League', matches: [
        { id: 1, home: { name: 'Spain' }, away: { name: 'Portugal' }, status: { utcTime: '2026-10-10T18:45:00Z' } },
        { id: 2, home: { name: 'France' }, away: { name: 'Italy' }, status: { utcTime: '2026-10-10T18:45:00Z' } },
      ] }] }),
  });
  try {
    const a = await absencesFor({ home: 'France', away: 'Italy', start });
    assert.equal(a.matchId, 2);
    assert.deepEqual(a.home.map((p) => [p.name, p.type, p.expectedReturn]), [['Kylian Mbappé', 'Injured', 'Late October 2026']]);
    assert.equal(a.away[0].type, 'Suspended');
    assert.equal(await absencesFor({ home: 'Germany', away: 'Netherlands', start }), null);
  } finally { globalThis.fetch = real; }
});
