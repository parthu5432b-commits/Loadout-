/* Loadout shell cache; bump on every release to invalidate stale navigation/data scripts. */
const CACHE = 'loadout-jee-2027-shell-v8-runtime';
const SHELL = [
  './', './index.html', './runtime/loadout-runtime.js', './app.js', './physics-history.js', './chemistry-history.js', './mathematics-history.js',
  './manifest.webmanifest', './assets/icon-192.png', './assets/icon-512.png',
  './data/physics_historical_trends.json', './data/chemistry_historical_trends.json', './data/mathematics_historical_trends.json', './data/excluded_topics.json', './data/source_audit.json'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(response => {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(req, copy));
    }
    return response;
  }).catch(() => caches.match('./index.html'))));
});
