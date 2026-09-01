import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  createProduct
} = await import('../src/catalog/catalogService.js');

const {
  createDocument,
  saveDocumentLine,
  closeDocument,
  createCorrectionDraft
} = await import('../src/documents/documentService.js');

const {
  DOCUMENT_TYPES,
  DOCUMENT_STATUS
} = await import('../src/documents/documentTypes.js');

const {
  getCurrentStock,
  getProductMovements
} = await import('../src/inventory/movementService.js');

const {
  STORES,
  get,
  getAllByIndex
} = await import('../src/storage/database.js');

test('cerrar una entrada crea movimiento, lote y aumenta stock', async () => {
  const product = await createProduct({
    name: 'ENTRADA TEST ACEITE',
    sku: 'ENTRY-ACEITE',
    minStock: 5,
    maxStock: 30
  });

  const document = await createDocument({
    type: DOCUMENT_TYPES.ENTRY,
    ownerId: 'operador-entry',
    supplierId: 'supplier-test'
  });

  await saveDocumentLine({
    documentId: document.id,
    productId: product.id,
    quantity: 12,
    unitCost: 2.5,
    lotNumber: 'LOT-ENTRY-001',
    expiresAt: '2027-01-31'
  });

  const result = await closeDocument(document.id, {
    userId: 'operador-entry'
  });

  assert.equal(result.document.status, DOCUMENT_STATUS.CLOSED);
  assert.equal(result.movements.length, 1);
  assert.equal(result.movements[0].type, 'ENTRY');
  assert.equal(result.movements[0].quantity, 12);
  assert.equal(result.lots.length, 1);
  assert.equal(result.lots[0].lotNumber, 'LOT-ENTRY-001');
  assert.equal(result.lots[0].originalQuantity, 12);
  assert.equal(result.lots[0].remainingQuantity, 12);
  assert.equal(result.lots[0].unitCost, 2.5);
  assert.equal(await getCurrentStock(product.id), 12);
});

test('una entrada admite varios lotes del mismo producto sin pisarlos', async () => {
  const product = await createProduct({
    name: 'ENTRADA MULTILOTE TEST',
    sku: 'ENTRY-MULTILOT',
    minStock: 0,
    maxStock: 50
  });

  const document = await createDocument({
    type: DOCUMENT_TYPES.ENTRY,
    ownerId: 'operador-multilot'
  });

  await saveDocumentLine({
    documentId: document.id,
    productId: product.id,
    quantity: 10,
    lotNumber: 'LOTE-A',
    expiresAt: '2027-02-01'
  });

  await saveDocumentLine({
    documentId: document.id,
    productId: product.id,
    quantity: 5,
    lotNumber: 'LOTE-B',
    expiresAt: '2027-03-01'
  });

  const result = await closeDocument(document.id, {
    userId: 'operador-multilot'
  });

  assert.equal(result.movements.length, 2);
  assert.equal(result.lots.length, 2);
  assert.deepEqual(
    result.lots.map(lot => lot.lotNumber).sort(),
    ['LOTE-A', 'LOTE-B']
  );
  assert.equal(await getCurrentStock(product.id), 15);
});

test('cerrar un surtido descuenta stock real', async () => {
  const product = await createProduct({
    name: 'SURTIDO TEST ARROZ',
    sku: 'SUPPLY-ARROZ',
    minStock: 5,
    maxStock: 40
  });

  const entry = await createDocument({
    type: DOCUMENT_TYPES.ENTRY,
    ownerId: 'operador-supply-seed'
  });

  await saveDocumentLine({
    documentId: entry.id,
    productId: product.id,
    quantity: 20
  });

  await closeDocument(entry.id, {
    userId: 'operador-supply-seed'
  });

  assert.equal(await getCurrentStock(product.id), 20);

  const supply = await createDocument({
    type: DOCUMENT_TYPES.SUPPLY,
    ownerId: 'operador-supply',
    destinationId: 'cocina-principal'
  });

  await saveDocumentLine({
    documentId: supply.id,
    productId: product.id,
    quantity: 7
  });

  const result = await closeDocument(supply.id, {
    userId: 'operador-supply'
  });

  assert.equal(result.document.status, DOCUMENT_STATUS.CLOSED);
  assert.equal(result.movements.length, 1);
  assert.equal(result.movements[0].type, 'SUPPLY');
  assert.equal(result.movements[0].quantity, 7);
  assert.equal(result.movements[0].metadata.destinationId, 'cocina-principal');
  assert.equal(await getCurrentStock(product.id), 13);
});

