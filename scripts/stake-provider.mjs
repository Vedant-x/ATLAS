// Server/build collector only. Never import this module into the browser bundle.
const API = 'https://api.odds-api.io/v3/';
const DEFAULT_SPORTS = ['football', 'basketball', 'baseball'];
const SPORTS = new Set('football basketball tennis baseball american-football ice-hockey esports darts mixed-martial-arts boxing handball volleyball snooker table-tennis rugby cricket water-polo futsal beach-volleyball aussie-rules floorball squash beach-soccer lacrosse curling padel bandy gaelic-football beach-handball athletics badminton cross-country golf cycling'.split(' '));
const PRICE_FIELDS = ['home', 'away', 'draw', 'over', 'under', 'yes', 'no', '1X', 'X2', '12', 'odd', 'even', 'none', 'odds'];
const LINK_FIELDS = PRICE_FIELDS.map((side) => `${side}Link`);
const STOP_STATUSES = new Set([401, 403, 429]);
const eventKey = (id) => Number.isSafeInteger(id) && id >= 0 ? String(id) : typeof id === 'string' && /^\d{1,20}$/.test(id) ? id : null;
const configuredSports = (value) => {
  const items = typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return items.length ? items : DEFAULT_SPORTS;
};
const configuredLimit = (value) => typeof value === 'string' && value.trim() ? Number(value.trim()) : 20;

function stakeURL(value, key) {
  if (typeof value !== 'string' || value.length > 2000 || (key && value.includes(key))) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || (u.hostname !== 'stake.com' && !u.hostname.endsWith('.stake.com'))) return null;
    if ([...u.searchParams.keys()].some((name) => /^(?:api[-_]?key|token|access[-_]?token|auth|authorization|password|secret)$/i.test(name))) return null;
    return u.href;
  } catch { return null; }
}

