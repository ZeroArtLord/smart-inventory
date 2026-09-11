import test from 'node:test';
import assert from 'node:assert/strict';

const {
  buildSupplyThermalPayload
} = await import('../src/printing/supplyThermalPayload.js');

const document = {
  id: 'sur_closed_123456',
  type: 'SUPPLY',
  status: 'CLOSED',
  ownerId: 'warehouse-a',
  createdAt: '2026-09-11T14:00:00.000Z',
  closedAt: '2026-09-11T15:15:00.000Z'
};

const lines = [
  {
    id: 'line-1',
    documentId: document.id,
    productId: 'cola',
    productName: 'COCA COLA ZERO 355ML',
    quantity: 24,
    notes: 'salieron completas'
  },
  {
    id: 'line-2',
    documentId: document.id,
    productId: 'harina',
    productName: 'HARINA',
    quantity: 2.5
  }
];

const products = [
  {
    id: 'cola',
    categoryId: 'bebidas',
    inventoryUnitId: 'unit_und'
  },
  {
    id: 'harina',
    categoryId: 'viveres',
    inventoryUnitId: 'unit_kg'
  }
];

const categories = [
  { id: 'bebidas', name: 'BEBIDAS' },
  { id: 'viveres', name: 'VÍVERES' }
];

test('payload de surtido usa cantidad real de documentLine y unidad base', () => {
  const payload = buildSupplyThermalPayload({
    document,
    lines,
    products,
    categories,
    ownerLabel: 'Depósito'
  });

  assert.equal(payload.id, document.id);
  assert.match(payload.code, /^SUR-/);
  assert.equal(payload.ownerLabel, 'Depósito');
  assert.equal(payload.items.length, 2);
  assert.deepEqual(payload.items[0], {
    name: 'COCA COLA ZERO 355ML',
    quantityText: '24 UND',
    category: 'BEBIDAS',
    note: 'salieron completas'
  });
  assert.equal(payload.items[1].quantityText, '2,5 KG');
  assert.equal(payload.items[1].category, 'VÍVERES');
});

test('payload térmico solo acepta SUPPLY cerrado y con renglones reales', () => {
  assert.throws(
    () => buildSupplyThermalPayload({
      document: { ...document, status: 'DRAFT' },
      lines,
      products,
      categories
    }),
    /cerrado/i
  );

  assert.throws(
    () => buildSupplyThermalPayload({
      document: { ...document, type: 'ENTRY' },
      lines,
      products,
      categories
    }),
    /surtido/i
  );

  assert.throws(
    () => buildSupplyThermalPayload({
      document,
      lines: [],
      products,
      categories
    }),
    /renglones/i
  );
});

test('payload no convierte cantidad por presentaciones ni expone lotes FEFO', () => {
  const payload = buildSupplyThermalPayload({
    document,
    lines: [{
      ...lines[0],
      quantity: 48,
      lotNumber: 'LOTE-A',
      allocations: [
        { lotId: 'a', quantity: 10 },
        { lotId: 'b', quantity: 38 }
      ]
    }],
    products: [{
      ...products[0],
      presentations: [{ code: 'CAJA', conversion: 24, primary: true }]
    }],
    categories
  });

  assert.equal(payload.items[0].quantityText, '48 UND');
  assert.equal('lotNumber' in payload.items[0], false);
  assert.equal('allocations' in payload.items[0], false);
});
