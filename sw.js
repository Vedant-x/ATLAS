// ATLAS service worker: makes the site installable and fast to reopen. The app shell is cached per
// build (the build stamps BUILD), match data is always fetched fresh with the last copy as an
// offline fallback, and other sites (live feeds, fonts, AI model files) are left to the browser.
const BUILD = '__BUILD__';
const SHELL = `atlas-shell-${BUILD}`;
const DATA = 'atlas-data';
const CORE = ['./', 'index.html', 'js/main.js', 'vendor/gsap.min.js', 'manifest.webmanifest', 'favicon.svg']; // the rest is cached as it's used

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('atlas-shell-') && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/vendor/web-llm.mjs')) return; // large, versioned by the browser cache
  if (url.pathname.includes('/data/')) {
    // Network first: always the newest snapshot. Only a good response is kept, under the file's
    // name without the ?t= cache-buster, so the last good copy is served when the network or the
    // server fails (an error page is never cached in its place).
    const key = new Request(url.origin + url.pathname);
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(key, copy)); return res; }
      return caches.open(DATA).then((c) => c.match(key)).then((hit) => hit || res);
    }).catch(() => caches.open(DATA).then((c) => c.match(key)).then((hit) => hit || Response.error())));
    return;
  }
  // App shell: cache first for this build, filled as files are used.
  e.respondWith(caches.open(SHELL).then((c) => c.match(req, { ignoreSearch: url.pathname.endsWith('/') || url.pathname.endsWith('index.html') }).then((hit) => hit || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }))));
});
// Tapping an alert opens (or focuses) ATLAS on that match.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(`./${e.notification.data?.url || ''}`, self.registration.scope).href;
  // Bring the open app forward on that match (Android: the installed app or a Chrome tab), or open it.
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.focused) || cs.find((x) => x.visibilityState === 'visible') || cs[0];
    if (!c) return self.clients.openWindow(url);
    return c.focus().then((w) => (w || c).navigate(url)).catch(() => self.clients.openWindow(url));
  }));
});

// Alerts while ATLAS is closed (js/pushalerts.js, worker/atlas-alerts.js): the push carries no data;
// the waiting messages for this subscription are fetched from the alerts Worker and shown, each once
// (tagged by its change id). A browser must show something for every push: if the messages can't be
// read, a short note opens the watchlist.
const subIdOf = async (endpoint) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)))].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    try {
      const cfg = await (await caches.open('atlas-config')).match('/alerts-config').then((r) => r && r.json());
      const sub = await self.registration.pushManager.getSubscription();
      if (!cfg?.alertsUrl || !sub) throw new Error('not configured');
      const { messages = [] } = await (await fetch(`${cfg.alertsUrl}/pending?id=${await subIdOf(sub.endpoint)}`)).json();
      if (!messages.length) throw new Error('nothing waiting');
      await Promise.all(messages.slice(-5).map((m) => self.registration.showNotification(m.title, { body: m.body, tag: m.id, icon: 'icons/icon-192.png', data: { url: m.url } })));
    } catch {
      await self.registration.showNotification('ATLAS', { body: 'A saved match changed.', tag: 'atlas-generic', icon: 'icons/icon-192.png', data: { url: '#/watchlist' } });
    }
  })());
});
