import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const checklist = await import('../src/documents/supplyChecklistService.js');

const {
  buildSupplyChecklistModel,
  loadSupplyChecklistState,
  setSupplyChecklistItemChecked,
  clearSupplyChecklistState
} = checklist;

test('A2 expone modelo y persistencia de Hoja de surtido', () => {
  assert.equal(typeof buildSupplyChecklistModel, 'function');
  assert.equal(typeof loadSupplyChecklistState, 'function');
  assert.equal(typeof setSupplyChecklistItemChecked, 'function');
  assert.equal(typeof clearSupplyChecklistState, 'function');
});

test('A2 agrupa pendientes por categoría y conserva cantidades decimales', () => {
  const model = buildSupplyChecklistModel({
    summary: {
      document: { id: 'cart-a2' },
      rows: [
        {
          productId: 'oil',
          productName: 'ACEITE SOYA LT',
          actionableRemaining: 3.23455
        },
        {
          productId: 'rice',
          productName: 'ARROZ',
          actionableRemaining: 2
        },
        {
          productId: 'done',
          productName: 'YA ENTREGADO',
          actionableRemaining: 0
        }
      ]
    },
    products: [
      { id: 'oil', categoryId: 'cat-kitchen', inventoryUnitId: 'unit_lt' },
      { id: 'rice', categoryId: 'cat-food', inventoryUnitId: 'unit_kg' },
      { id: 'done', categoryId: 'cat-food', inventoryUnitId: 'unit_und' }
    ],
    categories: [
      { id: 'cat-kitchen', name: 'COCINA' },
      { id: 'cat-food', name: 'ALIMENTOS' }
    ],
    checkedState: {}
  });

  assert.equal(model.pendingCount, 2);
  assert.deepEqual(
    model.groups.map(group => group.category),
    ['ALIMENTOS', 'COCINA']
  );

  const oil = model.groups.flatMap(group => group.rows)
    .find(row => row.productId === 'oil');

  assert.equal(oil.quantity, 3.23455);
  assert.equal(oil.quantityText, '3,23455 LT');
  assert.equal(oil.checked, false);
});

test('A2 guarda checks por carrito y los invalida cuando cambia la cantidad', async () => {
  await clearSupplyChecklistState('cart-a2-state');

  await setSupplyChecklistItemChecked(
    'cart-a2-state',
    'oil',
    3.23455,
    true
  );

  const saved = await loadSupplyChecklistState('cart-a2-state');
  assert.equal(saved.oil.quantity, 3.23455);
  assert.equal(saved.oil.checked, true);

  const sameQuantity = buildSupplyChecklistModel({
    summary: {
      document: { id: 'cart-a2-state' },
      rows: [{
        productId: 'oil',
        productName: 'ACEITE',
        actionableRemaining: 3.23455
      }]
    },
    products: [{ id: 'oil', inventoryUnitId: 'unit_lt' }],
    categories: [],
    checkedState: saved
  });

  assert.equal(sameQuantity.groups[0].rows[0].checked, true);

  const changedQuantity = buildSupplyChecklistModel({
    summary: {
      document: { id: 'cart-a2-state' },
      rows: [{
        productId: 'oil',
        productName: 'ACEITE',
        actionableRemaining: 4
      }]
    },
    products: [{ id: 'oil', inventoryUnitId: 'unit_lt' }],
    categories: [],
    checkedState: saved
  });

  assert.equal(changedQuantity.groups[0].rows[0].checked, false);
});
