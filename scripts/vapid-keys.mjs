// Makes a VAPID key pair for the alerts Worker (worker/README-alerts.md). Prints the public key
// (VAPID_PUBLIC, base64url raw P-256 point) and the private key as a JWK (VAPID_PRIVATE, a secret).
//   node scripts/vapid-keys.mjs
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url');
const jwk = await crypto.subtle.exportKey('jwk', privateKey);
console.log(`VAPID_PUBLIC  (plain-text variable):\n${raw}\n\nVAPID_PRIVATE (secret, keep it private):\n${JSON.stringify(jwk)}`);
