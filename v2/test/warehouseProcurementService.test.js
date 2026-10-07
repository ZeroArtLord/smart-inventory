import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  createProduct
} = await import('../src/catalog/catalogService.js');

const {
  STORES,
  get,
  getAll
} = await import('../src/storage/database.js');

const {
  calculatePendingInboundByProduct,
  REPLENISHMENT_STATUS
} = await import('../src/replenishment/replenishmentService.js');

const {
  createManualProductProcurement,
  createProcurementExtra,
  completeProcurementExtra,
  cancelProcurementExtra,
  updateProcurementItem,
  removeProcurementItem,
  procurementItemCanEdit,
  isProcurementExtra,
  procurementExtraUnit
} = await import('../src/replenishment/warehouseProcurementService.js');

test('decisión manual puede comprar un producto aunque su método habitual sea ORDER', async () => {
  const product = await createProduct({
    name: 'ARROZ EVENTO MANUAL V5B',
    sku: 'V5B-ARROZ-MANUAL',
    minStock: 0,
    maxStock: 0,
    replenishmentMethod: 'ORDER'
  });

  const item = await createManualProductProcurement({
    productId: product.id,
    method: 'PURCHASE',
    requestedQuantity: 100,
    reason: 'Evento especial',
    ownerId: 'god-v5b',
    vigiaSuggestedQuantity: 0,
    stockAtDecision: 3,
    pendingInboundAtDecision: 0
  });

  assert.equal(item.productId, product.id);
  assert.equal(item.method, 'PURCHASE');
  assert.equal(item.requestedQuantity, 100);
  assert.equal(item.pendingQuantity, 100);
  assert.equal(item.status, REPLENISHMENT_STATUS.DRAFT);
  assert.equal(item.sourceSuggestion.manualDecision, true);
  assert.equal(item.sourceSuggestion.configuredMethod, 'ORDER');
  assert.equal(item.sourceSuggestion.vigiaSuggestedQuantity, 0);
  assert.equal(item.sourceSuggestion.stockAtDecision, 3);
  assert.equal(item.sourceSuggestion.decisionReason, 'Evento especial');

  const stored = await get(STORES.REPLENISHMENTS, item.id);
  assert.equal(stored.id, item.id);

  const queue = await getAll(STORES.SYNC_QUEUE);
  assert.equal(
    queue.some(row =>
      row.entityType === 'replenishment' &&
      row.entityId === item.id &&
      row.operation === 'CREATE'
    ),
    true
  );
});

test('extra fuera del catálogo se guarda y sincroniza sin crear producto ni stock', async () => {
  const beforeProducts = await getAll(STORES.PRODUCTS);

  const extra = await createProcurementExtra({
    description: 'TEIPE ELECTRICO NEGRO',
    requestedQuantity: 3,
    unit: 'UND',
    notes: 'Mantenimiento',
    ownerId: 'god-v5b-extra'
  });

  assert.equal(isProcurementExtra(extra), true);
  assert.equal(procurementExtraUnit(extra), 'UND');
  assert.equal(extra.productName, 'TEIPE ELECTRICO NEGRO');
  assert.equal(extra.requestedQuantity, 3);
  assert.equal(extra.status, REPLENISHMENT_STATUS.DRAFT);
  assert.match(extra.productId, /^__VIGIA_EXTRA__:/);
  assert.equal(extra.sourceSuggestion.outsideCatalog, true);

  const afterProducts = await getAll(STORES.PRODUCTS);
  assert.equal(afterProducts.length, beforeProducts.length);
  assert.equal(
    afterProducts.some(product => product.id === extra.productId),
    false
  );

  // DRAFT nunca se considera mercancía en tránsito y, además, el id sintético
  // jamás coincide con un producto real.
  const pending = calculatePendingInboundByProduct([extra]);
  assert.equal(pending.size, 0);

  const queue = await getAll(STORES.SYNC_QUEUE);
  assert.equal(
    queue.some(row =>
      row.entityType === 'replenishment' &&
      row.entityId === extra.id &&
      row.payload?.sourceSuggestion?.kind === 'EXTRA'
    ),
    true
  );
});

test('extra puede cerrarse como comprado sin generar movimientos', async () => {
  const extra = await createProcurementExtra({
    description: 'BOMBILLO LED V5B',
    requestedQuantity: 5,
    unit: 'UND'
  });

  const beforeMovements = await getAll(STORES.MOVEMENTS);

  const completed = await completeProcurementExtra(extra.id, {
    userId: 'god-v5b'
  });

  assert.equal(completed.status, REPLENISHMENT_STATUS.RECEIVED);
  assert.equal(completed.pendingQuantity, 0);
  assert.equal(completed.receivedQuantity, 5);
  assert.ok(completed.receivedAt);

  const afterMovements = await getAll(STORES.MOVEMENTS);
  assert.equal(afterMovements.length, beforeMovements.length);
});

