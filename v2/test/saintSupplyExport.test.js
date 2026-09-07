import test from 'node:test';
import assert from 'node:assert/strict';

const {
  buildSaintSupplyReportModel,
  saintSupplyFilename
} = await import('../src/export/saintSupplyExport.js');

function supply(overrides = {}) {
  return {
    id: 'sup-v5c-001',
    type: 'SUPPLY',
    status: 'CLOSED',
    ownerId: 'almacenista-1',
    closedBy: 'god-1',
    destinationId: 'loc-cafeteria',
    reference: 'DESCARGO TEST',
    metadata: {},
    createdAt: '2026-09-07T08:00:00.000Z',
    updatedAt: '2026-09-07T09:00:00.000Z',
    closedAt: '2026-09-07T09:00:00.000Z',
    ...overrides
  };
}

const products = [
  {
    id: 'p-arroz',
    name: 'ARROZ TIPO III 800GRS',
    saintCode: '0313',
    inventoryUnitId: 'unit_und'
  },
  {
    id: 'p-azucar',
    name: 'AZUCAR A GRANEL',
    saintCode: '0290',
    inventoryUnitId: 'unit_kg'
  }
];

const lines = [
  {
    id: 'l1',
    documentId: 'sup-v5c-001',
    productId: 'p-arroz',
    productName: 'ARROZ TIPO III 800GRS',
    quantity: 20,
    notes: ''
  },
  {
    id: 'l2',
    documentId: 'sup-v5c-001',
    productId: 'p-azucar',
    productName: 'AZUCAR A GRANEL',
    quantity: 5.5,
    notes: 'Cocina'
  }
];

test('reporte SAINT conserva código, cantidad y unidad base', () => {
  const model = buildSaintSupplyReportModel({
    document: supply(),
    lines,
    products,
    locations: [
      { id: 'loc-cafeteria', name: 'CAFETERÍA' }
    ]
  });

  assert.equal(model.rows.length, 2);
  assert.deepEqual(
    model.rows.map(row => [
      row['Código SAINT'],
      row.Producto,
      row.Cantidad,
      row.Unidad
    ]),
    [
      ['0313', 'ARROZ TIPO III 800GRS', 20, 'UND'],
      ['0290', 'AZUCAR A GRANEL', 5.5, 'KG']
    ]
  );
  assert.equal(model.destination, 'CAFETERÍA');
  assert.equal(model.responsible, 'god-1');
  assert.equal(model.readyForManualSaint, true);
  assert.equal(model.missingSaintCount, 0);
  assert.deepEqual(model.totalsByUnit, [
    { unit: 'KG', quantity: 5.5 },
    { unit: 'UND', quantity: 20 }
  ]);
});

test('metadata de destino tiene prioridad y el reporte identifica Código SAINT faltante', () => {
  const model = buildSaintSupplyReportModel({
    document: supply({
      metadata: {
        destinationName: 'BARRA PRINCIPAL',
        responsibleName: 'Armando'
      }
    }),
    lines: [
      {
        documentId: 'sup-v5c-001',
        productId: 'p-sin-saint',
        productName: 'PRODUCTO SIN SAINT',
        quantity: 2
      }
    ],
    products: [
      {
        id: 'p-sin-saint',
        name: 'PRODUCTO SIN SAINT',
        saintCode: '',
        inventoryUnitId: 'unit_und'
      }
    ],
    locations: []
  });

  assert.equal(model.destination, 'BARRA PRINCIPAL');
  assert.equal(model.missingSaintCount, 1);
  assert.equal(model.readyForManualSaint, false);
  assert.match(model.warnings.join(' '), /sin Código SAINT/i);
});

test('no permite reporte SAINT de borrador ni de otro tipo de documento', () => {
  assert.throws(
    () => buildSaintSupplyReportModel({
      document: supply({ status: 'DRAFT' }),
      lines,
      products
    }),
    /cierra el surtido/i
  );

  assert.throws(
    () => buildSaintSupplyReportModel({
      document: supply({ type: 'ENTRY' }),
      lines,
      products
    }),
    /solo admite documentos de Surtido/i
  );
});

test('nombre del archivo queda estable y seguro', () => {
  assert.equal(
    saintSupplyFilename({ documentId: 'sup 2026/09/07 #1' }),
    'vigia_saint_surtido_sup-2026-09-07-1'
  );
});
