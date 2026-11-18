const CACHE = 'tradelog-shell-v55';
const base = new URL('./', self.location.href);
const shell = ['.', 'index.html', 'styles.css?v=41', 'liquid-glass.css?v=2', 'cloud-config.js', 'cloud-client.js?v=2', 'app.js?v=52', 'tools.js?v=24', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'chess-logo.png'].map(path => new URL(path, base).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(shell)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  if (url.pathname.includes('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(new URL('index.html', base), response.clone()));
      return response;
    }).catch(() => caches.match(new URL('index.html', base))));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});



