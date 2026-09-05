import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAdaptiveReplenishmentSuggestion
} from '../src/intelligence/replenishmentEngine.js';

function product(overrides = {}) {
  return {
    minStock: 5,
    maxStock: 12,
    intelligenceMode: 'SEED',
    targetDays: 7,
    safetyDays: 0,
    ...overrides
  };
}

function forecast(overrides = {}) {
  return {
    forecastDaily: 4,
    forecastWeekly: 28,
    confidence: 'HIGH',
    reasonCodes: ['RECENT_CONSUMPTION'],
    ...overrides
  };
}

test('V4-C sin pronóstico confiable usa el mínimo manual como fallback seguro', () => {
  const result = getAdaptiveReplenishmentSuggestion(
    product({ minStock: 6, maxStock: 20 }),
    {
      stock: 2,
      forecast: forecast({
        forecastDaily: 0,
        forecastWeekly: 0,
        confidence: 'INSUFFICIENT',
        reasonCodes: ['NO_HISTORY']
      })
    }
  );

  assert.equal(result.dynamicReady, false);
  assert.equal(result.vigiaTargetStock, 6);
  assert.equal(result.suggestedQuantity, 4);
  assert.ok(result.reasonCodes.includes('MANUAL_SEED_FALLBACK'));
});

test('V4-C modo SEED no deja que un máximo manual viejo frene demanda confiable', () => {
  const result = getAdaptiveReplenishmentSuggestion(
    product({
      minStock: 5,
      maxStock: 12,
      intelligenceMode: 'SEED'
    }),
    {
      stock: 0,
      forecast: forecast({ forecastDaily: 24 / 7 })
    }
  );

  assert.equal(result.mode, 'SEED');
  assert.equal(result.vigiaTargetStock, 24);
  assert.ok(result.vigiaTargetStock > result.manualMax);
  assert.equal(result.suggestedQuantity, 24);
  assert.ok(result.reasonCodes.includes('SEED_DYNAMIC_TARGET'));
});

test('V4-C modo ADAPTIVE deriva el objetivo de demanda aunque supere máximo manual', () => {
  const result = getAdaptiveReplenishmentSuggestion(
    product({
      minStock: 5,
      maxStock: 12,
      intelligenceMode: 'ADAPTIVE',
      targetDays: 7,
      safetyDays: 2
    }),
    {
      stock: 5,
      forecast: forecast({ forecastDaily: 3 })
    }
  );

  assert.equal(result.mode, 'ADAPTIVE');
  assert.equal(result.vigiaRecommendedMin, 21);
  assert.equal(result.vigiaRecommendedMax, 27);
  assert.equal(result.vigiaTargetStock, 27);
  assert.ok(result.vigiaTargetStock > result.manualMax);
  assert.ok(result.reasonCodes.includes('ADAPTIVE_DYNAMIC_TARGET'));
});

test('V4-C modo HARD_LIMIT respeta máximo administrativo y explica el choque', () => {
  const result = getAdaptiveReplenishmentSuggestion(
    product({
      minStock: 5,
      maxStock: 12,
      intelligenceMode: 'HARD_LIMIT'
    }),
    {
      stock: 0,
      forecast: forecast({ forecastDaily: 4 })
    }
  );

  assert.equal(result.rawDynamicTarget, 28);
  assert.equal(result.vigiaTargetStock, 12);
  assert.equal(result.suggestedQuantity, 12);
  assert.ok(result.warningCodes.includes('DEMAND_ABOVE_HARD_MAX'));
  assert.ok(result.reasonCodes.includes('HARD_LIMIT_APPLIED'));
});

test('V4-C SEED con confianza LOW conserva mínimo manual como piso', () => {
  const result = getAdaptiveReplenishmentSuggestion(
    product({ minStock: 10, maxStock: 40 }),
    {
      stock: 0,
      forecast: forecast({
        forecastDaily: 0.5,
        confidence: 'LOW'
      })
    }
  );

  assert.equal(result.rawDynamicTarget, 3.5);
  assert.equal(result.vigiaTargetStock, 10);
  assert.ok(result.reasonCodes.includes('SEED_LOW_CONFIDENCE_FLOOR'));
});

test('V4-C con confianza alta puede bajar por debajo de la semilla manual', () => {
  const result = getAdaptiveReplenishmentSuggestion(
    product({
      minStock: 10,
      maxStock: 40,
      intelligenceMode: 'SEED'
    }),
    {
      stock: 0,
      forecast: forecast({
        forecastDaily: 0.5,
        confidence: 'HIGH'
      })
    }
  );

  assert.equal(result.vigiaTargetStock, 3.5);
  assert.ok(result.vigiaTargetStock < result.manualMin);
  assert.equal(result.suggestedQuantity, 4);
});

test('V4-C descuenta mercancía en camino de la cantidad sugerida', () => {
  const result = getAdaptiveReplenishmentSuggestion(
    product({
      intelligenceMode: 'ADAPTIVE',
      targetDays: 7
    }),
    {
      stock: 3,
      pendingInbound: 5,
      forecast: forecast({ forecastDaily: 2 })
    }
  );

  assert.equal(result.vigiaTargetStock, 14);
  assert.equal(result.projectedAvailable, 8);
  assert.equal(result.suggestedQuantity, 6);
  assert.ok(result.reasonCodes.includes('PENDING_INBOUND_INCLUDED'));
});

test('V4-C es puro y reproducible; nunca modifica producto, forecast ni contexto', () => {
  const item = product({ intelligenceMode: 'ADAPTIVE', safetyDays: 1 });
  const demand = forecast({ forecastDaily: 2.25, confidence: 'MEDIUM' });
  const context = {
    stock: 4,
    pendingInbound: 2,
    forecast: demand
  };
  const before = JSON.stringify({ item, context });

  const first = getAdaptiveReplenishmentSuggestion(item, context);
  const second = getAdaptiveReplenishmentSuggestion(item, context);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ item, context }), before);
});
