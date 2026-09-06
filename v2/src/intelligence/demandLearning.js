import { MOVEMENT_TYPES } from '../core/movementTypes.js';
import { buildAdaptiveDemandForecast } from './replenishmentEngine.js';

const DAY_MS = 86400000;
const DEFAULT_YEAR_WEIGHTS = Object.freeze([1, 0.65, 0.4]);

export function buildAnomalyProtectedDemandSeries(
  movements,
  productId,
  now = new Date(),
  {
    minMovements = 8,
    iqrMultiplier = 3,
    fallbackMedianMultiplier = 4,
    minimumOutlierRatio = 3
  } = {}
) {
  const source = Array.isArray(movements) ? movements : [];
  const end = now.getTime();
  const excludedIndexes = new Set();
  const candidates = [];

  for (let index = 0; index < source.length; index++) {
    const movement = source[index];

    if (
      movement?.productId !== productId ||
      movement?.type !== MOVEMENT_TYPES.SUPPLY ||
      movement?.voided === true
    ) {
      continue;
    }

    const quantity = Number(movement.quantity || 0);
    const at = new Date(
      movement.effectiveAt || movement.createdAt
    ).getTime();

    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      Number.isNaN(at) ||
      at > end
    ) {
      continue;
    }

    if (movement?.metadata?.demandLearningExcluded === true) {
      excludedIndexes.add(index);
      continue;
    }

    candidates.push({
      index,
      quantity
    });
  }

  const candidateQuantityByIndex = new Map(
    candidates.map(item => [item.index, item.quantity])
  );
  const originalDemandTotal = candidates.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const diagnostics = {
    eligibleMovementCount: candidates.length,
    manualExcludedCount: excludedIndexes.size,
    anomalyCount: 0,
    originalDemandTotal: round(originalDemandTotal),
    modeledDemandTotal: round(originalDemandTotal),
    medianQuantity: null,
    q1: null,
    q3: null,
    iqr: null,
    upperCap: null,
    adjustedMovementIds: [],
    reasonCodes: []
  };

  if (excludedIndexes.size > 0) {
    diagnostics.reasonCodes.push('MANUAL_DEMAND_EXCLUSIONS');
  }

  if (candidates.length < Math.max(4, Number(minMovements) || 8)) {
    diagnostics.reasonCodes.push('ANOMALY_GUARD_WARMUP');

    return {
      movements: source
        .filter((_, index) => !excludedIndexes.has(index))
        .map(movement => ({ ...movement })),
      diagnostics
    };
  }

  const sorted = candidates
    .map(item => item.quantity)
    .sort((a, b) => a - b);
  const medianQuantity = percentile(sorted, 0.5);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = Math.max(0, q3 - q1);

  const iqrCap = iqr > 0
    ? q3 + (iqr * positiveOr(iqrMultiplier, 3))
    : medianQuantity * positiveOr(fallbackMedianMultiplier, 4);
  const upperCap = Math.max(
    medianQuantity * 2,
    iqrCap
  );
  const outlierRatio = positiveOr(minimumOutlierRatio, 3);
  const cappedByIndex = new Map();

  for (const item of candidates) {
    if (
      item.quantity > upperCap &&
      item.quantity >= medianQuantity * outlierRatio
    ) {
      cappedByIndex.set(item.index, upperCap);
    }
  }

  let modeledDemandTotal = 0;
  const modeledMovements = [];

  for (let index = 0; index < source.length; index++) {
    if (excludedIndexes.has(index)) continue;

    const movement = source[index];
    const cap = cappedByIndex.get(index);

    if (cap !== undefined) {
      modeledMovements.push({
        ...movement,
        quantity: cap
      });
      modeledDemandTotal += cap;
      diagnostics.adjustedMovementIds.push(
        movement?.id || `index:${index}`
      );
      continue;
    }

    modeledMovements.push({ ...movement });

    const candidateQuantity =
      candidateQuantityByIndex.get(index);
    if (candidateQuantity !== undefined) {
      modeledDemandTotal += candidateQuantity;
    }
  }

  diagnostics.anomalyCount = cappedByIndex.size;
  diagnostics.modeledDemandTotal = round(modeledDemandTotal);
  diagnostics.medianQuantity = round(medianQuantity);
  diagnostics.q1 = round(q1);
  diagnostics.q3 = round(q3);
  diagnostics.iqr = round(iqr);
  diagnostics.upperCap = round(upperCap);

  if (diagnostics.anomalyCount > 0) {
    diagnostics.reasonCodes.push('AUTOMATIC_OUTLIER_CAP');
  } else {
    diagnostics.reasonCodes.push('ANOMALY_GUARD_CLEAN');
  }

  return {
    movements: modeledMovements,
    diagnostics
  };
}

