import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

test('V8.5 IndexedDB conserva borradores de reparto entre recargas', async () => {
  const databaseModule = await import(`../src/storage/database.js?v85-area-drafts=${Date.now()}`);
  const db = await databaseModule.openDatabase();

  assert.equal(db.version, 10);
  assert.equal(db.objectStoreNames.contains('supplyAreaDrafts'), true);
});

test('V8.5 guarda y vuelve a leer un reparto pendiente desde IndexedDB', async () => {
  const {
    saveAreaAllocationDraft,
    loadAreaAllocationDrafts
  } = await import('../src/areas/supplyAreaDeliveryService.js');

  const parentCartId = `supply-local-${Date.now()}`;
  await saveAreaAllocationDraft({
    parentCartId,
    productId: 'bags-60',
    productName: 'BOLSAS DE 60 LT',
    quantity: 4,
    allocations: [
      { areaId: 'cafeteria', areaName: 'Cafetería', quantity: 2 },
      { areaId: 'mantenimiento', areaName: 'Mantenimiento', quantity: 2 }
    ]
  }, { sync: false });

  const restored = await loadAreaAllocationDrafts(parentCartId, { refresh: false });
  assert.equal(restored.length, 1);
  assert.equal(restored[0].productId, 'bags-60');
  assert.equal(restored[0].quantity, 4);
  assert.deepEqual(restored[0].allocations, [
    { areaId: 'cafeteria', areaName: 'Cafetería', quantity: 2 },
    { areaId: 'mantenimiento', areaName: 'Mantenimiento', quantity: 2 }
  ]);
  assert.equal(restored[0].syncStatus, 'PENDING');
});

test('V8.5 servidor persiste borradores de reparto por surtido y producto', async () => {
  const [route, migrations] = await Promise.all([
    fs.readFile(new URL('../server/src/routes/areas.js', import.meta.url), 'utf8'),
    fs.readdir(new URL('../server/migrations/', import.meta.url))
  ]);

  assert.ok(
    migrations.includes('016_supply_area_drafts.sql'),
    'Falta migración PostgreSQL para borradores de reparto'
  );
  assert.match(route, /\/drafts/);
  assert.match(route, /SUPPLY_AREA_DRAFT_SAVED/);
  assert.match(route, /SUPPLY_AREA_DRAFT_DELETED/);
  assert.match(route, /PERMISSIONS\.SUPPLY_WRITE/);

  const ownershipCalls = route.match(/assertOperationalDocumentOwnership/g) || [];
  assert.ok(
    ownershipCalls.length >= 4,
    'GET/PUT/DELETE de borradores deben pasar por ownership operativo'
  );
  assert.match(route, /expectedType:\s*['"]SUPPLY['"]/);
});

test('V8.5 cliente autoguarda y restaura reparto desde servidor con copia local', async () => {
  const [ui, service] = await Promise.all([
    fs.readFile(new URL('../src/ui/supplyAreaUi.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/areas/supplyAreaDeliveryService.js', import.meta.url), 'utf8')
  ]);

  for (const contract of [
    'loadAreaAllocationDrafts',
    'saveAreaAllocationDraft',
    'deleteAreaAllocationDrafts'
  ]) {
    assert.ok(service.includes(`export async function ${contract}`), `Falta servicio ${contract}`);
    assert.ok(ui.includes(contract), `La UI no usa ${contract}`);
  }

  assert.match(service, /STORES\.SUPPLY_AREA_DRAFTS/);
  assert.match(service, /\/api\/v1\/areas\/drafts/);
  assert.match(ui, /Guardando/);
  assert.match(ui, /Guardado/);
  assert.match(ui, /Pendiente de sincronizar/);
});

test('V8.5 una entrega exitosa limpia solo los borradores de productos entregados', async () => {
  const ui = await fs.readFile(
    new URL('../src/ui/supplyAreaUi.js', import.meta.url),
    'utf8'
  );

  assert.match(ui, /completeAreaDelivery/);
  assert.match(ui, /deleteAreaAllocationDrafts/);
  assert.match(ui, /productIds/);
  assert.match(ui, /parentCartId:\s*documentId/);
});