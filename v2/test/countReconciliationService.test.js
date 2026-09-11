import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const { createProduct } = await import('../src/catalog/catalogService.js');
const {
  createDocument,
  saveDocumentLine
} = await import('../src/documents/documentService.js');
const { DOCUMENT_TYPES } = await import('../src/documents/documentTypes.js');
const { STORES, get, getAll } = await import('../src/storage/database.js');
const {
  createMovement,
  getCurrentStock
} = await import('../src/inventory/movementService.js');
const { MOVEMENT_TYPES } = await import('../src/core/movementTypes.js');
const {
  submitCountForReconciliation,
  ensureCountReconciliationDraft,
  getCountReconciliationDetails,
  adjustReconciliationLine,
  ignoreReconciliationLine,
  recountReconciliationLine,
  finalizeCountReconciliation,
  listCountReconciliationCases,
  RECONCILIATION_STATE,
  RECONCILIATION_DECISION
} = await import('../src/documents/countReconciliationService.js');

let productA;
let productB;
let seeded = false;
// Los movimientos creados por el servicio usan Date.now(). El reloj lógico
// queda deliberadamente por delante para que los escenarios secuenciales no
// confundan una decisión de un test anterior con un evento posterior al nuevo
// conteo. Dentro de cada escenario el orden sigue siendo estrictamente causal.
let logicalTime = Date.now() + 60000;

function nextTime() {
  logicalTime += 1000;
  return new Date(logicalTime).toISOString();
}

async function seedProducts() {
  if (!productA) {
    productA = await createProduct({
      name: 'V5D ARROZ TEST',
      sku: 'V5D-ARROZ',
      minStock: 0,
      maxStock: 0
    });
  }
  if (!productB) {
    productB = await createProduct({
      name: 'V5D ACEITE TEST',
      sku: 'V5D-ACEITE',
      minStock: 0,
      maxStock: 0
    });
  }
  if (seeded) return;

  const effectiveAt = nextTime();
  await createMovement({
    productId: productA.id,
    type: MOVEMENT_TYPES.ENTRY,
    quantity: 10,
    effectiveAt,
    userId: 'seed-v5d'
  });
  await createMovement({
    productId: productB.id,
    type: MOVEMENT_TYPES.ENTRY,
    quantity: 4,
    effectiveAt,
    userId: 'seed-v5d'
  });
  seeded = true;
}

async function createCount({ ownerId, aDifference = 0, bDifference = 0 }) {
  await seedProducts();
  const [aExpected, bExpected] = await Promise.all([
    getCurrentStock(productA.id),
    getCurrentStock(productB.id)
  ]);
  const countedAt = nextTime();
  const count = await createDocument({ type: DOCUMENT_TYPES.COUNT, ownerId });

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
  return count;
}

async function openReconciliation(count, userId = 'god-v5d') {
  await submitCountForReconciliation(count.id, { userId: count.ownerId });
  return ensureCountReconciliationDraft(count.id, {
    userId,
    roleCode: 'GOD'
  });
}

test('cerrar conteo V5-D no crea movimientos y deja diferencias pendientes', async () => {
  const count = await createCount({
    ownerId: 'warehouse-v5d-1',
    aDifference: -2,
    bDifference: 2
  });
  const before = (await getAll(STORES.MOVEMENTS)).length;
  const result = await submitCountForReconciliation(count.id, {
    userId: count.ownerId
  });
  const after = (await getAll(STORES.MOVEMENTS)).length;

  assert.equal(result.differenceLines, 2);
  assert.equal(result.movements.length, 0);
  assert.equal(after, before);
  assert.equal(result.document.status, 'CLOSED');
  assert.equal(
    result.document.metadata.reconciliationState,
    RECONCILIATION_STATE.PENDING
  );
  assert.equal(result.document.metadata.adjustmentLines, 0);
  assert.equal(
    (await listCountReconciliationCases())
      .some(item => item.document.id === count.id),
    true
  );
});

