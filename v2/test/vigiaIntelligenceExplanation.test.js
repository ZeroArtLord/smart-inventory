import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVigiaExplanation
} from '../src/intelligence/intelligenceExplanation.js';
import {
  buildInventoryReport
} from '../src/reporting/reportingEngine.js';

const DAY_MS = 86400000;

function supply(productId, quantity, now, daysAgo, id = null) {
  return {
    id: id || `sup-${productId}-${daysAgo}-${quantity}`,
    productId,
    type: 'SUPPLY',
    quantity,
    effectiveAt: new Date(
      now.getTime() - (daysAgo * DAY_MS)
    ).toISOString()
  };
}

test('V4-E explica el fallback manual cuando todavía no hay historial', () => {
  const explanation = buildVigiaExplanation({
    forecast: {
      modelVersion: 'V4-D',
      confidence: 'INSUFFICIENT',
      forecastWeekly: 0,
      trendConfidence: 'INSUFFICIENT',
      seasonality: {
        confidence: 'INSUFFICIENT',
        appliedFactor: 1,
        reasonCodes: []
      },
      anomalyProtection: {
        anomalyCount: 0,
        manualExcludedCount: 0
      },
      reasonCodes: ['NO_HISTORY']
    },
    suggestion: {
      mode: 'SEED',
      confidence: 'INSUFFICIENT',
      dynamicReady: false,
      vigiaTargetStock: 10,
      suggestedQuantity: 6,
      pendingInbound: 0,
      reasonCodes: ['MANUAL_SEED_FALLBACK'],
      warningCodes: []
    }
  });

  assert.equal(explanation.modeLabel, 'SEMILLA');
  assert.equal(explanation.confidenceLabel, 'SIN HISTORIAL');
  assert.equal(explanation.headline, 'Reponer 6');
  assert.ok(
    explanation.reasons.some(text =>
      text.includes('historial suficiente')
    )
  );
  assert.ok(
    explanation.reasons.some(text =>
      text.includes('mínimo manual')
    )
  );
});

test('V4-E hace visible tendencia, temporada, tránsito y límites duros', () => {
  const explanation = buildVigiaExplanation({
    forecast: {
      modelVersion: 'V4-D',
      confidence: 'HIGH',
      forecastWeekly: 28,
      trendDirection: 'UP',
      trendPercentChange: 80,
      trendConfidence: 'MEDIUM',
      seasonality: {
        confidence: 'HIGH',
        appliedFactor: 1.4,
        comparisonYears: [{ yearOffset: 1 }, { yearOffset: 2 }],
        reasonCodes: ['ANNUAL_SEASON_HIGH']
      },
      anomalyProtection: {
        anomalyCount: 1,
        manualExcludedCount: 0
      },
      reasonCodes: ['TREND_UP', 'ANNUAL_SEASON_HIGH']
    },
    suggestion: {
      mode: 'HARD_LIMIT',
      confidence: 'HIGH',
      dynamicReady: true,
      forecastWeekly: 28,
      vigiaTargetStock: 12,
      suggestedQuantity: 4,
      pendingInbound: 5,
      reasonCodes: ['HARD_LIMIT_APPLIED'],
      warningCodes: ['DEMAND_ABOVE_HARD_MAX']
    }
  });

  assert.equal(explanation.modeLabel, 'BLOQUEO DURO');
  assert.equal(explanation.seasonalityLabel, 'Época de demanda alta');
  assert.ok(explanation.trendLabel.includes('Subiendo'));
  assert.ok(
    explanation.reasons.some(text =>
      text.includes('en camino')
    )
  );
  assert.ok(
    explanation.reasons.some(text =>
      text.includes('anti-anomalías')
    )
  );
  assert.ok(
    explanation.warnings.some(text =>
      text.includes('máximo administrativo')
    )
  );
});

test('V4-E conecta el reporte operativo con forecast V4-D y objetivo adaptativo', () => {
  const now = new Date('2026-09-05T12:00:00Z');
  const movements = [];

  for (let day = 1; day <= 7; day++) {
    movements.push(
      supply('prd-v4', 4, now, day)
    );
  }

  for (let day = 15; day <= 21; day++) {
    movements.push(
      supply('prd-v4', 1, now, day)
    );
  }

  const [row] = buildInventoryReport([
    {
      id: 'prd-v4',
      name: 'Producto V4',
      minStock: 5,
      maxStock: 12,
      intelligenceMode: 'SEED',
      targetDays: 7,
      safetyDays: 0,
      active: true
    }
  ], movements, { now });

  assert.equal(row.modelVersion, 'V4-D');
  assert.equal(row.dynamicReady, true);
  assert.equal(row.intelligenceMode, 'SEED');
  assert.ok(row.forecastWeekly > 0);
  assert.ok(row.vigiaTargetStock > 12);
  assert.equal(
    row.targetStock,
    row.vigiaTargetStock
  );
  assert.ok(
    row.intelligenceExplanation.reasons.length > 0
  );
  assert.ok(
    row.reasonCodes.includes('SEED_DYNAMIC_TARGET')
  );
});
