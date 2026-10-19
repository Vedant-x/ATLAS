// One recommendation object for every surface: dashboard cards, the research table, assistant answers,
// slip legs and the track record all describe a pick with this, so the same pick at the same quote and
// model has the same recommendationId everywhere. Built from a ranked pick (track.js / intel.js
// bankers: { event, market, pick, odds, p, pRaw, fair, book, prop }). Pure, so it can be tested.
import { selectionId } from './settle.js';

export const MODEL_SCHEMA = 1;
// Short FNV-1a hash: stable ids without a crypto dependency.
const hash = (s) => { let h = 0x811c9dc5; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };

// The line a selection is at ("Over 2.5", "Arsenal -1.5", "20+ Points"), or null.
export const lineOf = (pick = '') => { const m = String(pick).match(/([+-]?\d+(?:\.\d+)?)\+?(?!.*\d)/); return m ? Number(m[1]) : null; };

// How each market settles, in a sentence, so a card can say it and the grader follows it.
export function settlementRules(market = '', sport = '') {
  if (/^Player /.test(market)) return 'Player must play; a player who does not play voids the pick (DNP). Graded from the official box score.';
  if (/^Total/.test(market)) return `Final score including ${sport === 'football' ? 'stoppage time, not extra time or penalties' : 'overtime'}; a total exactly on a whole-number line pushes.`;
  if (market === 'Spread') return `Final score including ${sport === 'football' ? 'stoppage time' : 'overtime'}; a margin exactly on a whole-number line pushes.`;
  if (market === 'Match Result') return 'Result after regular time including stoppage time (90 minutes); extra time and penalties do not count.';
  return 'The winner as officially recorded, overtime and shoot-outs included. Postponed: void after 72 hours; cancelled or abandoned: void.';
}

// Uncertainty of a calibrated chance from the size of the record behind it (normal approximation of
// a proportion estimated from n settled forecasts of its kind). n unknown or 0: the widest honest range.
export function uncertainty(p, n) {
  if (!(n > 0)) return { method: 'no settled record of this kind yet', range: [Math.max(0, p - 0.15), Math.min(1, p + 0.15)] };
  const half = 1.96 * Math.sqrt((p * (1 - p)) / n);
  return { method: `normal approximation from ${n} settled forecasts of this kind`, range: [Math.max(0, +(p - half).toFixed(3)), Math.min(1, +(p + half).toFixed(3))] };
}

export function recommendation(b, { modelVersion, calibrationVersion = null, calN = null, readiness = null, constraints = null, mode = null, reason = null, now = Date.now(), sources = [] } = {}) {
  const e = b.event || b.e;
  const sel = selectionId({ eventId: e.id, market: b.market, pick: b.pick, prop: b.prop });
  const quoteAt = e.priceAt ?? (e.markets?.length ? e.fetchedAt ?? null : null);
  const priced = b.priced !== false && !b.derived;
  const quoteId = priced ? `${sel}@${Number(b.odds).toFixed(2)}${quoteAt ? `#${quoteAt}` : ''}` : null;
  return {
    schema: MODEL_SCHEMA,
    recommendationId: `r-${hash(`${sel}|${Number(b.odds).toFixed(2)}|${modelVersion}|${calibrationVersion}`)}`,
    canonicalSelectionId: sel,
    eventId: e.id, sport: e.sport, league: e.league,
    marketId: b.market, selection: b.pick, line: lineOf(b.pick), settlementRules: settlementRules(b.market, e.sport),
    bookmaker: priced ? b.book || e.bookmaker || null : null, quoteType: priced ? e.quoteType || 'bookmaker' : 'model fair odds',
    quoteId, quotedOdds: b.odds,
    sourceUpdatedAt: e.fetchedAt ?? null, fetchedAt: quoteAt,
    forecastGeneratedAt: now, publishedAt: now,
    modelVersion, calibrationVersion,
    rawProbability: b.pRaw ?? b.p, calibratedProbability: b.p, marketProbability: b.fair ?? null,
    ...(() => { const u = uncertainty(b.p, calN); return { uncertaintyMethod: u.method, uncertaintyRange: u.range }; })(),
    evidenceReferences: sources, readiness: readiness?.state ?? null, missingInputs: readiness ? [...(readiness.missing || []), ...(readiness.uncovered || [])] : [],
    requestConstraints: constraints, rankingMode: mode, rankingReason: reason,
  };
}
