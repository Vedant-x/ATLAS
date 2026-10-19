// Shareable slips: the legs packed into the link itself (#/slip/<code>), so sharing needs no server.
// A link is untrusted input: decoding checks every field and keeps at most 25 legs.
const MAX_LEGS = 25;

const toB64url = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export function encodeSlip(legs) {
  const rows = legs.slice(0, MAX_LEGS).map((l) => [l.key, l.eventId, l.sport, l.match, l.market, l.pick, +Number(l.odds).toFixed(3), +Number(l.p).toFixed(4), l.derived ? 1 : 0]);
  return toB64url(JSON.stringify(rows));
}

const str = (x, max = 200) => typeof x === 'string' && x.length > 0 && x.length <= max;
export function decodeSlip(code) {
  if (typeof code !== 'string' || code.length > 20000 || !/^[A-Za-z0-9_-]+$/.test(code)) return [];
  let rows;
  try { rows = JSON.parse(fromB64url(code)); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, MAX_LEGS).filter((r) => Array.isArray(r) && str(r[0], 400) && str(r[1]) && str(r[2], 40) && str(r[3]) && str(r[4]) && str(r[5])
    && Number.isFinite(r[6]) && r[6] > 1 && r[6] < 10000 && Number.isFinite(r[7]) && r[7] > 0 && r[7] < 1)
    .map(([key, eventId, sport, match, market, pick, odds, p, derived]) => ({ key, eventId, sport, match, market, pick, odds, p, derived: derived === 1 }));
}
