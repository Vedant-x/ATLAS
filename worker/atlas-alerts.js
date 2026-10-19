// ATLAS alerts while the site is closed: a Cloudflare Worker that keeps each visitor's push
// subscription and saved matches, checks the site's change feed (data/changes.json: starters
// announced or replaced, confirmed lineups, new absences, price moves, start-time moves) every few
// minutes on a cron trigger, and sends a Web Push to each visitor with a change for a match they
// saved. The push carries no data (so no payload encryption is needed); the visitor's service worker
// then asks this Worker for the waiting messages and shows them.
//
// Each message says what changed, for which saved match, and whether the forecast moved with it.
// Duplicates are suppressed (each change is sent once per visitor), quiet hours are kept in the
// visitor's own time zone, and only the kinds of change the visitor chose are sent.
//
// Bindings (worker/README-alerts.md): SUBS (KV namespace), VAPID_PUBLIC (base64url raw P-256 public
// key), VAPID_PRIVATE (the private key as a JWK JSON string, a secret), VAPID_SUBJECT (mailto: or
// https: contact), SITE (the site's address), ALLOWED_ORIGINS (comma-separated, default the site).

export const KINDS = { starter: 'starters', lineup: 'lineups', injury: 'absences', price: 'prices', time: 'times', prop: 'props' };
const KEEP_SEEN = 300;

// The id under which a subscription is stored: a hash of its push endpoint (the service worker can
// compute the same id from its own subscription).
export async function subId(endpoint) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(endpoint)));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Is it quiet hours for this visitor? quiet: [from, to] local hours (may run past midnight);
// tzOffset: minutes to add to UTC for the visitor's local time.
export function quietAt(sub, now = Date.now()) {
  const q = sub.quiet;
  if (!Array.isArray(q) || q[0] === q[1]) return false;
  const h = new Date(now + (sub.tzOffset || 0) * 6e4).getUTCHours();
  return q[0] < q[1] ? h >= q[0] && h < q[1] : h >= q[0] || h < q[1];
}

// The changes this visitor should hear about now: for a saved match, of a chosen kind, not sent
// before, not older than the subscription (no back-fill), and the match not over. Returns messages.
export function selectAlerts(sub, changes, now = Date.now()) {
  const watch = new Set(sub.watch || []), kinds = new Set(sub.kinds || Object.values(KINDS)), seen = new Set(sub.seen || []);
  return changes.filter((c) => watch.has(c.eventId) && kinds.has(KINDS[c.kind]) && !seen.has(c.id) && c.at >= (sub.since || 0) && !(c.start < now - 3 * 36e5))
    .map((c) => ({
      id: c.id, url: `#/match/${c.eventId}`,
      title: `${c.home} v ${c.away}`,
      body: `${c.text}${c.forecast === 'updated' ? ' · forecast updated' : c.forecast === 'not-modelled' ? ' · forecast impact not quantified' : ''}`,
      kind: c.kind, at: c.at,
    }));
}

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uJson = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
// The VAPID token for one push service (RFC 8292): an ES256 JWT for its origin, valid 12 hours.
export async function vapidJwt(endpoint, subject, privateJwk, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const key = await crypto.subtle.importKey('jwk', typeof privateJwk === 'string' ? JSON.parse(privateJwk) : privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64uJson({ typ: 'JWT', alg: 'ES256' }), body = b64uJson({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

async function push(sub, env) {
  const jwt = await vapidJwt(sub.endpoint, env.VAPID_SUBJECT || 'mailto:alerts@example.com', env.VAPID_PRIVATE);
  return fetch(sub.endpoint, { method: 'POST', headers: { TTL: '3600', Urgency: 'normal', Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, 'Content-Length': '0' } });
}

const json = (body, status = 200, cors = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });

export default {
  async fetch(req, env) {
    const site = env.SITE || 'https://vedant-x.github.io/ATLAS/';
    const allowed = (env.ALLOWED_ORIGINS || new URL(site).origin).split(',').map((s) => s.trim());
    const origin = req.headers.get('origin') || '';
    const cors = allowed.includes(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST' } : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (url.pathname === '/vapid') return json({ key: env.VAPID_PUBLIC || null }, 200, cors);
    if (url.pathname === '/pending') {
      // Waiting messages for one subscription (asked by its service worker after a push).
      const id = url.searchParams.get('id') || '';
      const sub = id && (await env.SUBS.get(`sub:${id}`, 'json'));
      if (!sub) return json({ messages: [] }, 200, cors);
      const messages = sub.queue || [];
      sub.queue = [];
      await env.SUBS.put(`sub:${id}`, JSON.stringify(sub));
      return json({ messages }, 200, cors);
    }
    if (req.method === 'POST' && (url.pathname === '/subscribe' || url.pathname === '/unsubscribe')) {
      if (!cors['access-control-allow-origin']) return json({ error: 'origin not allowed' }, 403);
      const body = await req.json().catch(() => null);
      const endpoint = body?.subscription?.endpoint;
      if (!endpoint || !/^https:\/\//.test(endpoint)) return json({ error: 'no subscription' }, 400, cors);
      const id = await subId(endpoint);
      if (url.pathname === '/unsubscribe') { await env.SUBS.delete(`sub:${id}`); return json({ ok: true }, 200, cors); }
      const prev = (await env.SUBS.get(`sub:${id}`, 'json')) || {};
      const sub = {
        endpoint, since: prev.since || Date.now(), seen: prev.seen || [], queue: prev.queue || [],
        watch: (body.watch || []).map(String).slice(0, 200),
        kinds: (body.kinds || Object.values(KINDS)).filter((k) => Object.values(KINDS).includes(k)),
        quiet: Array.isArray(body.quiet) ? body.quiet.map(Number).slice(0, 2) : null,
        tzOffset: Number.isFinite(body.tzOffset) ? body.tzOffset : 0,
      };
      await env.SUBS.put(`sub:${id}`, JSON.stringify(sub));
      return json({ ok: true, id }, 200, cors);
    }
    return new Response('ATLAS alerts is running.', { headers: cors });
  },

  // Every few minutes (cron trigger): read the change feed once, then each subscription.
  async scheduled(_event, env) {
    const site = env.SITE || 'https://vedant-x.github.io/ATLAS/';
    const r = await fetch(new URL('data/changes.json', site), { cf: { cacheTtl: 60 } }).catch(() => null);
    if (!r?.ok) return;
    const { changes = [] } = await r.json();
    const now = Date.now();
    let cursor;
    do {
      const page = await env.SUBS.list({ prefix: 'sub:', cursor });
      cursor = page.list_complete ? null : page.cursor;
      for (const k of page.keys) {
        const sub = await env.SUBS.get(k.name, 'json');
        if (!sub) continue;
        const fresh = selectAlerts(sub, changes, now);
        if (!fresh.length) continue;
        // Recorded as seen either way (no repeats); queued and pushed only outside quiet hours.
        sub.seen = [...sub.seen, ...fresh.map((m) => m.id)].slice(-KEEP_SEEN);
        if (!quietAt(sub, now)) {
          sub.queue = [...(sub.queue || []), ...fresh].slice(-20);
          const res = await push(sub, env).catch(() => null);
          if (res && (res.status === 404 || res.status === 410)) { await env.SUBS.delete(k.name); continue; } // subscription gone
        }
        await env.SUBS.put(k.name, JSON.stringify(sub));
      }
    } while (cursor);
  },
};