test('un surtido mayor al stock falla sin crear movimientos parciales ni cerrar documento', async () => {
  const product = await createProduct({
    name: 'SURTIDO BLOQUEADO TEST',
    sku: 'SUPPLY-BLOCK',
    minStock: 0,
    maxStock: 20
  });

  const entry = await createDocument({
    type: DOCUMENT_TYPES.ENTRY,
    ownerId: 'seed-block'
  });

  await saveDocumentLine({
    documentId: entry.id,
    productId: product.id,
    quantity: 5
  });

  await closeDocument(entry.id, { userId: 'seed-block' });

  const supply = await createDocument({
    type: DOCUMENT_TYPES.SUPPLY,
    ownerId: 'operador-block'
  });

  await saveDocumentLine({
    documentId: supply.id,
    productId: product.id,
    quantity: 6
  });

  await assert.rejects(
    closeDocument(supply.id, { userId: 'operador-block' }),
    /solo hay 5 disponibles/i
  );

  assert.equal(await getCurrentStock(product.id), 5);

  const storedDocument = await get(STORES.DOCUMENTS, supply.id);
  assert.equal(storedDocument.status, DOCUMENT_STATUS.DRAFT);

  const movements = await getProductMovements(product.id);
  assert.equal(
    movements.filter(movement => movement.type === 'SUPPLY').length,
    0
  );
});

test('cerrar un documento vacío falla y conserva el borrador', async () => {
  const document = await createDocument({
    type: DOCUMENT_TYPES.ENTRY,
    ownerId: 'operador-empty'
  });

  await assert.rejects(
    closeDocument(document.id, { userId: 'operador-empty' }),
    /documento vacío/i
  );

  const storedDocument = await get(STORES.DOCUMENTS, document.id);
  assert.equal(storedDocument.status, DOCUMENT_STATUS.DRAFT);
});

test('un documento cerrado no puede cerrarse dos veces ni duplicar movimientos', async () => {
  const product = await createProduct({
    name: 'IDEMPOTENCIA CIERRE TEST',
    sku: 'CLOSE-ONCE',
    minStock: 0,
    maxStock: 20
  });

  const document = await createDocument({
    type: DOCUMENT_TYPES.ENTRY,
    ownerId: 'operador-close-once'
  });

  await saveDocumentLine({
    documentId: document.id,
    productId: product.id,
    quantity: 4
  });

  await closeDocument(document.id, {
    userId: 'operador-close-once'
  });

  await assert.rejects(
    closeDocument(document.id, { userId: 'operador-close-once' }),
    /ya no está en borrador/i
  );

  const movements = await getAllByIndex(
    STORES.MOVEMENTS,
    'documentId',
    document.id
  );

  assert.equal(movements.length, 1);
  assert.equal(await getCurrentStock(product.id), 4);
});


test('surtido con lotes aplica FEFO y actualiza cantidades restantes', async () => {
  const product = await createProduct({
    name: 'FEFO INTEGRADO TEST',
    sku: 'FEFO-INTEGRATED',
    minStock: 0,
    maxStock: 50
  });

  const entry = await createDocument({
    type: DOCUMENT_TYPES.ENTRY,
    ownerId: 'operador-fefo'
  });

  await saveDocumentLine({
    documentId: entry.id,
    productId: product.id,
    quantity: 5,
    lotNumber: 'LOTE-VENCE-ANTES',
    expiresAt: '2027-01-01'
  });

  await saveDocumentLine({
    documentId: entry.id,
    productId: product.id,
    quantity: 10,
    lotNumber: 'LOTE-VENCE-DESPUES',
    expiresAt: '2027-06-01'
  });

  await closeDocument(entry.id, { userId: 'operador-fefo' });

  const supply = await createDocument({
    type: DOCUMENT_TYPES.SUPPLY,
    ownerId: 'operador-fefo',
    destinationId: 'cocina-fefo'
  });

  await saveDocumentLine({
    documentId: supply.id,
    productId: product.id,
    quantity: 8
  });

  const result = await closeDocument(supply.id, {
    userId: 'operador-fefo'
  });

  assert.equal(result.movements.length, 2);
  assert.deepEqual(
    result.movements.map(movement => [movement.metadata.lotNumber, movement.quantity]),
    [
      ['LOTE-VENCE-ANTES', 5],
      ['LOTE-VENCE-DESPUES', 3]
    ]
  );

  const lots = await getAllByIndex(
    STORES.LOTS,
    'productId',
    product.id
  );

  const byNumber = new Map(lots.map(lot => [lot.lotNumber, lot]));
  assert.equal(byNumber.get('LOTE-VENCE-ANTES').remainingQuantity, 0);
  assert.equal(byNumber.get('LOTE-VENCE-DESPUES').remainingQuantity, 7);
  assert.equal(await getCurrentStock(product.id), 7);
});


