import { zone as tzZone } from '../tz.js';
import { marketOk } from './constraints.js';
// What the assistant knows: read-only views over the site's live state (matches, prices, model
// probabilities, injuries, starters, slips). Used by both the built-in brain and the Claude tools,
// so every answer comes from the same numbers the pages show.
import { analysisFor, matchBestBets } from '../views.js';
import { todayEvents } from '../engine.js';
import { loadDetail, detailFor } from '../detail.js';
import { CATALOG, ALL_LEAGUES, sportById } from '../catalog.js';
import { prefs, prefEvents } from '../prefs.js';
import { liveWin } from '../live.js';
import { calibrated, shownProp, rankedBankers, bestBets, valueBets, recommendationFor } from '../track.js';
import { bankers } from '../intel.js';
import { trackCalibration, trackStats } from '../trackview.js';
import { researchRow, caseFor, researchPrefs } from '../research.js';
import { changesSince, lastVisit, needsReview, timelineUpdatedAt } from '../timeline.js';
import { watch } from '../alerts.js';
import { readiness, priceTime } from '../readiness.js';
import { playersData, playersMeta, loadPlayers, rowsOf, valueOf } from '../playerdata.js';
import { analyseSlip } from '../slipcheck.js';
import { slip } from '../slip.js';
import { propReadiness } from '../propcheck.js';
import { PROP_STATS, propMarket } from '../props.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);

// Names people use for sports, mapped to catalogue ids.
const SPORT_WORDS = [
  [/\b(soccer|football(?! league)|futbol|epl|premier league|la ?liga|bundesliga|serie a|ligue 1|champions league|ucl|europa)\b/, 'football'],
  [/\b(nfl|american football|ncaaf|college football|cfl)\b/, 'americanfootball'],
  [/\b(nba|wnba|basketball|hoops|ncaab)\b/, 'basketball'],
  [/\b(nhl|hockey|ice hockey)\b/, 'hockey'],
  [/\b(mlb|npb|kbo|baseball)\b/, 'baseball'],
  [/\b(tennis|atp|wta)\b/, 'tennis'],
  [/\b(ufc|mma|pfl|bellator|fight|fights)\b/, 'mma'],
  [/\b(rugby|nrl|six nations|super rugby)\b/, 'rugby'],
  [/\b(afl|aussie rules)\b/, 'aussierules'],
  [/\b(lacrosse|pll|nll)\b/, 'lacrosse'],
  [/\b(volleyball)\b/, 'volleyball'],
  [/\b(cricket|ipl|t20|odi|test match|big bash|bbl)\b/, 'cricket'],
  [/\b(darts|pdc)\b/, 'darts'], [/\b(snooker)\b/, 'snooker'], [/\b(handball)\b/, 'handball'],
  [/\b(table tennis|ping ?pong)\b/, 'tabletennis'], [/\b(badminton|bwf)\b/, 'badminton'], [/\b(boxing|boxer)\b/, 'boxing'],
  [/\b(netball)\b/, 'netball'], [/\b(gaa|gaelic|hurling)\b/, 'gaelic'],
];
// League shortcuts people type ("nba", "epl", "npb") → league path.
const LEAGUE_WORDS = [
  [/\bnba\b/, 'basketball/nba'], [/\bwnba\b/, 'basketball/wnba'], [/\bnfl\b/, 'football/nfl'], [/\bnhl\b/, 'hockey/nhl'],
  [/\bmlb\b/, 'baseball/mlb'], [/\bnpb\b/, 'atlas/npb'], [/\bkbo\b/, 'atlas/kbo'], [/\batp\b/, 'tennis/atp'], [/\bwta\b/, 'tennis/wta'],
  [/\bufc\b/, 'mma/ufc'], [/\b(epl|premier league)\b/, 'soccer/eng.1'], [/\bla ?liga\b/, 'soccer/esp.1'], [/\bbundesliga\b/, 'soccer/ger.1'],
  [/\bserie a\b/, 'soccer/ita.1'], [/\bligue 1\b/, 'soccer/fra.1'], [/\b(ucl|champions league)\b/, 'soccer/uefa.champions'],
  [/\b(uel|europa league)\b/, 'soccer/uefa.europa'], [/\b(ipl|big bash|bbl|t20 league)\b/, 'atlas/cricket-t20'], [/\bmls\b/, 'soccer/usa.1'], [/\bafl\b/, 'australian-football/afl'], [/\beuroleague\b/, 'atlas/euroleague'], [/\beurocup\b/, 'atlas/eurocup'], [/\bliiga\b/, 'atlas/liiga'], [/\bswiss (nl|national league|hockey)\b/, 'atlas/swissnl'], [/\bmotogp\b/, 'atlas/motogp'],
];

