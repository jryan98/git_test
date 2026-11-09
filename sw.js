// Offline support + fast updates.
// - Every file is re-checked with the server on each load ('no-cache': a cheap "not modified" reply when
//   nothing changed), so a new release is picked up immediately instead of after GitHub Pages' 10-minute cache.
// - Offline, the last copy of each file is used.
// - When a new release replaces an older one, open windows are reloaded once so they run the new code.
// Bump CACHE whenever this file changes.
const CACHE = 'gutfuel-v7';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/calc.js', 'js/ibs.js', 'js/units.js', 'js/foods.js', 'js/store.js',
  'js/charts.js', 'js/app.js', 'manifest.webmanifest', 'version.json', 'icons/icon.svg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];

self.addEventListener('install', e => {
  // 'reload' skips the browser's HTTP cache so the offline copy is the current release
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const upgrading = keys.some(k => k.startsWith('gutfuel-') && k !== CACHE);
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    if (upgrading) {
      const wins = await self.clients.matchAll({ type: 'window' });
      wins.forEach(w => w.navigate(w.url).catch(() => {}));
    }
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // page loads ('navigate' requests) can't be copied with new options, so rebuild them from the URL
  const fresh = e.request.mode === 'navigate'
    ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(fetch(fresh).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
