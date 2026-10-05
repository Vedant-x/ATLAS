// The assistant's AI. It runs on the visitor's own device (WebLLM: an open model executed by the browser
// on the GPU through WebGPU), so it costs the site nothing and has no usage limits. The model downloads
// once and is cached by the browser. With each question the browser builds a compact text snapshot of
// the ATLAS data that matters (the match on screen or named, its injuries and starters, current picks,
// live games, slips), so the model answers from the site's real numbers instead of guessing.
//
// AI_URL (js/config.js) can point at a hosted model later (worker/atlas-ai.js); if it fails, the
// on-device model takes over without telling the visitor anything about quotas.
import { AI_URL } from '../config.js';

const pc = (p) => (Number.isFinite(p) ? `${Math.round(p * 100)}%` : '?');
const od = (o) => (Number.isFinite(o) ? Number(o).toFixed(2) : '?');
const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

const SYSTEM = `You are the assistant on ATLAS, a sports-betting analysis site. Talk like a sharp, friendly analyst:
natural sentences in your own words, never a template. Answer the question first, then the reasons that matter
(form, injuries, starting pitchers, price versus estimate). Keep quick questions short (2-4 sentences).
Facts about matches, odds, chances, injuries and starters must come from SITE DATA; never invent numbers,
players or injuries. If the data doesn't cover it, say so. Chances are estimates, never guarantees. On a live
match the numbers are pre-match. Link matches as [Home vs Away](#/match/ID). Bold pick names with **double asterisks**.`;

