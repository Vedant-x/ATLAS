// Match-day weather from Open-Meteo (open-meteo.com, free, no key) for outdoor matches in the next
// 48 hours: temperature, chance of rain, rain and wind at kick-off. Wind and rain matter most in
// football (American and soccer), baseball, cricket, rugby and tennis; indoor venues are skipped.
// The venue's city (ESPN) is turned into coordinates with Open-Meteo's geocoder, cached by the build.
export const GEOCODE = (name) => `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`;
export const FORECAST = (lats, lons) => `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m&forecast_days=3&timezone=UTC`;
export const OUTDOOR = new Set(['football', 'americanfootball', 'baseball', 'cricket', 'rugby', 'tennis', 'aussierules', 'golf', 'fieldhockey', 'field-hockey']);

export const placeKey = (p) => [p.city, p.region, p.country].filter(Boolean).join(', ');

// The geocoder's best match for a venue's city → { lat, lon } (null when it found nothing): the one in
// the venue's state/region or country when those are given ("Columbus, Ohio" not Columbus, Georgia).
const low = (s) => String(s || '').toLowerCase();
const COUNTRY = { usa: 'united states', us: 'united states', england: 'united kingdom', scotland: 'united kingdom', wales: 'united kingdom', 'northern ireland': 'united kingdom', uk: 'united kingdom' };
export function geoFrom(json, place = {}) {
  const list = (json?.results || []).filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
  if (!list.length) return null;
  const region = low(place.region), country = COUNTRY[low(place.country)] || low(place.country);
  const r = (region && list.find((x) => low(x.admin1) === region || low(x.admin1).startsWith(region)))
    || (country && list.find((x) => low(x.country) === country)) || list[0];
  return { lat: +r.latitude.toFixed(3), lon: +r.longitude.toFixed(3) };
}

// One location's hourly forecast at the hour nearest kick-off.
export function atKickoff(hourly, start) {
  const times = (hourly?.time || []).map((t) => Date.parse(`${t}${/Z$/.test(t) ? '' : 'Z'}`));
  if (!times.length) return null;
  let i = 0;
  for (let k = 1; k < times.length; k++) if (Math.abs(times[k] - start) < Math.abs(times[i] - start)) i = k;
  if (Math.abs(times[i] - start) > 2 * 36e5) return null;
  const v = (k) => { const x = hourly[k]?.[i]; return Number.isFinite(x) ? x : null; };
  return { tempC: v('temperature_2m'), rainProb: v('precipitation_probability'), rainMm: v('precipitation'), windKmh: v('wind_speed_10m'), gustKmh: v('wind_gusts_10m') };
}

// A short reading for the match page and the analysis ("12°C, 60% rain, wind 32 km/h").
export function weatherLine(w) {
  if (!w) return '';
  const parts = [w.tempC != null ? `${Math.round(w.tempC)}°C` : null, w.rainProb != null ? `${w.rainProb}% chance of rain` : null,
    w.rainMm >= 0.5 ? `${w.rainMm.toFixed(1)} mm` : null, w.windKmh != null ? `wind ${Math.round(w.windKmh)} km/h${w.gustKmh >= 40 ? ` (gusts ${Math.round(w.gustKmh)})` : ''}` : null];
  return parts.filter(Boolean).join(', ');
}
// Conditions worth flagging: strong wind or heavy rain (kicking, passing, fly balls, serve toss).
export const weatherFlag = (w) => Boolean(w && ((w.windKmh ?? 0) >= 30 || (w.gustKmh ?? 0) >= 50 || (w.rainMm ?? 0) >= 2 || (w.rainProb ?? 0) >= 70));
