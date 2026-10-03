// Claude mode: the assistant talks to Claude (Anthropic API) with the visitor's own API key, kept in
// this browser only. Claude answers from the site's live data through tools backed by knowledge.js,
// so it never has to guess odds, injuries or starters.
const KEY = 'atlas-ai-key';
const MODEL = 'claude-opus-5-5';

export const claudeKey = {
  get() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } },
  set(v) { try { if (v) localStorage.setItem(KEY, v.trim()); else localStorage.removeItem(KEY); } catch { /* storage blocked */ } },
};

const SYSTEM = `You are the ATLAS assistant, a sports-betting analyst living inside the ATLAS dashboard (a site that
shows fixtures for every sport, margin-free probabilities from bookmaker prices, an ATLAS model for matches with
no price, injuries/absences, starting-pitcher reports and multiplier slips).

Rules:
- Use the tools for every fact: matches, odds, probabilities, injuries, starters, slips. Never invent a number,
  a player, an injury or a price. If a tool returns nothing, say so plainly.
- "This match" / "here" means the match in get_page_context. Resolve team names with search_matches.
- When recommending bets, give for each: the pick, the market, the match, the odds and the win chance as a
  percentage, and say whether it is a bookmaker price or the ATLAS model's fair odds. Prefer priced picks.
- Probabilities are estimates, never guarantees; never promise wins. Keep a light responsible-gambling note
  only when recommending bets, in one short line.
- Write short, scannable answers: a one-line headline, then bullets. Bold pick names with **double asterisks**.
  Link matches as [Home vs Away](#/match/ID) using the id from the tools. No tables, no headings beyond bold text.`;

const TOOLS = [
  { name: 'get_page_context', description: 'What the user is looking at: the page and, on a match page, that match in full (win probabilities, best prices, model markets, starters).', input_schema: { type: 'object', properties: {} } },
  { name: 'search_matches', description: 'Find matches by team/player names and/or filter by sport or league. Returns ids and kick-off times.',
    input_schema: { type: 'object', properties: {
      query: { type: 'string', description: 'Team or player names, e.g. "Yankees Rays" or "Arsenal"' },
      sport: { type: 'string', enum: ['football', 'basketball', 'americanfootball', 'hockey', 'baseball', 'tennis', 'mma', 'rugby', 'aussierules', 'lacrosse', 'volleyball'], description: 'football = soccer' },
      league: { type: 'string', description: 'League name or shortcut, e.g. "NBA", "Premier League", "NPB", "ATP"' },
      today: { type: 'boolean', description: 'Only matches still to start today (viewer local time)' },
      live: { type: 'boolean' }, limit: { type: 'integer' } } } },
  { name: 'get_match', description: 'Full analysis of one match by id: win probabilities and basis, best prices with probability and edge, model markets, form, records, tennis info, starting pitchers.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'get_injuries', description: 'Injuries and absences for one match by id, with the source. covered=false means no source covers it (unknown, not none).', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'best_bets', description: 'Ranked bet suggestions from the site. mode: safe = highest win chance, value = model rates the side above the price, balanced = short-ish odds with a high chance.',
    input_schema: { type: 'object', properties: {
      sport: { type: 'string' }, league: { type: 'string' }, today: { type: 'boolean' },
      mode: { type: 'string', enum: ['safe', 'value', 'balanced'] }, limit: { type: 'integer' },
      min_odds: { type: 'number' }, max_odds: { type: 'number' } } } },
  { name: 'multiplier_slips', description: 'Ready-made accumulators near a target multiplier (2, 3, 4, 5, 10, 20 use only matches still to start today; 100, 500, 1000 are long shots over the next days).', input_schema: { type: 'object', properties: { target: { type: 'integer' } }, required: ['target'] } },
];

