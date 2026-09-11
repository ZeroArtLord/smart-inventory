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
