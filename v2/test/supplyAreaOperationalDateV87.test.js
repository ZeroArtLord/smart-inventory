import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const {
  createAreaDeliveryIntent
} = await import('../src/areas/supplyAreaDeliveryService.js');
const {
  buildAreaConsumptionReport
} = await import('../src/reporting/areaConsumptionReport.js');

test('V8.7 la intención de reparto conserva fecha operativa y no permite cambiarla con el mismo token', async () => {
  const token = `v87-area-${Date.now()}-${Math.random()}`;
  const base = {
    deliveryToken: token,
    parentCartId: 'sur-parent-v87',
    operationalDate: '2026-09-12',
    rows: [{
      productId: 'p-v87',
      productName: 'Producto V87',
      quantity: 2,
      allocations: [{
        areaId: 'barra',
        areaName: 'Barra',
        quantity: 2
      }]
    }],
    userId: 'warehouse-v87'
  };

  const intent = await createAreaDeliveryIntent(base);
  assert.equal(intent.operationalDate, '2026-09-12');

  await assert.rejects(
    () => createAreaDeliveryIntent({
      ...base,
      operationalDate: '2026-09-13'
    }),
    /token|fecha|distribuci/i
  );
});

test('V8.7 reporte de áreas usa operationalDate antes que closedAt y conserva fallback legacy', () => {
  const row = {
    productId: 'p',
    productName: 'P',
    quantity: 1,
    allocations: [{ areaId: 'a', areaName: 'A', quantity: 1 }]
  };

  const report = buildAreaConsumptionReport({
    areaDeliveries: [
      {
        id: 'op-date',
        status: 'CLOSED',
        deliveryId: 'd-op',
        operationalDate: '2026-09-12',
        closedAt: '2026-09-14T18:00:00.000Z',
        rows: [row]
      },
      {
        id: 'legacy',
        status: 'CLOSED',
        deliveryId: 'd-legacy',
        closedAt: '2026-09-12T19:00:00.000Z',
        rows: [row]
      }
    ],
    movements: [
      { id: 'm-op', type: 'SUPPLY', documentId: 'd-op', productId: 'p', quantity: 1 },
      { id: 'm-legacy', type: 'SUPPLY', documentId: 'd-legacy', productId: 'p', quantity: 1 }
    ],
    from: '2026-09-12T00:00:00.000Z',
    to: '2026-09-12T23:59:59.999Z'
  });

  assert.equal(report.deliveryCount, 2);
  assert.equal(report.allocatedQuantity, 2);
});

test('V8.7 UI y servidor transportan operationalDate sin migración SQL nueva', async () => {
  const [ui, route] = await Promise.all([
    fs.readFile(new URL('../src/ui/supplyAreaUi.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../server/src/routes/areas.js', import.meta.url), 'utf8')
  ]);

  assert.match(ui, /operationalDate/);
  assert.match(ui, /createAreaDeliveryIntent\([\s\S]*operationalDate/);
  assert.match(route, /operationalDate/);
  assert.match(route, /JSON\.stringify\(\{[\s\S]*operationalDate[\s\S]*rows|JSON\.stringify\(\{[\s\S]*rows[\s\S]*operationalDate/);
});
