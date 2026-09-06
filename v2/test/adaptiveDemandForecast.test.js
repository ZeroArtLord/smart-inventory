import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVEMENT_TYPES } from '../src/core/movementTypes.js';
import {
  buildAdaptiveDemandForecast
} from '../src/intelligence/replenishmentEngine.js';

const DAY_MS = 86400000;

function supply(productId, quantity, now, daysAgo) {
  return {
    productId,
    type: MOVEMENT_TYPES.SUPPLY,
    quantity,
    effectiveAt: new Date(
      now.getTime() - (daysAgo * DAY_MS)
    ).toISOString()
  };
}

test('V4-B sin historial no inventa demanda', () => {
  const now = new Date('2026-09-04T12:00:00Z');
  const forecast = buildAdaptiveDemandForecast(
    [],
    'sin-historial',
    now
  );

  assert.equal(forecast.forecastDaily, 0);
  assert.equal(forecast.forecastWeekly, 0);
  assert.equal(forecast.confidence, 'INSUFFICIENT');
  assert.ok(forecast.reasonCodes.includes('NO_HISTORY'));
  assert.ok(forecast.reasonCodes.includes('TREND_INSUFFICIENT'));
});

test('V4-B detecta aceleración fuerte y limita el ajuste al factor de seguridad actual', () => {
  const now = new Date('2026-09-04T12:00:00Z');
  const movements = [];

  for (let day = 1; day <= 7; day++) {
    movements.push(supply('subida', 4, now, day));
  }

  for (let day = 15; day <= 21; day++) {
    movements.push(supply('subida', 1, now, day));
  }

  const forecast = buildAdaptiveDemandForecast(
    movements,
    'subida',
    now
  );

  assert.equal(forecast.trendDirection, 'UP');
  assert.ok(forecast.trendPercentChange > 100);
  assert.ok(
    forecast.trendAdjustedDailyConsumption >
      forecast.baseDailyConsumption
  );
  assert.ok(forecast.trendAdjustmentFactor <= 1.5);
  assert.ok(forecast.reasonCodes.includes('TREND_UP'));
});

test('V4-B reduce demanda de forma conservadora cuando el consumo cae', () => {
  const now = new Date('2026-09-04T12:00:00Z');
  const movements = [];

  for (let day = 1; day <= 7; day++) {
    movements.push(supply('bajada', 1, now, day));
  }

  for (let day = 15; day <= 21; day++) {
    movements.push(supply('bajada', 4, now, day));
  }

  const forecast = buildAdaptiveDemandForecast(
    movements,
    'bajada',
    now
  );

  assert.equal(forecast.trendDirection, 'DOWN');
  assert.ok(forecast.trendPercentChange < -50);
  assert.ok(
    forecast.trendAdjustedDailyConsumption <
      forecast.baseDailyConsumption
  );
  assert.ok(forecast.trendAdjustmentFactor >= 0.85);
  assert.ok(forecast.reasonCodes.includes('TREND_DOWN'));
});

test('V4-B es puro, reproducible y no modifica los movimientos de entrada', () => {
  const now = new Date('2026-09-04T12:00:00Z');
  const movements = [
    supply('puro', 3, now, 1),
    supply('puro', 3, now, 7),
    supply('puro', 2, now, 15),
    supply('puro', 2, now, 20)
  ];
  const before = JSON.stringify(movements);

  const first = buildAdaptiveDemandForecast(
    movements,
    'puro',
    now
  );
  const second = buildAdaptiveDemandForecast(
    movements,
    'puro',
    now
  );

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(movements), before);
});