test('solo GOD concilia y cada diferencia exige una decisión explícita', async () => {
  const countCase = (await listCountReconciliationCases())[0];
  assert.ok(countCase);

  await assert.rejects(
    ensureCountReconciliationDraft(countCase.document.id, {
      userId: 'supervisor-v5d',
      roleCode: 'SUPERVISOR'
    }),
    /solo el rol DIOS/i
  );

  const opened = await ensureCountReconciliationDraft(countCase.document.id, {
    userId: 'god-v5d',
    roleCode: 'GOD'
  });
  assert.equal(opened.reconciliation.type, 'ADJUSTMENT');
  assert.equal(opened.lines.length, 2);
  assert.ok(opened.lines.every(
    line => line.decision === RECONCILIATION_DECISION.PENDING
  ));

  const arroz = opened.lines.find(line => line.productId === productA.id);
  const aceite = opened.lines.find(line => line.productId === productB.id);
  const before = (await getAll(STORES.MOVEMENTS)).length;

  const adjusted = await adjustReconciliationLine(
    opened.reconciliation.id,
    arroz.productId,
    {
      userId: 'god-v5d',
      roleCode: 'GOD',
      reason: 'Faltante físico confirmado'
    }
  );
  assert.equal(adjusted.line.decision, RECONCILIATION_DECISION.ADJUSTED);
  assert.equal(adjusted.movement.type, 'ADJUSTMENT');
  assert.equal(adjusted.movement.delta, -2);
  assert.equal(
    adjusted.movement.metadata.reconciliationKind,
    'COUNT_RECONCILIATION'
  );
  assert.equal((await getAll(STORES.MOVEMENTS)).length, before + 1);

  const ignored = await ignoreReconciliationLine(
    opened.reconciliation.id,
    aceite.productId,
    {
      userId: 'god-v5d',
      roleCode: 'GOD',
      reason: 'Mercancía separada pendiente de ubicar'
    }
  );
  assert.equal(ignored.decision, RECONCILIATION_DECISION.IGNORED);

  const final = await finalizeCountReconciliation(opened.reconciliation.id, {
    userId: 'god-v5d',
    roleCode: 'GOD'
  });
  assert.equal(final.reconciliation.status, 'CLOSED');
  assert.equal(final.count.metadata.reconciliationState, RECONCILIATION_STATE.RESOLVED);
  assert.equal(final.summary.adjusted, 1);
  assert.equal(final.summary.ignored, 1);
  assert.equal(
    (await get(STORES.DOCUMENTS, countCase.document.id)).metadata.adjustmentLines,
    1
  );
});

test('reconteo usa stock VIGÍA actual y puede quedar MATCHED sin movimiento', async () => {
  const count = await createCount({
    ownerId: 'warehouse-v5d-2',
    bDifference: 1
  });
  const opened = await openReconciliation(count);
  const currentB = await getCurrentStock(productB.id);
  const before = (await getAll(STORES.MOVEMENTS)).length;

  const recounted = await recountReconciliationLine(
    opened.reconciliation.id,
    productB.id,
    {
      countedStock: currentB,
      userId: 'god-v5d',
      roleCode: 'GOD',
      reason: 'Segundo conteo físico'
    }
  );
  assert.equal(recounted.decision, RECONCILIATION_DECISION.MATCHED);
  assert.equal(recounted.difference, 0);
  assert.equal((await getAll(STORES.MOVEMENTS)).length, before);

  const details = await getCountReconciliationDetails(count.id);
  assert.equal(details.summary.matched, 1);
  assert.equal(details.summary.pending, 0);
  await finalizeCountReconciliation(opened.reconciliation.id, {
    userId: 'god-v5d',
    roleCode: 'GOD'
  });
});

test('ENTRY posterior conserva la diferencia y no se descuenta dos veces', async () => {
  const count = await createCount({
    ownerId: 'warehouse-v5d-live-op',
    aDifference: -1
  });
  const opened = await openReconciliation(count);

  await createMovement({
    productId: productA.id,
    type: MOVEMENT_TYPES.ENTRY,
    quantity: 3,
    effectiveAt: nextTime(),
    userId: 'recepcion-v5d'
  });

  const adjusted = await adjustReconciliationLine(
    opened.reconciliation.id,
    productA.id,
    {
      userId: 'god-v5d',
      roleCode: 'GOD',
      reason: 'Faltante confirmado después de entrada normal'
    }
  );
  assert.equal(adjusted.movement.delta, -1);
  assert.equal(adjusted.movement.metadata.laterOperationalMovementCount, 1);
  assert.equal(adjusted.movement.metadata.laterOperationalDelta, 3);

  await finalizeCountReconciliation(opened.reconciliation.id, {
    userId: 'god-v5d',
    roleCode: 'GOD'
  });
});

test('ADJUSTMENT posterior bloquea conciliación hasta realizar reconteo', async () => {
  const count = await createCount({
    ownerId: 'warehouse-v5d-sensitive',
    aDifference: -1
  });
  const opened = await openReconciliation(count);

  await createMovement({
    productId: productA.id,
    type: MOVEMENT_TYPES.ADJUSTMENT,
    quantity: 0,
    delta: 1,
    effectiveAt: nextTime(),
    userId: 'otro-ajuste-v5d',
    metadata: { reason: 'Ajuste posterior independiente' }
  });

  await assert.rejects(
    adjustReconciliationLine(opened.reconciliation.id, productA.id, {
      userId: 'god-v5d',
      roleCode: 'GOD'
    }),
    /Recuenta el producto/i
  );

  const currentA = await getCurrentStock(productA.id);
  const recounted = await recountReconciliationLine(
    opened.reconciliation.id,
    productA.id,
    {
      countedStock: currentA,
      userId: 'god-v5d',
      roleCode: 'GOD',
      reason: 'Reconteo obligatorio por ajuste posterior'
    }
  );
  assert.equal(recounted.decision, RECONCILIATION_DECISION.MATCHED);
  await finalizeCountReconciliation(opened.reconciliation.id, {
    userId: 'god-v5d',
    roleCode: 'GOD'
  });
});
