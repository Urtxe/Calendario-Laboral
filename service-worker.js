const CACHE_VERSION = 'v1.4.3'; 
const CACHE_NAME = `balance-laboral-${CACHE_VERSION}`;
const APP_BASE = new URL('./', self.location);

// Lista actualizada con los nombres de tus archivos reales
const urlsToCache = [
  new URL('./', APP_BASE).href,
  new URL('index.html', APP_BASE).href,
  new URL('src/css/main.css', APP_BASE).href,
  new URL('src/js/firebase-config.js', APP_BASE).href,
  new URL('src/js/app/state.js', APP_BASE).href,
  new URL('src/js/app/calendar.js', APP_BASE).href,
  new URL('src/js/app/sync.js', APP_BASE).href,
  new URL('src/js/app/ui.js', APP_BASE).href,
  new URL('src/js/app/pdf.js', APP_BASE).href,
  new URL('src/js/analytics.js', APP_BASE).href,
  new URL('manifest.json', APP_BASE).href,
  new URL('assets/images/logo.png', APP_BASE).href,
  new URL('assets/icons/apple-touch-icon.png', APP_BASE).href,
  new URL('assets/icons/icon-192.png', APP_BASE).href,
  new URL('assets/icons/icon-512.png', APP_BASE).href
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('📦 Caché abierto');
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
    ))
  );
  self.clients.claim();
});

// Estrategia: Network First (Red primero, si falla, usa el caché)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
