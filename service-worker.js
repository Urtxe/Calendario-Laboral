const CACHE_VERSION = 'v1.3.0'; 
const CACHE_NAME = `balance-laboral-${CACHE_VERSION}`;

// Lista actualizada con los nombres de tus archivos reales
const urlsToCache = [
  '/',
  '/index.html',
  '/src/css/main.css', // Corregido: antes era styles.css
  '/src/js/firebase-config.js',
  '/src/js/app/state.js',
  '/src/js/app/calendar.js',
  '/src/js/app/sync.js',
  '/src/js/app/ui.js',
  '/src/js/app/pdf.js',
  '/src/js/analytics.js',
  '/manifest.json',
  '/assets/images/logo.png',
  '/assets/icons/apple-touch-icon.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('📦 Caché abierto');
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
    ))
  );
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
