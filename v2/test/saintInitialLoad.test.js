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

const {
  applyRemoteEvents
} = await import('../src/sync/remoteApply.js');

const {
  STORES,
  getAll
} = await import('../src/storage/database.js');

test('prepara carga inicial vinculando filas SAINT con productos importados', () => {
  const preview = {
    fileName: 'saint.xlsx',
    fileSize: 2048,
    fileSha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    sheetName: 'Existencia',
    hasInitialStockColumn: true,
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
  assert.equal(draft.fileSize, 2048);
  assert.equal(
    draft.fileSha256,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  );
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
        hasInitialStockColumn: true,
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


test('aplicar evento remoto de carga inicial crea documento, líneas y movimientos locales', async () => {
  const payload = {
    id: 'saintload_remote_apply',
    source: 'SAINT',
    createdAt: '2026-09-03T15:00:00.000Z',
    appliedAt: '2026-09-03T15:01:00.000Z',
    appliedBy: 'usr_remote',
    rows: [
      {
        productId: 'prd_remote_a',
        quantity: 12,
        sourceCode: 'A',
        sourceRow: 2
      },
      {
        productId: 'prd_remote_b',
        quantity: 0,
        sourceCode: 'B',
        sourceRow: 3
      }
    ]
  };

  const applied = await applyRemoteEvents([
    {
      id: 'evt_initial_remote',
      entityType: 'initialLoad',
      entityId: payload.id,
      operation: 'CREATE',
      payload,
      userId: 'usr_remote',
      appliedAt: payload.appliedAt
    }
  ]);

  assert.equal(applied, 1);

  const documents = await getAll(STORES.DOCUMENTS);
  const lines = await getAll(STORES.DOCUMENT_LINES);
  const movements = await getAll(STORES.MOVEMENTS);

  const document = documents.find(
    item => item.id === initialLoadDocumentId(payload.id)
  );

  assert.ok(document);
  assert.equal(document.metadata.kind, 'SAINT_INITIAL_LOAD');

  assert.equal(
    lines.filter(line => line.documentId === document.id).length,
    2
  );

  const openingMovements = movements.filter(
    movement => movement.metadata?.initialLoadId === payload.id
  );

  assert.equal(openingMovements.length, 1);
  assert.equal(openingMovements[0].delta, 12);
});


test('rechaza preparar apertura si el archivo no trae columna de existencia', () => {
  assert.throws(
    () => buildSaintInitialLoadDraft(
      {
        hasInitialStockColumn: false,
        rows: [
          {
            excelRow: 2,
            name: 'PRODUCTO',
            sku: 'P001',
            saintInitialStock: null
          }
        ]
      },
      [
        {
          id: 'prd_p001',
          name: 'PRODUCTO',
          sku: 'P001'
        }
      ]
    ),
    /no contiene una columna de Existencia SAINT/i
  );
});

test('requiere cero explícito cuando una existencia SAINT está vacía', () => {
  assert.throws(
    () => buildSaintInitialLoadDraft(
      {
        hasInitialStockColumn: true,
        rows: [
          {
            excelRow: 2,
            name: 'PRODUCTO',
            sku: 'P001',
            saintInitialStock: null
          }
        ]
      },
      [
        {
          id: 'prd_p001',
          name: 'PRODUCTO',
          sku: 'P001'
        }
      ]
    ),
    /Escribe 0/i
  );
});


test('rechaza una huella SHA-256 inválida en la carga inicial', () => {
  assert.throws(
    () => buildSaintInitialLoadDraft(
      {
        hasInitialStockColumn: true,
        fileSha256: 'no-es-un-sha256',
        rows: [
          {
            excelRow: 2,
            name: 'PRODUCTO',
            sku: 'P001',
            saintInitialStock: 0
          }
        ]
      },
      [
        {
          id: 'prd_p001',
          name: 'PRODUCTO',
          sku: 'P001'
        }
      ]
    ),
    /SHA-256/i
  );
});


