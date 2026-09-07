import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

async function read(relativePath) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return readFile(path, 'utf8');
}

test('PWA V5 precachea shell operativo completo y assets mobile', async () => {
  const sw = await read('../sw.js');

  assert.match(sw, /smart-inventory-v2-shell-38/);

  const requiredAssets = [
    './css/mobile-launch-hardening.css',
    './css/v5-procurement.css',
    './css/v5-saint-report.css',
    './css/v5-reconciliation.css',
    './css/v5-live-supply.css',
    './src/ui/countWorkflowUi.js',
    './src/ui/countReconciliationUi.js',
    './src/ui/liveSupplyUi.js',
    './src/ui/replenishmentWorkflowUi.js',
    './src/ui/saintSupplyReportUi.js',
    './src/documents/countWorkflow.js',
    './src/documents/countWorkflowService.js',
    './src/documents/countReconciliationService.js',
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
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-title" content="VIGÍA"/);
  assert.match(html, /vigia-apple-touch-icon\.png/);
  assert.match(html, /mobile-launch-hardening\.css/);
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
