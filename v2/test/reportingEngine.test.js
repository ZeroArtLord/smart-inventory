import test from 'node:test';
import assert from 'node:assert/strict';

const {
  buildInventoryReport,
  summarizeInventoryReport,
  listExpiringLots,
  summarizeMovements,
  buildProductMovementTotals
} = await import('../src/reporting/reportingEngine.js');

test('reporte de inventario prioriza productos críticos y calcula sugerencia', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');
  const products = [
    {
      id: 'prd-a',
      name: 'Aceite',
      minStock: 20,
      maxStock: 40,
      active: true,
      replenishmentMethod: 'BOTH'
    },
    {
      id: 'prd-b',
      name: 'Arroz',
      minStock: 5,
      maxStock: 15,
      active: true,
      replenishmentMethod: 'PURCHASE'
    }
  ];

  const movements = [
    {
      id: 'mov-a',
      productId: 'prd-a',
      type: 'ADJUSTMENT',
      quantity: 0,
      delta: 8,
      effectiveAt: '2026-08-30T12:00:00.000Z'
    },
    {
      id: 'mov-b',
      productId: 'prd-b',
      type: 'ADJUSTMENT',
      quantity: 0,
      delta: 10,
      effectiveAt: '2026-08-30T12:00:00.000Z'
    }
  ];

  const report = buildInventoryReport(products, movements, { now });

  assert.equal(report[0].productId, 'prd-a');
  assert.equal(report[0].riskLevel, 'CRITICAL');
  assert.equal(report[0].stock, 8);
  assert.equal(report[0].suggestedQuantity, 12);
  assert.equal(report[1].riskLevel, 'GOOD');

  assert.deepEqual(
    summarizeInventoryReport(report),
    {
      products: 2,
      critical: 1,
      low: 0,
      good: 1,
      replenishmentNeeded: 1
    }
  );
});

test('mercancía pendiente reduce la recomendación sin alterar stock físico', () => {
  const report = buildInventoryReport([
    {
      id: 'prd-a',
      name: 'Aceite',
      minStock: 20,
      maxStock: 40,
      active: true
    }
  ], [
    {
      id: 'mov-a',
      productId: 'prd-a',
      type: 'ADJUSTMENT',
      quantity: 0,
      delta: 8,
      effectiveAt: '2026-08-30T12:00:00.000Z'
    }
  ], {
    now: new Date('2026-09-01T12:00:00.000Z'),
    pendingInboundByProduct: new Map([['prd-a', 5]])
  });

  assert.equal(report[0].stock, 8);
  assert.equal(report[0].pendingInbound, 5);
  assert.equal(report[0].suggestedQuantity, 7);
});

test('lista lotes próximos a vencer y conserva vencidos si se solicita', () => {
  const lots = listExpiringLots([
    {
      id: 'lot-expired',
      productId: 'prd-a',
      remainingQuantity: 2,
      expiresAt: '2026-08-30T12:00:00.000Z'
    },
    {
      id: 'lot-soon',
      productId: 'prd-a',
      remainingQuantity: 4,
      expiresAt: '2026-09-05T12:00:00.000Z'
    },
    {
      id: 'lot-far',
      productId: 'prd-a',
      remainingQuantity: 4,
      expiresAt: '2026-11-01T12:00:00.000Z'
    }
  ], {
    now: new Date('2026-09-01T12:00:00.000Z'),
    withinDays: 30
  });

  assert.deepEqual(
    lots.map(lot => [lot.id, lot.daysRemaining]),
    [
      ['lot-expired', -2],
      ['lot-soon', 4]
    ]
  );
});

test('resumen de movimientos cuenta por tipo dentro del rango', () => {
  const movements = [
    {
      productId: 'prd-a',
      type: 'ENTRY',
      quantity: 10,
      effectiveAt: '2026-09-01T10:00:00.000Z'
    },
    {
      productId: 'prd-a',
      type: 'SUPPLY',
      quantity: 3,
      effectiveAt: '2026-09-01T11:00:00.000Z'
    },
    {
      productId: 'prd-a',
      type: 'ADJUSTMENT',
      quantity: 0,
      delta: 2,
      effectiveAt: '2026-08-01T11:00:00.000Z'
    }
  ];

  const summary = summarizeMovements(movements, {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-01T23:59:59.999Z'
  });

  assert.deepEqual(summary, {
    movementCount: 2,
    entryCount: 1,
    supplyCount: 1,
    adjustmentCount: 0,
    reversalCount: 0,
    transferCount: 0
  });
});

test('totales por producto separan entrada, surtido y neto', () => {
  const rows = buildProductMovementTotals([
    {
      productId: 'prd-a',
      type: 'ENTRY',
      quantity: 10,
      effectiveAt: '2026-09-01T10:00:00.000Z'
    },
    {
      productId: 'prd-a',
      type: 'SUPPLY',
      quantity: 4,
      effectiveAt: '2026-09-01T11:00:00.000Z'
    },
    {
      productId: 'prd-a',
      type: 'ADJUSTMENT',
      quantity: 0,
      delta: -1,
      effectiveAt: '2026-09-01T12:00:00.000Z'
    }
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    productId: 'prd-a',
    entry: 10,
    supply: 4,
    adjustment: -1,
    reversal: 0,
    net: 5,
    movementCount: 3
  });
});
