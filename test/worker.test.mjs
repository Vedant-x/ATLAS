import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/atlas-ai-proxy.js';

const ORIGIN = 'https://vedant-x.github.io';
const req = (body, { origin = ORIGIN, path = '/v1/messages?beta=true', headers = {} } = {}) => new Request(`https://atlas-ai.example.workers.dev${path}`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-api-key': 'atlas-proxy', 'anthropic-beta': 'server-side-fallback-2026-07-01,files-api-2025-04-14', ...headers }, body: JSON.stringify(body),
});

test('proxy injects the secret key, fixes model and size, and drops unknown betas', async () => {
  const real = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, init) => { sent = { url, init }; return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); };
  try {
    const r = await worker.fetch(req({ model: 'something-expensive', max_tokens: 64000, betas: ['x'], tools: [{ name: 't', input_schema: {} }, { type: 'web_search_20260209', name: 'web_search' }], messages: [{ role: 'user', content: 'hi' }] }), { ANTHROPIC_API_KEY: 'sk-secret' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(sent.url, 'https://api.anthropic.com/v1/messages?beta=true');
    assert.equal(sent.init.headers['x-api-key'], 'sk-secret');
    assert.equal(sent.init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    const body = JSON.parse(sent.init.body);
    assert.equal(body.model, 'claude-opus-5-5');
    assert.equal(body.max_tokens, 4000);
    assert.equal(body.betas, undefined);
    assert.deepEqual(body.tools.map((t) => t.name), ['t']);
  } finally { globalThis.fetch = real; }
});

test('proxy refuses other sites, other paths, and visitors over the daily cap', async () => {
  const env = { ANTHROPIC_API_KEY: 'k', IP_DAILY_LIMIT: '1', USAGE: { m: new Map(), async get(k) { return this.m.get(k) ?? null; }, async put(k, v) { this.m.set(k, v); } } };
  assert.equal((await worker.fetch(req({}, { origin: 'https://evil.example' }), env)).status, 403);
  assert.equal((await worker.fetch(req({}, { path: '/v1/models' }), env)).status, 404);
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}');
  try {
    assert.equal((await worker.fetch(req({ messages: [] }), env)).status, 200);
    const capped = await worker.fetch(req({ messages: [] }), env);
    assert.equal(capped.status, 429);
    assert.equal((await capped.json()).error.type, 'rate_limit_error');
  } finally { globalThis.fetch = real; }
});
