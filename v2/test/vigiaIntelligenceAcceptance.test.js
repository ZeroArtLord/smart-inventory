import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVEMENT_TYPES } from '../src/core/movementTypes.js';
import {
  getAdaptiveReplenishmentSuggestion
} from '../src/intelligence/replenishmentEngine.js';
import {
  buildAnomalyProtectedDemandSeries,
  buildAnnualSeasonality,
  buildVigiaDemandForecast
} from '../src/intelligence/demandLearning.js';

const DAY_MS = 86400000;

function supply(productId, quantity, now, daysAgo, metadata = null) {
  return {
    id: `acc_${productId}_${daysAgo}_${quantity}`,
    productId,
    type: MOVEMENT_TYPES.SUPPLY,
    quantity,
    metadata: metadata || {},
    effectiveAt: new Date(
      now.getTime() - (daysAgo * DAY_MS)
    ).toISOString()
  };
}

function product(overrides = {}) {
  return {
    id: 'prd-acceptance',
    name: 'Producto aceptación',
    minStock: 5,
    maxStock: 12,
    intelligenceMode: 'SEED',
    targetDays: 7,
    safetyDays: 0,
    active: true,
    ...overrides
  };
}

function trustedForecast(overrides = {}) {
  return {
    modelVersion: 'V4-D',
    forecastDaily: 24 / 7,
    forecastWeekly: 24,
    confidence: 'HIGH',
    reasonCodes: ['RECENT_CONSUMPTION'],
    ...overrides
  };
}

function weeklyHistory(
  productId,
  now,
  totalDays,
  quantityForDay = () => 7
) {
  const movements = [];

  for (let day = 1; day <= totalDays; day += 7) {
    movements.push(
      supply(
        productId,
        quantityForDay(day),
        now,
        day
      )
    );
  }

  return movements;
}

test('V4-F sin historial no inventa demanda ni estacionalidad', () => {
  const now = new Date('2026-09-06T12:00:00Z');
  const forecast = buildVigiaDemandForecast(
    [],
    'sin-historial',
    now
  );

  assert.equal(forecast.forecastDaily, 0);
  assert.equal(forecast.forecastWeekly, 0);
  assert.equal(forecast.confidence, 'INSUFFICIENT');
  assert.equal(forecast.seasonalAdjustmentFactor, 1);
  assert.ok(forecast.reasonCodes.includes('NO_HISTORY'));
});

test('V4-F con 7-14 días conserva confianza LOW y comportamiento prudente', () => {
  const now = new Date('2026-09-06T12:00:00Z');
  const movements = [
    supply('warmup', 2, now, 1),
    supply('warmup', 2, now, 7)
  ];

  const forecast = buildVigiaDemandForecast(
    movements,
    'warmup',
    now
  );
  const suggestion = getAdaptiveReplenishmentSuggestion(
    product({ minStock: 10, maxStock: 40 }),
    {
      stock: 0,
      forecast
    }
  );

  assert.equal(forecast.confidence, 'LOW');
  assert.equal(forecast.seasonalAdjustmentFactor, 1);
  assert.equal(suggestion.vigiaTargetStock, 10);
  assert.ok(
    suggestion.reasonCodes.includes('SEED_LOW_CONFIDENCE_FLOOR')
  );
});

test('V4-F una aceleración desde consumo bajo a ~24 por semana aumenta el forecast', () => {
  const now = new Date('2026-09-06T12:00:00Z');
  const movements = [];

  for (let day = 1; day <= 7; day++) {
    movements.push(
      supply('surge', 24 / 7, now, day)
    );
  }

  for (let day = 15; day <= 21; day++) {
    movements.push(
      supply('surge', 1 / 7, now, day)
    );
  }

  movements.push(supply('surge', 1, now, 35));

  const forecast = buildVigiaDemandForecast(
    movements,
    'surge',
    now
  );

  assert.equal(forecast.trendDirection, 'UP');
  assert.ok(
    forecast.forecastWeekly >
      forecast.baseWeeklyConsumption
  );
  assert.ok(forecast.forecastWeekly > 12);
});

test('V4-F máximo manual 12 no atrapa una demanda confiable de 24 en SEED o ADAPTIVE', () => {
  const forecast = trustedForecast();

  const seed = getAdaptiveReplenishmentSuggestion(
    product({
      minStock: 5,
      maxStock: 12,
      intelligenceMode: 'SEED'
    }),
    {
      stock: 0,
      forecast
    }
  );

  const adaptive = getAdaptiveReplenishmentSuggestion(
    product({
      minStock: 5,
      maxStock: 12,
      intelligenceMode: 'ADAPTIVE'
    }),
    {
      stock: 0,
      forecast
    }
  );

  assert.equal(seed.vigiaTargetStock, 24);
  assert.equal(adaptive.vigiaTargetStock, 24);
  assert.ok(seed.vigiaTargetStock > seed.manualMax);
  assert.ok(adaptive.vigiaTargetStock > adaptive.manualMax);
});

