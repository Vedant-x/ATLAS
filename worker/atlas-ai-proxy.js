// ATLAS AI proxy: a Cloudflare Worker that lets the site's assistant talk to Claude without putting
// the Anthropic API key in the public site. The key lives only in the Worker's secret store.
//
// Guards: only the ATLAS site may call it (CORS origin check), only the Messages endpoint, the model
// and output size are fixed here (not by the browser), and optional daily caps (whole site and per
// visitor IP) stop anyone from running up the bill. Setup steps: worker/README.md.
//
// Environment:
//   ANTHROPIC_API_KEY  secret, required
//   ALLOWED_ORIGINS    comma-separated origins (default https://vedant-x.github.io)
//   DAILY_LIMIT        requests per UTC day for the whole site (default 400)
//   IP_DAILY_LIMIT     requests per UTC day per visitor IP (default 80)
//   USAGE              optional KV namespace binding; without it the daily caps are off
const MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 4000;
const MAX_BODY = 300_000; // bytes; a chat with tool results is far below this
const BETAS = new Set(['server-side-fallback-2026-07-01']);

const json = (status, type, message, cors) => new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
  status, headers: { 'content-type': 'application/json', ...cors },
});

export default {
  async fetch(req, env) {
    const origins = (env.ALLOWED_ORIGINS || 'https://vedant-x.github.io').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.get('origin') || '';
    const allowed = origins.includes(origin);
    const cors = allowed ? {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': '*',
      'access-control-max-age': '86400',
      vary: 'origin',
    } : {};

    if (req.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return new Response('ATLAS AI proxy is running.', { headers: cors });
    if (!allowed) return json(403, 'permission_error', 'This proxy only serves the ATLAS site.', cors);
    if (req.method !== 'POST' || url.pathname !== '/v1/messages') return json(404, 'not_found_error', 'Only POST /v1/messages is available.', cors);
    if (!env.ANTHROPIC_API_KEY) return json(500, 'api_error', 'The proxy has no ANTHROPIC_API_KEY secret yet.', cors);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, 'request_too_large', 'Conversation too long: clear the chat and ask again.', cors);
    let body;
    try { body = JSON.parse(raw); } catch { return json(400, 'invalid_request_error', 'Body must be JSON.', cors); }

    // Daily caps (best effort: KV counts are eventually consistent, which is fine for a budget guard).
    if (env.USAGE) {
      const day = new Date().toISOString().slice(0, 10);
      const ip = req.headers.get('cf-connecting-ip') || 'unknown';
      const siteKey = `site:${day}`, ipKey = `ip:${ip}:${day}`;
      const [site, mine] = await Promise.all([env.USAGE.get(siteKey), env.USAGE.get(ipKey)]).then((v) => v.map((x) => Number(x) || 0));
      if (site >= Number(env.DAILY_LIMIT || 400)) return json(429, 'rate_limit_error', 'The ATLAS assistant has reached its daily limit. It resets at midnight UTC.', cors);
      if (mine >= Number(env.IP_DAILY_LIMIT || 80)) return json(429, 'rate_limit_error', 'You have reached today\'s question limit. It resets at midnight UTC.', cors);
      await Promise.all([
        env.USAGE.put(siteKey, String(site + 1), { expirationTtl: 172800 }),
        env.USAGE.put(ipKey, String(mine + 1), { expirationTtl: 172800 }),
      ]);
    }

    // The proxy, not the browser, decides what is spent.
    body.model = MODEL;
    body.max_tokens = Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS);
    delete body.betas; delete body.container; delete body.mcp_servers;
    if (Array.isArray(body.tools)) body.tools = body.tools.filter((t) => !t.type || t.type === 'custom');

    const betas = (req.headers.get('anthropic-beta') || '').split(',').map((s) => s.trim()).filter((b) => BETAS.has(b));
    const upstream = await fetch(`https://api.anthropic.com/v1/messages${url.search === '?beta=true' ? '?beta=true' : ''}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': req.headers.get('anthropic-version') || '2023-06-01',
        ...(betas.length ? { 'anthropic-beta': betas.join(',') } : {}),
      },
      body: JSON.stringify(body),
    });
    // Stream the answer straight back (works for both streaming and plain responses).
    const headers = new Headers(cors);
    for (const h of ['content-type', 'request-id', 'retry-after']) { const v = upstream.headers.get(h); if (v) headers.set(h, v); }
    headers.set('access-control-expose-headers', 'request-id, retry-after');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
