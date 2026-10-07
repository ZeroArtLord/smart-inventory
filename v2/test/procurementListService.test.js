import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  createCategory,
  createProduct
} = await import('../src/catalog/catalogService.js');

const {
  STORES,
  get,
  getAll
} = await import('../src/storage/database.js');

const {
  createProcurementLists,
  updateDraftProcurementLine,
  listProcurementLists,
  procurementCategoryOf,
  procurementDisplayQuantity
} = await import('../src/replenishment/procurementListService.js');

const {
  isProcurementExtra
} = await import('../src/replenishment/warehouseProcurementService.js');

const {
  REPLENISHMENT_STATUS
} = await import('../src/replenishment/replenishmentService.js');

async function fixture() {
  const category = await createCategory(`BEBIDAS LISTA ${Date.now()} ${Math.random()}`);
  const purchase = await createProduct({
    name: `AGUACATE LISTA ${Date.now()} ${Math.random()}`,
    sku: `BUY-${Date.now()}-${Math.random()}`,
    categoryId: category.id,
    inventoryUnitId: 'unit_kg',
    minStock: 0,
    maxStock: 0,
    replenishmentMethod: 'PURCHASE'
  });
  const order = await createProduct({
    name: `PEPSI LISTA ${Date.now()} ${Math.random()}`,
    sku: `ORD-${Date.now()}-${Math.random()}`,
    categoryId: category.id,
    inventoryUnitId: 'unit_und',
    presentations: [
      { id: 'box', code: 'CAJA', unitId: 'unit_box', conversion: 24, primary: true }
    ],
    minStock: 0,
    maxStock: 0,
    replenishmentMethod: 'ORDER'
  });
  return { category, purchase, order };
}

test('crea listas separadas de Compras y Pedidos, incluye extras y no toca stock', async () => {
  const { category, purchase, order } = await fixture();
  const beforeMovements = await getAll(STORES.MOVEMENTS);

  const result = await createProcurementLists({
    ownerId: 'warehouse-user-list',
    ownerLabel: 'Almacenista Prueba',
    lines: [
      {
        productId: purchase.id,
        method: 'PURCHASE',
        requestedQuantity: 30,
        displayQuantity: 30,
        displayUnit: 'KG',
        displayConversion: 1,
        categoryName: category.name,
        notes: 'verdes para guasacaca',
        source: 'MANUAL',
        vigiaSuggestedQuantity: 0,
        stockAtDecision: 4,
        pendingInboundAtDecision: 0
      },
      {
        productId: order.id,
        method: 'ORDER',
        requestedQuantity: 264,
        displayQuantity: 11,
        displayUnit: 'CAJA',
        displayConversion: 24,
        categoryName: category.name,
        notes: 'distribuidor habitual',
        source: 'VIGIA_SUGGESTION',
        vigiaSuggestedQuantity: 264,
        stockAtDecision: 96,
        pendingInboundAtDecision: 0
      }
    ],
    extras: [
      {
        description: 'TEIPE ELECTRICO NEGRO',
        method: 'PURCHASE',
        requestedQuantity: 3,
        displayQuantity: 3,
        unit: 'UND',
        notes: 'para mantenimiento'
      }
    ]
  });

  assert.ok(result.procurementGroupId);
  assert.ok(result.purchaseListId);
  assert.ok(result.orderListId);
  assert.notEqual(result.purchaseListId, result.orderListId);
  assert.equal(result.items.length, 3);
  assert.ok(result.items.every(item => item.status === REPLENISHMENT_STATUS.DRAFT));

  const purchaseItems = result.items.filter(item => item.method === 'PURCHASE');
  const orderItems = result.items.filter(item => item.method === 'ORDER');
  assert.equal(purchaseItems.length, 2);
  assert.equal(orderItems.length, 1);
  assert.ok(purchaseItems.every(item => item.sourceSuggestion.procurementListId === result.purchaseListId));
  assert.ok(orderItems.every(item => item.sourceSuggestion.procurementListId === result.orderListId));
  assert.ok(result.items.every(item => item.sourceSuggestion.procurementGroupId === result.procurementGroupId));
  assert.ok(result.items.every(item => item.sourceSuggestion.ownerLabelAtDecision === 'Almacenista Prueba'));

  const extra = result.items.find(isProcurementExtra);
  assert.ok(extra);
  assert.equal(extra.sourceSuggestion.procurementListId, result.purchaseListId);
  assert.equal(procurementCategoryOf(extra), 'EXTRAS');
  assert.deepEqual(procurementDisplayQuantity(extra), { quantity: 3, unit: 'UND' });

  const savedBuy = await get(STORES.REPLENISHMENTS, purchaseItems[0].id);
  assert.equal(savedBuy.notes, 'verdes para guasacaca');
  assert.equal(procurementCategoryOf(savedBuy), category.name);

  const afterMovements = await getAll(STORES.MOVEMENTS);
  assert.equal(afterMovements.length, beforeMovements.length, 'crear listas no puede crear movimientos');

  const queue = await getAll(STORES.SYNC_QUEUE);
  for (const item of result.items) {
    assert.ok(queue.some(row =>
      row.entityType === 'replenishment' &&
      row.entityId === item.id &&
      row.operation === 'CREATE'
    ));
  }

  const lists = await listProcurementLists();
  const buyList = lists.find(list => list.id === result.purchaseListId);
  const orderList = lists.find(list => list.id === result.orderListId);
  assert.ok(buyList);
  assert.ok(orderList);
  assert.equal(buyList.kind, 'PURCHASE');
  assert.equal(orderList.kind, 'ORDER');
  assert.equal(buyList.ownerLabel, 'Almacenista Prueba');
  assert.equal(buyList.activeItems.length, 2);
  assert.equal(buyList.extras.length, 1);
  assert.equal(orderList.activeItems.length, 1);
});

test('edita cantidad y observación solo en BORRADOR preservando presentación del ticket', async () => {
  const { purchase } = await fixture();
  const result = await createProcurementLists({
    lines: [{
      productId: purchase.id,
      method: 'PURCHASE',
      requestedQuantity: 30,
      displayQuantity: 30,
      displayUnit: 'KG',
      displayConversion: 1,
      notes: 'verdes'
    }]
  });
  const item = result.items[0];
  const updated = await updateDraftProcurementLine(item.id, {
    requestedQuantity: 35,
    displayQuantity: 35,
    displayUnit: 'KG',
    displayConversion: 1,
    notes: 'maduros para ensalada',
    userId: 'warehouse-edit'
  });

  assert.equal(updated.requestedQuantity, 35);
  assert.equal(updated.pendingQuantity, 35);
  assert.equal(updated.notes, 'maduros para ensalada');
  assert.deepEqual(procurementDisplayQuantity(updated), { quantity: 35, unit: 'KG' });
  assert.equal(updated.version, item.version + 1);
});

test('valida todo el lote antes de escribir y evita listas parciales', async () => {
  const { purchase } = await fixture();
  const before = await getAll(STORES.REPLENISHMENTS);

  await assert.rejects(
    createProcurementLists({
      lines: [
        {
          productId: purchase.id,
          method: 'PURCHASE',
          requestedQuantity: 10,
          displayQuantity: 10,
          displayUnit: 'KG',
          displayConversion: 1
        },
        {
          productId: 'producto-inexistente-atomicidad',
          method: 'ORDER',
          requestedQuantity: 5,
          displayQuantity: 5,
          displayUnit: 'UND',
          displayConversion: 1
        }
      ]
    }),
    /Producto no encontrado/
  );

  const after = await getAll(STORES.REPLENISHMENTS);
  assert.equal(after.length, before.length);
});
