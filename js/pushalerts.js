// Alerts while ATLAS is closed (Web Push through the alerts Worker, worker/atlas-alerts.js). The
// browser subscribes once; the Worker keeps the saved matches, the chosen kinds of change, quiet hours
// and the time zone, and pushes when a saved match changes. Off until ALERTS_URL is set.
import { ALERTS_URL } from './config.js';
import { watch } from './alerts.js';
import { alertPrefs } from './livealerts.js';

const ON_KEY = 'atlas-push-on';
const isOn = () => { try { return localStorage.getItem(ON_KEY) === '1'; } catch { return false; } };
export const pushSupported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
export const pushState = () => (!ALERTS_URL ? 'not set up' : !pushSupported() ? 'unsupported' : isOn() ? 'on' : 'off');
const keyBytes = (b64) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };

// The service worker reads the Worker's address from here (it cannot import the site's modules).
const saveConfig = () => caches.open('atlas-config').then((c) => c.put('/alerts-config', new Response(JSON.stringify({ alertsUrl: ALERTS_URL })))).catch(() => {});

async function send(path, subscription) {
  const body = { subscription, watch: watch.ids(), quiet: alertPrefs.get().quiet ?? null, tzOffset: -new Date().getTimezoneOffset() };
  const r = await fetch(`${ALERTS_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`alerts server: HTTP ${r.status}`);
}
export async function enablePush() {
  if (pushState() === 'not set up' || !pushSupported()) return pushState();
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const { key } = await (await fetch(`${ALERTS_URL}/vapid`)).json();
  if (!key) throw new Error('the alerts server has no VAPID key');
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await send('/subscribe', sub.toJSON());
  await saveConfig();
  try { localStorage.setItem(ON_KEY, '1'); } catch { /* storage blocked */ }
  return 'on';
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await send('/unsubscribe', sub.toJSON()).catch(() => {}); await sub.unsubscribe(); }
  try { localStorage.removeItem(ON_KEY); } catch { /* storage blocked */ }
  return 'off';
}
// After the saved matches or quiet hours change: tell the Worker (nothing to do when off).
export async function syncPush() {
  if (pushState() !== 'on') return;
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) await send('/subscribe', sub.toJSON());
  } catch { /* offline or the server is down: the next change tries again */ }
}
