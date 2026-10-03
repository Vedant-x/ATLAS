// Alerts for matches you follow: the ones you star ("Watch") and every match in your slip. Each live
// refresh compares the new data with what you last saw and tells you about what changed: a new
// starting pitcher, a player newly listed out, a big price move, kick-off soon, a goal or score
// change. Shown in the page, and as system notifications (if allowed) when ATLAS is in the background.
import { slip } from './slip.js';

const WKEY = 'atlas-watch', SKEY = 'atlas-watch-state';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

let watched = new Set(load(WKEY, []));
let seen = load(SKEY, {});
const subs = new Set();

export const watch = {
  has: (id) => watched.has(id),
  ids: () => [...watched],
  toggle(id) {
    if (watched.has(id)) watched.delete(id); else { watched.add(id); askPermission(); }
    save(WKEY, [...watched]);
    subs.forEach((f) => f());
    return watched.has(id);
  },
  subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
};

function askPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  Notification.requestPermission().catch(() => {});
}

// What we compare between refreshes.
export function snapshot(e) {
  const m = e.markets?.[0];
  return {
    starters: (e.probables || []).map((p) => `${p.side}:${p.report?.name || p.name || ''}`).filter((x) => !x.endsWith(':')).sort(),
    out: ['home', 'away'].flatMap((s) => (e.absences?.[s] || []).map((i) => i.name)).sort(),
    odds: m ? Object.fromEntries(m.outcomes.map((o) => [o.name, o.odds])) : {},
    score: e.score || null, live: Boolean(e.live), start: e.start,
  };
}

// Messages for what changed between two snapshots of one match.
export function changes(e, before, now, at = Date.now()) {
  const msgs = [];
  const name = `${e.home} v ${e.away}`;
  if (!before) return msgs;
  const newSp = now.starters.filter((s) => !before.starters.includes(s));
  if (before.starters.length && newSp.length) msgs.push({ kind: 'starter', text: `${name}: starter change, now ${newSp.map((s) => s.split(':')[1]).join(' & ')}` });
  const newOut = now.out.filter((n) => !before.out.includes(n));
  if (newOut.length) msgs.push({ kind: 'injury', text: `${name}: newly listed out: ${newOut.slice(0, 3).join(', ')}${newOut.length > 3 ? ` +${newOut.length - 3}` : ''}` });
  for (const [k, o] of Object.entries(now.odds)) {
    const b = before.odds[k];
    if (b && o && Math.abs(o / b - 1) >= 0.08) msgs.push({ kind: 'price', text: `${name}: ${k} ${o < b ? 'shortened' : 'drifted'} ${b.toFixed(2)} → ${o.toFixed(2)}` });
  }
  if (!before.live && now.live) msgs.push({ kind: 'start', text: `${name} has started` });
  else if (!now.live && now.start - at < 15 * 6e4 && now.start - at > 0 && !(before.start - (before.checkedAt || at) < 15 * 6e4)) msgs.push({ kind: 'soon', text: `${name} starts in ${Math.max(1, Math.round((now.start - at) / 6e4))} min` });
  if (before.score && now.score && before.score !== now.score) msgs.push({ kind: 'score', text: `${name}: ${now.score}` });
  return msgs;
}

// Called after every data refresh.
export function checkAlerts(events) {
  const follow = new Set([...watched, ...slip.legs.map((l) => l.eventId)]);
  if (!follow.size) return [];
  const at = Date.now(), out = [];
  for (const e of events) {
    if (!follow.has(e.id)) continue;
    const now = { ...snapshot(e), checkedAt: at };
    out.push(...changes(e, seen[e.id], now, at).map((m) => ({ ...m, id: e.id })));
    seen[e.id] = now;
  }
  // Forget matches long gone.
  for (const id of Object.keys(seen)) if (!follow.has(id) && seen[id].start < at - 864e5) delete seen[id];
  save(SKEY, seen);
  out.forEach(notify);
  return out;
}

const ICON = { starter: '⚾', injury: '🩹', price: '📈', start: '▶', soon: '⏱', score: '⚽' };
function notify(m) {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = document.createElement('a');
  t.className = 'toast'; t.href = `#/match/${encodeURIComponent(m.id)}`;
  t.innerHTML = `<span>${ICON[m.kind] || '•'}</span><p></p>`;
  t.querySelector('p').textContent = m.text;
  box.append(t);
  setTimeout(() => t.classList.add('out'), 7000);
  setTimeout(() => t.remove(), 7600);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const opts = { body: m.text, icon: 'icons/icon-192.png', tag: `${m.id}:${m.kind}`, data: { url: `#/match/${m.id}` } };
    navigator.serviceWorker?.getRegistration().then((r) => (r ? r.showNotification('ATLAS', opts) : new Notification('ATLAS', opts))).catch(() => {});
  }
}
