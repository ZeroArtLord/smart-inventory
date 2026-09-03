const CACHE_NAME = 'smart-inventory-v2-shell-32';

const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './manifest.webmanifest',
  './vendor/xlsx.full.min.js',
  './src/ui/app.js',
  './src/auth/authProvider.js',
  './src/auth/firebaseClient.js',
  './src/auth/authBootstrap.js',
  './src/api/apiClient.js',
  './src/core/mathExpression.js',
  './src/core/ids.js',
  './src/core/catalog.js',
  './src/core/movementTypes.js',
  './src/core/versioning.js',
  './src/catalog/catalogService.js',
  './src/catalog/catalogExcel.js',
  './src/catalog/presentationModel.js',
  './src/catalog/catalogUi.js',
  './src/catalog/catalogImportGuard.js',
  './src/catalog/saintInitialLoad.js',
  './src/storage/database.js',
  './src/sync/localQueue.js',
  './src/sync/syncSettings.js',
  './src/sync/workspaceCache.js',
  './src/sync/remoteApply.js',
  './src/sync/syncEngine.js',
  './src/sync/conflictResolver.js',
  './src/inventory/stockEngine.js',
  './src/inventory/movementService.js',
  './src/inventory/lotEngine.js',
  './src/intelligence/replenishmentEngine.js',
  './src/replenishment/replenishmentService.js',
  './src/scanner/barcodeScanner.js',
  './src/export/exportService.js',
  './src/reporting/reportingEngine.js',
  './src/ui/dashboardService.js',
  './src/admin/adminClient.js',
  './src/audit/auditClient.js',
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

const FIREBASE_RUNTIME_PATHS = new Set([
  '/firebasejs/10.12.5/firebase-app-compat.js',
  '/firebasejs/10.12.5/firebase-auth-compat.js'
]);

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (isApiRequest(url)) {
    return;
  }

  if (isFirebaseRuntimeRequest(url)) {
    event.respondWith(
      networkFirstWithCache(event.request)
    );
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            cacheResponse(
              event.request,
              response.clone()
            );
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(event.request)) ||
          (await caches.match('./index.html')) ||
          caches.match('./')
        )
    );
    return;
  }

  event.respondWith(
    networkFirstWithCache(event.request)
  );
});

async function networkFirstWithCache(request) {
  try {
    const response = await fetch(request);

    if (
      response.ok ||
      response.type === 'opaque'
    ) {
      await cacheResponse(
        request,
        response.clone()
      );
    }

    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheResponse(request, response) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
}

function isApiRequest(url) {
  return (
    url.origin === self.location.origin &&
    url.pathname.startsWith('/api/')
  );
}

function isFirebaseRuntimeRequest(url) {
  return (
    url.origin === 'https://www.gstatic.com' &&
    FIREBASE_RUNTIME_PATHS.has(url.pathname)
  );
}