// Tool implementations over the shared knowledge layer.
function runners(K) {
  const out = (x) => JSON.stringify(x);
  const pickJson = (x) => ({ match: `${x.e.home} vs ${x.e.away}`, id: x.e.id, league: x.e.league, start: new Date(x.e.start).toISOString(), market: x.market, pick: x.pick, odds: x.odds, probability: +x.p.toFixed(3), edge: x.priced ? +x.ev.toFixed(3) : null, priced: x.priced });
  const leagueOf = (s) => (s ? K.leagueIn(s) || undefined : undefined);
  return {
    get_page_context: () => { const r = K.route(), e = K.currentEvent(); return out({ page: r.name, args: r.args, match: e ? K.matchSummary(e) : null, scope: K.currentScope() }); },
    search_matches: ({ query, sport, league, today, live, limit = 10 }) => {
      let list = K.filterEvents({ sport, league: leagueOf(league), today, live });
      if (query) list = K.eventsIn(query, list);
      return out(list.slice(0, Math.min(limit, 25)).map((e) => ({ id: e.id, match: `${e.home} vs ${e.away}`, league: e.league, start: new Date(e.start).toISOString(), live: Boolean(e.live), score: e.score || null, priced: Boolean(e.markets?.length) })));
    },
    get_match: ({ id }) => { const e = K.eventById(id); return out(e ? K.matchSummary(e) : { error: `no match with id ${id}` }); },
    get_injuries: async ({ id }) => { const e = K.eventById(id); return out(e ? { match: `${e.home} vs ${e.away}`, ...(await K.injuriesOf(e)) } : { error: `no match with id ${id}` }); },
    best_bets: ({ sport, league, today = false, mode = 'balanced', limit = 5, min_odds, max_odds }) =>
      out(K.picks({ sport, league: leagueOf(league), today, mode, limit: Math.min(limit, 15), minOdds: min_odds, maxOdds: max_odds }).map(pickJson)),
    multiplier_slips: ({ target }) => out(K.slips(target, target <= 20).slice(0, 3).map((s) => ({ odds: +s.odds.toFixed(2), probability: +s.p.toFixed(4), legs: s.legs.map((l) => ({ match: l.match, id: l.eventId, market: l.market, pick: l.pick, odds: l.odds, probability: +l.p.toFixed(3) })) }))),
  };
}

let sdk;
async function client(key) {
  sdk = sdk || (await import('../../vendor/anthropic-sdk.mjs')).Anthropic;
  // The key belongs to the visitor and never leaves their browser except to api.anthropic.com.
  return new sdk({ apiKey: key, dangerouslyAllowBrowser: true });
}

// One chat turn with the tool loop. `history` holds prior user/assistant messages (full content).
export async function askClaude(K, history, text, { onStatus } = {}) {
  const key = claudeKey.get();
  if (!key) throw new Error('No API key set');
  const anthropic = await client(key);
  const run = runners(K);
  const messages = [...history, { role: 'user', content: text }];
  for (let step = 0; step < 8; step++) {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low' }, // chat: quick answers; the tools carry the facts
      // Server-side fallback: if a request is declined, the API retries it on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'refusal') return { text: "I can't help with that one.", messages };
    if (response.stop_reason === 'pause_turn') continue;
    const calls = response.content.filter((b) => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !calls.length) {
      const textOut = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { text: textOut || '(no answer)', messages };
    }
    onStatus?.(calls.map((c) => c.name.replace(/_/g, ' ')).join(', '));
    // All results for this turn go back in one user message.
    const results = await Promise.all(calls.map(async (c) => {
      try {
        const fn = run[c.name];
        if (!fn) throw new Error(`unknown tool ${c.name}`);
        return { type: 'tool_result', tool_use_id: c.id, content: await fn(c.input || {}) };
      } catch (err) {
        return { type: 'tool_result', tool_use_id: c.id, content: String(err?.message || err), is_error: true };
      }
    }));
    messages.push({ role: 'user', content: results });
  }
  return { text: 'That took too many steps. Try a narrower question.', messages };
}

// Friendly message for API failures (typed SDK errors).
export function claudeError(err) {
  const A = sdk;
  if (A && err instanceof A.AuthenticationError) return 'That API key was rejected. Check it in ⚙ settings.';
  if (A && err instanceof A.PermissionDeniedError) return 'This API key does not have access to that model.';
  if (A && err instanceof A.RateLimitError) return 'Rate limited by the Anthropic API. Wait a moment and try again.';
  if (A && err instanceof A.BadRequestError) return `The API rejected the request: ${err.message}`;
  if (A && err instanceof A.APIConnectionError) return 'Could not reach the Anthropic API (offline or blocked).';
  if (A && err instanceof A.APIError) return `Anthropic API error ${err.status}: ${err.message}`;
  return String(err?.message || err);
}
