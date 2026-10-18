// Built-in brain: understands the common questions (best bets, bets for a sport, injuries,
// starters, who wins, multiplier slips, live games, players) and answers from the site's own data.
// No API key needed. Answers are { text, cards, chips, followups, sources } where text is a small
// markdown subset.
//
// Every request's constraints (odds range, day, sports included or left out, positive return only,
// how many) are parsed once (constraints.js) and kept: never widened or swapped for something else.
// "Nothing qualifies" is a valid answer. The conversation keeps a structured memory (the last list of
// picks, the pick or match in focus, the constraints in force), so "the second one", "what about
// tomorrow?" and "explain the risk" work.
import { parseConstraints, constraintChips, slipRequest, slipsOk, legOk } from './constraints.js';
const pc = (p) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
const od = (o) => (Number.isFinite(o) ? o.toFixed(2) : '—');
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, few: 4, couple: 2, some: 4 };

export function createBrain(K) {
  if (!K.pickId) K = { ...K, pickId: (x) => `${x.e.id}|${x.market}|${x.pick}` };
  const howMany = (q, d) => {
    const m = q.match(/\b(\d{1,2})\s*(?:bets?|picks?|tips?|games?|matches?|safe|value|best)?\b/);
    if (m && Number(m[1]) <= 15 && !/\d\s*x\b/.test(q)) return Number(m[1]);
    const w = Object.keys(NUM).find((k) => new RegExp(`\\b${k}\\b`).test(q));
    return w ? NUM[w] : d;
  };
  const pickCard = (x) => ({ type: 'pick', e: x.e, market: x.market, pick: x.pick, odds: x.odds, p: x.p, ev: x.ev, priced: x.priced, ...(x.prop ? { prop: x.prop } : {}), at: Date.now() });
  // Structured memory of this conversation.
  const mem = { list: [], focus: null, constraints: null, event: null };
  const remember = (list, c) => { mem.list = list; mem.constraints = c; mem.focus = list[0] || null; mem.event = list[0]?.e || mem.event; };
  const leagueName = (path) => { const e = K.filterEvents({ league: path })[0]; return e?.league || path.split('/').pop().toUpperCase(); };
  const SPORT_LABEL = { football: 'Soccer', americanfootball: 'American football', aussierules: 'Aussie rules' };
  const chipsOf = (c) => constraintChips(c, { leagueName, sport: c.sport ? SPORT_LABEL[c.sport] || c.sport[0].toUpperCase() + c.sport.slice(1) : null });
  const FOLLOW_PICK = ['Explain the risk', 'Compare alternatives', 'What would change this?'];
  const followupsFor = (x) => (x ? [...FOLLOW_PICK, ...(x.prop ? ['Show player history'] : [])] : []);
  const scopeLabel = (s) => [s.league ? s.leagueName : null, !s.league && s.sport ? s.sportName : null].filter(Boolean)[0] || 'every sport';

  function scopeFrom(q, useContext) {
    const league = K.leagueIn(q), sport = K.sportIn(q);
    let s = league ? { league } : sport ? { sport } : {};
    if (!league && !sport && useContext) s = K.currentScope();
    if (s.league && !s.sport) { const e = K.filterEvents({ league: s.league })[0]; if (e) s.sport = e.sport; }
    return s;
  }
  const names = (s) => {
    const e = K.filterEvents(s)[0];
    return { ...s, leagueName: s.league ? e?.league || s.league.split('/').pop().toUpperCase() : null, sportName: s.sport ? ({ football: 'soccer', americanfootball: 'American football', aussierules: 'Aussie rules' })[s.sport] || s.sport : null };
  };

  function targetEvent(q) {
    const found = K.eventsIn(q);
    if (found.length) return found[0];
    if (/\b(this|here|current)\b|\bthis (match|game)\b/.test(q) || true) return K.currentEvent();
    return null;
  }

  // Absences across a league or sport (from the snapshot's FotMob/ESPN lists), when no single match is named.
  function scopeInjuries(q) {
    const scope = names(scopeFrom(q, false));
    if (!scope.league && !scope.sport) return null;
    const evs = K.filterEvents(scope).filter((e) => e.absences && (e.absences.home?.length || e.absences.away?.length)).slice(0, 6);
    if (!evs.length) return { text: `No absence lists are loaded for ${scopeLabel(scope)} yet. Open a match and ask **"injuries"**: I'll fetch its team news live.` };
    const row = (i) => `${i.name} (${i.injury || (i.type === 'Suspended' ? 'suspension' : i.type || 'out')}${i.expectedReturn ? `, back ${i.expectedReturn}` : ''})`;
    const block = (e) => `**${e.home} vs ${e.away}**\n- ${e.home}: ${(e.absences.home || []).map(row).join(', ') || 'none listed'}\n- ${e.away}: ${(e.absences.away || []).map(row).join(', ') || 'none listed'}`;
    return { text: `**Absences: ${scopeLabel(scope)}** (source: ${evs[0].absences.source || 'FotMob'})\n\n${evs.map(block).join('\n\n')}`, cards: evs.slice(0, 4).map((e) => ({ type: 'match', e })) };
  }

  async function injuries(q) {
    const named = K.eventsIn(q)[0];
    if (!named && !/\b(this|here|current)\b/.test(q)) { const s = scopeInjuries(q); if (s) return s; }
    const e = targetEvent(q);
    if (!e) return { text: 'Which match? Open a match page and ask again, or name the teams, e.g. **"injuries Arsenal vs Leeds"**.' };
    const inj = await K.injuriesOf(e);
    const list = (side, team) => (side.length ? side.map((i) => `- **${i.name}**: ${i.status || 'out'}${i.detail ? ` (${i.detail})` : ''}${i.back ? ` · back: ${i.back}` : ''}`).join('\n') : `- nobody listed out for ${team}`);
    if (!inj.covered) return { text: `No injury source covers **${e.home} vs ${e.away}** (${e.league}), so absences are **unknown**, not "none". Check team news before betting.`, cards: [{ type: 'match', e }] };
    return { text: `**Injuries & absences: ${e.home} vs ${e.away}** (source: ${inj.source})\n\n**${e.home}**\n${list(inj.home, e.home)}\n\n**${e.away}**\n${list(inj.away, e.away)}\n\nLate changes happen; confirmed lineups land about an hour before start.`, cards: [{ type: 'match', e }] };
  }

  function starters(q) {
    const e = targetEvent(q);
    if (!e) return { text: 'Which game? Open an MLB, NPB or KBO match and ask **"starters"**, or name the teams.' };
    const st = K.startersOf(e);
    if (!st.length) return { text: `No starters announced for **${e.home} vs ${e.away}** yet. Leagues usually confirm them the day before.`, cards: [{ type: 'match', e }] };
    const line = (s) => `**${s.name}** (${s.team}${s.throws ? `, ${s.throws}HP` : ''}): ${s.season ? `${s.season.era} ERA, ${s.season.whip} WHIP, ${s.season.k9} K/9 (${s.season.w}-${s.season.l})` : 'no season line'}${s.last3 ? ` · last 3 starts ${s.last3.era} ERA` : ''}${s.rest != null ? ` · ${s.rest} days rest` : ''}${s.vsOpp?.avg ? ` · opp AVG vs them ${s.vsOpp.avg}` : ''}`;
    const [a, b] = st;
    let edge = '';
    if (a?.season && b?.season) {
      const better = Number(a.season.era) < Number(b.season.era) ? a : b;
      edge = `\n\nOn season ERA **${better.name}** has the better arm${a.last3 && b.last3 ? `; recent form: ${a.name} ${a.last3.era} vs ${b.name} ${b.last3.era} ERA over the last 3` : ''}.`;
    }
    return { text: `**Starting pitchers: ${e.home} vs ${e.away}**\n\n${st.map((s) => `- ${line(s)}`).join('\n')}${edge}`, cards: [{ type: 'match', e }] };
  }

  function matchView(e) {
    const s = K.matchSummary(e);
    const w = s.winProbability;
    const fav = w.home >= w.away ? e.home : e.away;
    const rec = s.recommended || [];
    const lines = [
      `**${e.home} vs ${e.away}** · ${e.league}${e.live ? ` · LIVE ${e.score || ''}` : ''}`,
      `${e.live ? 'Pre-match estimate (does not include the live score)' : 'Estimated win chance'}: ${e.home} **${pc(w.home)}**${w.draw ? ` · draw ${pc(w.draw)}` : ''} · ${e.away} **${pc(w.away)}** (${s.basis.toLowerCase()})`,
      `Favourite: **${fav}**.`,
      rec.length ? `My bet${rec.length > 1 ? 's' : ''} (all pointing the same way):\n${rec.map((x) => `- **${x.pick}** · ${x.market} at ${od(x.odds)}${x.priced ? '' : ' (fair odds)'}, est. ${pc(x.probability)}`).join('\n')}` : 'No pick strong enough to recommend here.',
      s.starters?.length === 2 && s.starters[0].season && s.starters[1].season ? `Starters: ${s.starters[0].name} (${s.starters[0].season.era} ERA) vs ${s.starters[1].name} (${s.starters[1].season.era} ERA).` : '',
    ].filter(Boolean);
    const cards = rec.map((x) => ({ type: 'pick', e, market: x.market, pick: x.pick, odds: x.odds, p: x.probability, ev: x.edge, priced: x.priced, at: Date.now() }));
    if (rec.length) remember(rec.map((x) => ({ e, market: x.market, pick: x.pick, odds: x.odds, p: x.probability, ev: x.priced ? x.edge : 0, priced: x.priced })), mem.constraints);
    mem.event = e;
    return { text: lines.join('\n'), cards: [{ type: 'match', e }, ...cards], followups: rec.length ? FOLLOW_PICK : [], sources: K.sourcesFor?.(e) || [] };
  }

  // Picks under the question's constraints. With a day, sport or odds range asked for, only those;
  // "positive return only" never falls back to other picks. carry: constraints from the last answer
  // ("what about tomorrow?", "more").
  function bets(q, { carry = null, more = false } = {}) {
    const asked = parseConstraints(q, K);
    const c = carry ? { ...carry, ...Object.fromEntries(Object.entries(asked).filter(([k, v]) => v != null && v !== false && !(k === 'exclude' && !v.sports.length && !v.leagues.length))) } : asked;
    if (carry && asked.exclude && (asked.exclude.sports.length || asked.exclude.leagues.length)) c.exclude = { sports: [...new Set([...(carry.exclude?.sports || []), ...asked.exclude.sports])], leagues: [...new Set([...(carry.exclude?.leagues || []), ...asked.exclude.leagues])] };
    const mode = c.positiveOnly || /\b(value|edge|\+ev|underpriced)\b/.test(q) ? 'value' : /\b(safe|safest|banker|bankers|sure|lock|locks|certain|guarantee)/.test(q) ? 'safe' : (carry?.mode || 'balanced');
    c.mode = mode;
    // Without a day asked for: the next 12 hours, then the next few days (said plainly).
    const n = c.n || howMany(q, 5);
    const scope = c.league ? { league: c.league } : c.sport ? { sport: c.sport } : names(scopeFrom(q.replace(/\b(?:excluding|exclude|except|without|other than|not|no|non)[- ][a-z0-9 ]+/g, ' '), !/\b(all|every|any)\b/.test(q) && !c.exclude.sports.length && !c.exclude.leagues.length));
    const base = { ...scope, mode, limit: n, exclude: c.exclude, ...(c.minOdds != null ? { minOdds: c.minOdds } : {}), ...(c.maxOdds != null ? { maxOdds: c.maxOdds } : {}), skip: more ? mem.list.map(K.pickId) : [] };
    let list, window;
    if (c.from) { list = K.picks({ ...base, from: c.from, to: c.to }); window = { today: 'today', tomorrow: 'tomorrow', week: 'the next 7 days', weekend: 'this weekend' }[c.day]; }
    else {
      list = K.picks({ ...base, today: true }); window = 'the next 12 hours';
      if (!list.length) { list = K.picks({ ...base, today: false }); window = 'the next few days'; }
    }
    list = list.filter((x) => legOk(c, x)); // every chip shown is a rule applied
    const chips = chipsOf(c);
    if (!list.length) {
      const why = mode === 'value' ? 'No pick has a positive estimated return (forecast x odds above 1)' : 'No pick passes these filters';
      const when = { today: 'today', tomorrow: 'for tomorrow', week: 'in the next 7 days', weekend: 'this weekend' }[c.day] || `in ${window || 'the window asked for'}`;
      remember([], c);
      return { text: `**${why}** ${when}. I won't swap in picks that break what you asked for.\n\nYou could widen the window, drop a filter${mode === 'value' ? ', or ask for **"best bets"** without the positive-return rule' : ''}.`, chips, followups: mode === 'value' ? ['Best bets anyway', 'Best bets this week'] : ['Best bets this week'] };
    }
    const head = { safe: 'Safest picks', value: 'Positive estimated return', balanced: 'Best bets' }[mode];
    const combo = list.reduce((a, x) => a * x.odds, 1), comboP = list.reduce((a, x) => a * x.p, 1);
    const f = K.freshness?.() || {}, mins = (t) => (t ? Math.max(0, Math.round((Date.now() - t) / 6e4)) : null);
    const why = (x) => {
      const cs = K.caseOf?.(x.e) || { pro: [], con: [], invalid: [] }, r = K.readinessOf?.(x.e) || { label: 'not checked', missing: [], uncovered: [] };
      return [
        `   Price ${od(x.odds)} needs ${pc(1 / x.odds)} · ATLAS ${pc(x.p)} · return ${x.ev >= 0 ? '+' : ''}${(x.ev * 100).toFixed(1)}%${x.priced ? '' : ' (model, no bookmaker price)'}`,
        cs.pro.find((t) => !/^Bookmaker price/.test(t)) ? `   For: ${cs.pro.find((t) => !/^Bookmaker price/.test(t)).replace(/\.$/, '')}.` : '',
        cs.con[0] ? `   Against: ${cs.con[0]}` : '',
        `   Evidence: ${r.label}${r.missing.length || r.uncovered.length ? ` (unknown: ${[...r.missing, ...r.uncovered].join(', ').toLowerCase()})` : ''}.`,
      ].filter(Boolean).join('\n');
    };
    remember(list, c);
    return {
      text: `**${head}${more ? ' (more)' : ''}** · ${window}\n\n${list.map((x, i) => `${i + 1}. **${x.pick}** · ${x.market} · ${x.e.home} vs ${x.e.away}: odds ${od(x.odds)}, est. ${pc(x.p)}\n${why(x)}`).join('\n')}\n\nAs singles each stands alone. Together: about **${od(combo)}x**, ${pc(comboP)} if the legs are unrelated.\nFreshness: prices checked ${mins(f.pricesAt) ?? '?'} min ago${f.changesAt ? `, team news ${mins(f.changesAt)} min ago` : ''}. Ask about **"the second one"** or tap a follow-up.`,
      cards: list.map(pickCard), chips, followups: ['More like these', ...followupsFor(list[0]).slice(0, 2)],
      sources: list.slice(0, 4).flatMap((x) => (K.sourcesFor?.(x.e) || []).map((src) => ({ ...src, match: `${x.e.home} v ${x.e.away}` }))),
    };
  }

  // A multiplier slip under the question's constraints (sport, day, exclusions, minimum leg odds).
  function multiplier(q) {
    const c = parseConstraints(q, K);
    const t = c.target || (/mega|long ?shot/.test(q) ? 100 : 3);
    const mega = t >= 100;
    // One request for every rule shown in the chips; the result is checked against them again.
    const list = slipsOk(c, K.slips(t, !mega && !c.from, slipRequest(c)));
    const chips = chipsOf({ ...c, target: t });
    if (!list.length) return { text: `**No ${t}x slip can be built** ${chips.length > 1 ? `with ${chips.filter((x) => x !== `${t}x`).join(' · ')}` : 'from the current picks'}: not enough qualifying legs. I won't loosen the filters on my own; try a smaller multiplier or a wider window.`, chips };
    const s = list[0];
    remember(s.legs.map((l) => ({ e: K.eventById?.(l.eventId), market: l.market, pick: l.pick, odds: l.odds, p: l.p, ev: l.p * l.odds - 1, priced: !l.derived, prop: l.prop })).filter((x) => x.e), c);
    return {
      text: `**Top ${t}x slip**: ${s.legs.length} legs at **${od(s.odds)}x**, estimated **${pc(s.p)}** if the legs are unrelated (the slip check in your slip measures same-match legs).\n\n${s.legs.map((l) => `- **${l.pick}** · ${l.market} · ${l.match} @ ${od(l.odds)} (${pc(l.p)})`).join('\n')}\n\n${list.length > 1 ? `${list.length - 1} more on the [${t}x page](#/${mega ? 'mega' : [2, 3, 4, 5, 10, 20].includes(t) ? `x/${t}` : `target/${t}`}).` : ''}`,
      cards: s.legs.map((l) => ({ type: 'leg', leg: l, at: Date.now() })), chips, followups: ['Explain the risk', 'Which leg is weakest?'],
    };
  }

  // ---------- follow-ups on the pick in focus ----------
  const ORD = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, fifth: 4, '5th': 4, last: -1 };
  function resolvePick(q) {
    const m = q.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\b(?: one| pick| bet| leg)?|#\s?(\d)|\b(?:number|no\.?|pick|bet|leg) ?(\d)\b/);
    if (!m || !mem.list.length) return null;
    const i = m[1] != null ? ORD[m[1]] : Number(m[2] || m[3]) - 1;
    return mem.list.at(i) || null;
  }
  function explainRisk(x) {
    const cs = K.caseOf(x.e), r = K.readinessOf(x.e);
    const margin = x.p - 1 / x.odds;
    return { text: `**Risk: ${x.pick}** (${x.e.home} vs ${x.e.away})\n\n- Loses about **${pc(1 - x.p)}** of the time on ATLAS's estimate.\n- Margin over break-even: ${margin >= 0 ? '+' : ''}${(margin * 100).toFixed(1)} pts (${pc(x.p)} vs ${pc(1 / x.odds)} needed at ${od(x.odds)}).\n${cs.con.length ? cs.con.slice(0, 3).map((t) => `- Against: ${t}`).join('\n') : '- No specific case against it in the data.'}\n- Evidence: ${r.label}${r.missing.length || r.uncovered.length ? `; unknown: ${[...r.missing, ...r.uncovered].join(', ').toLowerCase()}` : ''}.`, cards: [pickCard(x)], followups: ['Compare alternatives', 'What would change this?'] };
  }
  function changeThis(x) {
    const cs = K.caseOf(x.e), r = K.readinessOf(x.e);
    const items = [...(cs.invalid || []), ...r.checks.filter((c) => c.ok === false && c.waitable).map((c) => `${c.label} (${c.note})`)];
    return { text: `**What would change ${x.pick}**\n\n${items.length ? items.map((t) => `- ${t}`).join('\n') : '- Nothing pending in the data: the call rests on the current price and form.'}\n- A price move: if the odds drop below ${od(1 / Math.max(0.01, x.p))}, the estimated return turns negative.`, cards: [pickCard(x)], followups: ['Explain the risk', 'Compare alternatives'] };
  }
  function alternatives(x) {
    const others = K.candidates([x.e]).filter((y) => K.pickId(y) !== K.pickId(x)).sort((a, b) => b.ev - a.ev).slice(0, 4);
    if (!others.length) return { text: `No other priced markets for **${x.e.home} vs ${x.e.away}**.`, cards: [{ type: 'match', e: x.e }] };
    return { text: `**Alternatives in ${x.e.home} vs ${x.e.away}** (by estimated return)\n\n${others.map((y) => `- **${y.pick}** · ${y.market} @ ${od(y.odds)}: ATLAS ${pc(y.p)}, return ${y.ev >= 0 ? '+' : ''}${(y.ev * 100).toFixed(1)}%`).join('\n')}\n\nCurrent pick: **${x.pick}** @ ${od(x.odds)}, return ${x.ev >= 0 ? '+' : ''}${(x.ev * 100).toFixed(1)}%.`, cards: others.slice(0, 3).map(pickCard), followups: ['Explain the risk'] };
  }
  function playerHistory(x) {
    if (!x.prop) return { text: `**${x.pick}** is not a player prop. Open the [match dossier](#/match/${x.e.id}) for team form.`, cards: [{ type: 'match', e: x.e }] };
    return player(x.pick, x);
  }
  // A player named in the question (or the prop in focus): his lines, recent games and readiness.
  function player(q, focus = null) {
    const r = K.playerResearch(q);
    if (!r) return null;
    const lines = r.lines.slice().sort((a, b) => b.x.p - a.x.p);
    const lineTxt = lines.slice(0, 5).map(({ e, x, r: rd }) => {
      const rec = r.recent(x.type);
      return `- **${x.target}+ ${x.label}** @ ${od(x.odds)}: ATLAS ${pc(x.p)}, break-even ${pc(1 / x.odds)} · last ${rec.length}: ${rec.join(', ') || '–'} · ${rd.label}${x.why ? ` · ${x.why}` : ''}`;
    }).join('\n');
    const top = focus?.prop ? lines.find((l) => l.x.type === focus.prop.type && l.x.target === focus.prop.target) || lines[0] : lines[0];
    const link = top ? `#/props/${top.e.leaguePath.split('/')[1]}~${top.x.id}~${encodeURIComponent(top.x.type)}~${top.x.target}` : `#/player/${r.key.replace('|', '~')}`;
    return {
      text: `**${r.name}** · ${r.team}${r.injury ? ` · listed ${r.injury}` : ''}\n\n${lineTxt || 'No lines on offer right now.'}\n\nGame logs: ${r.games} recent games, built ${r.logsAt ? `${Math.round((Date.now() - r.logsAt) / 6e4)} min ago` : 'at an unknown time'}. [Open player research](${link}).`,
      cards: lines.slice(0, 3).map(({ e, x }) => pickCard({ e, market: `Player ${x.label}`, pick: `${r.name} ${x.target}+ ${x.label}`, odds: x.odds, p: x.p, ev: x.p * x.odds - 1, priced: true, prop: { id: String(x.id), league: e.leaguePath.split('/')[1], type: x.type, target: x.target } })),
      followups: ['Explain the risk', 'Compare alternatives'],
    };
  }

  function live(q) {
    const scope = names(scopeFrom(q, false));
    const list = K.filterEvents({ ...scope, live: true }).slice(0, 8);
    if (!list.length) return { text: `Nothing live${scope.sport || scope.league ? ` in ${scopeLabel(scope)}` : ''} right now.` };
    return { text: `**Live now** (${list.length})\n\n${list.map((e) => `- ${e.home} vs ${e.away} · ${e.league} · ${e.score || ''} ${e.clock || ''}`).join('\n')}`, cards: list.slice(0, 4).map((e) => ({ type: 'match', e })) };
  }

  // What changed (since your last visit), and which saved matches need another look.
  function changed(q) {
    const watchedOnly = /\b(my|saved|watch|watched|watchlist)\b/.test(q);
    const list = K.changes({ since: /\b(yesterday|24)\b/.test(q) ? Date.now() - 864e5 : K.lastVisit(), watchedOnly }).slice(0, 10);
    if (!list.length) return { text: watchedOnly ? 'Nothing material has changed for your saved matches since you last looked.' : 'No material changes (starters, lineups, absences, price moves) since your last visit.' };
    return { text: `**What changed${watchedOnly ? ' for your saved matches' : ''}**\n\n${list.map((c) => `- **${c.home} v ${c.away}**: ${c.text}${c.forecast === 'not-modelled' ? ' (forecast impact not quantified)' : c.forecast === 'updated' ? ' (forecast updated)' : ''}`).join('\n')}`, cards: [] };
  }
  function review() {
    const list = K.reviewList();
    if (!list.length) return { text: 'None of your saved matches need review: nothing material changed after you last opened them.' };
    return { text: `**Saved matches that need another look**\n\n${list.map((x) => `- **${x.e.home} v ${x.e.away}**: ${x.changes[0].text}${x.changes.length > 1 ? ` (+${x.changes.length - 1} more)` : ''}`).join('\n')}`, cards: list.slice(0, 4).map((x) => ({ type: 'match', e: x.e })) };
  }
  function confirmedLineups() {
    const list = K.filterEvents({ upcoming: true }).filter((e) => !e.live && e.start > Date.now() && e.absences?.lineup && !['lastStarting11', 'predicted'].includes(e.absences.lineup.type)).slice(0, 10);
    if (!list.length) return { text: 'No confirmed lineups yet for upcoming matches. Soccer XIs are usually confirmed about an hour before kick-off.' };
    return { text: `**Matches with confirmed lineups**\n\n${list.map((e) => `- ${e.home} v ${e.away} · ${e.league}`).join('\n')}`, cards: list.slice(0, 4).map((e) => ({ type: 'match', e })) };
  }
  function coverage() {
    const up = K.filterEvents({ upcoming: true }).filter((e) => !e.live && e.start > Date.now() && e.start < Date.now() + 48 * 36e5);
    const by = {};
    for (const e of up) { const r = K.readinessOf(e); const b = (by[e.sport] ||= { n: 0, priced: 0, ready: 0, gaps: new Set() }); b.n++; if (e.markets?.length) b.priced++; if (r.state === 'ready') b.ready++; [...r.uncovered].forEach((g) => b.gaps.add(g)); }
    return { text: `**Coverage, next 48 hours**\n\n${Object.entries(by).sort((a, b) => b[1].n - a[1].n).map(([s, b]) => `- **${s}**: ${b.n} matches, ${b.priced} priced, ${b.ready} ready${b.gaps.size ? ` · not covered: ${[...b.gaps].join(', ').toLowerCase()}` : ''}`).join('\n')}` };
  }

  const help = () => ({
    text: `I answer from ATLAS's own data: matches, prices, the model's chances, injuries, starters, player game logs and slips. I can't search the wider web. Try:\n- **"best bets today"** or **"3 safe NBA bets"**\n- **"one bet with odds at least 1.80 tomorrow, no NBA"** (I keep every filter you set)\n- **"positive edge bets only"** (no substitutes if none qualify)\n- **"the second one"**, **"explain the risk"**, **"what about tomorrow?"**\n- a player's name for his props and recent games\n- **"check my slip"**\n- **"value bets in the Premier League"**\n- **"injuries in this match"** (on a match page)\n- **"who wins Yankees vs Rays"**\n- **"starters"** for MLB/NPB/KBO games\n- **"give me a 3x slip"** or **"mega 100x"**\n- **"what's live"**\n- **"what changed?"** · **"which saved matches need review?"**\n- **"confirmed lineups"** · **"which sports have incomplete data?"**\n\nProbabilities are model estimates, not guarantees. Picks follow your saved filters (minimum odds, sports).`,
  });

  async function answer(raw) {
    const q = K.norm(raw).trim();
    if (!q) return help();
    if (/^(hi|hey|hello|yo|sup|help|what can you|who are you|how do you)/.test(q)) return help();
    // Follow-ups on the conversation so far.
    const ref = resolvePick(q);
    const focus = ref || mem.focus;
    if (/^(explain|what.?s|show)? ?(the )?risk|how risky|why (not|might it lose)/.test(q) && focus) { mem.focus = focus; return explainRisk(focus); }
    if (/compare|alternative|other options|instead/.test(q) && focus) { mem.focus = focus; return alternatives(focus); }
    if (/what would change|change (this|the call|your mind)|invalidat/.test(q) && focus) { mem.focus = focus; return changeThis(focus); }
    if (/player history|show (his|player)|game log/.test(q) && focus) { mem.focus = focus; return playerHistory(focus); }
    if (/weakest leg|which leg/.test(q) && mem.list.length) { const w = mem.list.reduce((a, x) => (!a || x.p < a.p ? x : a), null); mem.focus = w; return { ...explainRisk(w), text: `**Weakest leg: ${w.pick}** (${pc(w.p)})\n\n${explainRisk(w).text.split('\n').slice(2).join('\n')}` }; }
    if (ref && /^(the |what about |and |tell me about |why |explain )?(the )?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last|#\s?\d|number \d|pick \d|bet \d|leg \d)/.test(q)) { mem.focus = ref; return { ...matchView(ref.e), followups: followupsFor(ref) }; }
    if (/^(more|another|others|more like (these|this)|next ones?)\b/.test(q) && mem.constraints) return bets(q, { carry: mem.constraints, more: true });
    if (/^best bets anyway$/.test(q)) return bets('best bets', { carry: { ...(mem.constraints || {}), positiveOnly: false, mode: 'balanced' } });
    if (/^(what about|how about|and|same for|same but)\b/.test(q) && mem.constraints) return bets(q, { carry: mem.constraints });
    if (/what.?s? changed|what changed|changes|anything new|since (yesterday|last)/.test(q)) return changed(q);
    if (/need(s)? review|review my|my saved|my watch/.test(q)) return review();
    if (/confirmed (line ?ups?|xi)|line ?ups? (are )?confirmed/.test(q)) return confirmedLineups();
    if (/incomplete|coverage|missing data|which sports.*(data|covered)/.test(q)) return coverage();
    if (/\b(my )?slip\b/.test(q) && /\b(check|analy[sz]e|how|good|risk|chance)\b/.test(q)) return slipReview();
    if (/injur|absen|\bout\b|suspend|missing|ruled out|fitness|doubtful/.test(q)) return injuries(q);
    if (/starter|pitcher|pitching|probable|\bsp\b|who.?s throwing/.test(q)) return starters(q);
    if (/\b\d{1,5}(?:\.\d+)?\s*x\b|\b\d{1,5}\s*times\b|\bmega\b|long ?shot|accumulator|acca|parlay|\bslip\b/.test(q)) return multiplier(q);
    if (/\blive\b|in play|right now/.test(q) && !/\bbet|pick/.test(q)) return live(q);
    const pl = !K.playerResearch || (/\b(bets?|picks?|tips?)\b/.test(q) && !/\bprops?\b/.test(q)) ? null : player(q);
    if (pl) return pl;
    const teams = K.eventsIn(q);
    if (teams.length && !/\b(bets|picks|tips)\b/.test(q)) { mem.event = teams[0]; return matchView(teams[0]); }
    if (/\b(bet|bets|pick|picks|tip|tips|banker|bankers|safe|value|edge|best|lock|play|wager|odds)\b/.test(q)) {
      const here = K.currentEvent();
      if (here && /\b(this|here)\b/.test(q)) return matchView(here);
      return bets(q);
    }
    if (/who (will )?win|predict|prediction|favourite|favorite/.test(q)) {
      const e = teams[0] || K.currentEvent();
      return e ? matchView(e) : bets(q);
    }
    const here = K.currentEvent();
    if (here) return matchView(here);
    if (K.sportIn(q) || K.leagueIn(q) || /\btomorrow|today|tonight|weekend\b/.test(q)) return bets(q);
    return { text: `I'm not sure what you mean. ${help().text}` };
  }

  // The visitor's own slip, through the slip check (dependencies measured, not assumed).
  function slipReview() {
    const a = K.slipSummary();
    if (!a) return { text: 'Your slip is empty. Add picks with **+** and ask again.' };
    return { text: `**Your slip: ${a.legs.length} legs at ${od(a.odds)}x**\n\n- Combined chance **${pc(a.adjusted)}**${Math.abs(a.adjusted - a.product) > 1e-4 ? ` (${pc(a.product)} if every leg were unrelated)` : ''}; break-even ${pc(a.breakEven)}; estimated return ${a.ret >= 0 ? '+' : ''}${(a.ret * 100).toFixed(1)}%.\n- Weakest leg: **${a.weakest.pick}** (${pc(a.weakest.p)}).\n${a.pairs.length ? a.pairs.map((p) => `- ${p.a.pick} + ${p.b.pick}: ${p.kind === 'measured' ? `measured together (×${p.lift.toFixed(2)})` : p.kind === 'nested' ? 'the same stat at two lines' : 'same match, not measurable'}`).join('\n') : '- No two legs share a match.'}${a.limits.length ? `\n${a.limits.map((t) => `- Limit: ${t}`).join('\n')}` : ''}` };
  }

  // Quick-reply chips for where the user is.
  function suggestions() {
    const e = K.currentEvent();
    if (e) return [e.sport === 'baseball' ? 'Starters' : 'Injuries in this match', 'Best bet in this match', 'Who wins?', 'Best bets today'];
    const s = K.currentScope();
    const sp = s.sport ? ({ football: 'soccer', americanfootball: 'NFL', basketball: 'NBA', hockey: 'NHL', baseball: 'baseball' })[s.sport] || s.sport : null;
    return sp ? [`3 safe ${sp} bets`, `Value ${sp} bets`, 'Give me a 3x slip', "What's live?"] : ['Best bets today', 'What changed?', 'Give me a 2x slip', "What's live?"];
  }

  return { answer, suggestions, memory: () => mem };
}
