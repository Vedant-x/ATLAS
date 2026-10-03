// The assistant's brain: Claude (Anthropic API), reached through the site's proxy (worker/, which holds
// the API key) or with a visitor's own key kept in their browser. Claude answers from the site's live
// data through tools backed by knowledge.js, so it never has to guess odds, injuries or starters.
import { AI_PROXY_URL } from '../config.js';

const KEY = 'atlas-ai-key';
const MODEL = 'claude-opus-5-5';

export const claudeKey = {
  get() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } },
  set(v) { try { if (v) localStorage.setItem(KEY, v.trim()); else localStorage.removeItem(KEY); } catch { /* storage blocked */ } },
};

// Which way to reach Claude: the visitor's own key wins, then the site proxy.
export const aiRoute = () => (claudeKey.get() ? 'key' : AI_PROXY_URL ? 'proxy' : null);

const SYSTEM = `You are the ATLAS assistant, a sharp, friendly sports-betting analyst living inside the ATLAS dashboard
(a site that shows fixtures for every sport, margin-free probabilities from bookmaker prices, an ATLAS model for
matches with no price, injuries/absences, starting-pitcher reports and multiplier slips).

Talk like a knowledgeable friend, not a template: answer the actual question first, in your own words, then the
reasoning that matters (form, injuries, starters, price vs. estimate). Match the user's tone and length: a quick
question gets two or three sentences; "break this match down" gets a proper breakdown. Ask a short follow-up
question when the request is ambiguous (which match? which sport?). Small talk and general sports questions are
fine; answer from your own knowledge there, and say when something is not from the site's live data.

Rules:
- Use the tools for every fact: matches, odds, probabilities, injuries, starters, slips. Never invent a number,
  a player, an injury or a price. If a tool returns nothing, say so plainly.
- "This match" / "here" means the match in get_page_context. Resolve team names with search_matches.
- When recommending bets, give for each: the pick, the market, the match, the odds and the win chance as a
  percentage, and say whether it is a bookmaker price or the ATLAS model's fair odds. Prefer priced picks.
- best_bets already applies the visitor's saved filters (minimum odds, preferred sports); mention the minimum
  odds if it explains why few picks came back.
- For a live match, every probability and price from the tools is pre-match: it ignores the current score, so
  say that before using it.
- Probabilities are estimates, never guarantees; call them "estimated" chances and never promise wins. Keep a light responsible-gambling note
  only when recommending bets, in one short line.
- Formatting: plain sentences, with bullets only for lists of picks or players. Bold pick names with
  **double asterisks**. Link matches as [Home vs Away](#/match/ID) using the id from the tools. No tables or headings.`;

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
async function client() {
  sdk = sdk || (await import('../../vendor/anthropic-sdk.mjs')).Anthropic;
  const key = claudeKey.get();
  // A visitor's own key never leaves their browser except to api.anthropic.com.
  if (key) return new sdk({ apiKey: key, dangerouslyAllowBrowser: true });
  // The site proxy adds the real key server-side; this placeholder is discarded there.
  return new sdk({ apiKey: 'atlas-proxy', baseURL: AI_PROXY_URL.replace(/\/+$/, ''), dangerouslyAllowBrowser: true, maxRetries: 1 });
}

const toolsFor = () => TOOLS.map((t) => ({ ...t, eager_input_streaming: true }));

// One chat turn with the tool loop, streamed. `history` holds prior user/assistant messages (full content).
// onText(snapshot) receives the answer so far as it is written.
export async function askClaude(K, history, text, { onStatus, onText } = {}) {
  if (!aiRoute()) throw new Error('The AI is not connected yet');
  const anthropic = await client();
  const run = runners(K);
  const messages = [...history, { role: 'user', content: text }];
  const said = []; // text from every step, shown as one answer
  for (let step = 0; step < 8; step++) {
    const stream = anthropic.beta.messages.stream({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'medium' },
      // Server-side fallback: if a request is declined, the API retries it on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      tools: toolsFor(),
      messages,
    });
    stream.on('text', (_, snap) => onText?.([...said, snap].join('\n\n')));
    const response = await stream.finalMessage();
    messages.push({ role: 'assistant', content: response.content });
    const stepText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (stepText) said.push(stepText);
    if (response.stop_reason === 'refusal') return { text: said.join('\n\n') || "I can't help with that one.", messages };
    if (response.stop_reason === 'max_tokens') return { text: `${said.join('\n\n')}\n\n(Answer cut short: ask me to continue.)`.trim(), messages: messages.slice(0, -1) };
    if (response.stop_reason === 'pause_turn') continue;
    const calls = response.content.filter((b) => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !calls.length) {
      return { text: said.join('\n\n') || '(no answer)', messages };
    }
    onStatus?.(calls.map((c) => c.name.replace(/_/g, ' ')).join(', '));
    // All results for this turn go back in one user message.
    const results = await Promise.all(calls.map(async (c) => {
      try {
        const fn = run[c.name];
        if (!fn) throw new Error(`unknown tool ${c.name}`);
        // Streamed tool input arrives unvalidated: it must be an object of the declared shape.
        if (!c.input || typeof c.input !== 'object' || Array.isArray(c.input)) throw new Error('INVALID_JSON: tool input was not an object');
        const need = TOOLS.find((t) => t.name === c.name)?.input_schema.required || [];
        const missing = need.filter((k) => c.input[k] == null);
        if (missing.length) throw new Error(`INVALID_JSON: missing ${missing.join(', ')}`);
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
  if (A && err instanceof A.AuthenticationError) return claudeKey.get() ? 'That API key was rejected. Check it in ⚙ settings.' : 'The AI service key was rejected. The site owner needs to check the proxy setup.';
  if (A && err instanceof A.PermissionDeniedError) return 'This API key does not have access to that model.';
  if (A && err instanceof A.RateLimitError) return err.error?.error?.message || 'Too many questions right now. Wait a moment and try again.';
  if (A && err instanceof A.BadRequestError) return `The API rejected the request: ${err.message}`;
  if (A && err instanceof A.APIConnectionError) return 'Could not reach the AI service (offline or blocked).';
  if (A && err instanceof A.APIError) return `Anthropic API error ${err.status}: ${err.message}`;
  return String(err?.message || err);
}
