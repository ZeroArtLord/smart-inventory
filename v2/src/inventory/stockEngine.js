import { stockDeltaForMovement } from '../core/movementTypes.js';

const STOCK_EPSILON = 1e-9;

function normalizeStockTotal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return number;
  return Math.abs(number) <= STOCK_EPSILON ? 0 : number;
}

export function calculateStock(movements, productId, { locationId = null } = {}) {
  const total = movements.reduce((current, movement) => {
    if (movement.productId !== productId) return current;
    if (movement.voided === true) return current;

    if (locationId && movement.locationId !== locationId) {
      return current;
    }

    return current + stockDeltaForMovement(movement);
  }, 0);

  return normalizeStockTotal(total);
}

export function calculateStocksByProduct(movements) {
  const stocks = new Map();

  movements.forEach(movement => {
    if (movement.voided === true) return;
    const current = stocks.get(movement.productId) || 0;
    stocks.set(
      movement.productId,
      normalizeStockTotal(
        current + stockDeltaForMovement(movement)
      )
    );
  });

  return stocks;
}

export function calculateCoverageDays(stock, averageDailyConsumption) {
  const currentStock = Number(stock);
  const daily = Number(averageDailyConsumption);

  if (!Number.isFinite(currentStock) || currentStock < 0) return 0;
  if (!Number.isFinite(daily) || daily <= 0) return Infinity;

  return currentStock / daily;
}
