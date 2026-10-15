// The assistant's AI. It runs on the visitor's own device (WebLLM: an open model executed by the browser
// on the GPU through WebGPU), so it costs the site nothing and has no usage limits. The model downloads
// once and is cached by the browser. With each question the browser builds a compact text snapshot of
// the ATLAS data that matters (the match on screen or named, its injuries and starters, current picks,
// live games, slips), so the model answers from the site's real numbers instead of guessing.
//
// AI_URL (js/config.js) can point at a hosted model later (worker/atlas-ai.js); if it fails, the
// on-device model takes over without telling the visitor anything about quotas.
import { AI_URL } from '../config.js';
import { parseConstraints, constraintChips } from './constraints.js';

const pc = (p) => (Number.isFinite(p) ? `${Math.round(p * 100)}%` : '?');
const od = (o) => (Number.isFinite(o) ? Number(o).toFixed(2) : '?');
const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

const SYSTEM = `You are the assistant on ATLAS, a sports-betting research site. Talk like a sharp, friendly analyst:
natural sentences in your own words, never a template. Answer the question first, then the reasons that matter.
Keep quick questions short (2-4 sentences).
RULES:
- Facts (matches, odds, chances, injuries, starters, player stats) come only from SITE DATA. Never invent numbers,
  players, injuries or prices. If the data does not cover something, say it is unknown.
- When you recommend a pick, name it by its tag in square brackets, e.g. [P2]. Only tagged picks can be
  recommended. The site shows each tagged pick's verified price and chance itself, so do not restate odds.
- Keep every constraint listed under CONSTRAINTS (day, sports included or excluded, odds range, positive return
  only, how many). If PICKS says none qualify, say so plainly; never offer other picks in their place.
- "Return" means forecast x odds - 1. A forecast above the market estimate can still lose money at the price.
- Readiness labels (Ready, Waiting, Stale, Conflicting reports, Limited coverage) describe the evidence, not
  the chance of winning; mention them when they are not "Ready".
- Chances are estimates, never guarantees. On a live match the numbers are pre-match. Link matches as
  [Home vs Away](#/match/ID). Never back both sides of one match or pair an over with an under.`;

