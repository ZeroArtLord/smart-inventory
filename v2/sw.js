const CACHE_NAME = 'smart-inventory-v2-shell-38';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/vigia-icon.svg',
  './icons/vigia-maskable.svg',
  './icons/vigia-apple-touch-icon.png',
  './icons/vigia-192.png',
  './icons/vigia-512.png',
  './icons/vigia-512-maskable.png',
  './css/app.css',
  './css/v5-procurement.css',
  './css/v5-saint-report.css',
  './css/v5-reconciliation.css',
  './css/v5-live-supply.css',
  './css/mobile-launch-hardening.css',
  './vendor/xlsx.full.min.js',
  './src/ui/app.js',
  './src/ui/vigiaIntelligenceUi.js',
  './src/ui/countWorkflowUi.js',
  './src/ui/countReconciliationUi.js',
  './src/ui/liveSupplyUi.js',
  './src/ui/replenishmentWorkflowUi.js',
  './src/ui/saintSupplyReportUi.js',
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
  './src/intelligence/demandLearning.js',
  './src/intelligence/intelligenceExplanation.js',
  './src/replenishment/replenishmentService.js',
  './src/replenishment/warehouseProcurementService.js',
  './src/scanner/barcodeScanner.js',
  './src/export/exportService.js',
  './src/export/saintSupplyExport.js',
  './src/reporting/reportingEngine.js',
  './src/ui/dashboardService.js',
  './src/admin/adminClient.js',
  './src/audit/auditClient.js',
  './src/documents/documentTypes.js',
  './src/documents/documentService.js',
  './src/documents/countWorkflow.js',
  './src/documents/countWorkflowService.js',
  './src/documents/countReconciliationService.js',
  './src/documents/liveSupplyService.js',
  './src/documents/supplyReportContextService.js'
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