test('corregir un surtido restaura stock y lote sin borrar el documento original', async () => {
  const product = await createProduct({
    name: 'CORRECCION SURTIDO TEST',
    sku: 'CORR-SUPPLY',
    minStock: 0,
    maxStock: 40
  });

  const entry = await createDocument({
    type: DOCUMENT_TYPES.ENTRY,
    ownerId: 'corr-user'
  });

  await saveDocumentLine({
    documentId: entry.id,
    productId: product.id,
    quantity: 10,
    lotNumber: 'CORR-LOTE-1',
    expiresAt: '2027-12-01'
  });

  await closeDocument(entry.id, { userId: 'corr-user' });

  const supply = await createDocument({
    type: DOCUMENT_TYPES.SUPPLY,
    ownerId: 'corr-user',
    destinationId: 'cocina'
  });

  await saveDocumentLine({
    documentId: supply.id,
    productId: product.id,
    quantity: 4
  });

  await closeDocument(supply.id, { userId: 'corr-user' });
  assert.equal(await getCurrentStock(product.id), 6);

  const result = await createCorrectionDraft(supply.id, {
    userId: 'supervisor-corr',
    reason: 'Cantidad entregada incorrecta'
  });

  assert.equal(result.original.status, DOCUMENT_STATUS.CLOSED);
  assert.equal(result.draft.status, DOCUMENT_STATUS.DRAFT);
  assert.equal(result.draft.metadata.correctionOfDocumentId, supply.id);
  assert.equal(result.reversals.length, 1);
  assert.equal(result.reversals[0].type, 'REVERSAL');
  assert.equal(result.reversals[0].delta, 4);
  assert.equal(await getCurrentStock(product.id), 10);

  const lots = await getAllByIndex(
    STORES.LOTS,
    'productId',
    product.id
  );
  assert.equal(lots[0].remainingQuantity, 10);

  const correctionLines = await getAllByIndex(
    STORES.DOCUMENT_LINES,
    'documentId',
    result.draft.id
  );
  assert.equal(correctionLines.length, 1);
  assert.equal(correctionLines[0].quantity, 4);
});

test('no permite corregir una entrada si su mercancía ya fue consumida', async () => {
  const product = await createProduct({
    name: 'CORRECCION ENTRADA BLOQUEADA',
    sku: 'CORR-ENTRY-BLOCK',
    minStock: 0,
    maxStock: 40
  });

  const entry = await createDocument({
    type: DOCUMENT_TYPES.ENTRY,
    ownerId: 'corr-entry-user'
  });

  await saveDocumentLine({
    documentId: entry.id,
    productId: product.id,
    quantity: 10,
    lotNumber: 'CORR-ENTRY-LOT',
    expiresAt: '2028-01-01'
  });

  await closeDocument(entry.id, { userId: 'corr-entry-user' });

  const supply = await createDocument({
    type: DOCUMENT_TYPES.SUPPLY,
    ownerId: 'corr-entry-user'
  });

  await saveDocumentLine({
    documentId: supply.id,
    productId: product.id,
    quantity: 2
  });

  await closeDocument(supply.id, { userId: 'corr-entry-user' });
  assert.equal(await getCurrentStock(product.id), 8);

  await assert.rejects(
    createCorrectionDraft(entry.id, {
      userId: 'supervisor-corr',
      reason: 'Factura equivocada'
    }),
    /mercancía posterior|lote ya fue consumido/i
  );

  assert.equal(await getCurrentStock(product.id), 8);

  const storedEntry = await get(STORES.DOCUMENTS, entry.id);
  assert.equal(storedEntry.metadata?.correctionDraftId, undefined);
});

test('corregir un conteo compensa ajustes y crea un conteo nuevo vacío', async () => {
  const product = await createProduct({
    name: 'CORRECCION CONTEO TEST',
    sku: 'CORR-COUNT',
    minStock: 0,
    maxStock: 20
  });

  const count = await createDocument({
    type: DOCUMENT_TYPES.COUNT,
    ownerId: 'corr-count-user'
  });

  await saveDocumentLine({
    documentId: count.id,
    productId: product.id,
    countedStock: 5
  });

  await closeDocument(count.id, { userId: 'corr-count-user' });
  assert.equal(await getCurrentStock(product.id), 5);

  const result = await createCorrectionDraft(count.id, {
    userId: 'supervisor-corr',
    reason: 'Reconteo solicitado'
  });

  assert.equal(await getCurrentStock(product.id), 0);
  assert.equal(result.reversals.length, 1);
  assert.equal(result.reversals[0].delta, -5);
  assert.equal(result.draft.type, DOCUMENT_TYPES.COUNT);
  assert.equal(result.draft.status, DOCUMENT_STATUS.DRAFT);

  const correctionLines = await getAllByIndex(
    STORES.DOCUMENT_LINES,
    'documentId',
    result.draft.id
  );
  assert.equal(correctionLines.length, 0);
});
