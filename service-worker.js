const CACHE_VERSION = 'v2.0.2';
const SHELL_CACHE = `balance-laboral-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `balance-laboral-static-${CACHE_VERSION}`;
const APP_BASE = new URL('./', self.location);

const APP_SHELL_URLS = [
  './',
  'index.html',
  'manifest.json',
  'src/css/main.css',
  'src/css/base/_variables.css',
  'src/css/base/_reset.css',
  'src/css/base/_nightMode.css',
  'src/css/layout/_header.css',
  'src/css/layout/_container.css',
  'src/css/layout/_grid.css',
  'src/css/components/_card.css',
  'src/css/components/_button.css',
  'src/css/components/_badge.css',
  'src/css/components/_form.css',
  'src/css/components/_modal.css',
  'src/js/firebase-config.js',
  'src/js/app/state.js',
  'src/js/app/calendar.js',
  'src/js/app/sync.js',
  'src/js/app/ui.js',
  'src/js/app/pdf.js',
  'src/js/analytics.js',
  'assets/images/logo.png',
  'assets/icons/favicon-32.png',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-192.png',
  'assets/icons/icon-maskable-512.png'
].map(path => new URL(path, APP_BASE).href);

const DYNAMIC_PATHS = new Set([
  '/consultarConvenio',
  '/webhook'
]);

const DYNAMIC_HOST_PARTS = [
  'accounts.google.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebase.googleapis.com',
  'google-analytics.com',
  'googletagmanager.com',
  'stripe.com'
];

const STATIC_EXTENSIONS = [
  '.css',
  '.js',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
  '.ico',
  '.woff',
  '.woff2'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(APP_SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => Promise.all(
      cacheNames
        .filter(cacheName => cacheName.startsWith('balance-laboral-'))
        .filter(cacheName => ![SHELL_CACHE, STATIC_CACHE].includes(cacheName))
        .map(cacheName => caches.delete(cacheName))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isDynamicRequest(url, request)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.origin === self.location.origin && isStaticAsset(url)) {
    event.respondWith(cacheFirstStatic(request));
  }
});

function isDynamicRequest(url, request) {
  if (request.headers.has('Authorization')) return true;
  if (DYNAMIC_PATHS.has(url.pathname)) return true;
  return DYNAMIC_HOST_PARTS.some(hostPart => url.hostname.includes(hostPart));
}

function isStaticAsset(url) {
  return STATIC_EXTENSIONS.some(extension => url.pathname.endsWith(extension));
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(new URL('index.html', APP_BASE).href, response.clone());
    }
    return response;
  } catch (error) {
    return caches.match(request, { ignoreSearch: true })
      .then(response => response || caches.match(new URL('index.html', APP_BASE).href));
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

function isCacheableResponse(response) {
  return response && response.ok && response.type === 'basic';
}