test('extra puede cancelarse sin contaminar inventario', async () => {
  const extra = await createProcurementExtra({
    description: 'BROCHA V5B',
    requestedQuantity: 2,
    unit: 'UND'
  });

  const cancelled = await cancelProcurementExtra(extra.id, {
    userId: 'god-v5b'
  });

  assert.equal(cancelled.status, REPLENISHMENT_STATUS.CANCELLED);
  assert.equal(cancelled.pendingQuantity, 2);
  assert.ok(cancelled.cancelledAt);

  const movements = await getAll(STORES.MOVEMENTS);
  assert.equal(
    movements.some(movement => movement.productId === extra.productId),
    false
  );
});


test('lista de producto puede editar cantidad, tipo y nota antes de recibir', async () => {
  const product = await createProduct({
    name: 'HARINA EDITABLE V5B2',
    sku: 'V5B2-HARINA',
    minStock: 0,
    maxStock: 0,
    replenishmentMethod: 'BOTH'
  });

  const item = await createManualProductProcurement({
    productId: product.id,
    method: 'PURCHASE',
    requestedQuantity: 10,
    reason: 'Lista inicial'
  });

  assert.equal(procurementItemCanEdit(item), true);

  const updated = await updateProcurementItem(
    item.id,
    {
      requestedQuantity: 25,
      method: 'ORDER',
      notes: 'Se corrigió después de revisar almacén'
    },
    { userId: 'god-v5b2' }
  );

  assert.equal(updated.requestedQuantity, 25);
  assert.equal(updated.pendingQuantity, 25);
  assert.equal(updated.method, 'ORDER');
  assert.equal(updated.notes, 'Se corrigió después de revisar almacén');
  assert.equal(updated.sourceSuggestion.lastEditedBy, 'god-v5b2');

  const queue = await getAll(STORES.SYNC_QUEUE);
  assert.equal(
    queue.some(row =>
      row.entityId === item.id &&
      row.operation === 'UPDATE' &&
      row.payload?.requestedQuantity === 25
    ),
    true
  );
});

test('extra puede editar descripción, cantidad y unidad sin tocar inventario', async () => {
  const extra = await createProcurementExtra({
    description: 'TEIPE',
    requestedQuantity: 1,
    unit: 'UND'
  });
  const beforeMovements = (await getAll(STORES.MOVEMENTS)).length;

  const updated = await updateProcurementItem(
    extra.id,
    {
      description: 'TEIPE ELECTRICO NEGRO',
      requestedQuantity: 4,
      unit: 'PAQ',
      notes: 'Comprar cuatro paquetes'
    },
    { userId: 'god-v5b2' }
  );

  assert.equal(updated.productName, 'TEIPE ELECTRICO NEGRO');
  assert.equal(updated.requestedQuantity, 4);
  assert.equal(updated.pendingQuantity, 4);
  assert.equal(procurementExtraUnit(updated), 'PAQ');
  assert.equal((await getAll(STORES.MOVEMENTS)).length, beforeMovements);
});

test('quitar renglón cancela sin borrar historia ni crear movimientos', async () => {
  const product = await createProduct({
    name: 'ACEITE QUITAR V5B2',
    sku: 'V5B2-ACEITE',
    replenishmentMethod: 'BOTH'
  });
  const item = await createManualProductProcurement({
    productId: product.id,
    method: 'PURCHASE',
    requestedQuantity: 12
  });
  const beforeMovements = (await getAll(STORES.MOVEMENTS)).length;

  const removed = await removeProcurementItem(item.id, {
    userId: 'god-v5b2',
    reason: 'Ya no hace falta'
  });

  assert.equal(removed.status, REPLENISHMENT_STATUS.CANCELLED);
  assert.equal(removed.pendingQuantity, 12);
  assert.equal(removed.sourceSuggestion.removedFromOperationalList, true);
  assert.equal(removed.sourceSuggestion.removedReason, 'Ya no hace falta');
  assert.equal(procurementItemCanEdit(removed), false);

  const stored = await get(STORES.REPLENISHMENTS, item.id);
  assert.equal(stored.status, REPLENISHMENT_STATUS.CANCELLED);
  assert.equal((await getAll(STORES.MOVEMENTS)).length, beforeMovements);

  await assert.rejects(
    updateProcurementItem(item.id, { requestedQuantity: 20 }),
    /no se puede editar\/quitar/i
  );
});
