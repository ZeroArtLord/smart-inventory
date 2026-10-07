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

test('bootstrap REFRESCO 350 es preview por defecto y no toca movimientos', async () => {
  const source = await read('../server/scripts/configureRefresco350Bridge.js');

  assert.match(source, /const apply = args\.has\('--apply'\)/);
  assert.match(source, /PREVIEW OK/);
  assert.match(source, /CATALOG_ONLY_NO_STOCK_MOVEMENTS/);
  assert.doesNotMatch(source, /INSERT INTO movements/i);
  assert.doesNotMatch(source, /DELETE FROM movements/i);
  assert.match(source, /saint_bridge_source = true/);
  assert.match(source, /SET active = false/);
});

test('migración del puente es aditiva y conserva unicidad saint_code existente', async () => {
  const migration = await read('../server/migrations/014_product_saint_bridge.sql');
  const originalSaint = await read('../server/migrations/012_product_saint_code.sql');

  assert.match(migration, /ADD COLUMN IF NOT EXISTS saint_bridge_source/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS saint_bridge_source_product_id/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS saint_bridge_code/);
  assert.doesNotMatch(migration, /DROP COLUMN/i);
  assert.match(originalSaint, /CREATE UNIQUE INDEX IF NOT EXISTS uq_products_workspace_saint_code/);
});

test('el guard SAINT carga antes de la conciliación y captura cierre sin borrar el borrador', async () => {
  const [html, ui, service] = await Promise.all([
    read('../index.html'),
    read('../src/ui/saintBridgeUi.js'),
    read('../src/documents/saintBridgeReclassificationService.js')
  ]);

  assert.ok(
    html.indexOf('saintBridgeUi.js') < html.indexOf('countReconciliationUi.js')
  );
  assert.match(ui, /submitCountWithSaintBridge/);
  assert.match(ui, /stopImmediatePropagation/);
  assert.match(ui, /data-v5-bridge-action="apply"/);
  assert.match(service, /submitCountForReconciliation\(documentId/);
  assert.doesNotMatch(service, /delete\(.*DOCUMENT_LINES/i);
  assert.doesNotMatch(service, /clear\(.*DOCUMENT_LINES/i);
});

test('reclasificación SAINT crea solo ajustes trazables dentro de una transacción local', async () => {
  const service = await read('../src/documents/saintBridgeReclassificationService.js');

  assert.match(service, /runTransaction\(/);
  assert.match(service, /SAINT_BRIDGE_RECLASSIFICATION_KIND/);
  assert.match(service, /type:\s*MOVEMENT_TYPES\.ADJUSTMENT/);
  assert.match(service, /authorizedRole:\s*'GOD'/);
  assert.match(service, /sourceTargetStock:\s*0/);
  assert.match(service, /falta conteo físico\. No se reclasificó nada/);
});

test('sync protege el puente SAINT con valores canónicos PostgreSQL', async () => {
  const sync = await read('../server/src/routes/sync.js');

  assert.match(sync, /canonicalizeProtectedProductBridgeFields/);
  assert.match(sync, /saint_bridge_source_product_id/);
  assert.match(sync, /saintBridgeCode:\s*row\.saint_bridge_code/);
});
