import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

import { buildAreaConsumptionReport } from '../src/reporting/areaConsumptionReport.js';

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

test('area report distributes known lot cost proportionally without duplicating stock', () => {
  const report = buildAreaConsumptionReport({
    areaDeliveries: [{
      id: 'delivery-token-1',
      status: 'CLOSED',
      deliveryId: 'delivery-1',
      closedAt: '2026-09-10T12:00:00.000Z',
      rows: [{
        productId: 'soap',
        productName: 'Jabón',
        quantity: 5,
        allocations: [
          { areaId: 'cocina', areaName: 'Cocina', quantity: 2 },
          { areaId: 'barra', areaName: 'Barra', quantity: 3 }
        ]
      }]
    }],
    movements: [
      { id: 'm1', type: 'SUPPLY', documentId: 'delivery-1', productId: 'soap', quantity: 2, lotId: 'l1' },
      { id: 'm2', type: 'SUPPLY', documentId: 'delivery-1', productId: 'soap', quantity: 3, lotId: 'l2' }
    ],
    lots: [
      { id: 'l1', unitCost: 10 },
      { id: 'l2', unitCost: 20 }
    ],
    products: [{ id: 'soap', name: 'Jabón' }],
    areas: [
      { id: 'cocina', name: 'Cocina', active: true },
      { id: 'barra', name: 'Barra', active: true }
    ],
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-30T23:59:59.999Z'
  });

  assert.equal(report.deliveryCount, 1);
  assert.equal(report.trackedDeliveryLines, 1);
  assert.equal(report.knownCost, 80);
  assert.equal(report.costCoveragePercent, 100);

  const cocina = report.rows.find(row => row.areaId === 'cocina');
  const barra = report.rows.find(row => row.areaId === 'barra');
  assert.equal(cocina.knownCost, 32);
  assert.equal(barra.knownCost, 48);
  assert.equal(cocina.quantity + barra.quantity, 5);
});

test('reversed supply movement is excluded from area spend', () => {
  const report = buildAreaConsumptionReport({
    areaDeliveries: [{
      id: 't2', status: 'CLOSED', deliveryId: 'd2', closedAt: '2026-09-10T12:00:00.000Z',
      rows: [{ productId: 'p', productName: 'P', quantity: 1, allocations: [{ areaId: 'a', areaName: 'A', quantity: 1 }] }]
    }],
    movements: [
      { id: 'm-original', type: 'SUPPLY', documentId: 'd2', productId: 'p', quantity: 1, lotId: 'lot' },
      { id: 'm-reversal', type: 'REVERSAL', reversedMovementId: 'm-original', quantity: 1 }
    ],
    lots: [{ id: 'lot', unitCost: 50 }]
  });

  assert.equal(report.knownCost, 0);
  assert.equal(report.costCoveragePercent, 0);
});

test('IndexedDB v9 exposes area catalog and area-delivery stores', async () => {
  const databaseModule = await import(`../src/storage/database.js?areas-v7=${Date.now()}`);
  const db = await databaseModule.openDatabase();
  assert.equal(db.objectStoreNames.contains('areas'), true);
  assert.equal(db.objectStoreNames.contains('supplyAreaDeliveries'), true);
});

test('UI contract fixes sticky summary overlap and loads area modules', async () => {
  const [css, index, sw, route, migration] = await Promise.all([
    fs.readFile(new URL('../css/v7-supply-areas.css', import.meta.url), 'utf8'),
    fs.readFile(new URL('../index.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('../sw.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../server/src/routes/areas.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../server/migrations/015_supply_areas.sql', import.meta.url), 'utf8')
  ]);

  assert.match(css, /document-summary-column\{position:static!important/);
  assert.match(css, /v5-live-supply-panel\{grid-column:1!important/);
  assert.match(index, /v7-supply-areas\.css/);
  assert.match(index, /supplyAreaUi\.js/);
  assert.match(index, /areaWorkspaceUi\.js/);
  assert.match(sw, /smart-inventory-v2-shell-49/);
  assert.match(route, /SUPPLY_AREA_ALLOCATION_RECORDED/);
  assert.match(route, /PERMISSIONS\.SUPPLY_WRITE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS supply_area_deliveries/);
});
