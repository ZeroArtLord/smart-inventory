import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const { createProduct } = await import('../src/catalog/catalogService.js');
const {
  applyQuickStockCorrection,
  previewQuickStockCorrection,
  QUICK_STOCK_CORRECTION_KIND
} = await import('../src/inventory/quickStockCorrectionService.js');
const { getCurrentStock } = await import('../src/inventory/movementService.js');
const {
  createDocument,
  saveDocumentLine
} = await import('../src/documents/documentService.js');
const { DOCUMENT_TYPES } = await import('../src/documents/documentTypes.js');
const {
  enableLiveSupplyCart,
  dispatchLiveSupply,
  createLiveSupplyDeliveryToken
} = await import('../src/documents/liveSupplyService.js');
const { STORES, getAll } = await import('../src/storage/database.js');
const {
  assertEventPermission,
  requiresGodQuickStockCorrection
} = await import('../server/src/security/permissions.js');

async function product(name) {
  return createProduct({
    name,
    sku: `${name.replace(/[^A-Z0-9]/gi, '-').toUpperCase()}-${Date.now()}-${Math.random()}`,
    minStock: 0,
    maxStock: 0
  });
}

test('GOD corrige stock directo con ADJUSTMENT trazable y sin editar una columna de stock', async () => {
  const item = await product('V5 QUICK STOCK TEST A');
  const preview = await previewQuickStockCorrection(item.id, {
    targetStock: 12
  });

  assert.equal(preview.currentStock, 0);
  assert.equal(preview.targetStock, 12);
  assert.equal(preview.delta, 12);

  const result = await applyQuickStockCorrection(item.id, {
    targetStock: 12,
    reason: 'Existencia física verificada',
    userId: 'god-test',
    roleCode: 'GOD',
    context: {
      source: 'CATALOG'
    }
  });

  assert.equal(result.delta, 12);
  assert.equal(await getCurrentStock(item.id), 12);
  assert.equal(
    result.movement.metadata.quickStockCorrectionKind,
    QUICK_STOCK_CORRECTION_KIND
  );
  assert.equal(result.movement.metadata.authorizedRole, 'GOD');
  assert.equal(result.movement.metadata.stockBeforeDecision, 0);
  assert.equal(result.movement.metadata.targetStock, 12);
  assert.equal(result.movement.metadata.source, 'CATALOG');
});

test('rol distinto de GOD no puede usar la corrección rápida aunque conozca el servicio', async () => {
  const item = await product('V5 QUICK STOCK TEST B');
  const before = (await getAll(STORES.MOVEMENTS)).length;

  await assert.rejects(
    applyQuickStockCorrection(item.id, {
      targetStock: 5,
      reason: 'Intento no autorizado',
      userId: 'supervisor-test',
      roleCode: 'SUPERVISOR'
    }),
    /Solo el rol DIOS/i
  );

  assert.equal(await getCurrentStock(item.id), 0);
  assert.equal((await getAll(STORES.MOVEMENTS)).length, before);
});

test('la corrección rápida nunca permite declarar stock negativo', async () => {
  const item = await product('V5 QUICK STOCK TEST C');

  await assert.rejects(
    applyQuickStockCorrection(item.id, {
      targetStock: -1,
      reason: 'Valor imposible',
      userId: 'god-test',
      roleCode: 'GOD'
    }),
    /cantidad inválida/i
  );

  assert.equal(await getCurrentStock(item.id), 0);
});

test('GOD puede corregir un producto en cero y continuar el mismo surtido sin stock negativo', async () => {
  const item = await product('V5 QUICK STOCK SUPPLY TEST');
  const supply = await createDocument({
    type: DOCUMENT_TYPES.SUPPLY,
    ownerId: 'god-test'
  });

  await saveDocumentLine({
    documentId: supply.id,
    productId: item.id,
    quantity: 6
  });

  await enableLiveSupplyCart(supply.id, { userId: 'god-test' });

  await applyQuickStockCorrection(item.id, {
    targetStock: 12,
    reason: 'Existencia física no registrada al surtir',
    userId: 'god-test',
    roleCode: 'GOD',
    context: {
      source: 'SUPPLY',
      documentId: supply.id,
      documentType: 'SUPPLY'
    }
  });

  const delivery = await dispatchLiveSupply(supply.id, {
    deliveryToken: createLiveSupplyDeliveryToken(),
    quantities: [{ productId: item.id, quantity: 6 }],
    userId: 'god-test'
  });

  assert.equal(delivery.movements.length, 1);
  assert.equal(await getCurrentStock(item.id), 6);
});

test('servidor exige GOD para eventos marcados como corrección rápida', () => {
  const event = {
    entityType: 'movement',
    operation: 'CREATE',
    payload: {
      type: 'ADJUSTMENT',
      metadata: {
        quickStockCorrectionKind: QUICK_STOCK_CORRECTION_KIND
      }
    }
  };

  assert.equal(requiresGodQuickStockCorrection(event), true);

  assert.throws(
    () => assertEventPermission({
      roleCode: 'SUPERVISOR',
      permissions: ['adjustment.write']
    }, event),
    error => error?.statusCode === 403 && /DIOS/i.test(error.message)
  );

  assert.equal(
    assertEventPermission({
      roleCode: 'GOD',
      permissions: ['*']
    }, event),
    'role:GOD'
  );
});
