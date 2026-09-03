import test from 'node:test';
import assert from 'node:assert/strict';

const {
  validateSyncEvent
} = await import('../server/src/sync/validateEvent.js');

function baseProduct() {
  return {
    id: 'prd_test',
    name: 'Producto Test',
    minStock: 5,
    maxStock: 20,
    purchaseConversion: 1,
    replenishmentMethod: 'BOTH'
  };
}

function baseMovement() {
  return {
    id: 'mov_test',
    productId: 'prd_test',
    type: 'ENTRY',
    quantity: 5,
    createdAt: '2026-09-01T12:00:00.000Z',
    effectiveAt: '2026-09-01T12:00:00.000Z'
  };
}

test('acepta un producto válido', () => {
  assert.doesNotThrow(() => validateSyncEvent({
    entityType: 'product',
    entityId: 'prd_test',
    operation: 'CREATE',
    payload: baseProduct()
  }));
});

test('rechaza evento cuyo entityId no coincide con payload.id', () => {
  assert.throws(() => validateSyncEvent({
    entityType: 'product',
    entityId: 'prd_otro',
    operation: 'CREATE',
    payload: baseProduct()
  }), /no coincide/i);
});

test('rechaza mínimos mayores al máximo en servidor', () => {
  const product = {
    ...baseProduct(),
    minStock: 30,
    maxStock: 20
  };

  assert.throws(() => validateSyncEvent({
    entityType: 'product',
    entityId: product.id,
    operation: 'UPDATE',
    payload: product
  }), /mínimo no puede superar/i);
});

test('rechaza movimiento de salida con cantidad cero', () => {
  const movement = {
    ...baseMovement(),
    type: 'SUPPLY',
    quantity: 0
  };

  assert.throws(() => validateSyncEvent({
    entityType: 'movement',
    entityId: movement.id,
    operation: 'CREATE',
    payload: movement
  }), /mayor que cero/i);
});

test('rechaza UPDATE de movimientos inmutables', () => {
  const movement = baseMovement();

  assert.throws(() => validateSyncEvent({
    entityType: 'movement',
    entityId: movement.id,
    operation: 'UPDATE',
    payload: movement
  }), /solo admiten CREATE/i);
});

test('rechaza lote cuya cantidad restante supera la original', () => {
  const lot = {
    id: 'lot_test',
    productId: 'prd_test',
    receivedAt: '2026-09-01T12:00:00.000Z',
    originalQuantity: 5,
    remainingQuantity: 6,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z'
  };

  assert.throws(() => validateSyncEvent({
    entityType: 'lot',
    entityId: lot.id,
    operation: 'CREATE',
    payload: lot
  }), /supera la original/i);
});

test('acepta ajuste con delta negativo', () => {
  const movement = {
    ...baseMovement(),
    type: 'ADJUSTMENT',
    quantity: 0,
    delta: -3
  };

  assert.doesNotThrow(() => validateSyncEvent({
    entityType: 'movement',
    entityId: movement.id,
    operation: 'CREATE',
    payload: movement
  }));
});


test('acepta carga inicial SAINT válida', () => {
  const payload = {
    id: 'saintload_test',
    source: 'SAINT',
    createdAt: '2026-09-03T14:00:00.000Z',
    rows: [
      {
        productId: 'prd_test',
        quantity: 25
      }
    ]
  };

  assert.doesNotThrow(() => validateSyncEvent({
    entityType: 'initialLoad',
    entityId: payload.id,
    operation: 'CREATE',
    payload
  }));
});

test('rechaza productos duplicados en carga inicial', () => {
  const payload = {
    id: 'saintload_dup',
    source: 'SAINT',
    createdAt: '2026-09-03T14:00:00.000Z',
    rows: [
      {
        productId: 'prd_test',
        quantity: 10
      },
      {
        productId: 'prd_test',
        quantity: 20
      }
    ]
  };

  assert.throws(() => validateSyncEvent({
    entityType: 'initialLoad',
    entityId: payload.id,
    operation: 'CREATE',
    payload
  }), /duplicados/i);
});

test('rechaza existencia negativa en carga inicial', () => {
  const payload = {
    id: 'saintload_negative',
    source: 'SAINT',
    createdAt: '2026-09-03T14:00:00.000Z',
    rows: [
      {
        productId: 'prd_test',
        quantity: -1
      }
    ]
  };

  assert.throws(() => validateSyncEvent({
    entityType: 'initialLoad',
    entityId: payload.id,
    operation: 'CREATE',
    payload
  }), /Existencia inicial/i);
});


test('rechaza huella SHA-256 inválida en carga inicial', () => {
  const payload = {
    id: 'saintload_bad_hash',
    source: 'SAINT',
    fileSha256: '1234',
    createdAt: '2026-09-03T14:00:00.000Z',
    rows: [
      {
        productId: 'prd_test',
        quantity: 0
      }
    ]
  };

  assert.throws(() => validateSyncEvent({
    entityType: 'initialLoad',
    entityId: payload.id,
    operation: 'CREATE',
    payload
  }), /SHA-256/i);
});


test('rechaza fuente distinta de SAINT en carga inicial', () => {
  const payload = {
    id: 'saintload_other_source',
    source: 'OTRA',
    createdAt: '2026-09-03T14:00:00.000Z',
    rows: [
      {
        productId: 'prd_test',
        quantity: 0
      }
    ]
  };

  assert.throws(() => validateSyncEvent({
    entityType: 'initialLoad',
    entityId: payload.id,
    operation: 'CREATE',
    payload
  }), /solo admite fuente SAINT/i);
});
