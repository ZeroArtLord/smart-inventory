import test from 'node:test';
import assert from 'node:assert/strict';

const {
  movementStockDelta,
  assertMovementKeepsStockNonNegative
} = await import('../server/src/sync/stockInvariant.js');

test('movementStockDelta traduce tipos a impacto de stock', () => {
  assert.equal(movementStockDelta({ type: 'ENTRY', quantity: 5 }), 5);
  assert.equal(movementStockDelta({ type: 'SUPPLY', quantity: 5 }), -5);
  assert.equal(movementStockDelta({ type: 'ADJUSTMENT', delta: -2 }), -2);
  assert.equal(movementStockDelta({ type: 'REVERSAL', delta: 3 }), 3);
  assert.equal(movementStockDelta({ type: 'TRANSFER', quantity: 9 }), 0);
});

test('servidor rechaza movimiento que dejaría stock negativo', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);

      if (sql.includes('pg_advisory_xact_lock')) {
        return { rowCount: 1, rows: [{}] };
      }

      if (sql.includes('SELECT 1 FROM movements')) {
        return { rowCount: 0, rows: [] };
      }

      if (sql.includes('COALESCE(SUM')) {
        return { rowCount: 1, rows: [{ stock: '4' }] };
      }

      throw new Error('Consulta inesperada');
    }
  };

  await assert.rejects(
    assertMovementKeepsStockNonNegative(
      client,
      'workspace-1',
      {
        id: 'mov-1',
        productId: 'prd-1',
        locationId: null,
        type: 'SUPPLY',
        quantity: 5
      }
    ),
    error =>
      error.code === 'STOCK_NEGATIVE' &&
      error.statusCode === 409 &&
      error.details.currentStock === 4 &&
      error.details.resultingStock === -1
  );

  assert.equal(calls.length, 3);
});

test('movimiento duplicado no vuelve a validar ni aplicar stock', async () => {
  let calls = 0;
  const client = {
    async query(sql) {
      calls += 1;

      if (sql.includes('pg_advisory_xact_lock')) {
        return { rowCount: 1, rows: [{}] };
      }

      if (sql.includes('SELECT 1 FROM movements')) {
        return { rowCount: 1, rows: [{}] };
      }

      throw new Error('No debería consultar stock');
    }
  };

  const result = await assertMovementKeepsStockNonNegative(
    client,
    'workspace-1',
    {
      id: 'mov-existing',
      productId: 'prd-1',
      type: 'SUPPLY',
      quantity: 999
    }
  );

  assert.deepEqual(result, { duplicateMovement: true });
  assert.equal(calls, 2);
});

test('entrada válida devuelve stock resultante', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rowCount: 1, rows: [{}] };
      }

      if (sql.includes('SELECT 1 FROM movements')) {
        return { rowCount: 0, rows: [] };
      }

      if (sql.includes('COALESCE(SUM')) {
        return { rowCount: 1, rows: [{ stock: '7' }] };
      }

      throw new Error('Consulta inesperada');
    }
  };

  const result = await assertMovementKeepsStockNonNegative(
    client,
    'workspace-1',
    {
      id: 'mov-entry',
      productId: 'prd-1',
      type: 'ENTRY',
      quantity: 3
    }
  );

  assert.equal(result.currentStock, 7);
  assert.equal(result.resultingStock, 10);
});
