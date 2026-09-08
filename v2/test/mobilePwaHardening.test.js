import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function resolve(relativePath) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function read(relativePath) {
  return readFile(resolve(relativePath), 'utf8');
}

async function readBinary(relativePath) {
  return readFile(resolve(relativePath));
}

test('PWA V5 precachea shell operativo completo y assets mobile reales', async () => {
  const sw = await read('../sw.js');

  assert.match(sw, /smart-inventory-v2-shell-41/);

  const requiredAssets = [
    './css/mobile-launch-hardening.css',
    './css/v5-procurement.css',
    './css/v5-saint-report.css',
    './css/v5-reconciliation.css',
    './css/v5-live-supply.css',
    './css/v5-saint-bridge.css',
    './src/ui/countWorkflowUi.js',
    './src/ui/saintBridgeUi.js',
    './src/ui/countReconciliationUi.js',
    './src/ui/countReconciliationBulkUi.js',
    './src/ui/liveSupplyUi.js',
    './src/ui/replenishmentWorkflowUi.js',
    './src/ui/saintSupplyReportUi.js',
    './src/catalog/saintBridge.js',
    './src/documents/countWorkflow.js',
    './src/documents/countWorkflowService.js',
    './src/documents/countReconciliationService.js',
    './src/documents/countReconciliationBulkService.js',
    './src/documents/saintBridgeReclassificationService.js',
    './src/documents/liveSupplyService.js',
    './src/documents/supplyReportContextService.js',
    './src/replenishment/warehouseProcurementService.js',
    './src/export/saintSupplyExport.js',
    './icons/vigia-apple-touch-icon.png',
    './icons/vigia-192.png',
    './icons/vigia-512.png',
    './icons/vigia-512-maskable.png'
  ];

  for (const asset of requiredAssets) {
    assert.ok(sw.includes(`'${asset}'`), `Falta en APP_SHELL: ${asset}`);
    const bytes = await readBinary(`../${asset.slice(2)}`);
    assert.ok(bytes.length > 0, `Asset vacío o inexistente: ${asset}`);
  }
});

test('recarga normal permite Firebase a través del service worker y revalida shell', async () => {
  const server = await read('../server/src/app.js');
  const sw = await read('../sw.js');

  assert.ok(
    server.includes("'https://www.gstatic.com'"),
    'CSP debe permitir conexión del service worker a Firebase runtime'
  );
  assert.ok(
    server.includes("app.get(['/', '/index.html']"),
    'index debe tener ruta explícita para política de revalidación'
  );
  assert.ok(
    server.includes("res.set('Cache-Control', 'no-cache, must-revalidate')"),
    'index debe revalidarse en recargas normales'
  );
  assert.ok(
    server.includes("app.get('/sw.js'"),
    'service worker debe tener ruta explícita'
  );
  assert.ok(
    server.includes("no-cache, no-store, must-revalidate"),
    'service worker no debe quedar congelado por HTTP cache'
  );
  assert.ok(
    sw.includes("url.origin === 'https://www.gstatic.com'"),
    'service worker debe reconocer Firebase runtime'
  );
  assert.ok(
    sw.includes('networkFirstWithCache(event.request)'),
    'Firebase runtime debe conservar fallback cacheado después de una carga online'
  );
});

test('iconos PNG de instalación tienen firma PNG válida', async () => {
  const signature = '89504e470d0a1a0a';
  const icons = [
    '../icons/vigia-apple-touch-icon.png',
    '../icons/vigia-192.png',
    '../icons/vigia-512.png',
    '../icons/vigia-512-maskable.png'
  ];

  for (const icon of icons) {
    const bytes = await readBinary(icon);
    assert.equal(
      bytes.subarray(0, 8).toString('hex'),
      signature,
      `Firma PNG inválida: ${icon}`
    );
  }
});

test('manifest VIGÍA es instalable y declara iconos PNG + maskable', async () => {
  const manifest = JSON.parse(await read('../manifest.webmanifest'));

  assert.equal(manifest.name, 'VIGÍA - Inventory Intelligence');
  assert.equal(manifest.short_name, 'VIGÍA');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'any');
  assert.equal(manifest.prefer_related_applications, false);

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  assert.ok(
    icons.some(icon => icon.src === './icons/vigia-192.png' && icon.sizes === '192x192'),
    'Falta icono PNG 192x192'
  );
  assert.ok(
    icons.some(icon => icon.src === './icons/vigia-512.png' && icon.sizes === '512x512'),
    'Falta icono PNG 512x512'
  );
  assert.ok(
    icons.some(icon => icon.src === './icons/vigia-512-maskable.png' && icon.purpose === 'maskable'),
    'Falta icono maskable'
  );
});

test('index incluye hardening de iOS, viewport seguro y CSS mobile final', async () => {
  const html = await read('../index.html');

  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-title" content="VIGÍA"/);
  assert.match(html, /vigia-apple-touch-icon\.png/);
  assert.match(html, /mobile-launch-hardening\.css/);
  assert.match(html, /v5-saint-bridge\.css/);
  assert.match(html, /countReconciliationBulkUi\.js/);
  assert.ok(
    html.indexOf('saintBridgeUi.js') < html.indexOf('countReconciliationUi.js'),
    'El guard del puente SAINT debe cargar antes de la conciliación legacy'
  );
  assert.ok(
    html.indexOf('countReconciliationUi.js') < html.indexOf('countReconciliationBulkUi.js'),
    'La UI masiva debe extender la conciliación base después de cargarla'
  );
});

test('hardening mobile protege safe areas, zoom iOS, touch targets y overflow', async () => {
  const css = await read('../css/mobile-launch-hardening.css');

  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /--vigia-touch-min:\s*44px/);
  assert.match(css, /font-size:\s*16px/);
  assert.match(css, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(css, /overscroll-behavior-x:\s*contain/);
  assert.match(css, /\.v5-live-finalize-button/);
  assert.match(css, /\.v5-recon-line-actions button/);
  assert.match(css, /\.v5-count-actions button/);
});
