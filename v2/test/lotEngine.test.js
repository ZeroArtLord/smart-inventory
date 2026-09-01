import test from 'node:test';
import assert from 'node:assert/strict';

const {
  allocateLotsFefo
} = await import('../src/inventory/lotEngine.js');

test('FEFO consume primero el lote que vence antes', () => {
  const result = allocateLotsFefo([
    {
      id: 'lot-late',
      remainingQuantity: 10,
      expiresAt: '2027-06-01T00:00:00.000Z',
      receivedAt: '2026-09-01T00:00:00.000Z'
    },
    {
      id: 'lot-early',
      remainingQuantity: 8,
      expiresAt: '2027-01-01T00:00:00.000Z',
      receivedAt: '2026-09-02T00:00:00.000Z'
    }
  ], 12);

  assert.deepEqual(
    result.allocations.map(item => [item.lotId, item.quantity]),
    [
      ['lot-early', 8],
      ['lot-late', 4]
    ]
  );
  assert.equal(result.untrackedQuantity, 0);
});

test('FEFO deja cantidad no rastreada si el stock por lotes no cubre todo', () => {
  const result = allocateLotsFefo([
    {
      id: 'lot-only',
      remainingQuantity: 3,
      expiresAt: '2027-01-01T00:00:00.000Z'
    }
  ], 7);

  assert.equal(result.allocatedQuantity, 3);
  assert.equal(result.untrackedQuantity, 4);
});

test('FEFO respeta ubicación cuando se solicita', () => {
  const result = allocateLotsFefo([
    {
      id: 'lot-a',
      locationId: 'almacen-a',
      remainingQuantity: 5,
      expiresAt: '2027-01-01T00:00:00.000Z'
    },
    {
      id: 'lot-b',
      locationId: 'almacen-b',
      remainingQuantity: 9,
      expiresAt: '2026-12-01T00:00:00.000Z'
    }
  ], 4, { locationId: 'almacen-a' });

  assert.deepEqual(
    result.allocations.map(item => item.lotId),
    ['lot-a']
  );
  assert.equal(result.untrackedQuantity, 0);
});

test('lotes sin vencimiento se consumen después de los fechados', () => {
  const result = allocateLotsFefo([
    {
      id: 'lot-no-expiry',
      remainingQuantity: 5,
      expiresAt: null,
      receivedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      id: 'lot-expiry',
      remainingQuantity: 5,
      expiresAt: '2028-01-01T00:00:00.000Z',
      receivedAt: '2026-09-01T00:00:00.000Z'
    }
  ], 6);

  assert.deepEqual(
    result.allocations.map(item => [item.lotId, item.quantity]),
    [
      ['lot-expiry', 5],
      ['lot-no-expiry', 1]
    ]
  );
});
