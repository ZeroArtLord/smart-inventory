import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as areaDelivery from '../src/areas/supplyAreaDeliveryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appSource = fs.readFileSync(path.resolve(__dirname, '../src/ui/app.js'), 'utf8');
const cssSource = fs.readFileSync(path.resolve(__dirname, '../css/v7-supply-areas.css'), 'utf8');
const swSource = fs.readFileSync(path.resolve(__dirname, '../sw.js'), 'utf8');

test('V8.6 acumula la misma área cuando el mismo producto se agrega varias veces', () => {
  assert.equal(
    typeof areaDelivery.mergeQuickAreaAllocation,
    'function',
    'falta mergeQuickAreaAllocation para acumular destino rápido'
  );

  const draft = areaDelivery.mergeQuickAreaAllocation({
    existingDraft: {
      parentCartId: 'supply-1',
      productId: 'prod-1',
      productName: 'ORASI AVELLANA',
      quantity: 5,
      allocations: [
        { areaId: 'cafeteria', areaName: 'Cafetería', quantity: 3 }
      ]
    },
    parentCartId: 'supply-1',
    productId: 'prod-1',
    productName: 'ORASI AVELLANA',
    totalQuantity: 7,
    addedQuantity: 2,
    area: { id: 'cafeteria', name: 'Cafetería' }
  });

  assert.equal(draft.quantity, 7);
  assert.deepEqual(draft.allocations, [
    { areaId: 'cafeteria', areaName: 'Cafetería', quantity: 5 }
  ]);
});

test('V8.6 conserva áreas previas y deja sin asignar una adición cuando no se marca destino', () => {
  assert.equal(typeof areaDelivery.mergeQuickAreaAllocation, 'function');

  const draft = areaDelivery.mergeQuickAreaAllocation({
    existingDraft: {
      parentCartId: 'supply-1',
      productId: 'prod-1',
      productName: 'ORASI AVELLANA',
      quantity: 5,
      allocations: [
        { areaId: 'barra', areaName: 'Barra', quantity: 2 }
      ]
    },
    parentCartId: 'supply-1',
    productId: 'prod-1',
    productName: 'ORASI AVELLANA',
    totalQuantity: 8,
    addedQuantity: 3,
    area: null
  });

  assert.equal(draft.quantity, 8);
  assert.deepEqual(draft.allocations, [
    { areaId: 'barra', areaName: 'Barra', quantity: 2 }
  ]);
});

test('V8.6 muestra todas las áreas como botones rápidos opcionales y conserva Enter', () => {
  assert.match(appSource, /data-action=\\"select-quick-supply-area\\"/);
  assert.match(appSource, /data-quick-supply-area/);
  assert.match(appSource, /selectedSupplyAreaId/);
  assert.match(appSource, /operationQuantity[\\s\\S]*addOperationLine/);
  assert.match(cssSource, /v86-quick-area-grid/);
  assert.match(cssSource, /v86-quick-area-button/);
  assert.match(swSource, /smart-inventory-v2-shell-55/);
});
