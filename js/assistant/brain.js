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
    const best = s.bestPrices.filter((x) => x.priced).sort((a, b) => b.probability - a.probability)[0];
    const value = s.bestPrices.filter((x) => x.priced && x.edge > 0).sort((a, b) => b.edge - a.edge)[0];
    const lines = [
      `**${e.home} vs ${e.away}** · ${e.league}${e.live ? ` · LIVE ${e.score || ''}` : ''}`,
      `${e.live ? 'Pre-match estimate (does not include the live score)' : 'Estimated win chance'}: ${e.home} **${pc(w.home)}**${w.draw ? ` · draw ${pc(w.draw)}` : ''} · ${e.away} **${pc(w.away)}** (${s.basis.toLowerCase()})`,
      `Favourite: **${fav}**.`,
      best ? `Safest priced pick: **${best.pick}** (${best.market}) at ${od(best.odds)}, estimated ${pc(best.probability)}.` : 'No bookmaker price yet: fair odds come from the ATLAS model.',
      value ? `Best value: **${value.pick}** (${value.market}) at ${od(value.odds)}, model edge ${(value.edge * 100).toFixed(1)}%.` : '',
      s.starters?.length === 2 && s.starters[0].season && s.starters[1].season ? `Starters: ${s.starters[0].name} (${s.starters[0].season.era} ERA) vs ${s.starters[1].name} (${s.starters[1].season.era} ERA).` : '',
    ].filter(Boolean);
    const cards = s.bestPrices.slice(0, 3).map((x) => ({ type: 'pick', e, market: x.market, pick: x.pick, odds: x.odds, p: x.probability, ev: x.edge, priced: x.priced }));
    return { text: lines.join('\n'), cards: [{ type: 'match', e }, ...cards] };
  }

  function bets(q) {
    const today = /\btoday|tonight|now\b/.test(q);
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
    return {
      text: `**${head}: ${scopeLabel(scope)}${today ? ' today' : ''}**${note}\n\n${list.map((x, i) => `${i + 1}. **${x.pick}** · ${x.market} · ${x.e.home} vs ${x.e.away}: odds ${od(x.odds)}, est. ${pc(x.p)}${x.priced ? '' : ' (model, no bookmaker price)'}`).join('\n')}\n\nAs singles each stands alone. All ${list.length} together: about **${od(combo)}x**, an estimated ${pc(comboP)} chance if the legs are independent. Tap **+** to add to your slip.`,
      cards: list.map(pickCard),
    };
  }

  function multiplier(q) {
    const m = q.match(/(\d{1,4})\s*x\b|\b(\d{1,4})\s*times\b/);
    const target = Number(m?.[1] || m?.[2]);
    const valid = [2, 3, 4, 5, 10, 20, 100, 500, 1000];
    const t = valid.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a), 2);
    const mega = t >= 100;
    const list = K.slips(t, !mega);
    if (!list.length) return { text: mega ? `Not enough priced matches to build a ${t}x slip right now.` : `Today's remaining prices can't be combined into about ${t}x. Try another multiplier or ask tomorrow.` };
    const s = list[0];
    return {
      text: `**Top ${t}x slip${mega ? '' : ' (today only)'}**: ${s.legs.length} legs at **${od(s.odds)}x**, estimated **${pc(s.p)}** chance to land.\n\n${s.legs.map((l) => `- **${l.pick}** · ${l.market} · ${l.match} @ ${od(l.odds)} (${pc(l.p)})`).join('\n')}\n\n${list.length > 1 ? `${list.length - 1} more on the [${t}x page](#/${mega ? 'mega' : `x/${t}`}).` : ''}`,
      cards: s.legs.map((l) => ({ type: 'leg', leg: l })),
    };
  }

  function live(q) {
    const scope = names(scopeFrom(q, false));
    const list = K.filterEvents({ ...scope, live: true }).slice(0, 8);
    if (!list.length) return { text: `Nothing live${scope.sport || scope.league ? ` in ${scopeLabel(scope)}` : ''} right now.` };
    return { text: `**Live now** (${list.length})\n\n${list.map((e) => `- ${e.home} vs ${e.away} · ${e.league} · ${e.score || ''} ${e.clock || ''}`).join('\n')}`, cards: list.slice(0, 4).map((e) => ({ type: 'match', e })) };
  }

  const help = () => ({
    text: `I know everything on ATLAS: every match, the model's win chances, odds, edge, injuries, starting pitchers and slips. Try:\n- **"best bets today"** or **"3 safe NBA bets"**\n- **"value bets in the Premier League"**\n- **"injuries in this match"** (on a match page)\n- **"who wins Yankees vs Rays"**\n- **"starters"** for MLB/NPB/KBO games\n- **"give me a 3x slip"** or **"mega 100x"**\n- **"what's live"**\n\nProbabilities are model estimates, not guarantees. Picks follow your saved filters (minimum odds, sports).`,
  });

  async function answer(raw) {
    const q = K.norm(raw).trim();
    if (!q) return help();
    if (/^(hi|hey|hello|yo|sup|help|what can you|who are you|how do you)/.test(q)) return help();
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
    return sp ? [`3 safe ${sp} bets`, `Value ${sp} bets`, 'Give me a 3x slip', "What's live?"] : ['Best bets today', '3 safe bets', 'Give me a 2x slip', "What's live?"];
  }

  return { answer, suggestions };
}
