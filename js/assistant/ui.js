// The floating assistant: an animated character you can drag anywhere, a chat panel, six looks to
// pick from. Answers come from an AI model running on the visitor's own device (ai.js); browsers
// without WebGPU get the built-in brain, which answers from the same site data.
import { ico } from '../icons.js';
import { createKnowledge } from './knowledge.js';
import { createBrain } from './brain.js';
import { CHARACTERS, characterById, svgOf } from './characters.js';
import { aiAvailable, askAI, loadEngine, engineLoaded, onProgress, deviceAI, deviceOptIn, setDeviceOptIn, downloadSize } from './ai.js';
import { esc, legIndex } from '../views.js';
import { slip } from '../slip.js';

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const pc = (p) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;

// Markdown subset: **bold**, bullets, numbered lines, links to in-site routes only.
function md(text) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((#\/[^)\s]*)\)/g, (_, t, h) => `<a href="${h}">${t}</a>`);
  const out = [];
  let list = null;
  for (const line of String(text).split('\n')) {
    const b = line.match(/^\s*[-•*]\s+(.*)/), n = line.match(/^\s*(\d+)[.)]\s+(.*)/);
    if (b || n) {
      const kind = b ? 'ul' : 'ol';
      if (list !== kind) { if (list) out.push(`</${list}>`); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline(b ? b[1] : n[2])}</li>`);
      continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return out.join('');
}

export function mountAssistant(S) {
  const K = createKnowledge(S);
  const brain = createBrain(K);
  let charId = store.get('atlas-ai-char', 'nova');
  let history = store.get('atlas-ai-history', []); // [{role, text, cards?}] for display
  let busy = false;

  // ---------- launcher (the floating character) ----------
  const root = document.createElement('div');
  root.className = 'ai-root';
  root.innerHTML = `
    <button class="ai-launch" aria-label="Open the ATLAS assistant" data-cursor="ASK">
      <span class="ai-shadow"></span><span class="ai-avatar"></span>
      <span class="ai-bubble" hidden></span>
    </button>
    <section class="ai-panel" role="dialog" aria-label="ATLAS assistant" hidden>
      <header class="ai-head">
        <span class="ai-mini"></span>
        <div class="ai-title"><b class="ai-name"></b><small class="ai-mode"></small></div>
        <button class="ai-icon" data-ai="looks" title="Change character" aria-label="Change character">${ico('person')}</button>
        <button class="ai-icon" data-ai="clear" title="Clear chat" aria-label="Clear chat">${ico('refresh')}</button>
        <button class="ai-icon" data-ai="close" title="Close" aria-label="Close">${ico('close')}</button>
      </header>
      <div class="ai-looks" hidden></div>
      <div class="ai-log" aria-live="polite"></div>
      <div class="ai-optin" hidden></div>
      <div class="ai-chips"></div>
      <form class="ai-form"><input class="ai-input" placeholder="Ask about bets, injuries, starters…" autocomplete="off" maxlength="500"/><button class="ai-send" aria-label="Send">${ico('send')}</button></form>
    </section>`;
  document.body.append(root);
  const $ = (s) => root.querySelector(s);
  const launch = $('.ai-launch'), panel = $('.ai-panel'), log = $('.ai-log'), input = $('.ai-input');

  let modeText = 'Assistant';
  const setMode = (t) => { modeText = t; const el = root.querySelector('.ai-mode'); if (el) el.textContent = t; };
  // Download progress of the on-device model (first time only; cached afterwards).
  onProgress((p) => {
    setMode(p >= 1 ? 'AI · on your device' : `Getting the AI ready · ${Math.round(p * 100)}%`);
    const pend = history[history.length - 1];
    if (busy && pend?.pending && !pend.streamed) { pend.text = p >= 1 ? 'Thinking…' : `Setting up the AI on your device (first time only) · ${Math.round(p * 100)}%`; const el = log.lastElementChild; if (el) el.innerHTML = md(pend.text); }
  });
  // Warm the model up when the chat opens, once the visitor has turned it on (and not on mobile data).
  const warm = async () => {
    if (engineLoaded() || !deviceOptIn() || !(await deviceAI())) return;
    const c = navigator.connection;
    if (c && (c.saveData || c.type === 'cellular' || /2g|3g/.test(c.effectiveType || ''))) return;
    loadEngine().catch(() => {});
  };
  // Devices that can run the model are offered it once, as a choice with the download size shown.
  const optin = async () => {
    const box = $('.ai-optin');
    const show = !deviceOptIn() && (await deviceAI());
    box.hidden = !show;
    if (show) box.innerHTML = `<p>Answers now come from ATLAS's built-in assistant. A fuller AI can run on this device: free and private, ${downloadSize()} to download once.</p><button class="ai-optin-btn" data-ai="optin">Use on-device AI</button>`;
    setMode(deviceOptIn() && (await deviceAI()) ? 'AI · on your device' : 'Built-in assistant');
  };
  optin();

  function paint() {
    const c = characterById(charId);
    $('.ai-avatar').innerHTML = svgOf(c, 'ai-c-big');
    $('.ai-mini').innerHTML = svgOf(c, 'ai-c-mini');
    $('.ai-name').textContent = c.name;
    $('.ai-mode').textContent = modeText;
    root.style.setProperty('--ai', c.color);
  }

  // Drag anywhere; position remembered. A short press opens the chat.
  const pos = store.get('atlas-ai-pos', null);
  const place = (x, y) => {
    const s = launch.offsetWidth || 84;
    const nx = Math.max(6, Math.min(innerWidth - s - 6, x)), ny = Math.max(70, Math.min(innerHeight - s - (innerWidth <= 820 ? 92 : 6), y)); // phones: never over the tab bar
    root.style.setProperty('--ax', `${nx}px`); root.style.setProperty('--ay', `${ny}px`);
    root.classList.add('placed');
    return [nx, ny];
  };
  if (pos) requestAnimationFrame(() => place(pos[0], pos[1]));
  let drag = null;
  launch.addEventListener('pointerdown', (e) => {
    const r = launch.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
    launch.setPointerCapture(e.pointerId);
  });
  launch.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) drag.moved = true;
    if (drag.moved) { root.classList.add('dragging'); place(e.clientX - drag.dx, e.clientY - drag.dy); }
  });
  launch.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null; root.classList.remove('dragging');
    if (moved) { const r = launch.getBoundingClientRect(); store.set('atlas-ai-pos', [r.left, r.top]); }
    else toggle(true);
    e.preventDefault();
  });
  addEventListener('resize', () => { const p = store.get('atlas-ai-pos', null); if (p) place(p[0], p[1]); });

  // Eyes follow a mouse cursor (not touch), at most once a frame, and only for the visible character.
  let eyeAt = null;
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || drag) return;
    if (!eyeAt) requestAnimationFrame(() => {
      const { x, y } = eyeAt; eyeAt = null;
      const g = root.querySelector(root.classList.contains('open') ? '.ai-mini .ai-pupils' : '.ai-avatar .ai-pupils');
      if (!g) return;
      const r = g.ownerSVGElement.getBoundingClientRect();
      const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 300) * 3;
      g.style.transform = `translate(${((dx / d) * k).toFixed(1)}px, ${((dy / d) * k).toFixed(1)}px)`;
    });
    eyeAt = { x: e.clientX, y: e.clientY };
  }, { passive: true });

  // ---------- chat ----------
  const cardHtml = (c) => {
    if (c.type === 'match') return `<a class="ai-card match" href="#/match/${esc(c.e.id)}"><b>${esc(c.e.home)} <i>vs</i> ${esc(c.e.away)}</b><small>${esc(c.e.league)} · ${c.e.live ? 'LIVE' : new Date(c.e.start).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</small><em>Open dossier →</em></a>`;
    const leg = c.type === 'leg' ? c.leg : { key: `${c.e.id}|${c.priced ? '' : 'fair|'}${c.market}|${c.pick}`, eventId: c.e.id, sport: c.e.sport, match: `${c.e.home} vs ${c.e.away}`, market: c.market, pick: c.pick, odds: c.odds, p: c.p, derived: !c.priced };
    legIndex.set(leg.key, leg);
    return `<div class="ai-card pick"><div><b>${esc(leg.pick)}</b><small>${esc(leg.market)} · <a href="#/match/${esc(leg.eventId)}">${esc(leg.match)}</a></small></div>
      <span class="ai-odds">${Number(leg.odds).toFixed(2)}<small>${pc(leg.p)}</small></span>
      <button class="leg ${slip.has(leg.key) ? 'on' : ''}" data-leg="${esc(leg.key)}" aria-label="Add to slip">+</button></div>`;
  };
  const msgHtml = (m) => `<div class="ai-msg ${m.role}">${m.role === 'user' ? `<p>${esc(m.text)}</p>` : md(m.text)}${(m.cards || []).length ? `<div class="ai-cards">${m.cards.map(cardHtml).join('')}</div>` : ''}</div>`;
  const persist = () => store.set('atlas-ai-history', history.slice(-30).map((m) => ({ role: m.role, text: m.text }))); // cards hold live objects; only text is kept
  function render() {
    log.innerHTML = history.length ? history.map(msgHtml).join('') : `<div class="ai-msg bot">${md(`Hey, I'm **${characterById(charId).name}**. Ask me anything: a bet for tonight, who's injured, how a pitcher's been throwing, or just talk sport. I can see every match, price and team-news update on ATLAS.`)}</div>`;
    log.scrollTop = log.scrollHeight;
    $('.ai-chips').innerHTML = brain.suggestions().map((s) => `<button class="ai-chip">${esc(s)}</button>`).join('');
  }

  async function ask(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    history.push({ role: 'user', text });
    history.push({ role: 'bot', text: 'Thinking…', pending: true });
    render();
    root.classList.add('talking');
    const pending = history[history.length - 1];
    const live = (t) => { pending.text = pending.streamed = t; const el = log.lastElementChild; if (el) { el.innerHTML = md(t); log.scrollTop = log.scrollHeight; } };
    let reply;
    // Without on-device AI (no WebGPU, or the model failed to load) the built-in brain answers.
    const fallback = async () => (await brain.answer(text).catch(() => null)) || { text: 'Sorry, I couldn\'t work that out. Try asking another way.', cards: [] };
    if (!(await aiAvailable())) reply = await fallback();
    else {
      try {
        // Earlier turns of this chat (not the question just asked) give the AI the thread.
        const past = history.slice(0, -2).filter((m) => m.text && !m.pending).slice(-8).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
        const answer = await askAI(K, past, text, { onText: live });
        // Matches the AI linked to become tappable cards.
        const ids = [...new Set([...answer.matchAll(/#\/match\/([^)\s]+)/g)].map((m) => m[1]))].slice(0, 3);
        reply = { text: answer, cards: ids.map((id) => K.eventById(decodeURIComponent(id))).filter(Boolean).map((e) => ({ type: 'match', e })) };
      } catch (err) {
        console.warn('AI answer failed, using the built-in brain', err);
        reply = await fallback();
      }
    }
    history[history.length - 1] = { role: 'bot', text: reply.text, cards: reply.cards || [] };
    busy = false;
    persist();
    render();
    setTimeout(() => root.classList.remove('talking'), Math.min(4000, 600 + reply.text.length * 12));
  }

  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    root.classList.toggle('open', open);
    if (open) { render(); $('.ai-bubble').hidden = true; setTimeout(() => input.focus(), 50); warm(); }
  }

  function looks() {
    const box = $('.ai-looks');
    box.hidden = !box.hidden;
    box.innerHTML = `<p>Pick a character</p><div class="ai-grid">${CHARACTERS.map((c) => `<button class="ai-look ${c.id === charId ? 'on' : ''}" data-look="${c.id}">${svgOf(c, 'ai-c-thumb')}<b>${c.name}</b><small>${c.tag}</small></button>`).join('')}</div>`;
  }
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button, a');
    if (!t || !root.contains(t)) return;
    const act = t.dataset.ai;
    if (act === 'close') toggle(false);
    else if (act === 'looks') looks();
    else if (act === 'clear') { history = []; persist(); render(); }
    else if (act === 'optin') { setDeviceOptIn(true); optin(); warm(); }
    else if (t.dataset.look) { charId = t.dataset.look; store.set('atlas-ai-char', charId); paint(); looks(); looks(); root.classList.add('wave'); setTimeout(() => root.classList.remove('wave'), 900); }
    else if (t.classList.contains('ai-chip')) ask(t.textContent);
    else if (t.tagName === 'A' && t.getAttribute('href')?.startsWith('#/') && innerWidth < 820) toggle(false); // phones: get out of the way
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.classList.contains('ai-form')) { const v = input.value; input.value = ''; ask(v); }
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) toggle(false); });
  addEventListener('hashchange', () => { if (!panel.hidden) render(); });
  slip.subscribe(() => root.querySelectorAll('.ai-card .leg').forEach((b) => b.classList.toggle('on', slip.has(b.dataset.leg))));

  paint();
  render();
  // A one-time hello so people notice it.
  if (!store.get('atlas-ai-greeted', false)) {
    setTimeout(() => { const b = $('.ai-bubble'); b.textContent = 'Ask about any match'; b.hidden = false; store.set('atlas-ai-greeted', true); setTimeout(() => { b.hidden = true; }, 6000); }, 2500);
  }
  return { open: () => toggle(true), close: () => toggle(false), isOpen: () => !panel.hidden, ask };
}
