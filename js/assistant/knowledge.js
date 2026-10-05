// What the assistant knows: read-only views over the site's live state (matches, prices, model
// probabilities, injuries, starters, slips). Used by both the built-in brain and the Claude tools,
// so every answer comes from the same numbers the pages show.
import { analysisFor, matchBestBets } from '../views.js';
import { devig, todayEvents } from '../engine.js';
import { loadDetail, detailFor } from '../detail.js';
import { CATALOG, ALL_LEAGUES, sportById } from '../catalog.js';
import { prefs, prefEvents } from '../prefs.js';
import { liveWin } from '../live.js';

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
];
// League shortcuts people type ("nba", "epl", "npb") → league path.
const LEAGUE_WORDS = [
  [/\bnba\b/, 'basketball/nba'], [/\bwnba\b/, 'basketball/wnba'], [/\bnfl\b/, 'football/nfl'], [/\bnhl\b/, 'hockey/nhl'],
  [/\bmlb\b/, 'baseball/mlb'], [/\bnpb\b/, 'atlas/npb'], [/\bkbo\b/, 'atlas/kbo'], [/\batp\b/, 'tennis/atp'], [/\bwta\b/, 'tennis/wta'],
  [/\bufc\b/, 'mma/ufc'], [/\b(epl|premier league)\b/, 'soccer/eng.1'], [/\bla ?liga\b/, 'soccer/esp.1'], [/\bbundesliga\b/, 'soccer/ger.1'],
  [/\bserie a\b/, 'soccer/ita.1'], [/\bligue 1\b/, 'soccer/fra.1'], [/\b(ucl|champions league)\b/, 'soccer/uefa.champions'],
  [/\b(uel|europa league)\b/, 'soccer/uefa.europa'], [/\b(ipl|big bash|bbl|t20 league)\b/, 'atlas/cricket-t20'], [/\bmls\b/, 'soccer/usa.1'], [/\bafl\b/, 'australian-football/afl'],
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

  function filterEvents({ sport, league, today, live, upcoming = true } = {}) {
    let list = S.events;
    if (sport) list = list.filter((e) => e.sport === sport);
    if (league) list = list.filter((e) => e.leaguePath === league);
    if (live) list = list.filter((e) => e.live);
    else if (today) list = todayEvents(list);
    else if (upcoming) list = list.filter((e) => e.live || e.start > Date.now() - 3 * 36e5);
    return list;
  }

  // Every pick candidate: bookmaker prices (model-adjusted probability) or, with no price, the
  // model's favourite at fair odds.
  function candidates(list) {
    const out = [];
    for (const e of list) {
      if (e.live) continue; // stored prices are pre-match
      if (e.markets?.length) {
        for (const m of e.markets) {
          const { outcomes } = devig(m);
          outcomes.forEach((o, i) => {
            const p = m.outcomes[i].model ?? o.fair;
            out.push({ e, market: m.name, pick: o.name, odds: o.odds, p, ev: p * o.odds - 1, priced: true });
          });
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

  // mode: safe (highest win chance), value (model above the price), balanced (short-ish odds, high chance).
  // The visitor's saved filters apply: minimum odds, and preferred sports when none is named.
  function picks({ sport, league, today = false, mode = 'balanced', limit = 5, minOdds = prefs.get().minOdds, maxOdds } = {}) {
    let list = filterEvents({ sport, league, today });
    if (!sport && !league) list = prefEvents(list);
    let c = candidates(list);
    if (prefs.get().pricedOnly) c = c.filter((x) => x.priced);
    if (minOdds) c = c.filter((x) => x.odds >= minOdds);
    if (maxOdds) c = c.filter((x) => x.odds <= maxOdds);
    if (mode === 'safe') c = c.filter((x) => x.p >= 0.6).sort((a, b) => b.p - a.p || b.priced - a.priced);
    else if (mode === 'value') c = c.filter((x) => x.priced && x.ev > 0 && x.odds <= 5).sort((a, b) => b.ev - a.ev);
    else c = c.filter((x) => x.odds >= 1.3 && x.odds <= 2.6 && x.p >= 0.45).sort((a, b) => (b.priced - a.priced) || b.p - a.p);
    const seen = new Set(), out = [];
    for (const x of c) { if (seen.has(x.e.id)) continue; seen.add(x.e.id); out.push(x); if (out.length >= limit) break; }
    return out;
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

  const slips = (target, today = true) => S.slips(target, { count: 5, today: today && target < 100 });

  const catalog = () => CATALOG.map((s) => ({ id: s.id, name: s.name, matches: S.events.filter((e) => e.sport === s.id).length }));

  return { route, currentEvent, currentScope, eventById, sportIn, leagueIn, eventsIn, filterEvents, picks, matchSummary, injuriesOf, startersOf, slips, catalog, norm };
}
