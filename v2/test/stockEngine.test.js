import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVEMENT_TYPES } from '../src/core/movementTypes.js';
import {
  calculateStock,
  calculateStocksByProduct,
  calculateCoverageDays
} from '../src/inventory/stockEngine.js';

const movements = [
  { id: '1', productId: 'aceite', type: MOVEMENT_TYPES.ENTRY, quantity: 20, locationId: 'almacen' },
  { id: '2', productId: 'aceite', type: MOVEMENT_TYPES.ENTRY, quantity: 10, locationId: 'almacen' },
  { id: '3', productId: 'aceite', type: MOVEMENT_TYPES.SUPPLY, quantity: 4, locationId: 'almacen' },
  { id: '4', productId: 'aceite', type: MOVEMENT_TYPES.SUPPLY, quantity: 3, locationId: 'almacen' },
  { id: '5', productId: 'aceite', type: MOVEMENT_TYPES.ADJUSTMENT, quantity: 0, delta: -1, locationId: 'almacen' },
  { id: '6', productId: 'harina', type: MOVEMENT_TYPES.ENTRY, quantity: 8, locationId: 'almacen' }
];

test('calcula stock exclusivamente desde movimientos', () => {
  assert.equal(calculateStock(movements, 'aceite'), 22);
  assert.equal(calculateStock(movements, 'harina'), 8);
});

test('respeta ubicación', () => {
  const withSecondLocation = [
    ...movements,
    { id: '7', productId: 'aceite', type: MOVEMENT_TYPES.ENTRY, quantity: 5, locationId: 'cocina' }
  ];

  assert.equal(calculateStock(withSecondLocation, 'aceite', { locationId: 'almacen' }), 22);
  assert.equal(calculateStock(withSecondLocation, 'aceite', { locationId: 'cocina' }), 5);
});

test('genera mapa de stocks', () => {
  const stocks = calculateStocksByProduct(movements);
  assert.equal(stocks.get('aceite'), 22);
  assert.equal(stocks.get('harina'), 8);
});

test('calcula días de cobertura', () => {
  assert.equal(calculateCoverageDays(12, 3), 4);
  assert.equal(calculateCoverageDays(12, 0), Infinity);
});
