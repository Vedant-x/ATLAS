// The visitor's time zone, used for every time ATLAS shows: kick-offs, "today" and "tomorrow", the
// parlay of the day's 12:00-to-12:00 day. One setting for the whole site (Display: time zone), IST
// by default. Pure helpers take the zone key so they can be tested; zone() reads the saved choice.

export const ZONES = {
  IST: { tz: 'Asia/Kolkata', label: 'India (IST)' },
  GMT: { tz: 'UTC', label: 'GMT / UTC' },
  UK: { tz: 'Europe/London', label: 'UK (London)' },
  CET: { tz: 'Europe/Paris', label: 'Central Europe' },
  GST: { tz: 'Asia/Dubai', label: 'Gulf (Dubai)' },
  PKT: { tz: 'Asia/Karachi', label: 'Pakistan' },
  BST: { tz: 'Asia/Dhaka', label: 'Bangladesh' },
  SGT: { tz: 'Asia/Singapore', label: 'Singapore' },
  JST: { tz: 'Asia/Tokyo', label: 'Japan / Korea' },
  AET: { tz: 'Australia/Sydney', label: 'Australia (Sydney)' },
  NZT: { tz: 'Pacific/Auckland', label: 'New Zealand' },
  SAST: { tz: 'Africa/Johannesburg', label: 'South Africa' },
  WAT: { tz: 'Africa/Lagos', label: 'Nigeria (WAT)' },
  BRT: { tz: 'America/Sao_Paulo', label: 'Brazil' },
  ET: { tz: 'America/New_York', label: 'US Eastern' },
  CT: { tz: 'America/Chicago', label: 'US Central' },
  PT: { tz: 'America/Los_Angeles', label: 'US Pacific' },
  LOCAL: { tz: null, label: 'This device' },
};
const KEY = 'atlas-tz';
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
export const tzOf = (zone) => (ZONES[zone]?.tz ?? (zone === 'LOCAL' ? deviceTz() : ZONES.IST.tz)) || deviceTz();

let current = null;
export function zone() {
  if (current) return current;
  try { const z = localStorage.getItem(KEY); if (ZONES[z]) return (current = z); } catch { /* storage blocked */ }
  try { const z = JSON.parse(localStorage.getItem('atlas-research-v1') || '{}').potdZone; if (ZONES[z]) return (current = z); } catch { /* older setting */ }
  return (current = 'IST');
}
export function setZone(z) { if (!ZONES[z]) return; current = z; try { localStorage.setItem(KEY, z); } catch { /* this visit only */ } }

// Minutes to add to UTC for local time in a zone at a moment (daylight saving included).
export function offsetMin(z, t = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tzOf(z), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(t)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute);
  return Math.round((asUtc - Math.floor(t / 6e4) * 6e4) / 6e4);
}
// The short name shown after a time: "IST", "GMT", "EDT", "AEDT"…
export function abbr(z, t = Date.now()) {
  if (z === 'IST') return 'IST';
  if (z === 'GMT') return 'GMT';
  try {
    // Each locale knows its own region's names (en-GB: BST, CET; en-AU: AEDT); the first real name wins.
    let name = z;
    for (const loc of ['en-US', 'en-GB', 'en-AU', 'en-IN']) {
      name = new Intl.DateTimeFormat(loc, { timeZone: tzOf(z), timeZoneName: 'short' }).formatToParts(new Date(t)).find((p) => p.type === 'timeZoneName')?.value || z;
      if (!/^(GMT|UTC)[+-]/.test(name)) break;
    }
    // No common name in any locale (Japan, Singapore, Pakistan…): the zone's own short code.
    if (/^(GMT|UTC)[+-]/.test(name)) return z === 'LOCAL' ? `UTC${name.slice(3)}` : z;
    return name;
  } catch { return z; }
}
// Local midnight (or another hour) of the day containing t, as a timestamp.
export function dayStartAt(t, z, hour = 0) {
  let start = Math.floor((t + offsetMin(z, t) * 6e4 - hour * 36e5) / 864e5) * 864e5 + hour * 36e5;
  start -= offsetMin(z, start) * 6e4; // back to UTC, with the offset at that moment
  if (start > t) start -= 864e5; // a DST change can push the estimate past t
  return start;
}
export const dayKey = (t, z) => new Date(t + offsetMin(z, t) * 6e4).toISOString().slice(0, 10);
export const weekday = (t, z) => new Date(t + offsetMin(z, t) * 6e4).getUTCDay();

// "Mon 20 Oct, 7:30 pm IST" (full) or "Mon 19:30" (short) in the chosen zone.
export function fmt(t, z = zone(), style = 'full') {
  if (!Number.isFinite(t)) return '';
  const tz = tzOf(z);
  if (style === 'short') return `${new Date(t).toLocaleString('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit' })} ${abbr(z, t)}`;
  if (style === 'time') return `${new Date(t).toLocaleString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })} ${abbr(z, t)}`;
  return `${new Date(t).toLocaleString('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })} ${abbr(z, t)}`;
}
