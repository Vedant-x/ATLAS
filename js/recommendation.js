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

// Uncertainty of one fixture's chance: not shown. The interval used until 27 Oct (p plus or minus
// 1.96 sqrt(p(1-p)/n), n the size of a broad family of settled forecasts, or 15 points with none) is
// a cohort hit-rate interval, not a validated range for one match. None is shown until a method passes
// held-out checks (event- and day-blocked resampling, reliability bins with their support counts).
// n is reported as the support behind the calibration, which is what it is.
export function uncertainty(p, n) {
  return { method: `not validated for a single match; calibration rests on ${n > 0 ? n : 'no'} settled forecasts of this kind`, range: null };
}

export function recommendation(b, { modelVersion, calibrationVersion = null, calN = null, readiness = null, constraints = null, mode = null, reason = null, now = Date.now(), generatedAt = null, publishedAt = null, sources = [] } = {}) {
  const e = b.event || b.e;
  const sel = selectionId({ eventId: e.id, market: b.market, pick: b.pick, prop: b.prop });
  // The quote taken: its bookmaker and the time that quote was read (Stake's read for Stake's price,
  // never the board's time for another book's price).
  const quoteAt = b.quoteAt ?? (b.atStake ? e.stakeAt : e.priceAt ?? (e.markets?.length ? e.fetchedAt : null)) ?? null;
  const priced = b.priced !== false && !b.derived;
  const book = priced ? b.book || e.bookmaker || null : null;
  // Quote identity: selection, line, price, bookmaker and read time (the settlement rules follow the market).
  const quoteId = priced ? `${sel}@${Number(b.odds).toFixed(2)}|${book ?? ''}|${lineOf(b.pick) ?? ''}${quoteAt ? `#${quoteAt}` : ''}` : null;
  return {
    schema: MODEL_SCHEMA,
    // recommendationId: the selection at a price under one model and calibration (shared by every
    // surface showing it). forecastId: this exact forecast revision (the quote's bookmaker and time,
    // the exact odds and the chance shown), so any change to the quote or the chance is a new forecast.
    recommendationId: `r-${hash(`${sel}|${Number(b.odds).toFixed(2)}|${modelVersion}|${calibrationVersion}`)}`,
    forecastId: `f-${hash(`${sel}|${b.odds}|${priced ? book || '' : 'fair'}|${quoteAt ?? ''}|${Number(b.p).toFixed(4)}|${Number(b.pRaw ?? b.p).toFixed(4)}|${modelVersion}|${calibrationVersion}`)}`,
    canonicalSelectionId: sel,
    eventId: e.id, sport: e.sport, league: e.league,
    marketId: b.market, selection: b.pick, line: lineOf(b.pick), settlementRules: settlementRules(b.market, e.sport),
    bookmaker: book, quoteType: priced ? (b.atStake ? 'bookmaker' : e.quoteType || 'bookmaker') : 'model fair odds',
    quoteId, quotedOdds: b.odds, quoteAt,
    // fetchedAt: when ATLAS read the feed; sourceUpdatedAt: the quote's own time where the source gives
    // one (the many-bookmaker feed), else null; referenceAt: when the market reference was read.
    fetchedAt: b.atStake ? e.stakeAt ?? null : e.fetchedAt ?? null, sourceUpdatedAt: !b.atStake && e.oddsSource === 'the-odds-api' ? e.priceAt ?? null : null, referenceAt: b.referenceAt ?? null,
    // When the forecast was computed (the data build that produced it, where known) and when it was
    // published to the record (null for a display that was never recorded): never the render time.
    forecastGeneratedAt: generatedAt ?? e.fetchedAt ?? now, publishedAt,
    modelVersion, calibrationVersion,
    rawProbability: b.pRaw ?? b.p, calibratedProbability: b.p, marketProbability: b.fair ?? null,
    // Named probabilities and returns (track.js named): never one ev with two meanings.
    modelProbability: b.modelProbability ?? null, modelEV: b.modelEV ?? null, referenceProbability: b.referenceProbability ?? null, referenceEV: b.referenceEV ?? null,
    referenceMethod: b.referenceMethod ?? null, selectionBasis: b.selectionBasis ?? null,
    ...(() => { const u = uncertainty(b.p, calN); return { uncertaintyMethod: u.method, uncertaintyRange: u.range }; })(),
    evidenceReferences: sources, readiness: readiness?.state ?? null, missingInputs: readiness ? [...(readiness.missing || []), ...(readiness.uncovered || [])] : [],
    requestConstraints: constraints, rankingMode: mode, rankingReason: reason,
  };
}
