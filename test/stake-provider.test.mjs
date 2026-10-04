import test from 'node:test';
import assert from 'node:assert/strict';
import { collectStake } from '../scripts/stake-provider.mjs';

const now = Date.parse('2026-10-04T09:00:00Z');
const apiKey = 'private-provider-test-key';
const event = (id, sport = 'football') => ({ id, home: `Home ${id}`, away: `Away ${id}`, date: new Date(now + 3600000).toISOString(), status: 'pending', sport: { name: sport, slug: sport }, league: { name: 'Test League', slug: 'test-league' } });
const quote = (id, extras = {}) => ({ id, bookmakers: { Stake: [{ name: 'ML', updatedAt: new Date(now - 1000).toISOString(), odds: [{ home: '1.5', away: '2.8' }] }] }, ...extras });
const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('missing key makes no network request', async () => {
  const result = await collectStake({ apiKey: '', now, fetchImpl: () => assert.fail('network call') });
  assert.equal(result.status, 'not-configured');
  assert.equal(result.fetchedAt, null);
  assert.deepEqual(result.events, []);
});

test('unauthorized, forbidden and rate-limited requests stop immediately without exposing upstream errors', async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const result = await collectStake({ apiKey, now, fetchImpl: async () => { calls++; return new Response(JSON.stringify({ error: apiKey }), { status }); } });
    assert.equal(calls, 1);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.errors[0].status, status);
    assert.ok(!JSON.stringify(result).includes(apiKey));
  }
});

test('default scope needs three discovery calls and at most two ten-event quote batches', async () => {
  const calls = [];
  const result = await collectStake({ apiKey, now, fetchImpl: async (url) => {
    const u = new URL(url); calls.push(u);
    if (u.pathname.endsWith('/events')) {
      assert.equal(u.searchParams.get('bookmaker'), 'Stake');
      assert.equal(u.searchParams.get('status'), 'pending');
      assert.equal(u.searchParams.get('limit'), '500');
      const sport = u.searchParams.get('sport');
      return ok(sport === 'football' ? Array.from({ length: 25 }, (_, i) => event(i + 1)) : []);
    }
    assert.equal(u.searchParams.get('bookmakers'), 'Stake');
    assert.ok(!u.searchParams.has('markets'));
    const ids = u.searchParams.get('eventIds').split(',');
    assert.ok(ids.length <= 10);
    return ok(ids.map((id) => quote(Number(id))));
  } });
  assert.equal(calls.length, 5);
  assert.equal(result.events.length, 20);
  assert.equal(result.status, 'partial');
  assert.ok(result.errors.some((e) => e.code === 'event-limit-reached'));
});

test('quotes join exact provider IDs; incomplete discovery retains successful scope and trusted metadata', async () => {
  const result = await collectStake({ apiKey, now, sports: ['football', 'baseball'], fetchImpl: async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/events')) return u.searchParams.get('sport') === 'baseball' ? new Response(apiKey, { status: 503 }) : ok([event(1), event(2), event(1)]);
    return ok([quote(1), quote(1), quote(999)]);
  } });
  assert.equal(result.status, 'partial');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].home, 'Home 1');
  assert.equal(result.events[0].sport.slug, 'football');
  assert.ok(result.errors.some((e) => e.code === 'missing-events'));
  assert.ok(result.errors.some((e) => e.code === 'duplicate-event'));
  assert.ok(result.errors.some((e) => e.code === 'unexpected-event'));
  assert.ok(!JSON.stringify(result).includes(apiKey));
});

test('white-list preserves labelled and line markets while stripping credentials and unsafe links', async () => {
  const result = await collectStake({ apiKey, now, sports: ['baseball'], fetchImpl: async (url) => new URL(url).pathname.endsWith('/events') ? ok([event(1, 'baseball')]) : ok([quote(1, {
    secret: apiKey, urls: { Stake: 'https://stake.com/sports/baseball/1', Other: 'https://example.com/' },
    bookmakers: { Stake: [{ name: 'Player Props', updatedAt: new Date(now - 1000).toISOString(), token: apiKey, odds: [{ label: 'Player A', hdp: '1.5', over: '2.2', under: '1.7', odds: '3.1', homeLink: 'https://stake.com/selection/1', awayLink: `https://stake.com/?apiKey=${apiKey}`, overLink: 'https://stake.com.evil.test/', underLink: 'javascript:alert(1)', secret: apiKey }] }], 'Stake.bet.br': [{ token: apiKey }] },
  })]) });
  assert.equal(result.status, 'connected');
  const row = result.events[0].bookmakers.Stake[0].odds[0];
  assert.equal(row.label, 'Player A'); assert.equal(row.hdp, 1.5); assert.equal(row.odds, 3.1);
  assert.equal(row.homeLink, 'https://stake.com/selection/1');
  assert.equal(row.awayLink, undefined); assert.equal(row.overLink, undefined); assert.equal(row.underLink, undefined);
  assert.ok(!JSON.stringify(result).includes(apiKey));
  assert.deepEqual(Object.keys(result.events[0].bookmakers), ['Stake']);
});

