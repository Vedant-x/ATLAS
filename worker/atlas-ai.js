// ATLAS AI: a Cloudflare Worker that answers the site assistant's questions with Workers AI (an open
// model running on Cloudflare). On the free plan this costs nothing: there is a daily free allowance
// and no card on file, so when it is used up the assistant simply pauses until the next day.
//
// The browser sends the question, recent chat and a compact snapshot of the relevant ATLAS data
// (matches, prices, estimates, injuries, starters); the model writes the answer from that.
//
// Bindings / variables (Settings in the Cloudflare dashboard):
//   AI               Workers AI binding, required
//   USAGE            optional KV namespace for the per-visitor daily cap
//   ALLOWED_ORIGINS  comma-separated (default https://vedant-x.github.io)
//   IP_DAILY_LIMIT   questions per visitor per UTC day (default 40)
//   MODEL            Workers AI model id (default below)
const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_BODY = 60_000;

const SYSTEM = `You are the assistant on ATLAS, a sports-betting analysis site. Talk like a sharp, friendly analyst
who knows sport: natural sentences, your own words, never a template. Answer the actual question first, then the
reasons that matter (form, injuries, starting pitchers, price versus estimate). Keep quick questions short (two to
four sentences); give a fuller breakdown when asked. If the question is unclear, ask a short follow-up.

Facts about matches, odds, probabilities, injuries and starters must come from the SITE DATA block in the user's
message. Never invent a number, player, injury or price; if the data doesn't cover something, say so. For general
sport chat you may use your own knowledge, saying it isn't from the site's live data.

When recommending bets give the pick, the match, the odds and the estimated chance, and say whether the price is
a bookmaker's or the ATLAS model's fair odds. Probabilities are estimates, never guarantees. On a live match the
site's numbers are pre-match and ignore the score: say so. Link a match as [Home vs Away](#/match/ID) using its id.
Bold pick names with **double asterisks**. Use bullets only for lists. No tables or headings.`;

const err = (status, message, cors) => new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json', ...cors } });

export default {
  async fetch(req, env) {
    const origins = (env.ALLOWED_ORIGINS || 'https://vedant-x.github.io').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.get('origin') || '';
    const allowed = origins.includes(origin);
    const cors = allowed ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' } : {};
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (req.method === 'GET' && url.pathname === '/') return new Response(env.AI ? 'ATLAS AI is running.' : 'ATLAS AI is deployed but the AI binding is missing.', { headers: cors });
    if (!allowed) return err(403, 'This service only answers the ATLAS site.', cors);
    if (req.method !== 'POST' || url.pathname !== '/chat') return err(404, 'Only POST /chat is available.', cors);
    if (!env.AI) return err(500, 'The AI binding is missing: add a Workers AI binding named AI.', cors);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return err(413, 'That conversation is too long: clear the chat and ask again.', cors);
    let body;
    try { body = JSON.parse(raw); } catch { return err(400, 'Body must be JSON.', cors); }
    const question = String(body.question || '').slice(0, 1000).trim();
    if (!question) return err(400, 'Empty question.', cors);

    if (env.USAGE) {
      const key = `ip:${req.headers.get('cf-connecting-ip') || 'unknown'}:${new Date().toISOString().slice(0, 10)}`;
      const used = Number(await env.USAGE.get(key)) || 0;
      if (used >= Number(env.IP_DAILY_LIMIT || 40)) return err(429, "You've reached today's question limit. It resets at midnight UTC.", cors);
      await env.USAGE.put(key, String(used + 1), { expirationTtl: 172800 });
    }

    const history = (Array.isArray(body.history) ? body.history : []).slice(-8)
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    const context = String(body.context || '').slice(0, 30_000);
    const messages = [
      { role: 'system', content: SYSTEM },
      ...history,
      { role: 'user', content: `SITE DATA (live from ATLAS, ${new Date().toUTCString()}):\n${context || '(none)'}\n\nQUESTION: ${question}` },
    ];

    try {
      const stream = await env.AI.run(env.MODEL || DEFAULT_MODEL, { messages, stream: true, max_tokens: 800, temperature: 0.6 });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', ...cors } });
    } catch (e) {
      const msg = String(e?.message || e);
      // Free allowance used up (or Workers AI busy): pause politely, never bill.
      if (/limit|quota|neuron|429|capacity/i.test(msg)) return err(429, 'The free AI allowance for today is used up. It resets at midnight UTC.', cors);
      return err(502, `The AI service failed: ${msg.slice(0, 200)}`, cors);
    }
  },
};
