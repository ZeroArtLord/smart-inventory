const CACHE_NAME = 'smart-inventory-v2-shell-4';

const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './manifest.webmanifest',
  './vendor/xlsx.full.min.js',
  './src/ui/app.js',
  './src/core/mathExpression.js',
  './src/core/ids.js',
  './src/core/catalog.js',
  './src/core/movementTypes.js',
  './src/catalog/catalogService.js',
  './src/catalog/catalogExcel.js',
  './src/storage/database.js',
  './src/sync/localQueue.js',
  './src/sync/syncSettings.js',
  './src/sync/remoteApply.js',
  './src/sync/syncEngine.js',
  './src/inventory/stockEngine.js',
  './src/inventory/movementService.js',
  './src/intelligence/replenishmentEngine.js',
  './src/documents/documentTypes.js',
  './src/documents/documentService.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