test('ended events, renamed participants, missing Stake, and missing quote timestamps cannot become usable prices', async () => {
  const result = await collectStake({ apiKey, now, sports: ['football'], fetchImpl: async (url) => new URL(url).pathname.endsWith('/events') ? ok([event(1), event(2), event(3), event(4)]) : ok([
    quote(1, { status: 'live' }), quote(2, { home: 'Different Team' }), quote(3, { bookmakers: { 'Stake.bet.br': [] } }), quote(4, { bookmakers: { Stake: [{ name: 'ML', odds: [{ home: 1.5 }] }] } }),
  ]) });
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.events, []);
});

test('invalid configuration, malformed JSON and thrown URL errors stay sanitized', async () => {
  const invalid = await collectStake({ apiKey, sports: ['not-a-sport'], now, fetchImpl: () => assert.fail('network call') });
  assert.equal(invalid.status, 'unavailable');
  const failed = await collectStake({ apiKey, sports: ['football'], now, fetchImpl: async () => { throw Error(`fetch failed https://example.com?apiKey=${apiKey}`); } });
  assert.equal(failed.status, 'unavailable');
  assert.ok(!JSON.stringify(failed).includes(apiKey));
  const malformed = await collectStake({ apiKey, sports: ['football'], now, fetchImpl: async () => ok({ error: apiKey }) });
  assert.equal(malformed.errors[0].code, 'invalid-response');
});

test('maximum event count is bounded and successful empty discovery is connected', async () => {
  const result = await collectStake({ apiKey, maxEvents: 500, sports: ['football', 'football'], now, fetchImpl: async () => ok([]) });
  assert.equal(result.scope.maxEvents, 80);
  assert.deepEqual(result.scope.sports, ['football']);
  assert.equal(result.status, 'connected');
  assert.deepEqual(result.events, []);
});

test('conflicting duplicate catalogue identities are excluded instead of choosing a team mapping', async () => {
  let calls = 0;
  const result = await collectStake({ apiKey, sports: ['football'], now, fetchImpl: async () => {
    calls++;
    return ok([event(1), { ...event(1), away: 'Different Opponent' }, event(1)]);
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.errors[0].code, 'conflicting-metadata');
  assert.deepEqual(result.events, []);
});

test('environment scope applies at call time; empty settings retain defaults and explicit options override', async () => {
  const previous = { sports: process.env.STAKE_SPORTS, max: process.env.STAKE_MAX_EVENTS };
  const collect = (options = {}) => collectStake({ apiKey, now, fetchImpl: async () => ok([]), ...options });
  try {
    process.env.STAKE_SPORTS = ' tennis, baseball , tennis ';
    process.env.STAKE_MAX_EVENTS = ' 35 ';
    const configured = await collect();
    assert.deepEqual(configured.scope.sports, ['tennis', 'baseball']);
    assert.equal(configured.scope.maxEvents, 35);
    const explicit = await collect({ sports: ['football'], maxEvents: 10 });
    assert.deepEqual(explicit.scope.sports, ['football']);
    assert.equal(explicit.scope.maxEvents, 10);
    process.env.STAKE_SPORTS = '  ';
    process.env.STAKE_MAX_EVENTS = '';
    const fallback = await collect();
    assert.deepEqual(fallback.scope.sports, ['football', 'basketball', 'baseball']);
    assert.equal(fallback.scope.maxEvents, 20);
  } finally {
    if (previous.sports === undefined) delete process.env.STAKE_SPORTS; else process.env.STAKE_SPORTS = previous.sports;
    if (previous.max === undefined) delete process.env.STAKE_MAX_EVENTS; else process.env.STAKE_MAX_EVENTS = previous.max;
  }
});