export function createKnowledge(S) {
  const route = () => {
    const [, name = '', ...args] = (location.hash || '#/').split('/');
    return { name: name || 'home', args: args.map(decodeURIComponent) };
  };
  const eventById = (id) => S.events.find((e) => e.id === id);
  const currentEvent = () => { const r = route(); return r.name === 'match' ? eventById(r.args[0]) : null; };
  const currentScope = () => {
    const r = route();
    if (r.name === 'sport') return { sport: r.args[0] };
    if (r.name === 'league') { const l = ALL_LEAGUES.find((x) => x.path === r.args[0].replace(/~/g, '/')); return l ? { league: l.path, sport: l.sport } : {}; }
    const e = currentEvent();
    return e ? { league: e.leaguePath, sport: e.sport } : {};
  };

  const sportIn = (text) => { const t = norm(text); return SPORT_WORDS.find(([re]) => re.test(t))?.[1] || null; };
  const leagueIn = (text) => {
    const t = norm(text);
    const hit = LEAGUE_WORDS.find(([re]) => re.test(t))?.[1];
    if (hit) return hit;
    return ALL_LEAGUES.find((l) => l.name.length > 4 && t.includes(norm(l.name)))?.path || null;
  };

  // Matches whose team / player names appear in the text (best overlap first).
  function eventsIn(text, list = S.events) {
    const q = new Set(words(text));
    if (!q.size) return [];
    const STOP = new Set(['the', 'and', 'bet', 'bets', 'win', 'wins', 'who', 'will', 'game', 'match', 'today', 'tonight', 'odds', 'pick', 'picks', 'injuries', 'injury', 'starters', 'for', 'this', 'with', 'what', 'give', 'best', 'safe', 'city', 'united', 'real', 'team']);
    return list.map((e) => {
      const hw = words(e.home).filter((w) => !STOP.has(w)), aw = words(e.away).filter((w) => !STOP.has(w));
      const score = (hw.some((w) => q.has(w)) ? 1 : 0) + (aw.some((w) => q.has(w)) ? 1 : 0);
      return { e, score };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.e.start - b.e.start).map((x) => x.e);
  }

  // from / to: a start-time window (e.g. tomorrow); exclude: { sports: [], leagues: [] }.
  function filterEvents({ sport, league, today, live, upcoming = true, from, to, exclude } = {}) {
    let list = S.events;
    if (sport) list = list.filter((e) => e.sport === sport);
    if (league) list = list.filter((e) => e.leaguePath === league);
    if (exclude?.sports?.length) list = list.filter((e) => !exclude.sports.includes(e.sport));
    if (exclude?.leagues?.length) list = list.filter((e) => !exclude.leagues.includes(e.leaguePath));
    if (live) list = list.filter((e) => e.live);
    else if (from || to) list = list.filter((e) => !e.live && (!from || e.start >= from) && (!to || e.start < to));
    else if (today) list = todayEvents(list);
    else if (upcoming) list = list.filter((e) => e.live || e.start > Date.now() - 3 * 36e5);
    return list;
  }

  // Every pick candidate: bookmaker prices (model-adjusted probability) or, with no price, the
  // model's favourite at fair odds.
  function candidates(list) {
    const out = [];
    const cal = trackCalibration(); // same calibrated chance the pages and the record use
    for (const e of list) {
      if (e.live) continue; // stored prices are pre-match
      if (e.markets?.length || e.props?.length) {
        // The shortlist's own candidates and calibration (sport included), so the assistant and the
        // cards always quote the same chance for the same pick.
        for (const b of bankers([e], { min: 0, limit: 999 })) {
          const p = calibrated(b.p, b.market, cal, e.sport, b.derived ? null : b.odds);
          out.push({ e, market: b.market, pick: b.pick, odds: b.odds, p, fair: b.fair, ev: p * b.odds - 1, priced: true, ...(b.prop ? { prop: { ...b.prop, id: String(b.prop.id), league: e.leaguePath?.split('/')[1] } } : {}) });
        }
      } else {
        const a = analysisFor(e), w = a.win;
        const fav = w.home >= w.away ? [e.home, w.home] : [e.away, w.away];
        if (w.draw && w.draw > fav[1]) continue;
        out.push({ e, market: 'Winner (model)', pick: fav[0], odds: +(1 / fav[1]).toFixed(2), p: fav[1], ev: 0, priced: false, confidence: a.confidence });
      }
    }
    return out;
  }

  // The same selection engine as the site's lists (track.js), so the assistant and the cards always
  // agree: balanced = Best bets, safe = Best bets rated 60%+ (likeliest first), value = Value bets
  // (prices above the sharp market's fair odds; ATLAS's own "edge" was retired with the model-only
  // picks: it lost). The visitor's saved filters apply: minimum odds, and preferred sports when none
  // is named. Odds limits asked for are hard rules on every pick.
  function picks({ sport, league, today = false, mode = 'balanced', limit = 5, minOdds = prefs.get().minOdds, maxOdds, from, to, exclude, skip = [], markets = null, noProps = false } = {}) {
    let list = filterEvents({ sport, league, today, from, to, exclude }).filter((e) => !e.live);
    if (!sport && !league) list = prefEvents(list);
    const cal = trackCalibration();
    const lo = minOdds || 1;
    const ranked = mode === 'value' ? valueBets(list, { cal, limit: 2000 }).filter((b) => b.odds >= lo)
      : mode === 'safe' ? bestBets(list, { cal, limit: 2000 }).filter((b) => b.p >= 0.6)
        : bestBets(list, { cal, limit: 2000 });
    let c = ranked.map((b) => ({ e: b.event, market: b.market, pick: b.pick, odds: b.odds, p: b.p, fair: b.fair, ev: b.p * b.odds - 1, priced: true, book: b.book || null, recommendationId: recommendationFor(b, cal).recommendationId,
      ...(b.prop ? { prop: { ...b.prop, id: String(b.prop.id), league: b.event.leaguePath?.split('/')[1] } } : {}) }));
    if (minOdds) c = c.filter((x) => x.odds >= minOdds);
    if (maxOdds) c = c.filter((x) => x.odds <= maxOdds);
    c = c.filter((x) => marketOk({ markets, noProps }, x));
    const seen = new Set(), out = [];
    const skipped = new Set(skip);
    for (const x of c) { if (seen.has(x.e.id) || skipped.has(pickId(x))) continue; seen.add(x.e.id); out.push(x); if (out.length >= limit) break; }
    return out;
  }

  // Why nothing qualified: every priced selection that matches the request's scope, day, market
  // type and odds range, each with the reason it was left out (below break-even at this price, below
  // the list's chance floor, missing evidence), the nearest first. Empty when no such market exists.
  function nearMisses({ sport, league, from, to, today = false, exclude, minOdds, maxOdds, markets = null, noProps = false, mode = 'balanced' } = {}) {
    const list = filterEvents({ sport, league, today, from, to, exclude }).filter((e) => !e.live && e.markets?.length);
    const cal = trackCalibration();
    const all = rankedBankers(list, { cal, min: 0, minOdds: minOdds ?? 1.01, maxOdds: maxOdds ?? 1000, limit: 2000, mix: false })
      .filter((b) => marketOk({ markets, noProps }, { market: b.market, prop: b.prop }));
    return all.slice(0, 40).map((b) => {
      const ev = b.p * b.odds - 1, r = readiness(b.event, { priceAt: priceTime(b.event) });
      const reasons = [];
      if (ev < 0) reasons.push(`below break-even at this price (needs ${Math.round(100 / b.odds)}%, ATLAS ${Math.round(b.p * 100)}%)`);
      if (mode === 'safe' && b.p < 0.6) reasons.push('under the 60% chance this list needs');
      if (mode === 'balanced' && b.p < 0.55) reasons.push('under the 55% chance Best bets need');
      const missing = r.checks.filter((x) => x.ok === false && x.key !== 'price').map((x) => x.label.toLowerCase());
      if (missing.length) reasons.push(`missing: ${missing.join(', ')}`);
      if (r.checks.some((x) => x.key === 'price' && x.ok === false)) reasons.push('price not fresh');
      return { e: b.event, market: b.market, pick: b.pick, odds: b.odds, p: b.p, ev, reasons };
    }).sort((x, y) => y.p - x.p);
  }

  const startersOf = (e) => (e.probables || []).filter((p) => p.report).map((p) => {
    const r = p.report;
    return { side: p.side, team: p.side === 'home' ? e.home : e.away, name: r.name, league: r.league, throws: r.throws, age: r.age,
      season: r.season && { era: r.season.era, whip: r.season.whip, k9: r.season.k9, bb9: r.season.bb9, w: r.season.w, l: r.season.l, ip: r.season.ip },
      last3: r.form3 && { era: r.form3.era, whip: r.form3.whip }, rest: r.rest, vsOpp: r.vsOpp && { avg: r.vsOpp.avg, ops: r.vsOpp.ops, era: r.vsOpp.era },
      injuries: (r.injuries || []).slice(0, 3) };
  });

  // Injuries/absences for one match (loads the match detail if needed).
  async function injuriesOf(e) {
    let d = detailFor(e.id);
    if (!d) d = await loadDetail(e).catch(() => null);
    const ab = d?.absences || e.absences;
    const side = (s) => [
      ...(d?.injuries?.[s] || []).map((i) => ({ name: i.name, status: i.status, detail: [i.side, i.type, i.detail].filter(Boolean).join(' ') || 'injury not specified', back: i.returnDate || null })),
      ...(ab?.[s] || []).map((i) => ({ name: i.name, status: i.type, detail: i.injury || (i.type === 'Suspended' ? 'suspension' : 'injury not specified'), back: i.expectedReturn || null })),
    ];
    const covered = Boolean(d?.injuryFeed || ab);
    return { covered, source: [d?.injuryFeed, ab?.source].filter(Boolean).join(' + ') || null, home: side('home'), away: side('away') };
  }

  // Compact description of one match for answers and for Claude.
  function matchSummary(e) {
    const a = analysisFor(e);
    const top = candidates([{ ...e, live: false }]).sort((x, y) => y.p - x.p).slice(0, 6)
      .map((x) => ({ market: x.market, pick: x.pick, odds: x.odds, probability: r2(x.p), edge: x.priced ? r2(x.ev) : null, priced: x.priced }));
    const derived = (a.groups || []).flatMap((g) => g.markets.slice(0, 2).map((m) => ({ market: m.name, top: m.outcomes.slice().sort((p, q) => q.p - p.p).slice(0, 3).map((o) => ({ pick: o.name, probability: r2(o.p), fairOdds: r2(o.fair) })) }))).slice(0, 8);
    return {
      id: e.id, url: `#/match/${e.id}`, sport: sportById(e.sport)?.name || e.sport, league: e.league, home: e.home, away: e.away,
      start: new Date(e.start).toISOString(), live: Boolean(e.live), score: e.score || null, venue: e.venue || null, note: e.note || null,
      winProbability: { home: r2(a.win.home), draw: a.win.draw ? r2(a.win.draw) : undefined, away: r2(a.win.away) },
      liveEstimate: (() => { const lw = liveWin(e, a); return lw ? { home: r2(lw.home), draw: lw.draw != null ? r2(lw.draw) : undefined, away: r2(lw.away), gameLeft: r2(lw.left) } : undefined; })(),
      basis: a.basis, confidence: a.confidence, bookmaker: e.bookmaker || null, bestPrices: top, modelMarkets: derived,
      // The picks to recommend: 1-3 that agree with each other (one side, one goals direction).
      recommended: matchBestBets(e, a).map((x) => ({ label: x.label, market: x.market, pick: x.pick, odds: r2(x.odds), probability: r2(x.q), priced: x.book, edge: x.book ? r2(x.ev) : null })),
      records: e.stats?.homeRecord || e.stats?.awayRecord ? { home: e.stats.homeRecord, away: e.stats.awayRecord } : undefined,
      form: e.stats?.homeForm ? { home: (e.stats.homeForm || []).join(''), away: (e.stats.awayForm || []).join('') } : undefined,
      starters: startersOf(e), tennis: e.tennis ? { tournament: e.tennis.tournament, location: e.tennis.location, draw: e.tennis.drawName, round: e.tennis.round, bestOf: e.tennis.bestOf } : undefined,
    };
  }

  // Research: the case for one match (supports / against / unknown / would change the call), the
  // evidence readiness, and the change timeline. Same functions the pages use.
  const caseOf = (e) => { const x = researchRow(e); return { row: x, ...(caseFor(x) || { pro: [], con: [], unknown: [], invalid: [] }) }; };
  const readinessOf = (e) => readiness(e, { priceAt: priceTime(e) });
  const changes = ({ since = lastVisit(), watchedOnly = false } = {}) => changesSince(since).filter((c) => !watchedOnly || watch.has(c.eventId));
  const reviewList = () => watch.ids().map((id) => S.events.find((e) => e.id === id)).filter(Boolean).map((e) => ({ e, changes: needsReview(e.id) })).filter((x) => x.changes.length);
  const freshness = () => ({ pricesAt: S.events?.reduce((t, e) => Math.max(t, priceTime(e) || 0), 0) || null, changesAt: timelineUpdatedAt() });
  // Slips, optionally limited to the events a question allows (sport, dates, exclusions) and a minimum
  // leg price; a filtered set is built fresh rather than read from the page's cache.
  const slips = (target, today = true, { filter = null, key = '', minOdds = null, maxOdds = null, positiveOnly = false } = {}) => S.slips(target, { count: 5, today: today && target < 100, filter, key, minOdds, maxOdds, positiveOnly });
  const pickId = (x) => `${x.e.id}|${x.market}|${x.pick}`;

  // Player research for the assistant: a player named in the question, with every line he has and
  // what his recent games say (same model and data as the props pages).
  function playerResearch(text) {
    const data = playersData() || loadPlayers();
    if (!data) return null;
    const t = norm(text);
    const hit = Object.entries(data).find(([, p]) => { const parts = norm(p.n).split(' '); const last = parts.at(-1); return last.length > 3 && t.includes(last) && (parts.length < 2 || t.includes(parts[0]) || t.split(/\s+/).includes(last)); });
    if (!hit) return null;
    const [key, p] = hit;
    const [league, id] = key.split('|');
    const lines = [];
    const cal = trackCalibration(); // the same calibrated chance as the props pages, never the raw one
    for (const e of S.events) {
      if (e.leaguePath?.split('/')[1] !== league) continue;
      for (const raw of e.props || []) if (String(raw.id) === id) { const x = shownProp(raw, propMarket(raw), cal, e.sport); lines.push({ e, x, r: propReadiness(e, x, { logsAt: playersMeta().updatedAt }) }); }
    }
    const rows = rowsOf(p);
    return { key, name: p.n, team: p.t, sport: p.s, games: rows.length, logsAt: playersMeta().updatedAt, lines, injury: p.inj || null,
      recent: (type) => rows.slice(0, 10).map((r) => valueOf(p.s, type, r)).filter((v) => v != null), label: (type) => PROP_STATS[p.s]?.[type]?.label || type };
  }
  // The visitor's current slip, analysed (dependencies, combined chance, return at the price).
  const slipSummary = () => (slip.legs.length ? { legs: slip.legs, ...analyseSlip(slip.legs, { logs: playersData() }) } : null);
  // Where the facts for a match come from, and how old each one is.
  function sourcesFor(e) {
    const age = (t) => (t ? `${Math.max(0, Math.round((Date.now() - t) / 6e4))} min ago` : 'time unknown');
    const out = [];
    if (e.markets?.length) out.push({ what: 'Prices', from: e.bookmaker || 'bookmaker feed', at: age(priceTime(e)) });
    out.push({ what: 'Fixture and scores', from: e.source || 'league feed', at: age(e.fetchedAt ?? null) });
    if (e.props?.length) out.push({ what: 'Player props', from: 'DraftKings via ESPN', at: age(e.fetchedAt ?? null) });
    if (e.injuries || e.injuryChecked) out.push({ what: 'Injury report', from: 'ESPN', at: age(e.injuryChecked || e.injuries?.at) });
    if (e.absences) out.push({ what: 'Absences and lineups', from: e.absences.source || 'FotMob', at: age(e.absences.at) });
    if ((e.probables || []).some((x) => x.report)) out.push({ what: 'Starting pitchers', from: 'MLB / NPB / KBO feeds', at: age((e.probables || []).find((x) => x.report)?.report?.fetchedAt ?? null) });
    if (playersMeta().updatedAt && e.props?.some((x) => x.hist)) out.push({ what: 'Player game logs', from: 'ESPN game logs', at: age(playersMeta().updatedAt) });
    return out;
  }

  const catalog = () => CATALOG.map((s) => ({ id: s.id, name: s.name, matches: S.events.filter((e) => e.sport === s.id).length }));

  // The retired longer slips' final record, for answers to "give me a 10x slip".
  const retiredSlips = () => {
    const r = (trackStats()?.retired || []).filter((x) => /slips/i.test(x.name));
    const won = r.reduce((a, x) => a + x.won, 0), n = r.reduce((a, x) => a + x.won + x.lost, 0);
    return n ? `${won} won of ${n}` : null;
  };

  return { route, currentEvent, retiredSlips, currentScope, eventById, sportIn, leagueIn, eventsIn, filterEvents, picks, nearMisses, pickId, candidates, matchSummary, injuriesOf, startersOf, slips, catalog, norm, caseOf, readinessOf, changes, reviewList, freshness, lastVisit, minOdds: () => prefs.get().minOdds, zone: () => tzZone(), playerResearch, slipSummary, sourcesFor, SPORT_WORDS, LEAGUE_WORDS };
}