export async function collectStake({ apiKey = process.env.ODDS_API_KEY, sports = configuredSports(process.env.STAKE_SPORTS), maxEvents = configuredLimit(process.env.STAKE_MAX_EVENTS), now = Date.now(), fetchImpl = fetch } = {}) {
  const clock = Number.isFinite(now) ? now : Date.now();
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  const limit = Number.isFinite(Number(maxEvents)) ? Math.max(1, Math.min(80, Math.floor(Number(maxEvents)))) : 20;
  const validSports = Array.isArray(sports) && sports.length > 0 && sports.every((s) => typeof s === 'string' && SPORTS.has(s));
  const selectedSports = validSports ? [...new Set(sports)] : [...DEFAULT_SPORTS];
  const errors = [];
  const output = { schema: 1, provider: 'Odds-API.io', bookmaker: 'Stake', status: 'not-configured', message: 'The Stake odds provider key is not configured.', fetchedAt: clock, scope: { sports: selectedSports, maxEvents: limit, prematchOnly: true }, events: [], errors };
  if (!key) return { ...output, fetchedAt: null };
  const error = (stage, code, status) => {
    if (!errors.some((e) => e.stage === stage && e.code === code && e.status === status)) errors.push({ stage, code, ...(status ? { status } : {}) });
  };
  if (!validSports) {
    error('configuration', 'invalid-sports');
    return { ...output, status: 'unavailable', message: 'Configure supported sport slugs before fetching Stake odds.' };
  }
  const text = (value, length = 180) => typeof value === 'string' ? value.replaceAll(key, '[redacted]').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, length) : '';
  let stopped = false;
  async function get(path, params, stage) {
    const url = new URL(path, API);
    url.search = new URLSearchParams({ apiKey: key, ...params }).toString();
    try {
      const response = await fetchImpl(url.href, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        error(stage, 'http-error', Number(response.status));
        if (STOP_STATUSES.has(response.status)) stopped = true;
        return null;
      }
      const data = await response.json();
      if (!Array.isArray(data)) { error(stage, 'invalid-response'); return null; }
      return data;
    } catch {
      // Exceptions can contain the request URL (and API key): never return them.
      error(stage, 'request-failed');
      return null;
    }
  }
  const end = clock + 48 * 60 * 60 * 1000;
  const catalogue = new Map();
  const conflicts = new Set();
  for (const sport of selectedSports) {
    const list = await get('events', { sport, bookmaker: 'Stake', status: 'pending', from: new Date(clock).toISOString(), to: new Date(end).toISOString(), limit: '500' }, 'events');
    if (stopped) break;
    if (!list) continue;
    if (list.length >= 500) error('events', 'catalogue-truncated');
    for (const entry of list.slice(0, 500)) {
      const id = eventKey(entry?.id), date = Date.parse(entry?.date);
      if (!id || !Number.isFinite(date) || date <= clock || date > end || entry.status !== 'pending') continue;
      const home = text(entry.home), away = text(entry.away);
      if (!home || !away) { error('events', 'missing-metadata'); continue; }
      if (conflicts.has(id)) continue;
      if (catalogue.has(id)) {
        const old = catalogue.get(id);
        if (old.home !== home || old.away !== away || old.date !== new Date(date).toISOString()) {
          error('events', 'conflicting-metadata');
          catalogue.delete(id);
          conflicts.add(id);
        }
        continue;
      }
      catalogue.set(id, { id: entry.id, home, away, date: new Date(date).toISOString(), status: 'pending', sport: { name: text(entry.sport?.name) || sport, slug: sport }, league: { name: text(entry.league?.name), slug: text(entry.league?.slug) } });
    }
  }
  const selected = [...catalogue.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || String(a.id).localeCompare(String(b.id))).slice(0, limit);
  if (catalogue.size > limit) error('events', 'event-limit-reached');
  for (let offset = 0; offset < selected.length && !stopped; offset += 10) {
    const batch = selected.slice(offset, offset + 10);
    const requested = new Map(batch.map((e) => [eventKey(e.id), e]));
    const list = await get('odds/multi', { eventIds: batch.map((e) => e.id).join(','), bookmakers: 'Stake' }, 'odds');
    if (!list) continue;
    if (list.length > 100) error('odds', 'response-truncated');
    const seen = new Set();
    for (const entry of list.slice(0, 100)) {
      const id = eventKey(entry?.id), meta = requested.get(id);
      if (!meta) { error('odds', 'unexpected-event'); continue; }
      if (seen.has(id)) { error('odds', 'duplicate-event'); continue; }
      seen.add(id);
      if (entry.status !== undefined && entry.status !== 'pending') { error('odds', 'event-no-longer-pending'); continue; }
      if ((entry.home !== undefined && text(entry.home) !== meta.home) || (entry.away !== undefined && text(entry.away) !== meta.away)) { error('odds', 'metadata-mismatch'); continue; }
      const rawMarkets = entry.bookmakers?.Stake;
      if (!Array.isArray(rawMarkets)) { error('odds', 'stake-markets-missing'); continue; }
      if (rawMarkets.length > 1000) error('odds', 'markets-truncated');
      const markets = [];
      for (const market of rawMarkets.slice(0, 1000)) {
        const name = text(market?.name);
        if (!name || !Array.isArray(market?.odds)) { error('odds', 'invalid-market'); continue; }
        const updated = Date.parse(market.updatedAt);
        if (!Number.isFinite(updated) || updated > clock + 60000) { error('odds', 'invalid-market-timestamp'); continue; }
        if (market.odds.length > 5000) error('odds', 'outcomes-truncated');
        const rows = [];
        for (const row of market.odds.slice(0, 5000)) {
          if (!row || typeof row !== 'object') continue;
          const safe = {};
          for (const field of PRICE_FIELDS) {
            const value = typeof row[field] === 'number' || typeof row[field] === 'string' ? Number(row[field]) : NaN;
            if (Number.isFinite(value) && value > 1 && value <= 1000000) safe[field] = value;
          }
          if (!Object.keys(safe).length) continue;
          if ((typeof row.hdp === 'number' || typeof row.hdp === 'string') && row.hdp !== '' && Number.isFinite(Number(row.hdp)) && Math.abs(Number(row.hdp)) < 100000) safe.hdp = Number(row.hdp);
          if (typeof row.label === 'string') safe.label = text(row.label);
          for (const field of LINK_FIELDS) { const url = stakeURL(row[field], key); if (url) safe[field] = url; }
          rows.push(safe);
        }
        if (rows.length) markets.push({ name, updatedAt: new Date(updated).toISOString(), odds: rows });
      }
      if (!markets.length) { error('odds', 'no-usable-markets'); continue; }
      const url = stakeURL(entry.urls?.Stake, key);
      output.events.push({ ...meta, bookmakers: { Stake: markets }, ...(url ? { urls: { Stake: url } } : {}) });
    }
    if ([...requested.keys()].some((id) => !seen.has(id))) error('odds', 'missing-events');
  }
  output.status = errors.length ? output.events.length ? 'partial' : 'unavailable' : 'connected';
  output.message = output.status === 'connected' ? output.events.length ? 'Stake prices received from the configured provider.' : 'No upcoming Stake-priced events were returned for this window.' : output.status === 'partial' ? 'Only part of the requested Stake coverage is available. See collection status.' : 'Stake prices could not be collected. Check provider access, quota and connection.';
  return output;
}
