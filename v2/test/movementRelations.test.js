import test from 'node:test';
import assert from 'node:assert/strict';

const {
  assertMovementRelations,
  expectedDocumentTypes
} = await import('../server/src/sync/movementRelations.js');

test('expectedDocumentTypes asigna documentos válidos', () => {
  assert.deepEqual(expectedDocumentTypes('ENTRY'), ['ENTRY']);
  assert.deepEqual(expectedDocumentTypes('SUPPLY'), ['SUPPLY']);
  assert.deepEqual(
    expectedDocumentTypes('ADJUSTMENT'),
    ['COUNT', 'ADJUSTMENT']
  );
});

test('rechaza movimiento cuyo producto no existe', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('FROM products')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error('Consulta inesperada');
    }
  };

  await assert.rejects(
    assertMovementRelations(
      client,
      'workspace-1',
      {
        id: 'mov-1',
        productId: 'prd-missing',
        type: 'ENTRY',
        quantity: 1
      }
    ),
    error =>
      error.code === 'MOVEMENT_PRODUCT_NOT_FOUND' &&
      error.statusCode === 409
  );
});

test('rechaza documento incompatible con tipo de movimiento', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('FROM products')) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes('FROM documents')) {
        return {
          rowCount: 1,
          rows: [{ type: 'SUPPLY', status: 'CLOSED' }]
        };
      }
      throw new Error('Consulta inesperada');
    }
  };

  await assert.rejects(
    assertMovementRelations(
      client,
      'workspace-1',
      {
        id: 'mov-entry',
        productId: 'prd-1',
        documentId: 'doc-wrong',
        type: 'ENTRY',
        quantity: 2
      }
    ),
    error => error.code === 'MOVEMENT_DOCUMENT_TYPE_MISMATCH'
  );
});

test('rechaza reverso cuyo delta no compensa exactamente al original', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('FROM products')) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes('FROM documents')) {
        return {
          rowCount: 1,
          rows: [{ type: 'SUPPLY', status: 'CLOSED' }]
        };
      }
      if (sql.includes('FROM movements') && sql.includes('id = $2')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'mov-original',
            product_id: 'prd-1',
            type: 'SUPPLY',
            quantity: '5',
            delta: null,
            location_id: null
          }]
        };
      }
      throw new Error('Consulta inesperada');
    }
  };

  await assert.rejects(
    assertMovementRelations(
      client,
      'workspace-1',
      {
        id: 'mov-reversal',
        productId: 'prd-1',
        documentId: 'doc-supply',
        type: 'REVERSAL',
        quantity: 5,
        delta: 4,
        reversedMovementId: 'mov-original',
        locationId: null
      }
    ),
    error => error.code === 'REVERSAL_DELTA_MISMATCH'
  );
});

test('acepta reverso exacto y sin duplicados', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('FROM products')) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes('FROM documents')) {
        return {
          rowCount: 1,
          rows: [{ type: 'SUPPLY', status: 'CLOSED' }]
        };
      }
      if (sql.includes('reversed_movement_id = $2')) {
        return { rowCount: 0, rows: [] };
      }
      if (
        sql.includes('FROM movements') &&
        sql.includes('id = $2')
      ) {
        return {
          rowCount: 1,
          rows: [{
            id: 'mov-original',
            product_id: 'prd-1',
            type: 'SUPPLY',
            quantity: '5',
            delta: null,
            location_id: null
          }]
        };
      }
      throw new Error('Consulta inesperada');
    }
  };

  await assert.doesNotReject(
    assertMovementRelations(
      client,
      'workspace-1',
      {
        id: 'mov-reversal-ok',
        productId: 'prd-1',
        documentId: 'doc-supply',
        type: 'REVERSAL',
        quantity: 5,
        delta: 5,
        reversedMovementId: 'mov-original',
        locationId: null
      }
    )
  );
});
