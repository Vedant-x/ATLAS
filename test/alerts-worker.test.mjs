import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAlerts, quietAt, vapidJwt, subId } from '../worker/atlas-alerts.js';

const T = Date.parse('2026-10-18T12:00:00Z');
const change = (id, eventId, kind, at = T, extra = {}) => ({ id, eventId, kind, at, text: `${kind} changed`, home: 'A', away: 'B', start: T + 36e5, forecast: 'updated', ...extra });

test('alerts: saved matches only, chosen kinds only, each change once, nothing from before the subscription', () => {
  const sub = { watch: ['e1'], kinds: ['starters', 'lineups'], seen: ['c0'], since: T - 60e3 };
  const out = selectAlerts(sub, [
    change('c0', 'e1', 'starter'), // already sent
    change('c1', 'e1', 'starter'), // new: sent
    change('c2', 'e2', 'starter'), // not a saved match
    change('c3', 'e1', 'price'), // a kind not chosen
    change('c4', 'e1', 'lineup', T - 3600e3), // from before the subscription
  ], T);
  assert.deepEqual(out.map((m) => m.id), ['c1']);
  assert.equal(out[0].title, 'A v B');
  assert.match(out[0].body, /starter changed · forecast updated/);
  assert.equal(out[0].url, '#/match/e1');
});

test('alerts: quiet hours in the visitor\'s own time zone, including past midnight', () => {
  const ist = { quiet: [23, 7], tzOffset: 330 };
  assert.equal(quietAt(ist, Date.parse('2026-10-18T18:00:00Z')), true); // 23:30 IST
  assert.equal(quietAt(ist, Date.parse('2026-10-18T06:00:00Z')), false); // 11:30 IST
  assert.equal(quietAt({ quiet: null }, T), false);
});

test('alerts: the VAPID token is an ES256 JWT for the push service that verifies with the public key', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const jwt = await vapidJwt('https://fcm.googleapis.com/fcm/send/abc', 'mailto:me@example.com', jwk, T);
  const [h, b, s] = jwt.split('.');
  const dec = (x) => JSON.parse(Buffer.from(x, 'base64url').toString());
  assert.equal(dec(h).alg, 'ES256');
  assert.equal(dec(b).aud, 'https://fcm.googleapis.com');
  assert.equal(dec(b).exp, T / 1000 + 12 * 3600);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${b}`));
  assert.ok(ok);
  assert.equal(await subId('https://x/1'), await subId('https://x/1'));
  assert.notEqual(await subId('https://x/1'), await subId('https://x/2'));
});
