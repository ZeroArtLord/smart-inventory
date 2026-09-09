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

test('PWA V6 precachea shell operativo completo y assets mobile reales', async () => {
  const sw = await read('../sw.js');

  assert.match(sw, /smart-inventory-v2-shell-46/);

  const requiredAssets = [
    './css/mobile-launch-hardening.css',
    './css/v5-procurement.css',
    './css/v6-procurement.css',
    './css/v6-procurement-hardening.css',
    './css/v6-thermal-printer.css',
    './css/v6-catalog-category-filter.css',
    './css/v5-saint-report.css',
    './css/v5-reconciliation.css',
    './css/v5-live-supply.css',
    './css/v5-saint-bridge.css',
    './css/v5-quick-stock.css',
    './src/ui/countWorkflowUi.js',
    './src/ui/saintBridgeUi.js',
    './src/ui/countReconciliationUi.js',
    './src/ui/countReconciliationBulkUi.js',
    './src/ui/liveSupplyUi.js',
    './src/ui/quickStockCorrectionUi.js',
    './src/ui/quickStockCorrectionRefreshUi.js',
    './src/ui/procurementWorkspaceV6Ui.js',
    './src/ui/procurementWorkspaceV6Render.js',
    './src/ui/procurementWorkspaceV6Print.js',
    './src/ui/thermalPrinterSettingsUi.js',
    './src/ui/thermalDirectPrintUi.js',
    './src/ui/catalogCategoryFilterUi.js',
    './src/ui/saintSupplyReportUi.js',
    './src/printing/thermalPrinterClient.js',
    './src/catalog/saintBridge.js',
    './src/inventory/quickStockCorrectionService.js',
    './src/documents/countWorkflow.js',
    './src/documents/countWorkflowService.js',
    './src/documents/countReconciliationService.js',
    './src/documents/countReconciliationBulkService.js',
    './src/documents/saintBridgeReclassificationService.js',
    './src/documents/liveSupplyService.js',
    './src/documents/supplyReportContextService.js',
    './src/replenishment/warehouseProcurementService.js',
    './src/replenishment/procurementListService.js',
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

  assert.equal(
    sw.includes("'./src/ui/replenishmentWorkflowUi.js'"),
    false,
    'El shell V6 no debe seguir cargando la UI legacy de reposición'
  );
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

test('index incluye hardening, impresión térmica y filtro de catálogo por categoría', async () => {
  const html = await read('../index.html');

  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-title" content="VIGÍA"/);
  assert.match(html, /vigia-apple-touch-icon\.png/);
  assert.match(html, /mobile-launch-hardening\.css/);
  assert.match(html, /v5-saint-bridge\.css/);
  assert.match(html, /v5-quick-stock\.css/);
  assert.match(html, /v6-procurement\.css/);
  assert.match(html, /v6-procurement-hardening\.css/);
  assert.match(html, /v6-thermal-printer\.css/);
  assert.match(html, /v6-catalog-category-filter\.css/);
  assert.match(html, /procurementWorkspaceV6Ui\.js/);
  assert.match(html, /thermalPrinterSettingsUi\.js/);
  assert.match(html, /thermalDirectPrintUi\.js/);
  assert.match(html, /catalogCategoryFilterUi\.js/);
  assert.equal(
    html.includes('replenishmentWorkflowUi.js'),
    false,
    'index no debe cargar la UI legacy de Comprar/Pedir'
  );
  assert.match(html, /countReconciliationBulkUi\.js/);
  assert.match(html, /quickStockCorrectionUi\.js/);
  assert.match(html, /quickStockCorrectionRefreshUi\.js/);
  assert.ok(
    html.indexOf('saintBridgeUi.js') < html.indexOf('countReconciliationUi.js'),
    'El guard del puente SAINT debe cargar antes de la conciliación legacy'
  );
  assert.ok(
    html.indexOf('countReconciliationUi.js') < html.indexOf('countReconciliationBulkUi.js'),
    'La UI masiva debe extender la conciliación base después de cargarla'
  );
  assert.ok(
    html.indexOf('liveSupplyUi.js') < html.indexOf('quickStockCorrectionUi.js'),
    'La corrección rápida debe extender el surtido vivo después de cargarlo'
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

test('hardening V6 mantiene tarjetas visibles, barra sobre navegación y ticket 80mm imprimible', async () => {
  const css = await read('../css/v6-procurement-hardening.css');

  assert.match(css, /left:\s*calc\(var\(--sidebar-width\)/);
  assert.match(css, /top:\s*72px/);
  assert.match(css, /top:\s*calc\(64px \+ env\(safe-area-inset-top\)\)/);
  assert.match(css, /bottom:\s*calc\(72px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /padding-bottom:\s*calc\(170px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /#v6pPrintModal/);
  assert.match(css, /width:\s*80mm !important/);
  assert.match(css, /page-break-after:\s*always/);
  assert.equal(
    css.includes('body>*:not(.v6p-print-host)'),
    false,
    'La impresión no debe depender de un host inexistente'
  );
});
