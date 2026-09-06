import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVEMENT_TYPES } from '../src/core/movementTypes.js';
import {
  buildAdaptiveDemandForecast
} from '../src/intelligence/replenishmentEngine.js';
import {
  buildAnomalyProtectedDemandSeries,
  buildAnnualSeasonality,
  buildVigiaDemandForecast
} from '../src/intelligence/demandLearning.js';

const DAY_MS = 86400000;

function supply(productId, quantity, now, daysAgo, metadata = null) {
  return {
    id: `mov_${productId}_${daysAgo}_${quantity}`,
    productId,
    type: MOVEMENT_TYPES.SUPPLY,
    quantity,
    metadata: metadata || {},
    effectiveAt: new Date(
      now.getTime() - (daysAgo * DAY_MS)
    ).toISOString()
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

test('V4-D limita un pico aislado sin modificar el movimiento original', () => {
  const now = new Date('2026-09-05T12:00:00Z');
  const movements = [];

  for (let day = 1; day <= 12; day++) {
    movements.push(supply('outlier', 10, now, day));
  }
  movements.push(supply('outlier', 250, now, 2.5));

  const before = JSON.stringify(movements);
  const protectedSeries = buildAnomalyProtectedDemandSeries(
    movements,
    'outlier',
    now
  );

  assert.equal(protectedSeries.diagnostics.anomalyCount, 1);
  assert.equal(protectedSeries.diagnostics.medianQuantity, 10);
  assert.equal(protectedSeries.diagnostics.upperCap, 40);
  assert.ok(
    protectedSeries.diagnostics.modeledDemandTotal <
      protectedSeries.diagnostics.originalDemandTotal
  );
  assert.ok(
    protectedSeries.diagnostics.reasonCodes.includes(
      'AUTOMATIC_OUTLIER_CAP'
    )
  );
  assert.equal(JSON.stringify(movements), before);

  const rawForecast = buildAdaptiveDemandForecast(
    movements,
    'outlier',
    now
  );
  const vigiaForecast = buildVigiaDemandForecast(
    movements,
    'outlier',
    now
  );

  assert.ok(
    vigiaForecast.preSeasonalityForecastDaily <
      rawForecast.forecastDaily
  );
});

test('V4-D permite excluir explícitamente un evento extraordinario solo del aprendizaje', () => {
  const now = new Date('2026-09-05T12:00:00Z');
  const movements = [];

  for (let day = 1; day <= 10; day++) {
    movements.push(supply('manual-exclusion', 5, now, day));
  }

  movements.push(
    supply(
      'manual-exclusion',
      1000,
      now,
      3.5,
      { demandLearningExcluded: true }
    )
  );

  const protectedSeries = buildAnomalyProtectedDemandSeries(
    movements,
    'manual-exclusion',
    now
  );

  assert.equal(protectedSeries.diagnostics.manualExcludedCount, 1);
  assert.ok(
    protectedSeries.diagnostics.reasonCodes.includes(
      'MANUAL_DEMAND_EXCLUSIONS'
    )
  );
  assert.equal(
    protectedSeries.movements.some(
      movement => movement.quantity === 1000
    ),
    false
  );
  assert.equal(
    movements.some(
      movement => movement.quantity === 1000
    ),
    true
  );
});

test('V4-D con menos de un año observa la fase pero no aplica estacionalidad anual', () => {
  const now = new Date('2026-09-05T12:00:00Z');
  const movements = weeklyHistory(
    'emerging',
    now,
    180,
    day => day <= 28 ? 14 : 7
  );

  const seasonality = buildAnnualSeasonality(
    movements,
    'emerging',
    now
  );

  assert.equal(seasonality.confidence, 'LOW');
  assert.equal(seasonality.appliedFactor, 1);
  assert.ok(
    seasonality.reasonCodes.includes('ANNUAL_HISTORY_NOT_READY')
  );
  assert.notEqual(
    seasonality.emergingPhaseDirection,
    'STABLE'
  );

  const forecast = buildVigiaDemandForecast(
    movements,
    'emerging',
    now
  );

  assert.equal(forecast.seasonalAdjustmentFactor, 1);
  assert.equal(
    forecast.forecastDaily,
    forecast.preSeasonalityForecastDaily
  );
});

test('V4-D con un ciclo anual puede anticipar una época alta sin duplicar agresivamente la demanda reciente', () => {
  const now = new Date('2026-02-20T12:00:00Z');
  const movements = weeklyHistory(
    'season-high',
    now,
    365,
    day => day >= 351 ? 21 : 7
  );

  const seasonality = buildAnnualSeasonality(
    movements,
    'season-high',
    now,
    {
      horizonDays: 14,
      maxYears: 1
    }
  );

  assert.equal(seasonality.confidence, 'MEDIUM');
  assert.ok(seasonality.seasonalFactor > 1);
  assert.ok(seasonality.appliedFactor > 1);
  assert.ok(seasonality.appliedFactor < seasonality.seasonalFactor);
  assert.ok(
    seasonality.reasonCodes.includes('ANNUAL_SEASON_HIGH')
  );

  const forecast = buildVigiaDemandForecast(
    movements,
    'season-high',
    now,
    {
      seasonalHorizonDays: 14,
      annualSeasonality: { maxYears: 1 }
    }
  );

  assert.ok(
    forecast.forecastDaily >
      forecast.preSeasonalityForecastDaily
  );
  assert.ok(forecast.seasonalAdjustmentFactor <= 1.25);
});

test('V4-D pondera más el año reciente que un patrón antiguo', () => {
  const now = new Date('2027-02-20T12:00:00Z');
  const movements = weeklyHistory(
    'multi-year',
    now,
    760,
    day => {
      if (day >= 345 && day <= 385) return 21;
      if (day >= 710 && day <= 750) return 3.5;
      return 7;
    }
  );

  const seasonality = buildAnnualSeasonality(
    movements,
    'multi-year',
    now,
    {
      horizonDays: 14,
      maxYears: 2
    }
  );

  assert.equal(seasonality.comparisonYears.length, 2);
  const recent = seasonality.comparisonYears[0];
  const older = seasonality.comparisonYears[1];

  assert.ok(recent.factor > older.factor);
  assert.ok(recent.weight > older.weight);
  assert.ok(
    seasonality.rawSeasonalFactor >
      ((recent.factor + older.factor) / 2)
  );
  assert.ok(
    seasonality.reasonCodes.includes(
      'MULTI_YEAR_RECENCY_WEIGHTING'
    )
  );
});

test('V4-D es puro y reproducible; protección y estacionalidad nunca reescriben la historia', () => {
  const now = new Date('2027-09-05T12:00:00Z');
  const movements = weeklyHistory(
    'pure-v4d',
    now,
    500,
    day => day >= 350 && day <= 390 ? 14 : 7
  );
  movements.push(supply('pure-v4d', 500, now, 5));

  const before = JSON.stringify(movements);
  const first = buildVigiaDemandForecast(
    movements,
    'pure-v4d',
    now
  );
  const second = buildVigiaDemandForecast(
    movements,
    'pure-v4d',
    now
  );

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(movements), before);
  assert.equal(first.modelVersion, 'V4-D');
});