export function buildAnnualSeasonality(
  movements,
  productId,
  now = new Date(),
  {
    horizonDays = 14,
    seasonWindowDays = 28,
    emergingHistoryDays = 90,
    annualHistoryDays = 365,
    maxYears = 3,
    minPeriodMovements = 2,
    minSeasonalFactor = 0.5,
    maxSeasonalFactor = 2,
    yearWeights = DEFAULT_YEAR_WEIGHTS
  } = {}
) {
  const series = extractSupplySeries(
    movements,
    productId,
    now
  );
  const historyDays = historyDaysForSeries(series, now);
  const windowDays = Math.max(
    14,
    Math.floor(Number(seasonWindowDays) || 28)
  );
  const horizon = Math.max(
    0,
    Math.floor(Number(horizonDays) || 0)
  );
  const forecastAt = new Date(
    now.getTime() + (horizon * DAY_MS)
  );
  const base = {
    historyDays,
    movementCount: series.length,
    horizonDays: horizon,
    seasonWindowDays: windowDays,
    forecastAt: forecastAt.toISOString(),
    confidence: 'INSUFFICIENT',
    longRunDailyAverage: 0,
    emergingPhaseFactor: 1,
    emergingPhaseDirection: 'STABLE',
    rawSeasonalFactor: 1,
    seasonalFactor: 1,
    appliedFactor: 1,
    comparisonYears: [],
    reasonCodes: [],
    confidenceReasons: []
  };

  if (!series.length) {
    base.reasonCodes.push('NO_SEASONAL_HISTORY');
    base.confidenceReasons.push(
      'No hay surtidos históricos para evaluar estacionalidad.'
    );
    return base;
  }

  const longRunDailyAverage = series.reduce(
    (sum, item) => sum + item.quantity,
    0
  ) / Math.max(1, historyDays);
  base.longRunDailyAverage = round(longRunDailyAverage);

  const emerging = buildEmergingPhase(
    series,
    now,
    windowDays
  );
  base.emergingPhaseFactor = emerging.factor;
  base.emergingPhaseDirection = emerging.direction;

  if (historyDays < Math.max(30, Number(emergingHistoryDays) || 90)) {
    base.reasonCodes.push('SEASONAL_HISTORY_INSUFFICIENT');
    base.confidenceReasons.push(
      `Solo hay ${historyDays} día(s) de historial; VIGÍA no intenta reconocer una época todavía.`
    );
    return base;
  }

  if (historyDays < Math.max(180, Number(annualHistoryDays) || 365)) {
    base.confidence = 'LOW';
    base.reasonCodes.push('ANNUAL_HISTORY_NOT_READY');
    base.reasonCodes.push(
      `EMERGING_PHASE_${emerging.direction}`
    );
    base.confidenceReasons.push(
      `Hay ${historyDays} día(s) de historial: se observa la fase actual, pero no se aplica estacionalidad anual hasta completar un ciclo suficiente.`
    );
    return base;
  }

  if (!(longRunDailyAverage > 0)) {
    base.confidence = 'LOW';
    base.reasonCodes.push('ANNUAL_BASELINE_EMPTY');
    base.confidenceReasons.push(
      'El promedio histórico es cero; no existe una base válida para comparar épocas.'
    );
    return base;
  }

  const firstAt = series[0].at;
  const comparisons = [];
  const years = Math.max(
    1,
    Math.min(5, Math.floor(Number(maxYears) || 3))
  );
  const minimumCoveredDays = Math.max(
    7,
    Math.ceil(windowDays / 2)
  );

  for (let yearOffset = 1; yearOffset <= years; yearOffset++) {
    const periodEnd = shiftUtcYears(
      forecastAt,
      -yearOffset
    );
    const periodStart = new Date(
      periodEnd.getTime() - (windowDays * DAY_MS)
    );
    const coveredStartMs = Math.max(
      periodStart.getTime(),
      firstAt
    );
    const coveredEndMs = Math.min(
      periodEnd.getTime(),
      now.getTime()
    );
    const coveredDays = Math.max(
      0,
      (coveredEndMs - coveredStartMs) / DAY_MS
    );

    if (coveredDays < minimumCoveredDays) continue;

    const periodItems = series.filter(item =>
      item.at >= coveredStartMs &&
      item.at <= coveredEndMs
    );

    if (
      periodItems.length <
      Math.max(1, Math.floor(Number(minPeriodMovements) || 2))
    ) {
      continue;
    }

    const periodTotal = periodItems.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
    const periodDailyAverage =
      periodTotal / Math.max(1, coveredDays);
    const rawFactor =
      periodDailyAverage / longRunDailyAverage;
    const factor = clamp(
      rawFactor,
      positiveOr(minSeasonalFactor, 0.5),
      positiveOr(maxSeasonalFactor, 2)
    );
    const weight = seasonalYearWeight(
      yearOffset,
      yearWeights
    );

    comparisons.push({
      yearOffset,
      periodStart: new Date(coveredStartMs).toISOString(),
      periodEnd: new Date(coveredEndMs).toISOString(),
      coveredDays: round(coveredDays),
      movementCount: periodItems.length,
      periodDailyAverage: round(periodDailyAverage),
      rawFactor: round(rawFactor),
      factor: round(factor),
      weight: round(weight)
    });
  }

  base.comparisonYears = comparisons;

  if (!comparisons.length) {
    base.confidence = 'LOW';
    base.reasonCodes.push('ANNUAL_COMPARISON_INSUFFICIENT');
    base.confidenceReasons.push(
      'Existe más de un año de historial, pero todavía no hay suficientes surtidos en períodos equivalentes para ajustar la demanda.'
    );
    return base;
  }

  const weightTotal = comparisons.reduce(
    (sum, item) => sum + item.weight,
    0
  );
  const weightedFactor = comparisons.reduce(
    (sum, item) => sum + (item.factor * item.weight),
    0
  ) / Math.max(weightTotal, Number.EPSILON);
  const seasonalFactor = clamp(
    weightedFactor,
    positiveOr(minSeasonalFactor, 0.5),
    positiveOr(maxSeasonalFactor, 2)
  );
  const periodMovementCount = comparisons.reduce(
    (sum, item) => sum + item.movementCount,
    0
  );
  const confidence =
    comparisons.length >= 2 && periodMovementCount >= 6
      ? 'HIGH'
      : 'MEDIUM';
  const strength = confidence === 'HIGH'
    ? 0.4
    : 0.25;
  const appliedFactor = 1 +
    ((seasonalFactor - 1) * strength);

  base.confidence = confidence;
  base.rawSeasonalFactor = round(weightedFactor);
  base.seasonalFactor = round(seasonalFactor);
  base.appliedFactor = round(appliedFactor);

  if (seasonalFactor > 1.1) {
    base.reasonCodes.push('ANNUAL_SEASON_HIGH');
  } else if (seasonalFactor < 0.9) {
    base.reasonCodes.push('ANNUAL_SEASON_LOW');
  } else {
    base.reasonCodes.push('ANNUAL_SEASON_STABLE');
  }

  if (comparisons.length >= 2) {
    base.reasonCodes.push('MULTI_YEAR_RECENCY_WEIGHTING');
  }

  base.confidenceReasons.push(
    `Se compararon ${comparisons.length} período(s) equivalente(s); los años recientes pesan más que los antiguos.`
  );
  base.confidenceReasons.push(
    `El factor estacional bruto ${round(seasonalFactor)} se aplica de forma prudente como ${round(appliedFactor)} para evitar duplicar el efecto que ya refleja el consumo reciente.`
  );

  return base;
}

