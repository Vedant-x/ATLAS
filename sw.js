// ATLAS service worker: makes the site installable and fast to reopen. The app shell is cached per
// build (the build stamps BUILD), match data is always fetched fresh with the last copy as an
// offline fallback, and other sites (live feeds, fonts, AI model files) are left to the browser.
const BUILD = '__BUILD__';
const SHELL = `atlas-shell-${BUILD}`;
const DATA = 'atlas-data';
const CORE = ['./', 'index.html', 'css/style.css', 'js/main.js', 'vendor/gsap.min.js', 'vendor/three.module.js', 'manifest.webmanifest', 'favicon.svg'];

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
    // Network first: always the newest snapshot; the last one if offline.
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(DATA).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req)));
    return;
  }
  // App shell: cache first for this build, filled as files are used.
  e.respondWith(caches.open(SHELL).then((c) => c.match(req, { ignoreSearch: url.pathname.endsWith('/') || url.pathname.endsWith('index.html') }).then((hit) => hit || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }))));
});
// Tapping an alert opens (or focuses) ATLAS on that match.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(`./${e.notification.data?.url || ''}`, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => { const c = cs[0]; return c ? c.navigate(url).then((w) => w?.focus()) : self.clients.openWindow(url); }));
});
