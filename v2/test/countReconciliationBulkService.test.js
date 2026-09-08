import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const { createProduct } = await import('../src/catalog/catalogService.js');
const {
  createDocument,
  saveDocumentLine
} = await import('../src/documents/documentService.js');
const { DOCUMENT_TYPES } = await import('../src/documents/documentTypes.js');
const {
  STORES,
  get,
  getAll,
  requestToPromise,
  runTransaction
} = await import('../src/storage/database.js');
const {
  createMovement,
  getCurrentStock
} = await import('../src/inventory/movementService.js');
const { MOVEMENT_TYPES } = await import('../src/core/movementTypes.js');
const {
  submitCountForReconciliation,
  ensureCountReconciliationDraft,
  getCountReconciliationDetails,
  finalizeCountReconciliation,
  RECONCILIATION_DECISION
} = await import('../src/documents/countReconciliationService.js');
const {
  adjustAllPendingReconciliationLines
} = await import('../src/documents/countReconciliationBulkService.js');

let productA;
let productB;
let seeded = false;
let logicalTime = Date.now() + 120000;

function nextTime() {
  logicalTime += 1000;
  return new Date(logicalTime).toISOString();
}

async function seed() {
  if (!productA) {
    productA = await createProduct({
      name: 'V5 BULK ARROZ TEST',
      sku: 'V5-BULK-ARROZ',
      minStock: 0,
      maxStock: 0
    });
  }
  if (!productB) {
    productB = await createProduct({
      name: 'V5 BULK ACEITE TEST',
      sku: 'V5-BULK-ACEITE',
      minStock: 0,
      maxStock: 0
    });
  }
  if (seeded) return;

  await createMovement({
    productId: productA.id,
    type: MOVEMENT_TYPES.ENTRY,
    quantity: 10,
    effectiveAt: nextTime(),
    userId: 'seed-bulk'
  });
  await createMovement({
    productId: productB.id,
    type: MOVEMENT_TYPES.ENTRY,
    quantity: 5,
    effectiveAt: nextTime(),
    userId: 'seed-bulk'
  });
  seeded = true;
}

async function createCount({ aDifference, bDifference }) {
  await seed();
  const [aExpected, bExpected] = await Promise.all([
    getCurrentStock(productA.id),
    getCurrentStock(productB.id)
  ]);
  const countedAt = nextTime();
  const count = await createDocument({
    type: DOCUMENT_TYPES.COUNT,
    ownerId: 'warehouse-bulk'
  });

  await saveDocumentLine({
    documentId: count.id,
    productId: productA.id,
    expectedStock: aExpected,
    countedStock: aExpected + aDifference,
    countedAt
  });
  await saveDocumentLine({
    documentId: count.id,
    productId: productB.id,
    expectedStock: bExpected,
    countedStock: bExpected + bDifference,
    countedAt
  });

  await submitCountForReconciliation(count.id, {
    userId: count.ownerId
  });
  const opened = await ensureCountReconciliationDraft(count.id, {
    userId: 'god-bulk',
    roleCode: 'GOD'
  });

  return { count, opened };
}

test('GOD ajusta todas las diferencias normales con una sola decisión trazable', async () => {
  const { count, opened } = await createCount({
    aDifference: 2,
    bDifference: -2
  });
  const before = await getAll(STORES.MOVEMENTS);

  const result = await adjustAllPendingReconciliationLines(
    opened.reconciliation.id,
    {
      userId: 'god-bulk',
      roleCode: 'GOD',
      reason: 'Primer conteo físico confirmado'
    }
  );

  assert.equal(result.adjustedCount, 2);
  assert.equal(result.movements.length, 2);
  assert.ok(result.bulkAdjustmentId);
  assert.ok(result.movements.every(movement =>
    movement.type === MOVEMENT_TYPES.ADJUSTMENT &&
    movement.metadata.bulkReconciliationAdjustment === true &&
    movement.metadata.bulkAdjustmentId === result.bulkAdjustmentId
  ));
  assert.equal((await getAll(STORES.MOVEMENTS)).length, before.length + 2);
  assert.equal(await getCurrentStock(productA.id), 12);
  assert.equal(await getCurrentStock(productB.id), 3);

  const details = await getCountReconciliationDetails(count.id);
  assert.equal(details.summary.pending, 0);
  assert.equal(details.summary.adjusted, 2);
  assert.ok(details.lines.every(line =>
    line.decision === RECONCILIATION_DECISION.ADJUSTED &&
    line.bulkAdjustmentId === result.bulkAdjustmentId
  ));

  const liveRecon = await get(STORES.DOCUMENTS, opened.reconciliation.id);
  assert.equal(liveRecon.status, 'DRAFT', 'el lote no debe cerrar la conciliación automáticamente');

  await finalizeCountReconciliation(opened.reconciliation.id, {
    userId: 'god-bulk',
    roleCode: 'GOD'
  });
});

test('si una sola línea tiene un ajuste posterior, el lote completo se bloquea antes de escribir', async () => {
  const { count, opened } = await createCount({
    aDifference: 1,
    bDifference: 2
  });

  await createMovement({
    productId: productB.id,
    type: MOVEMENT_TYPES.ADJUSTMENT,
    quantity: 0,
    delta: 1,
    effectiveAt: nextTime(),
    userId: 'otro-ajuste-bulk',
    metadata: { reason: 'Ajuste posterior independiente' }
  });

  const before = await getAll(STORES.MOVEMENTS);
  const batchBefore = before.filter(movement =>
    movement.metadata?.bulkReconciliationAdjustment === true
  ).length;

  await assert.rejects(
    adjustAllPendingReconciliationLines(opened.reconciliation.id, {
      userId: 'god-bulk',
      roleCode: 'GOD'
    }),
    /Recuenta ese producto|ajuste\(s\)\/reverso\(s\) posterior/i
  );

  const after = await getAll(STORES.MOVEMENTS);
  const batchAfter = after.filter(movement =>
    movement.metadata?.bulkReconciliationAdjustment === true
  ).length;
  assert.equal(after.length, before.length);
  assert.equal(batchAfter, batchBefore);

  const details = await getCountReconciliationDetails(count.id);
  assert.equal(details.summary.pending, 2);
  assert.ok(details.lines.every(line =>
    line.decision === RECONCILIATION_DECISION.PENDING
  ));
});

test('un puente SAINT pendiente bloquea el ajuste masivo normal', async () => {
  const { count, opened } = await createCount({
    aDifference: 1,
    bDifference: 1
  });

  await runTransaction(
    [STORES.DOCUMENTS],
    'readwrite',
    async documentStore => {
      const reconciliation = await requestToPromise(
        documentStore.get(opened.reconciliation.id)
      );
      await requestToPromise(documentStore.put({
        ...reconciliation,
        metadata: {
          ...(reconciliation.metadata || {}),
          saintBridgePlans: [{
            sourceProductId: 'bridge-source-test',
            saintCode: '344121',
            status: 'PENDING',
            variants: []
          }]
        }
      }));
    }
  );

  const before = (await getAll(STORES.MOVEMENTS)).length;

  await assert.rejects(
    adjustAllPendingReconciliationLines(opened.reconciliation.id, {
      userId: 'god-bulk',
      roleCode: 'GOD'
    }),
    /Primero aplica 1 reclasificación\(es\) del puente SAINT/i
  );

  assert.equal((await getAll(STORES.MOVEMENTS)).length, before);
  const details = await getCountReconciliationDetails(count.id);
  assert.equal(details.summary.pending, 2);
});
