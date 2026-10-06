// Built-in brain: understands the common questions (best bets, bets for a sport, injuries,
// starters, who wins, multiplier slips, live games) and answers from the site's own data.
// No API key needed. Answers are { text, cards } where text is a small markdown subset.
const pc = (p) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
const od = (o) => (Number.isFinite(o) ? o.toFixed(2) : '—');
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, few: 4, couple: 2, some: 4 };

export function createBrain(K) {
  const howMany = (q, d) => {
    const m = q.match(/\b(\d{1,2})\s*(?:bets?|picks?|tips?|games?|matches?|safe|value|best)?\b/);
    if (m && Number(m[1]) <= 15 && !/\d\s*x\b/.test(q)) return Number(m[1]);
    const w = Object.keys(NUM).find((k) => new RegExp(`\\b${k}\\b`).test(q));
    return w ? NUM[w] : d;
  };
  const pickCard = (x) => ({ type: 'pick', e: x.e, market: x.market, pick: x.pick, odds: x.odds, p: x.p, ev: x.ev, priced: x.priced });
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
    const cards = rec.map((x) => ({ type: 'pick', e, market: x.market, pick: x.pick, odds: x.odds, p: x.probability, ev: x.edge, priced: x.priced }));
    return { text: lines.join('\n'), cards: [{ type: 'match', e }, ...cards] };
  }

  function bets(q) {
    const today = !/\b(tomorrow|week|weekend|upcoming|next|later|days)\b/.test(q); // next 12 hours unless asked about later
    const mode = /\b(safe|safest|banker|bankers|sure|lock|locks|certain|guarantee)/.test(q) ? 'safe' : /\b(value|edge|\+ev|underpriced)\b/.test(q) ? 'value' : 'balanced';
    const n = howMany(q, 5);
    const scope = names(scopeFrom(q, !/\b(all|every|any)\b/.test(q)));
    let list = K.picks({ ...scope, today, mode, limit: n });
    let note = '';
    if (!list.length && today) { list = K.picks({ ...scope, today: false, mode, limit: n }); note = ' Nothing suitable left today, so these are the next few days.'; }
    if (!list.length && mode === 'value') { list = K.picks({ ...scope, today, mode: 'balanced', limit: n }); note = ' No positive-edge prices right now, so here are the strongest balanced picks.'; }
    if (!list.length) return { text: `I couldn't find priced matches for ${scopeLabel(scope)} in the next few days. Try another sport, or ask for **"best bets"** across everything.` };
    const head = { safe: 'Safest picks', value: 'Best value (model above the price)', balanced: 'Best bets' }[mode];
    const combo = list.reduce((a, x) => a * x.odds, 1), comboP = list.reduce((a, x) => a * x.p, 1);
    // Every candidate carries its reason, the strongest concern, what is still unknown and what would
    // change the call; the answer opens with its scope and closes with how fresh the facts are.
    const f = K.freshness?.() || {}, mins = (t) => (t ? Math.max(0, Math.round((Date.now() - t) / 6e4)) : null);
    const why = (x) => {
      const c = K.caseOf?.(x.e) || { pro: [], con: [], invalid: [] }, r = K.readinessOf?.(x.e) || { label: 'not checked', missing: [], uncovered: [] };
      return [
        `   Why: ${x.priced ? `price ${od(x.odds)} needs ${pc(1 / x.odds)}, ATLAS ${pc(x.p)}` : 'ATLAS model only (no price)'}${c.pro.find((t) => !/^Bookmaker price/.test(t)) ? `; ${c.pro.find((t) => !/^Bookmaker price/.test(t)).replace(/\.$/, '')}` : ''}.`,
        c.con[0] ? `   Against: ${c.con[0]}` : '',
        `   Evidence: ${r.label}${r.missing.length || r.uncovered.length ? ` (unknown: ${[...r.missing, ...r.uncovered].join(', ').toLowerCase()})` : ''}.`,
        c.invalid[0] ? `   Would change the call: ${c.invalid[0]}` : '',
      ].filter(Boolean).join('\n');
    };
    const scopeLine = `Scope: ${today ? 'matches starting in the next 12 hours' : 'the next few days'} · ${scopeLabel(scope)} · minimum odds ${od(K.minOdds?.() ?? 1.3)}`;
    return {
      text: `**${head}: ${scopeLabel(scope)}${today ? ' (next 12 hours)' : ''}**${note}\n${scopeLine}\n\n${list.map((x, i) => `${i + 1}. **${x.pick}** · ${x.market} · ${x.e.home} vs ${x.e.away}: odds ${od(x.odds)}, est. ${pc(x.p)}${x.priced ? '' : ' (model, no bookmaker price)'}\n${why(x)}`).join('\n')}\n\nAs singles each stands alone. All ${list.length} together: about **${od(combo)}x**, an estimated ${pc(comboP)} chance if the legs are independent.\nFreshness: prices checked ${mins(f.pricesAt) ?? '?'} min ago${f.changesAt ? `, team news / changes ${mins(f.changesAt)} min ago` : ''}. Tap **+** to add to your slip.`,
      cards: list.map(pickCard),
    };
  }

  function multiplier(q) {
    const m = q.match(/(\d{1,5}(?:\.\d+)?)\s*x\b|\b(\d{1,5}(?:\.\d+)?)\s*times\b/);
    const target = Number(m?.[1] || m?.[2]);
    const t = target >= 1.2 && target <= 100000 ? target : /mega/.test(q) ? 100 : 2; // any target, built from bankers
    const mega = t >= 100;
    const list = K.slips(t, !mega);
    if (!list.length) return { text: mega ? `Not enough priced matches to build a ${t}x slip right now.` : `Today's remaining prices can't be combined into about ${t}x. Try another multiplier or ask tomorrow.` };
    const s = list[0];
    return {
      text: `**Top ${t}x slip${mega ? '' : ' (today only)'}**: ${s.legs.length} legs at **${od(s.odds)}x**, estimated **${pc(s.p)}** chance to land.\n\n${s.legs.map((l) => `- **${l.pick}** · ${l.market} · ${l.match} @ ${od(l.odds)} (${pc(l.p)})`).join('\n')}\n\n${list.length > 1 ? `${list.length - 1} more on the [${t}x page](#/${mega ? 'mega' : [2, 3, 4, 5, 10, 20].includes(t) ? `x/${t}` : `target/${t}`}).` : ''}`,
      cards: s.legs.map((l) => ({ type: 'leg', leg: l })),
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
    text: `I know everything on ATLAS: every match, the model's win chances, odds, edge, injuries, starting pitchers and slips. Try:\n- **"best bets today"** or **"3 safe NBA bets"**\n- **"value bets in the Premier League"**\n- **"injuries in this match"** (on a match page)\n- **"who wins Yankees vs Rays"**\n- **"starters"** for MLB/NPB/KBO games\n- **"give me a 3x slip"** or **"mega 100x"**\n- **"what's live"**\n- **"what changed?"** · **"which saved matches need review?"**\n- **"confirmed lineups"** · **"which sports have incomplete data?"**\n\nProbabilities are model estimates, not guarantees. Picks follow your saved filters (minimum odds, sports).`,
  });

  async function answer(raw) {
    const q = K.norm(raw).trim();
    if (!q) return help();
    if (/^(hi|hey|hello|yo|sup|help|what can you|who are you|how do you)/.test(q)) return help();
    if (/what.?s? changed|what changed|changes|anything new|since (yesterday|last)/.test(q)) return changed(q);
    if (/need(s)? review|review my|my saved|my watch/.test(q)) return review();
    if (/confirmed (line ?ups?|xi)|line ?ups? (are )?confirmed/.test(q)) return confirmedLineups();
    if (/incomplete|coverage|missing data|which sports.*(data|covered)/.test(q)) return coverage();
    if (/injur|absen|\bout\b|suspend|missing|ruled out|fitness|doubtful/.test(q)) return injuries(q);
    if (/starter|pitcher|pitching|probable|\bsp\b|who.?s throwing/.test(q)) return starters(q);
    if (/\b\d{1,4}\s*x\b|\b\d{1,4}\s*times\b|\bmega\b|long ?shot|accumulator|acca|parlay/.test(q)) {
      if (!/\d/.test(q)) return multiplier(/mega|long ?shot/.test(q) ? '100x' : '3x');
      return multiplier(q);
    }
    if (/\blive\b|in play|right now/.test(q) && !/\bbet|pick/.test(q)) return live(q);
    const teams = K.eventsIn(q);
    if (teams.length && !/\b(bets|picks|tips)\b/.test(q)) return matchView(teams[0]);
    if (/\b(bet|bets|pick|picks|tip|tips|banker|bankers|safe|value|edge|best|lock|play|wager)\b/.test(q)) {
      const here = K.currentEvent();
      if (here && /\b(this|here)\b/.test(q)) return matchView(here);
      return bets(q);
    }
    if (/who (will )?win|predict|prediction|favourite|favorite|odds/.test(q)) {
      const e = teams[0] || K.currentEvent();
      return e ? matchView(e) : bets(q);
    }
    const here = K.currentEvent();
    if (here) return matchView(here);
    if (K.sportIn(q) || K.leagueIn(q)) return bets(q);
    return { text: `I'm not sure what you mean. ${help().text}` };
  }

  // Quick-reply chips for where the user is.
  function suggestions() {
    const e = K.currentEvent();
    if (e) return [e.sport === 'baseball' ? 'Starters' : 'Injuries in this match', 'Best bet in this match', 'Who wins?', 'Best bets today'];
    const s = K.currentScope();
    const sp = s.sport ? ({ football: 'soccer', americanfootball: 'NFL', basketball: 'NBA', hockey: 'NHL', baseball: 'baseball' })[s.sport] || s.sport : null;
    return sp ? [`3 safe ${sp} bets`, `Value ${sp} bets`, 'Give me a 3x slip', "What's live?"] : ['Best bets today', 'What changed?', 'Give me a 2x slip', "What's live?"];
  }

  return { answer, suggestions };
}
