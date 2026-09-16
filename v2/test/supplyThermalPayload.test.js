import test from 'node:test';
import assert from 'node:assert/strict';

const {
  buildSupplyThermalPayload,
  buildConsolidatedSupplyThermalPayload
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

test('payload térmico abrevia CAJA y BULTO como el ticket de Compras/Pedidos', () => {
  const payload = buildSupplyThermalPayload({
    document,
    lines: [
      {
        productId: 'cajas',
        productName: 'REFRESCO EN CAJA',
        quantity: 3
      },
      {
        productId: 'bultos',
        productName: 'ARROZ EN BULTO',
        quantity: 2
      }
    ],
    products: [
      {
        id: 'cajas',
        categoryId: 'bebidas',
        inventoryUnitId: 'unit_box'
      },
      {
        id: 'bultos',
        categoryId: 'viveres',
        inventoryUnitId: 'unit_bulto'
      }
    ],
    categories
  });

  assert.equal(payload.items[0].quantityText, '3 CJ');
  assert.equal(payload.items[1].quantityText, '2 BUL');
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

test('payload consolidado agrupa por producto y conserva todos los decimales significativos', () => {
  const parentDocument = {
    id: 'sur_live_parent_1',
    type: 'SUPPLY',
    status: 'DRAFT',
    ownerId: 'warehouse-a',
    createdAt: '2026-09-16T12:00:00.000Z',
    metadata: {
      kind: 'LIVE_SUPPLY_CART',
      operationalDate: '2026-09-16'
    }
  };
  const deliveryDocuments = [
    {
      id: 'delivery-1',
      type: 'SUPPLY',
      status: 'CLOSED',
      closedAt: '2026-09-16T13:00:00.000Z',
      metadata: {
        kind: 'LIVE_SUPPLY_DELIVERY',
        parentCartId: parentDocument.id
      }
    },
    {
      id: 'delivery-2',
      type: 'SUPPLY',
      status: 'CLOSED',
      closedAt: '2026-09-16T14:00:00.000Z',
      metadata: {
        kind: 'LIVE_SUPPLY_DELIVERY',
        parentCartId: parentDocument.id
      }
    }
  ];

  const payload = buildConsolidatedSupplyThermalPayload({
    parentDocument,
    deliveryDocuments,
    lines: [
      {
        documentId: 'delivery-1',
        productId: 'cola',
        productName: 'COCA COLA ZERO 355ML',
        quantity: 1.2345
      },
      {
        documentId: 'delivery-2',
        productId: 'cola',
        productName: 'COCA COLA ZERO 355ML',
        quantity: 2.00005
      },
      {
        documentId: 'delivery-2',
        productId: 'harina',
        productName: 'HARINA',
        quantity: 0.3333
      }
    ],
    products,
    categories,
    ownerLabel: 'Depósito'
  });

  assert.equal(payload.id, parentDocument.id);
  assert.equal(payload.ownerLabel, 'Depósito');
  assert.equal(payload.items.length, 2);
  assert.deepEqual(payload.items[0], {
    name: 'COCA COLA ZERO 355ML',
    quantityText: '3,23455 UND',
    category: 'BEBIDAS',
    note: ''
  });
  assert.deepEqual(payload.items[1], {
    name: 'HARINA',
    quantityText: '0,3333 KG',
    category: 'VÍVERES',
    note: ''
  });
});