test('V4-F cuando el consumo cae de ~24 a ~10 por semana el ajuste baja gradualmente', () => {
  const now = new Date('2026-09-06T12:00:00Z');
  const movements = [];

  for (let day = 1; day <= 7; day++) {
    movements.push(
      supply('cooldown', 10 / 7, now, day)
    );
  }

  for (let day = 15; day <= 21; day++) {
    movements.push(
      supply('cooldown', 24 / 7, now, day)
    );
  }

  movements.push(supply('cooldown', 2, now, 35));

  const forecast = buildVigiaDemandForecast(
    movements,
    'cooldown',
    now
  );

  assert.equal(forecast.trendDirection, 'DOWN');
  assert.ok(
    forecast.forecastWeekly <
      forecast.baseWeeklyConsumption
  );
  assert.ok(forecast.trendAdjustmentFactor >= 0.85);
});

test('V4-F mercancía en camino se descuenta sin convertirse en stock físico', () => {
  const result = getAdaptiveReplenishmentSuggestion(
    product({
      intelligenceMode: 'ADAPTIVE',
      targetDays: 7
    }),
    {
      stock: 3,
      pendingInbound: 5,
      forecast: trustedForecast({
        forecastDaily: 2,
        forecastWeekly: 14
      })
    }
  );

  assert.equal(result.stock, 3);
  assert.equal(result.pendingInbound, 5);
  assert.equal(result.projectedAvailable, 8);
  assert.equal(result.vigiaTargetStock, 14);
  assert.equal(result.suggestedQuantity, 6);
});

test('V4-F HARD_LIMIT respeta el máximo administrativo y deja advertencia', () => {
  const result = getAdaptiveReplenishmentSuggestion(
    product({
      minStock: 5,
      maxStock: 12,
      intelligenceMode: 'HARD_LIMIT'
    }),
    {
      stock: 0,
      forecast: trustedForecast({
        forecastDaily: 4,
        forecastWeekly: 28
      })
    }
  );

  assert.equal(result.rawDynamicTarget, 28);
  assert.equal(result.vigiaTargetStock, 12);
  assert.ok(
    result.warningCodes.includes('DEMAND_ABOVE_HARD_MAX')
  );
});

test('V4-F con menos de un año no aplica una estacionalidad anual inventada', () => {
  const now = new Date('2026-09-06T12:00:00Z');
  const movements = weeklyHistory(
    'under-year',
    now,
    180,
    day => day <= 28 ? 14 : 7
  );

  const seasonality = buildAnnualSeasonality(
    movements,
    'under-year',
    now
  );

  assert.equal(seasonality.confidence, 'LOW');
  assert.equal(seasonality.appliedFactor, 1);
  assert.ok(
    seasonality.reasonCodes.includes('ANNUAL_HISTORY_NOT_READY')
  );
});

test('V4-F con un ciclo anual reconoce una época alta y anticipa demanda', () => {
  const now = new Date('2026-02-20T12:00:00Z');
  const movements = weeklyHistory(
    'annual-high',
    now,
    365,
    day => day >= 351 ? 21 : 7
  );

  const forecast = buildVigiaDemandForecast(
    movements,
    'annual-high',
    now,
    {
      seasonalHorizonDays: 14,
      annualSeasonality: {
        maxYears: 1
      }
    }
  );

  assert.ok(forecast.seasonalAdjustmentFactor > 1);
  assert.ok(
    forecast.forecastDaily >
      forecast.preSeasonalityForecastDaily
  );
  assert.ok(
    forecast.reasonCodes.includes('ANNUAL_SEASON_HIGH')
  );
});

test('V4-F un pico aislado no redefine la demanda normal ni reescribe la historia', () => {
  const now = new Date('2026-09-06T12:00:00Z');
  const movements = [];

  for (let day = 1; day <= 12; day++) {
    movements.push(
      supply('spike', 10, now, day)
    );
  }
  movements.push(
    supply('spike', 250, now, 2.5)
  );

  const before = JSON.stringify(movements);
  const protectedSeries = buildAnomalyProtectedDemandSeries(
    movements,
    'spike',
    now
  );

  assert.equal(protectedSeries.diagnostics.anomalyCount, 1);
  assert.ok(
    protectedSeries.diagnostics.modeledDemandTotal <
      protectedSeries.diagnostics.originalDemandTotal
  );
  assert.equal(JSON.stringify(movements), before);
});

test('V4-F 1000 evaluaciones son puras: crean cero movimientos y no mutan inputs', () => {
  const now = new Date('2027-09-06T12:00:00Z');
  const movements = weeklyHistory(
    'pure-1000',
    now,
    500,
    day => day >= 350 && day <= 390 ? 14 : 7
  );
  movements.push(
    supply('pure-1000', 500, now, 5)
  );

  const item = product({
    id: 'pure-1000',
    intelligenceMode: 'ADAPTIVE',
    targetDays: 7,
    safetyDays: 2
  });
  const beforeMovements = JSON.stringify(movements);
  const beforeProduct = JSON.stringify(item);
  const originalLength = movements.length;

  let last = null;

  for (let iteration = 0; iteration < 1000; iteration++) {
    const forecast = buildVigiaDemandForecast(
      movements,
      'pure-1000',
      now
    );

    last = getAdaptiveReplenishmentSuggestion(
      item,
      {
        stock: 5,
        pendingInbound: 2,
        forecast
      }
    );
  }

  assert.ok(last);
  assert.equal(movements.length, originalLength);
  assert.equal(JSON.stringify(movements), beforeMovements);
  assert.equal(JSON.stringify(item), beforeProduct);
});
