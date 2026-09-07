import test from 'node:test';
import assert from 'node:assert/strict';

const {
  validateSyncEvent
} = await import('../server/src/sync/validateEvent.js');

test('servidor acepta compra manual aunque el método sea una decisión humana', () => {
  const now = new Date().toISOString();
  const payload = {
    id: 'rep-manual-contract-v5b',
    productId: 'product-real-001',
    productName: 'ARROZ',
    supplierId: null,
    method: 'PURCHASE',
    status: 'DRAFT',
    requestedQuantity: 100,
    receivedQuantity: 0,
    pendingQuantity: 100,
    expectedAt: null,
    reference: null,
    notes: 'Evento especial',
    ownerId: 'god',
    sourceSuggestion: {
      kind: 'PRODUCT',
      source: 'MANUAL',
      manualDecision: true,
      vigiaSuggestedQuantity: 0
    },
    receiptDocuments: [],
    orderedAt: null,
    receivedAt: null,
    cancelledAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now
  };

  assert.equal(
    validateSyncEvent({
      entityType: 'replenishment',
      entityId: payload.id,
      operation: 'CREATE',
      payload
    }).payload,
    payload
  );
});

test('servidor acepta extra con productId sintético sin convertirlo en producto', () => {
  const now = new Date().toISOString();
  const payload = {
    id: 'rep-extra-contract-v5b',
    productId: '__VIGIA_EXTRA__:rep-extra-contract-v5b',
    productName: 'TEIPE ELECTRICO',
    supplierId: null,
    method: 'PURCHASE',
    status: 'DRAFT',
    requestedQuantity: 3,
    receivedQuantity: 0,
    pendingQuantity: 3,
    expectedAt: null,
    reference: null,
    notes: null,
    ownerId: 'god',
    sourceSuggestion: {
      kind: 'EXTRA',
      source: 'EXTRA',
      manualDecision: true,
      unit: 'UND',
      outsideCatalog: true
    },
    receiptDocuments: [],
    orderedAt: null,
    receivedAt: null,
    cancelledAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now
  };

  assert.doesNotThrow(() =>
    validateSyncEvent({
      entityType: 'replenishment',
      entityId: payload.id,
      operation: 'CREATE',
      payload
    })
  );
});