// ---------- site data, as compact text (small models have a short memory) ----------
export async function buildContext(K, text, max = 6000, mem = null) {
  const tags = {};
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
    const prices = (m.recommended || []).map((x) => `${x.pick} (${x.market}) ${od(x.odds)} est. ${pc(x.probability)}${x.priced ? (x.edge > 0 ? ` edge +${(x.edge * 100).toFixed(1)}%` : '') : ' [model fair odds]'}`);
    if (prices.length) lines.push(`  Recommended (consistent, one side): ${prices.join('; ')}`);
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

  // The picks the question allows, under its constraints, tagged P1.. so the answer can name them and
  // the site can render each from its record (same selection as the built-in assistant).
  const c = parseConstraints(text, K);
  const chips = constraintChips(c);
  lines.push(`CONSTRAINTS: ${chips.length ? chips.join(' · ') : 'none stated'}${prefsNote(K)}`);
  const mode = c.positiveOnly || /\b(value|edge|\+ev)\b/.test(q) ? 'value' : /\b(safe|safest|banker|lock)/.test(q) ? 'safe' : 'balanced';
  const sel = { ...(c.league ? { league: c.league } : c.sport ? { sport: c.sport } : scope), mode, limit: c.n || 6, exclude: c.exclude, ...(c.minOdds != null ? { minOdds: c.minOdds } : {}), ...(c.maxOdds != null ? { maxOdds: c.maxOdds } : {}) };
  let picks = c.from ? K.picks({ ...sel, from: c.from, to: c.to }) : K.picks({ ...sel, today: true });
  if (!picks.length && !c.from) picks = K.picks({ ...sel, today: false });
  const tagged = [...(mem?.list || []).map((x) => ({ ...x, earlier: true })), ...picks.filter((x) => !(mem?.list || []).some((y) => K.pickId(y) === K.pickId(x)))].slice(0, 12);
  tagged.forEach((x, i) => { x.tag = `P${i + 1}`; });
  const pickLine = (x) => `[${x.tag}] ${x.pick} · ${x.market} · [${x.e.home} vs ${x.e.away}](#/match/${x.e.id}) ${when(x.e.start)} · odds ${od(x.odds)} · ATLAS ${pc(x.p)} · break-even ${pc(1 / x.odds)} · return ${x.ev >= 0 ? '+' : ''}${(x.ev * 100).toFixed(1)}% · evidence: ${K.readinessOf?.(x.e)?.label || 'not checked'}${x.priced ? '' : ' · model only'}${x.earlier ? ' · (from your earlier answer)' : ''}`;
  if (tagged.length) lines.push(`PICKS (${mode === 'value' ? 'positive estimated return' : mode}, constraints applied):`, ...tagged.map((x) => `  - ${pickLine(x)}`));
  if (!picks.length) lines.push(`PICKS: none qualify under these constraints${mode === 'value' ? ' (no positive estimated return)' : ''}. Say so; do not substitute others.`);
  // Recent material changes (starters, lineups, injuries, prices, props), newest first.
  const ch = K.changes?.({ since: /yesterday|24/.test(q) ? Date.now() - 864e5 : K.lastVisit?.() }) || [];
  if (ch.length) lines.push(`CHANGES since ${/yesterday|24/.test(q) ? 'yesterday' : 'the last visit'}: ${ch.slice(-8).reverse().map((x) => `${x.home} v ${x.away}: ${x.text}`).join('; ')}`);
  // A player named in the question: his lines, recent games and readiness.
  const pr = K.playerResearch?.(text);
  if (pr) lines.push(`PLAYER ${pr.name} (${pr.team}${pr.injury ? `, listed ${pr.injury}` : ''}), game logs built ${pr.logsAt ? `${Math.round((Date.now() - pr.logsAt) / 6e4)} min ago` : 'unknown'}: ${pr.lines.slice(0, 5).map(({ x, r }) => `${x.target}+ ${x.label} @ ${od(x.odds)}: ATLAS ${pc(x.p)}, last games ${pr.recent(x.type).join(',')}, ${r.label}${x.why ? `, ${x.why}` : ''}`).join(' | ') || 'no lines on offer'}`);
  // The visitor's slip, through the slip check.
  const sl = /\bslip\b/.test(q) ? K.slipSummary?.() : null;
  if (sl) lines.push(`YOUR SLIP: ${sl.legs.length} legs, ${od(sl.odds)}x, combined chance ${pc(sl.adjusted)} (${pc(sl.product)} if unrelated), break-even ${pc(sl.breakEven)}, weakest ${sl.weakest.pick} ${pc(sl.weakest.p)}${sl.uncertain ? ', some same-match legs cannot be measured' : ''}.`);

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
    const up = K.filterEvents({ ...scope, ...(c.from ? { from: c.from, to: c.to } : { today: true }), exclude: c.exclude }).filter((e) => !e.live).sort((a, b) => a.start - b.start).slice(0, 8);
    if (up.length) lines.push(`UPCOMING: ${up.map((e) => `[${e.home} vs ${e.away}](#/match/${e.id}) ${when(e.start)}`).join('; ')}`);
  }
  let out = '';
  for (const l of lines) { if (out.length + l.length > max) break; out += `${l}\n`; }
  for (const x of tagged) tags[x.tag] = x;
  return { text: out.trim(), tags, chips };
}
const prefsNote = (K) => (K.minOdds?.() ? ` · site filter: legs at odds ${od(K.minOdds())}+` : '');

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
async function askServer(K, history, text, context, onText, signal) {
  const res = await fetch(`${AI_URL.replace(/\/+$/, '')}/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
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
// The on-device model is a large one-time download (about 1 GB on phones, 2 GB on desktops), so it
// only runs once the visitor turns it on; until then the built-in assistant answers.
const OPT_KEY = 'atlas-ai-device';
export const deviceOptIn = () => { try { return localStorage.getItem(OPT_KEY) === 'on'; } catch { return false; } };
export const setDeviceOptIn = (on) => { try { localStorage.setItem(OPT_KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ } };
export const downloadSize = () => (small() ? 'about 1 GB' : 'about 2 GB');
export async function aiAvailable() { return Boolean(AI_URL) || (deviceOptIn() && deviceAI()); }

// Which engine is answering, for the panel's label.
export function aiMode() {
  if (AI_URL) return 'Hosted AI';
  if (deviceOptIn() && gpuOk) return `On-device AI · ${small() ? 'Llama 3.2 1B' : 'Llama 3.2 3B'}`;
  return 'Built-in assistant';
}
let abort = null;
// Stop the answer being written (hosted: abort the request; device: interrupt the model).
export async function stopAI() {
  abort?.abort();
  if (engineP) { try { (await engineP).interruptGenerate(); } catch { /* not generating */ } }
}

// Checks an answer against the data it was given: [P#] tags become the pick names (and verified cards),
// and any odds or percentage the model wrote that is not in the data is flagged.
export function verifyAnswer(answer, context) {
  const used = [...new Set([...answer.matchAll(/\[(P\d{1,2})\]/g)].map((m) => m[1]))].filter((t) => context.tags[t]);
  let text = answer.replace(/\[(P\d{1,2})\]/g, (m, t) => (context.tags[t] ? `**${context.tags[t].pick}**` : m));
  const known = new Set((context.text.match(/\d+(?:\.\d+)?%?/g) || []));
  const numbers = (text.match(/\b\d\.\d{2}\b|\b\d{1,3}(?:\.\d)?%/g) || []);
  const unknown = numbers.filter((n) => !known.has(n) && !known.has(n.replace('%', '')));
  if (unknown.length) text += `\n\n_Unverified: ${[...new Set(unknown)].slice(0, 4).join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not in ATLAS's data; trust the cards below._`;
  return { text, picks: used.map((t) => context.tags[t]), unverified: unknown };
}

// One answer. history: [{role:'user'|'assistant', content}] of earlier turns; mem: the brain's memory.
export async function askAI(K, history, text, { onText, mem = null } = {}) {
  abort = new AbortController();
  if (AI_URL) {
    try {
      const ctx = await buildContext(K, text, 20000, mem);
      const answer = await askServer(K, history, text, ctx.text, onText, abort.signal);
      return { ...verifyAnswer(answer, ctx), mode: 'Hosted AI', chips: ctx.chips };
    } catch (err) { if (err?.name === 'AbortError') throw err; /* fall through to the device */ }
  }
  if (!deviceOptIn() || !(await deviceAI())) throw new Error('no-ai');
  const ctx = await buildContext(K, text, 7000, mem);
  const past = history.slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 1200) }));
  const answer = await askDevice([{ role: 'system', content: SYSTEM }, ...past, { role: 'user', content: `SITE DATA:\n${ctx.text}\n\nQUESTION: ${text}` }], onText);
  return { ...verifyAnswer(answer, ctx), mode: aiMode(), chips: ctx.chips };
}