export function buildVigiaDemandForecast(
  movements,
  productId,
  now = new Date(),
  {
    trendWindowDays = 14,
    seasonalHorizonDays = 14,
    anomalyProtection = {},
    annualSeasonality = {}
  } = {}
) {
  const protection = buildAnomalyProtectedDemandSeries(
    movements,
    productId,
    now,
    anomalyProtection
  );
  const baseForecast = buildAdaptiveDemandForecast(
    protection.movements,
    productId,
    now,
    { trendWindowDays }
  );
  const seasonality = buildAnnualSeasonality(
    protection.movements,
    productId,
    now,
    {
      horizonDays: seasonalHorizonDays,
      ...annualSeasonality
    }
  );

  const preSeasonalityForecastDaily = Number(
    baseForecast.forecastDaily || 0
  );
  const seasonalAdjustmentFactor = Number(
    seasonality.appliedFactor || 1
  );
  const forecastDaily =
    preSeasonalityForecastDaily * seasonalAdjustmentFactor;
  const reasonCodes = uniqueCodes([
    ...(baseForecast.reasonCodes || []),
    ...(protection.diagnostics.reasonCodes || []),
    ...(seasonality.reasonCodes || [])
  ]);
  const confidenceReasons = [
    ...(baseForecast.confidenceReasons || []),
    ...(seasonality.confidenceReasons || [])
  ];

  if (protection.diagnostics.anomalyCount > 0) {
    confidenceReasons.push(
      `VIGÍA limitó ${protection.diagnostics.anomalyCount} salida(s) estadísticamente extraordinaria(s) solo para el aprendizaje; los movimientos originales permanecen intactos.`
    );
  }

  if (protection.diagnostics.manualExcludedCount > 0) {
    confidenceReasons.push(
      `${protection.diagnostics.manualExcludedCount} movimiento(s) marcado(s) para excluir del aprendizaje no participaron en el pronóstico.`
    );
  }

  return {
    ...baseForecast,
    modelVersion: 'V4-D',
    preSeasonalityForecastDaily: round(
      preSeasonalityForecastDaily
    ),
    preSeasonalityForecastWeekly: round(
      preSeasonalityForecastDaily * 7
    ),
    seasonalAdjustmentFactor: round(
      seasonalAdjustmentFactor
    ),
    forecastDaily: round(forecastDaily),
    forecastWeekly: round(forecastDaily * 7),
    anomalyProtection: protection.diagnostics,
    seasonality,
    reasonCodes,
    confidenceReasons
  };
}