// ---------- site data, as compact text (small models have a short memory) ----------
export async function buildContext(K, text, max = 6000) {
  const q = K.norm(text);
  const lines = [`Now: ${new Date().toLocaleString()}. Page: ${K.route().name}.`];
  const scope = (() => {
    const league = K.leagueIn(text), sport = K.sportIn(text);
    if (league) return { league };
    if (sport) return { sport };
    return /\b(all|every|any)\b/.test(q) ? {} : K.currentScope();
  })();
  const named = K.eventsIn(text).slice(0, 2);
  const here = K.currentEvent();
  const matches = [...new Set([here, ...named].filter(Boolean))].slice(0, 2);
  for (const e of matches) {
    const m = K.matchSummary(e);
    const w = m.winProbability;
    lines.push(`MATCH${e === here ? ' (on screen)' : ''}: [${e.home} vs ${e.away}](#/match/${e.id}) · ${e.league} · ${e.live ? `LIVE ${e.score || ''} (numbers are pre-match)` : when(e.start)}${e.venue ? ` · ${e.venue}` : ''}`);
    lines.push(`  Pre-match estimated win chance: ${e.home} ${pc(w.home)}${w.draw ? `, draw ${pc(w.draw)}` : ''}, ${e.away} ${pc(w.away)} (${m.basis})`);
    if (m.liveEstimate) { const l = m.liveEstimate; lines.push(`  LIVE estimate from the current score (${Math.round(l.gameLeft * 100)}% of game left): ${e.home} ${pc(l.home)}${l.draw != null ? `, draw ${pc(l.draw)}` : ''}, ${e.away} ${pc(l.away)}`); }
    const prices = m.bestPrices.slice(0, 5).map((x) => `${x.pick} (${x.market}) ${od(x.odds)} est. ${pc(x.probability)}${x.priced ? (x.edge > 0 ? ` edge +${(x.edge * 100).toFixed(1)}%` : '') : ' [model fair odds]'}`);
    if (prices.length) lines.push(`  Prices: ${prices.join('; ')}`);
    if (m.form) lines.push(`  Form (last results): ${e.home} ${m.form.home || '-'}, ${e.away} ${m.form.away || '-'}`);
    for (const s of m.starters || []) lines.push(`  Starter ${s.team}: ${s.name}${s.season ? ` ${s.season.era} ERA, ${s.season.whip} WHIP, ${s.season.k9} K/9, ${s.season.w}-${s.season.l}` : ''}${s.last3 ? `, last 3 starts ${s.last3.era} ERA` : ''}${s.rest != null ? `, ${s.rest} days rest` : ''}`);
    const inj = await Promise.race([K.injuriesOf(e), new Promise((r) => setTimeout(() => r(null), 6000))]).catch(() => null);
    if (inj?.covered) {
      const side = (list) => (list.length ? list.slice(0, 8).map((i) => `${i.name} (${i.detail}${i.back ? `, back ${i.back}` : ''})`).join(', ') : 'none listed');
      lines.push(`  Injuries/absences (${inj.source}): ${e.home}: ${side(inj.home)}. ${e.away}: ${side(inj.away)}.`);
    } else lines.push('  Injuries: no source covers this match (unknown, not none).');
    const lu = e.absences?.lineup;
    if (lu) lines.push(`  Lineups (${lu.type === 'lastStarting11' ? 'not announced; last match XI' : lu.type === 'predicted' ? 'predicted' : 'confirmed'}): ${e.home} ${lu.home.formation || ''}: ${lu.home.starters.map((p) => p.name).join(', ')}. ${e.away} ${lu.away.formation || ''}: ${lu.away.starters.map((p) => p.name).join(', ')}.`);
  }

  const today = /\b(today|tonight|now)\b/.test(q);
  const pickLine = (x) => `${x.pick} · ${x.market} · [${x.e.home} vs ${x.e.away}](#/match/${x.e.id}) ${when(x.e.start)} · odds ${od(x.odds)} · est. ${pc(x.p)}${x.priced ? (x.ev > 0 ? ` · edge +${(x.ev * 100).toFixed(1)}%` : '') : ' · model fair odds'}`;
  const section = (title, list) => { if (list.length) lines.push(title, ...list.map((x) => `  - ${pickLine(x)}`)); };
  section(`SAFEST PICKS${today ? ' TODAY' : ''}:`, K.picks({ ...scope, today, mode: 'safe', limit: 4 }));
  section('VALUE PICKS (model above the price):', K.picks({ ...scope, today, mode: 'value', limit: 3 }));
  section('BALANCED PICKS:', K.picks({ ...scope, today, mode: 'balanced', limit: 4 }));

  if (/\blive\b|in play|right now|score/.test(q)) {
    const live = K.filterEvents({ ...scope, live: true }).slice(0, 8);
    lines.push(live.length ? `LIVE NOW: ${live.map((e) => `[${e.home} vs ${e.away}](#/match/${e.id}) ${e.score || ''} ${e.clock || ''}`).join('; ')}` : 'LIVE NOW: nothing in play.');
  }
  const mult = q.match(/(\d{1,4})\s*x\b|\b(\d{1,4})\s*times\b/);
  if (mult || /\b(slip|parlay|acca|accumulator|multi|mega)\b/.test(q)) {
    const t = Number(mult?.[1] || mult?.[2]) || (/mega/.test(q) ? 100 : 3);
    const target = [2, 3, 4, 5, 10, 20, 100, 500, 1000].reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), 3);
    K.slips(target, target <= 20).slice(0, 2).forEach((s, i) => lines.push(`${target}x SLIP ${i + 1}: total ${od(s.odds)}, est. ${pc(s.p)} — ${s.legs.map((l) => `${l.pick} @ ${od(l.odds)} (${l.match})`).join('; ')}`));
  }
  if (!matches.length && /injur|absen|\bout\b|suspend|team news/.test(q)) {
    K.filterEvents(scope).filter((e) => e.absences).slice(0, 5).forEach((e) => lines.push(`ABSENCES [${e.home} vs ${e.away}](#/match/${e.id}): ${e.home}: ${(e.absences.home || []).map((i) => `${i.name} (${i.injury || i.type})`).join(', ') || 'none'}; ${e.away}: ${(e.absences.away || []).map((i) => `${i.name} (${i.injury || i.type})`).join(', ') || 'none'}`));
  }
  if (!matches.length) {
    const up = K.filterEvents({ ...scope, today }).filter((e) => !e.live).sort((a, b) => a.start - b.start).slice(0, 8);
    if (up.length) lines.push(`UPCOMING: ${up.map((e) => `[${e.home} vs ${e.away}](#/match/${e.id}) ${when(e.start)}`).join('; ')}`);
  }
  let out = '';
  for (const l of lines) { if (out.length + l.length > max) break; out += `${l}\n`; }
  return out.trim();
}

// ---------- on-device model (WebLLM) ----------
// Phones and low-memory machines get the 1B model (~0.9 GB once); others the 3B (~2.3 GB once).
const small = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.deviceMemory && navigator.deviceMemory < 8);
const MODEL = () => (small() ? 'Llama-3.2-1B-Instruct-q4f16_1-MLC' : 'Llama-3.2-3B-Instruct-q4f16_1-MLC');

let gpuOk;
export async function deviceAI() {
  if (gpuOk === undefined) gpuOk = Boolean(navigator.gpu && (await navigator.gpu.requestAdapter().catch(() => null)));
  return gpuOk;
}

let engineP = null;
const progressSubs = new Set();
export const onProgress = (f) => { progressSubs.add(f); return () => progressSubs.delete(f); };
// Load (or reuse) the on-device engine; reports download/compile progress 0..1.
export function loadEngine() {
  if (!engineP) {
    engineP = (async () => {
      const webllm = await import('../../vendor/web-llm.mjs');
      const report = (r) => progressSubs.forEach((f) => f(r.progress ?? 0, r.text || ''));
      try {
        const worker = new Worker(new URL('js/assistant/llm-worker.js', document.baseURI), { type: 'module' }) /* page-relative: works bundled or not */;
        return await webllm.CreateWebWorkerMLCEngine(worker, MODEL(), { initProgressCallback: report });
      } catch {
        return webllm.CreateMLCEngine(MODEL(), { initProgressCallback: report });
      }
    })();
    engineP.catch(() => { engineP = null; });
  }
  return engineP;
}
export const engineLoaded = () => Boolean(engineP);

async function askDevice(messages, onText) {
  const engine = await loadEngine();
  const stream = await engine.chat.completions.create({ messages, stream: true, temperature: 0.6, max_tokens: 500 });
  let answer = '';
  for await (const chunk of stream) {
    const piece = chunk.choices?.[0]?.delta?.content || '';
    if (piece) { answer += piece; onText?.(answer); }
  }
  return answer.trim();
}

// ---------- optional hosted model (future paid plan) ----------
async function askServer(K, history, text, context, onText) {
  const res = await fetch(`${AI_URL.replace(/\/+$/, '')}/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: text, history: history.slice(-8), context }),
  });
  if (!res.ok) throw new Error(`server ${res.status}`);
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
      try { const j = JSON.parse(d); const piece = j.response ?? j.choices?.[0]?.delta?.content ?? ''; if (piece) { answer += piece; onText?.(answer); } } catch { /* partial line */ }
    }
  }
  if (!answer.trim()) throw new Error('empty answer');
  return answer.trim();
}

// Can this visitor get AI answers at all (hosted model configured, or a WebGPU device)?
export async function aiAvailable() { return Boolean(AI_URL) || deviceAI(); }

// One answer. history: [{role:'user'|'assistant', content}] of earlier turns.
export async function askAI(K, history, text, { onText } = {}) {
  if (AI_URL) {
    try { return await askServer(K, history, text, await buildContext(K, text, 20000), onText); } catch { /* fall through to the device */ }
  }
  if (!(await deviceAI())) throw new Error('no-ai');
  const context = await buildContext(K, text, 6000);
  const past = history.slice(-4).map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
  return askDevice([{ role: 'system', content: SYSTEM }, ...past, { role: 'user', content: `SITE DATA:\n${context}\n\nQUESTION: ${text}` }], onText);
}
