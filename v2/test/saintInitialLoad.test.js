import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  buildSaintInitialLoadDraft,
  reconstructSaintInitialLoad,
  saintInitialLoadSummary,
  initialLoadDocumentId,
  initialLoadMovementId
} = await import('../src/catalog/saintInitialLoad.js');

test('prepara carga inicial vinculando filas SAINT con productos importados', () => {
  const preview = {
    fileName: 'saint.xlsx',
    sheetName: 'Existencia',
    rows: [
      {
        excelRow: 2,
        name: 'REFRESCO COLA',
        sku: 'REF001',
        barcode: '',
        unitCode: 'UND',
        saintInitialStock: 485
      },
      {
        excelRow: 3,
        name: 'AGUA',
        sku: 'AGU001',
        barcode: '',
        unitCode: 'UND',
        saintInitialStock: 0
      }
    ]
  };

  const products = [
    {
      id: 'prd_ref',
      name: 'REFRESCO COLA',
      sku: 'REF001'
    },
    {
      id: 'prd_agua',
      name: 'AGUA',
      sku: 'AGU001'
    }
  ];

  const draft = buildSaintInitialLoadDraft(
    preview,
    products
  );

  assert.equal(draft.source, 'SAINT');
  assert.equal(draft.rows.length, 2);
  assert.equal(draft.rows[0].productId, 'prd_ref');
  assert.equal(draft.rows[0].quantity, 485);
  assert.equal(draft.rows[1].quantity, 0);

  assert.deepEqual(
    saintInitialLoadSummary(draft),
    {
      productCount: 2,
      positiveStockCount: 1,
      zeroStockCount: 1
    }
  );
});

test('reconstruye documento y movimientos deterministas desde evento remoto', () => {
  const payload = {
    id: 'saintload_test',
    source: 'SAINT',
    createdAt: '2026-09-03T14:00:00.000Z',
    appliedAt: '2026-09-03T14:05:00.000Z',
    appliedBy: 'usr_1',
    rows: [
      {
        productId: 'prd_ref',
        quantity: 485,
        sourceCode: 'REF001',
        sourceRow: 2
      },
      {
        productId: 'prd_zero',
        quantity: 0,
        sourceCode: 'ZERO',
        sourceRow: 3
      }
    ]
  };

  const result = reconstructSaintInitialLoad({
    entityType: 'initialLoad',
    payload,
    userId: 'usr_1'
  });

  assert.equal(
    result.document.id,
    initialLoadDocumentId(payload.id)
  );
  assert.equal(result.document.type, 'ADJUSTMENT');
  assert.equal(result.document.status, 'CLOSED');
  assert.equal(result.lines.length, 2);
  assert.equal(result.movements.length, 1);
  assert.equal(
    result.movements[0].id,
    initialLoadMovementId(payload.id, 0)
  );
  assert.equal(result.movements[0].delta, 485);
  assert.equal(
    result.movements[0].metadata.kind,
    'SAINT_INITIAL_LOAD'
  );
});

test('rechaza carga si una fila no puede vincularse al catálogo', () => {
  assert.throws(
    () => buildSaintInitialLoadDraft(
      {
        rows: [
          {
            excelRow: 5,
            name: 'NO EXISTE',
            sku: 'MISS001',
            saintInitialStock: 10
          }
        ]
      },
      []
    ),
    /No se pudieron vincular/i
  );
});
