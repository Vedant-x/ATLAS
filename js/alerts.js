// Alerts for matches you follow: the ones you star ("Watch") and every match in your slip. Each live
// refresh compares the new data with what you last saw and tells you about what changed: a new
// starting pitcher, a player newly listed out, a big price move, kick-off soon, a goal or score
// change. Shown in the page, and as system notifications (if allowed) when ATLAS is in the background.
import { slip } from './slip.js';
import { covers } from './livealerts.js';

const WKEY = 'atlas-watch', SKEY = 'atlas-watch-state', MKEY = 'atlas-watch-meta';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

let watched = new Set(load(WKEY, []));
let seen = load(SKEY, {});
// What we last knew about each watched match, so it stays listed (with its result) after it ends
// and drops out of the feeds, until it is cleared.
let meta = load(MKEY, {});
const subs = new Set();

export const watch = {
  has: (id) => watched.has(id),
  ids: () => [...watched],
  toggle(id) {
    if (watched.has(id)) { watched.delete(id); delete meta[id]; save(MKEY, meta); } else { watched.add(id); askPermission(); }
    save(WKEY, [...watched]);
    subs.forEach((f) => f());
    return watched.has(id);
  },
  meta: (id) => meta[id],
  // Keep the details of watched matches current.
  remember(events) {
    let dirty = false;
    for (const e of events) {
      if (!watched.has(e.id)) continue;
      const m = meta[e.id] || {};
      const next = { ...m, home: e.home, away: e.away, league: e.league, sport: e.sport, start: e.start, score: e.score || m.score || null };
      if (JSON.stringify(next) !== JSON.stringify(m)) { meta[e.id] = next; dirty = true; }
    }
    if (dirty) save(MKEY, meta);
  },
  // Full time seen by the live alerts: `line` is the final scoreline.
  finish(id, line) {
    if (!watched.has(id) || meta[id]?.result === line) return;
    meta[id] = { ...meta[id], final: true, result: line };
    save(MKEY, meta);
  },
  // Watched matches that have ended: marked final, or gone from the feeds after their start time.
  finished(events) {
    if (!events.length) return []; // feeds not loaded yet
    const live = new Set(events.map((e) => e.id)), now = Date.now();
    return [...watched].filter((id) => !live.has(id) && (meta[id]?.final || !meta[id] || meta[id].start < now));
  },
  removeMany(ids) {
    ids.forEach((id) => { watched.delete(id); delete meta[id]; });
    save(WKEY, [...watched]); save(MKEY, meta);
    subs.forEach((f) => f());
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
  watch.remember(events);
  const follow = new Set([...watched, ...slip.legs.map((l) => l.eventId)]);
  if (!follow.size) return [];
  const at = Date.now(), out = [];
  for (const e of events) {
    if (!follow.has(e.id)) continue;
    const now = { ...snapshot(e), checkedAt: at };
    // Live scores of ESPN matches come from the live alerts (with scorer and minute), not from here.
    out.push(...changes(e, seen[e.id], now, at).filter((m) => !(m.kind === 'score' && covers(e))).map((m) => ({ ...m, id: e.id })));
    seen[e.id] = now;
  }
  // Forget matches long gone.
  for (const id of Object.keys(seen)) if (!follow.has(id) && seen[id].start < at - 864e5) delete seen[id];
  save(SKEY, seen);
  out.forEach(notify);
  return out;
}

const ICON = KIND_ICON;
// Matches followed for alerts: starred plus every match in the slip.
export const followed = () => new Set([...watched, ...slip.legs.map((l) => l.eventId)]);
// A live moment (goal, card, half-time, full time): a system notification titled with the scoreline,
// or a toast while ATLAS is in view.
// Android shows the badge in the status bar as a white silhouette, so it must be white on transparent.
const BADGE = 'icons/badge-96.png';
const MOMENT_ICON = { card: '🟨', period: '⏸', final: '🏁' };
const SCORE_ICON = { football: '⚽', hockey: '🏒', baseball: '⚾', basketball: '🏀', americanfootball: '🏈', rugby: '🏉', cricket: '🏏' };
export function showMoment(m) {
  const icon = m.kind === 'card' && /^Red/.test(m.body) ? '🟥' : m.kind === 'score' ? SCORE_ICON[m.sport] || '⚽' : MOMENT_ICON[m.kind] || '•';
  toast({ id: m.id, kind: m.kind, text: `${m.title} · ${m.body}` }, icon);
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body: `${icon} ${m.body}`, icon: 'icons/icon-192.png', badge: BADGE, vibrate: [90, 50, 90], tag: m.key, renotify: true, data: { url: `#/match/${m.id}` } };
  navigator.serviceWorker?.getRegistration().then((r) => (r ? r.showNotification(m.title, opts) : new Notification(m.title, opts))).catch(() => {});
}
export const notifyPermission = () => ('Notification' in window ? Notification.permission : 'unsupported');
export const requestNotify = () => ('Notification' in window ? Notification.requestPermission().catch(() => 'denied') : Promise.resolve('unsupported'));
function toast(m, icon) {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = document.createElement('a');
  t.className = 'toast'; t.href = `#/match/${encodeURIComponent(m.id)}`;
  t.innerHTML = `<span>${icon}</span><p></p>`;
  t.querySelector('p').textContent = m.text;
  box.append(t);
  setTimeout(() => t.classList.add('out'), 7000);
  setTimeout(() => t.remove(), 7600);
}
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
    const opts = { body: m.text, icon: 'icons/icon-192.png', badge: BADGE, tag: `${m.id}:${m.kind}`, data: { url: `#/match/${m.id}` } };
    navigator.serviceWorker?.getRegistration().then((r) => (r ? r.showNotification('ATLAS', opts) : new Notification('ATLAS', opts))).catch(() => {});
  }
}
