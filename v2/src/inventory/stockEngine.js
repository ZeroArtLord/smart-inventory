import { stockDeltaForMovement } from '../core/movementTypes.js';

export function calculateStock(movements, productId, { locationId = null } = {}) {
  return movements.reduce((total, movement) => {
    if (movement.productId !== productId) return total;
    if (movement.voided === true) return total;

    if (locationId && movement.locationId && movement.locationId !== locationId) {
      return total;
    }

    return total + stockDeltaForMovement(movement);
  }, 0);
}

export function calculateStocksByProduct(movements) {
  const stocks = new Map();

  movements.forEach(movement => {
    if (movement.voided === true) return;
    const current = stocks.get(movement.productId) || 0;
    stocks.set(
      movement.productId,
      current + stockDeltaForMovement(movement)
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
