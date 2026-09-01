import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVEMENT_TYPES } from '../src/core/movementTypes.js';
import {
  buildConsumptionProfile,
  buildDemandTrend,
  getReplenishmentSuggestion,
  getTrendAwareReplenishmentSuggestion,
  classifyStockRisk
} from '../src/intelligence/replenishmentEngine.js';

test('sin historial repone solamente hasta el mínimo', () => {
  const product = { minStock: 20, maxStock: 40 };
  const result = getReplenishmentSuggestion(product, {
    stock: 12,
    pendingInbound: 0,
    dailyConsumption: 0
  });

  assert.equal(result.minimumDeficit, 8);
  assert.equal(result.suggestedQuantity, 8);
  assert.equal(result.reason, 'BELOW_MINIMUM');
});

test('descuenta mercancía que ya viene en camino', () => {
  const product = { minStock: 20, maxStock: 40 };
  const result = getReplenishmentSuggestion(product, {
    stock: 12,
    pendingInbound: 5,
    dailyConsumption: 0
  });

  assert.equal(result.suggestedQuantity, 3);
});

test('con consumo conocido puede recomendar por encima del mínimo sin superar máximo', () => {
  const product = { minStock: 20, maxStock: 40 };
  const result = getReplenishmentSuggestion(product, {
    stock: 12,
    dailyConsumption: 5,
    targetDays: 7
  });

  assert.equal(result.targetStock, 35);
  assert.equal(result.suggestedQuantity, 23);
});

test('el máximo limita la recomendación predictiva', () => {
  const product = { minStock: 20, maxStock: 40 };
  const result = getReplenishmentSuggestion(product, {
    stock: 12,
    dailyConsumption: 10,
    targetDays: 7
  });

  assert.equal(result.targetStock, 40);
  assert.equal(result.suggestedQuantity, 28);
});

test('construye perfil usando surtidos como consumo real', () => {
  const now = new Date('2026-08-30T12:00:00Z');
  const movements = [
    {
      productId: 'aceite',
      type: MOVEMENT_TYPES.SUPPLY,
      quantity: 7,
      effectiveAt: '2026-08-29T12:00:00Z'
    },
    {
      productId: 'aceite',
      type: MOVEMENT_TYPES.SUPPLY,
      quantity: 7,
      effectiveAt: '2026-08-24T12:00:00Z'
    },
    {
      productId: 'aceite',
      type: MOVEMENT_TYPES.ENTRY,
      quantity: 100,
      effectiveAt: '2026-08-29T12:00:00Z'
    }
  ];

  const profile = buildConsumptionProfile(movements, 'aceite', now);
  assert.equal(profile.totals[7], 14);
  assert.equal(profile.dailyAverages[7], 2);
});

test('clasifica crítico cuando está por debajo del mínimo', () => {
  const risk = classifyStockRisk(
    { minStock: 20, maxStock: 40 },
    { stock: 12, dailyConsumption: 1 }
  );

  assert.equal(risk.level, 'CRITICAL');
});


test('detecta tendencia de consumo al alza comparando ventanas', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  const movements = [];

  for (let day = 1; day <= 6; day++) {
    movements.push({
      productId: 'tendencia',
      type: MOVEMENT_TYPES.SUPPLY,
      quantity: 10,
      effectiveAt: new Date(
        now.getTime() - (day * 86400000)
      ).toISOString()
    });
  }

  for (let day = 15; day <= 20; day++) {
    movements.push({
      productId: 'tendencia',
      type: MOVEMENT_TYPES.SUPPLY,
      quantity: 4,
      effectiveAt: new Date(
        now.getTime() - (day * 86400000)
      ).toISOString()
    });
  }

  const trend = buildDemandTrend(
    movements,
    'tendencia',
    now,
    { windowDays: 14 }
  );

  assert.equal(trend.direction, 'UP');
  assert.equal(trend.confidence, 'MEDIUM');
  assert.ok(trend.percentChange > 100);
});

test('tendencia al alza aumenta consumo ajustado sin superar factor de seguridad', () => {
  const result = getTrendAwareReplenishmentSuggestion(
    { minStock: 20, maxStock: 100 },
    {
      stock: 10,
      pendingInbound: 0,
      dailyConsumption: 5,
      targetDays: 7,
      safetyDays: 1,
      trend: {
        direction: 'UP',
        confidence: 'MEDIUM',
        percentChange: 80
      }
    }
  );

  assert.equal(result.baseDailyConsumption, 5);
  assert.equal(result.adjustedDailyConsumption, 7);
  assert.equal(result.originalTargetDays, 7);
  assert.equal(result.safetyDays, 1);
  assert.equal(result.targetDays, 8);
  assert.equal(result.suggestedQuantity, 46);
});

test('sin confianza suficiente no modifica el consumo base', () => {
  const result = getTrendAwareReplenishmentSuggestion(
    { minStock: 20, maxStock: 100 },
    {
      stock: 10,
      dailyConsumption: 5,
      targetDays: 7,
      trend: {
        direction: 'UP',
        confidence: 'INSUFFICIENT',
        percentChange: 100
      }
    }
  );

  assert.equal(result.adjustedDailyConsumption, 5);
});
