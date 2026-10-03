// The assistant's AI: questions go to the ATLAS AI Worker (worker/atlas-ai.js, free Cloudflare Workers
// AI). With each question the browser sends a compact snapshot of the ATLAS data that matters for it
// (the match on screen or named in the question, its injuries and starters, current picks, live games,
// slips), so the model answers from the site's real numbers instead of guessing.
import { AI_URL } from '../config.js';

export const aiReady = () => Boolean(AI_URL);

const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const pickRow = (x) => ({ match: `${x.e.home} vs ${x.e.away}`, id: x.e.id, league: x.e.league, start: new Date(x.e.start).toISOString(), pick: x.pick, market: x.market, odds: x.odds, estimatedChance: r3(x.p), edge: x.priced ? r3(x.ev) : null, price: x.priced ? 'bookmaker' : 'ATLAS model fair odds' });

// Everything the model may need for this question, as JSON text.
export async function buildContext(K, text) {
  const q = K.norm(text);
  const out = { page: K.route().name, now: new Date().toString() };
  const scope = (() => {
    const league = K.leagueIn(text), sport = K.sportIn(text);
    if (league) return { league };
    if (sport) return { sport };
    return /\b(all|every|any)\b/.test(q) ? {} : K.currentScope();
  })();
  if (scope.league || scope.sport) out.scope = scope;

  // Matches: the one on screen plus any named in the question (with injuries).
  const named = K.eventsIn(text).slice(0, 3);
  const here = K.currentEvent();
  const matches = [...new Set([here, ...named].filter(Boolean))].slice(0, 3);
  if (matches.length) {
    out.matches = await Promise.all(matches.map(async (e) => {
      const m = K.matchSummary(e);
      const inj = await Promise.race([K.injuriesOf(e), new Promise((r) => setTimeout(() => r(null), 6000))]).catch(() => null);
      return { ...m, onScreen: e === here, injuries: inj ? { covered: inj.covered, source: inj.source, [e.home]: inj.home, [e.away]: inj.away } : 'not loaded' };
    }));
  }

  // Current picks for the scope (they already follow the visitor's saved filters).
  const today = /\b(today|tonight|now)\b/.test(q);
  const picks = (mode, n) => K.picks({ ...scope, today, mode, limit: n }).map(pickRow);
  out.picks = { safest: picks('safe', 5), value: picks('value', 4), balanced: picks('balanced', 5) };
  if (today && !out.picks.safest.length && !out.picks.balanced.length) out.picks.nextDays = K.picks({ ...scope, mode: 'balanced', limit: 5 }).map(pickRow);

  if (/\blive\b|in play|right now|score/.test(q)) {
    out.live = K.filterEvents({ ...scope, live: true }).slice(0, 10).map((e) => ({ id: e.id, match: `${e.home} vs ${e.away}`, league: e.league, score: e.score, clock: e.clock }));
  }
  const mult = q.match(/(\d{1,4})\s*x\b|\b(\d{1,4})\s*times\b/);
  if (mult || /\b(slip|parlay|acca|accumulator|multi|mega)\b/.test(q)) {
    const t = Number(mult?.[1] || mult?.[2]) || (/mega/.test(q) ? 100 : 3);
    const valid = [2, 3, 4, 5, 10, 20, 100, 500, 1000];
    const target = valid.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), 3);
    out.slips = { target, note: target <= 20 ? 'matches still to start today only' : 'long shots over the next days', options: K.slips(target, target <= 20).slice(0, 3).map((s) => ({ totalOdds: r3(s.odds), estimatedChance: r3(s.p), legs: s.legs.map((l) => ({ match: l.match, id: l.eventId, pick: l.pick, market: l.market, odds: l.odds, estimatedChance: r3(l.p) })) })) };
  }
  if (!matches.length && /\b(injur|absen|out|suspend|team news)/.test(q) && (scope.league || scope.sport)) {
    out.absences = K.filterEvents(scope).filter((e) => e.absences).slice(0, 6).map((e) => ({ id: e.id, match: `${e.home} vs ${e.away}`, [e.home]: e.absences.home, [e.away]: e.absences.away, source: e.absences.source }));
  }
  if (!matches.length) {
    out.upcoming = K.filterEvents({ ...scope, today }).filter((e) => !e.live).sort((a, b) => a.start - b.start).slice(0, 12)
      .map((e) => ({ id: e.id, match: `${e.home} vs ${e.away}`, league: e.league, start: new Date(e.start).toISOString(), priced: Boolean(e.markets?.length) }));
  }
  out.sports = K.catalog().filter((s) => s.matches);
  let s = JSON.stringify(out);
  if (s.length > 28000) { delete out.upcoming; delete out.sports; s = JSON.stringify(out).slice(0, 28000); }
  return s;
}

// Ask the Worker; onText(snapshot) receives the answer as it streams in.
export async function askAI(K, history, text, { onText, signal } = {}) {
  if (!AI_URL) throw new Error("The AI isn't connected yet.");
  const context = await buildContext(K, text);
  const res = await fetch(`${AI_URL.replace(/\/+$/, '')}/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ question: text, history: history.slice(-8), context }),
  }).catch(() => { throw new Error('Could not reach the AI (offline or blocked).'); });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `The AI service answered ${res.status}.`);
  }
  // Server-sent events: "data: {...}" lines, ending with "data: [DONE]".
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', answer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      const d = line.replace(/^data:\s*/, '').trim();
      if (!line.startsWith('data:') || !d || d === '[DONE]') continue;
      try {
        const j = JSON.parse(d);
        const piece = j.response ?? j.choices?.[0]?.delta?.content ?? '';
        if (piece) { answer += piece; onText?.(answer); }
      } catch { /* partial or non-JSON line */ }
    }
  }
  return answer.trim() || "I couldn't come up with an answer. Try rephrasing.";
}
