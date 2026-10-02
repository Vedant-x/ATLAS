import test from 'node:test';
import assert from 'node:assert/strict';
import { fromServer, groupStake } from '../js/feed.js';
import { parseESPN } from '../api/feeds.mjs';
import { devig, buildSlips } from '../js/engine.js';
import { applyModel, bankers } from '../js/intel.js';

const now = Date.parse('2026-10-02T06:00:00Z');
const fresh = new Date(now - 60000).toISOString();
const stake = (id, side, odds, extra = {}) => ({ id: `stake:9:ML:0:${side}`, event_id: '9', event: 'Arsenal FC vs Ipswich Town', participants: ['Arsenal FC', 'Ipswich Town'],
  sport: 'Football', league: 'Premier League', start: '2026-10-02T14:00:00Z', bookmaker: 'Stake', market: 'ML', selection: id, odds, updated_at: fresh, ...extra });
const feedEvent = { id: 'espn:soccer/eng.1:1', sport: 'Soccer', league: 'Premier League', name: 'Arsenal vs Ipswich Town', start: '2026-10-02T14:00:00Z', state: 'scheduled',
  competitors: [{ name: 'Arsenal', side: 'home', record: '6-1-0' }, { name: 'Ipswich Town', side: 'away', record: '0-2-5' }],
  reference_odds: { bookmaker: 'DraftKings', markets: [{ name: 'Match Result', outcomes: [{ name: 'Arsenal', odds: 1.22 }, { name: 'Draw', odds: 6.5 }, { name: 'Ipswich Town', odds: 12 }] }] } };

test('Stake prices replace the reference line when the teams match', () => {
  const sel = [stake('Arsenal FC', 'home', 1.25), stake('Draw', 'draw', 6), stake('Ipswich Town', 'away', 11)];
  const [e] = fromServer({ events: [feedEvent], odds: { selections: sel } }, now);
  assert.equal(e.bookmaker, 'Stake');
  assert.deepEqual(e.markets[0].outcomes.map((o) => o.odds), [1.25, 6, 11]);
});

test('without Stake prices the ESPN reference line is used and labelled', () => {
  const [e] = fromServer({ events: [feedEvent], odds: { selections: [] } }, now);
  assert.match(e.bookmaker, /not Stake/);
  assert.equal(e.markets[0].outcomes[0].odds, 1.22);
  assert.equal(e.stats.homeRecord, '6-1-0');
});

test('stale or started Stake prices are dropped', () => {
  const old = new Date(now - 6 * 60000).toISOString();
  assert.equal(groupStake([stake('A', 'home', 2, { updated_at: old }), stake('B', 'away', 2, { updated_at: old })], now).size, 0);
  assert.equal(groupStake([stake('A', 'home', 2, { start: '2026-10-02T05:00:00Z' })], now).size, 0);
});

test('finished events and unknown sports are skipped', () => {
  assert.equal(fromServer({ events: [{ ...feedEvent, state: 'finished' }, { ...feedEvent, sport: 'Curling' }] }, now).length, 0);
});

test('ESPN odds are converted from moneyline to decimal', () => {
  const d = { events: [{ competitions: [{ id: 1, date: '2026-10-02T14:00:00Z',
    competitors: [{ homeAway: 'home', team: { displayName: 'A' } }, { homeAway: 'away', team: { displayName: 'B' } }],
    odds: [{ provider: { name: 'DraftKings' }, homeTeamOdds: { moneyLine: -200 }, awayTeamOdds: { moneyLine: 150 } }] }] }] };
  const [e] = parseESPN(d, 'NBA', 'basketball/nba');
  assert.deepEqual(e.reference_odds.markets[0].outcomes.map((o) => o.odds), [1.5, 2.5]);
});

test('de-vig probabilities sum to 1 and slips stay one leg per event', () => {
  const { outcomes } = devig(feedEvent.reference_odds.markets[0]);
  assert.ok(Math.abs(outcomes.reduce((a, o) => a + o.fair, 0) - 1) < 1e-9);
  const events = fromServer({ events: Array.from({ length: 6 }, (_, i) => ({ ...feedEvent, id: `e${i}`,
    reference_odds: { bookmaker: 'X', markets: [{ name: 'Winner', outcomes: [{ name: 'Arsenal', odds: 1.4 + i / 10 }, { name: 'Ipswich Town', odds: 2.8 }] }] } })) }, now);
  for (const s of buildSlips(events, 3, { maxLegs: 3, tolerance: 0.1 })) assert.equal(new Set(s.legs.map((l) => l.eventId)).size, s.legs.length);
});

test('bankers only list picks at 70%+ model probability', () => {
  const events = applyModel(fromServer({ events: [feedEvent] }, now));
  const b = bankers(events);
  assert.equal(b[0].pick, 'Arsenal');
  assert.ok(b.every((x) => x.p >= 0.7));
});
