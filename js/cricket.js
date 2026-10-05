// Cricket from ESPN's all-cricket score panel (every current Test, ODI, T20I and domestic or
// franchise match). Matches are filed under three ATLAS sections by type, keeping the series name.
export const CRICKET_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel';

export function sectionOf(cls = {}, seriesName = '') {
  if (cls.internationalClassId && cls.internationalClassId !== '0') return 'atlas/cricket-intl';
  if (/^T20$|Twenty20/i.test(cls.eventType || cls.generalClassCard || '') || /premier league|super league|big bash|\bT20\b|Super60|The Hundred/i.test(seriesName)) return 'atlas/cricket-t20';
  return 'atlas/cricket-dom';
}

const FORMAT = (cls = {}) => cls.eventType || cls.generalClassCard || '';

// ATLAS events from a score panel response. Finished matches are dropped (like every other sport).
export function parseCricket(json, now = Date.now()) {
  const out = [];
  for (const block of json?.scores || []) {
    const lg = block.leagues?.[0] || {};
    for (const ev of block.events || []) {
      const c = ev.competitions?.[0];
      if (!c) continue;
      const state = (c.status || ev.status)?.type?.state;
      if (state === 'post') continue;
      const team = (k) => c.competitors?.find((x) => x.homeAway === k) || {};
      const h = team('home'), a = team('away');
      const home = h.team?.displayName, away = a.team?.displayName;
      if (!home || !away || /^(TBA|TBC)$/.test(home) || /^(TBA|TBC)$/.test(away)) continue;
      const start = Date.parse(c.date || ev.date);
      if (!Number.isFinite(start) || start > now + 5 * 864e5) continue;
      const fmt = FORMAT(c.class);
      out.push({
        id: `cricket-${ev.id}`, compId: String(ev.id), seriesId: lg.id ? String(lg.id) : null, sport: 'cricket', leaguePath: sectionOf(c.class, lg.name || ''),
        league: lg.name || 'Cricket', home, away, start, live: state === 'in',
        score: state === 'in' ? `${h.score || 'yet to bat'} – ${a.score || 'yet to bat'}` : null,
        clock: (c.status || ev.status)?.type?.detail || '', note: [fmt, c.description, c.status?.summary || ev.status?.summary].filter(Boolean).join(' · '),
        venue: c.venue?.fullName || null, neutral: Boolean(c.neutralSite), format: fmt,
        markets: [], stats: {}, probables: [], lineups: null,
        colors: { home: h.team?.color ? `#${h.team.color.replace('#', '')}` : null, away: a.team?.color ? `#${a.team.color.replace('#', '')}` : null },
        source: 'ESPN cricket', fetchedAt: now,
      });
    }
  }
  return out;
}
