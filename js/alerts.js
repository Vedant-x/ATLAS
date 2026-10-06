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

// What we compare between refreshes, and the messages for what changed: shared with the server-side
// change timeline (changelog.js).
export { snapshot } from './changelog.js';
import { snapshot, diff, KIND_ICON } from './changelog.js';
export const changes = (e, before, now, at) => diff(e, before, now, at).map((c) => ({ kind: c.kind, text: c.liveOnly ? c.text : `${c.name}: ${c.text}` }));

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

const ICON = KIND_ICON;
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