function extractSupplySeries(
  movements,
  productId,
  now
) {
  const end = now.getTime();

  return (Array.isArray(movements) ? movements : [])
    .filter(movement => movement?.productId === productId)
    .filter(movement => movement?.type === MOVEMENT_TYPES.SUPPLY)
    .filter(movement => movement?.voided !== true)
    .filter(movement => movement?.metadata?.demandLearningExcluded !== true)
    .map(movement => ({
      quantity: Number(movement.quantity || 0),
      at: new Date(
        movement.effectiveAt || movement.createdAt
      ).getTime()
    }))
    .filter(item =>
      Number.isFinite(item.quantity) &&
      item.quantity > 0 &&
      !Number.isNaN(item.at) &&
      item.at <= end
    )
    .sort((a, b) => a.at - b.at);
}

function historyDaysForSeries(series, now) {
  if (!series.length) return 0;

  return Math.max(
    1,
    Math.ceil(
      (now.getTime() - series[0].at) /
      DAY_MS
    )
  );
}

function buildEmergingPhase(
  series,
  now,
  windowDays
) {
  const end = now.getTime();
  const recentStart = end - (windowDays * DAY_MS);
  const baselineDays = Math.max(90, windowDays * 3);
  const baselineStart = end - (baselineDays * DAY_MS);
  const recentTotal = sumBetween(
    series,
    recentStart,
    end
  );
  const baselineTotal = sumBetween(
    series,
    baselineStart,
    end
  );
  const recentDaily = recentTotal / windowDays;
  const baselineDaily = baselineTotal / baselineDays;
  const factor = baselineDaily > 0
    ? clamp(recentDaily / baselineDaily, 0.5, 2)
    : 1;

  let direction = 'STABLE';
  if (factor >= 1.15) direction = 'RISING';
  if (factor <= 0.85) direction = 'FALLING';

  return {
    factor: round(factor),
    direction
  };
}

function sumBetween(series, startMs, endMs) {
  return series
    .filter(item =>
      item.at > startMs &&
      item.at <= endMs
    )
    .reduce((sum, item) => sum + item.quantity, 0);
}

function seasonalYearWeight(yearOffset, weights) {
  const explicit = Array.isArray(weights)
    ? Number(weights[yearOffset - 1])
    : NaN;

  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  return Math.pow(0.6, yearOffset - 1);
}

function shiftUtcYears(date, amount) {
  const copy = new Date(date.getTime());
  const originalMonth = copy.getUTCMonth();

  copy.setUTCFullYear(
    copy.getUTCFullYear() + amount
  );

  if (copy.getUTCMonth() !== originalMonth) {
    copy.setUTCDate(0);
  }

  return copy;
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];

  const position =
    (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) return sorted[lower];

  const fraction = position - lower;
  return sorted[lower] +
    ((sorted[upper] - sorted[lower]) * fraction);
}

function uniqueCodes(values) {
  return [...new Set(values.filter(Boolean))];
}

function positiveOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number
    : fallback;
}

function clamp(value, min, max) {
  return Math.min(
    Math.max(Number(value), Number(min)),
    Number(max)
  );
}

function round(value) {
  return Math.round(
    (Number(value) + Number.EPSILON) * 1000
  ) / 1000;
}
