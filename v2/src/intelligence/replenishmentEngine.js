import { MOVEMENT_TYPES } from '../core/movementTypes.js';
import {
  INTELLIGENCE_MODES,
  DEFAULT_INTELLIGENCE_POLICY,
  normalizeIntelligenceMode
} from '../core/catalog.js';
import { calculateCoverageDays } from '../inventory/stockEngine.js';

const DAY_MS = 86400000;
const WINDOWS = Object.freeze([7, 14, 30, 60, 90]);

export function buildConsumptionProfile(movements, productId, now = new Date()) {
  const supplyMovements = movements
    .filter(movement => movement.productId === productId)
    .filter(movement => movement.type === MOVEMENT_TYPES.SUPPLY)
    .filter(movement => movement.voided !== true)
    .filter(movement => Number(movement.quantity) > 0)
    .map(movement => ({
      quantity: Number(movement.quantity),
      at: new Date(movement.effectiveAt || movement.createdAt)
    }))
    .filter(item => !Number.isNaN(item.at.getTime()))
    .filter(item => item.at.getTime() <= now.getTime());

  const totals = {};
  const dailyAverages = {};

  for (const days of WINDOWS) {
    const from = now.getTime() - (days * DAY_MS);
    const total = supplyMovements
      .filter(item => item.at.getTime() > from)
      .reduce((sum, item) => sum + item.quantity, 0);

    totals[days] = round(total);
    dailyAverages[days] = round(total / days);
  }

  const firstMovementAt = supplyMovements.length
    ? Math.min(...supplyMovements.map(item => item.at.getTime()))
    : null;

  const historyDays = firstMovementAt === null
    ? 0
    : Math.max(1, Math.ceil((now.getTime() - firstMovementAt) / DAY_MS));

  const estimatedDailyConsumption = chooseDailyEstimate(
    dailyAverages,
    historyDays
  );

  return {
    historyDays,
    movementCount: supplyMovements.length,
    totals,
    dailyAverages,
    estimatedDailyConsumption,
    estimatedWeeklyConsumption: round(estimatedDailyConsumption * 7),
    confidence: confidenceForHistory(historyDays, supplyMovements.length)
  };
}

export function buildDemandTrend(
  movements,
  productId,
  now = new Date(),
  { windowDays = 14 } = {}
) {
  const days = Math.max(3, Math.floor(Number(windowDays) || 14));
  const end = now.getTime();
  const recentStart = end - (days * DAY_MS);
  const previousStart = end - (days * 2 * DAY_MS);

  const relevant = movements
    .filter(movement => movement.productId === productId)
    .filter(movement => movement.type === MOVEMENT_TYPES.SUPPLY)
    .filter(movement => movement.voided !== true)
    .map(movement => ({
      quantity: Number(movement.quantity || 0),
      at: new Date(movement.effectiveAt || movement.createdAt).getTime()
    }))
    .filter(item =>
      Number.isFinite(item.quantity) &&
      item.quantity > 0 &&
      !Number.isNaN(item.at) &&
      item.at <= end &&
      item.at > previousStart
    );

  const recentTotal = relevant
    .filter(item => item.at > recentStart)
    .reduce((sum, item) => sum + item.quantity, 0);

  const previousTotal = relevant
    .filter(item => item.at <= recentStart)
    .reduce((sum, item) => sum + item.quantity, 0);

  const recentDaily = recentTotal / days;
  const previousDaily = previousTotal / days;

  let percentChange = null;
  if (previousDaily > 0) {
    percentChange = ((recentDaily - previousDaily) / previousDaily) * 100;
  } else if (recentDaily > 0) {
    percentChange = 100;
  }

  let direction = 'STABLE';
  if (percentChange !== null && percentChange >= 15) direction = 'UP';
  if (percentChange !== null && percentChange <= -15) direction = 'DOWN';

  const confidence = relevant.length >= 8
    ? 'MEDIUM'
    : relevant.length >= 4
      ? 'LOW'
      : 'INSUFFICIENT';

  return {
    windowDays: days,
    recentTotal: round(recentTotal),
    previousTotal: round(previousTotal),
    recentDailyAverage: round(recentDaily),
    previousDailyAverage: round(previousDaily),
    percentChange: percentChange === null ? null : round(percentChange),
    direction,
    movementCount: relevant.length,
    confidence
  };
}

export function buildAdaptiveDemandForecast(
  movements,
  productId,
  now = new Date(),
  { trendWindowDays = 14 } = {}
) {
  const profile = buildConsumptionProfile(
    movements,
    productId,
    now
  );
  const trend = buildDemandTrend(
    movements,
    productId,
    now,
    { windowDays: trendWindowDays }
  );

  const baseDaily = nonNegative(
    profile.estimatedDailyConsumption
  );
  const adjustedDaily = adjustDailyConsumptionForTrend(
    baseDaily,
    trend
  );
  const adjustmentFactor = baseDaily > 0
    ? adjustedDaily / baseDaily
    : 1;

  const reasonCodes = [];
  const confidenceReasons = [];

  if (profile.historyDays === 0) {
    reasonCodes.push('NO_HISTORY');
    confidenceReasons.push('No hay surtidos históricos para estimar demanda.');
  } else if (profile.confidence === 'INSUFFICIENT') {
    reasonCodes.push('HISTORY_INSUFFICIENT');
    confidenceReasons.push(
      `Solo hay ${profile.historyDays} día(s) de historial útil; VIGÍA no proyecta demanda todavía.`
    );
  } else {
    reasonCodes.push('RECENT_CONSUMPTION');
    confidenceReasons.push(
      `La demanda base usa ${profile.historyDays} día(s) de historial y ${profile.movementCount} surtido(s).`
    );
  }

  if (trend.confidence === 'INSUFFICIENT') {
    reasonCodes.push('TREND_INSUFFICIENT');
    confidenceReasons.push(
      'La tendencia reciente no tiene suficientes movimientos para modificar la demanda base.'
    );
  } else {
    reasonCodes.push(`TREND_${trend.direction}`);
    confidenceReasons.push(
      `Tendencia ${trend.direction} en ventana de ${trend.windowDays} días con cambio ${trend.percentChange ?? 0}%.`
    );
  }

  return {
    historyDays: profile.historyDays,
    movementCount: profile.movementCount,
    baseDailyConsumption: round(baseDaily),
    baseWeeklyConsumption: round(baseDaily * 7),
    trendAdjustedDailyConsumption: round(adjustedDaily),
    forecastDaily: round(adjustedDaily),
    forecastWeekly: round(adjustedDaily * 7),
    trendAdjustmentFactor: round(adjustmentFactor),
    trendWindowDays: trend.windowDays,
    trendDirection: trend.direction,
    trendPercentChange: trend.percentChange,
    trendConfidence: trend.confidence,
    confidence: profile.confidence,
    confidenceReasons,
    reasonCodes,
    profile,
    trend
  };
}

export function getAdaptiveReplenishmentSuggestion(
  product,
  context = {}
) {
  const mode = normalizeIntelligenceMode(
    product?.intelligenceMode ?? DEFAULT_INTELLIGENCE_POLICY.mode
  );
  const forecast = context.forecast || null;
  const forecastDaily = nonNegative(
    forecast?.forecastDaily ??
    context.forecastDaily ??
    context.dailyConsumption
  );
  const confidence =
    forecast?.confidence ||
    context.confidence ||
    'INSUFFICIENT';

  const targetDays = positiveOr(
    product?.targetDays ?? context.targetDays,
    DEFAULT_INTELLIGENCE_POLICY.targetDays
  );
  const safetyDays = nonNegative(
    product?.safetyDays ??
    context.safetyDays ??
    DEFAULT_INTELLIGENCE_POLICY.safetyDays
  );

  const stock = nonNegative(context.stock);
  const pendingInbound = nonNegative(context.pendingInbound);
  const projectedAvailable = stock + pendingInbound;
  const manualMin = nonNegative(product?.minStock);
  const manualMax = nonNegative(product?.maxStock);
  const dynamicReady =
    forecastDaily > 0 &&
    confidence !== 'INSUFFICIENT';

  const recommendedMin = dynamicReady
    ? forecastDaily * targetDays
    : manualMin;
  const rawDynamicTarget = dynamicReady
    ? forecastDaily * (targetDays + safetyDays)
    : manualMin;
  const recommendedMax = dynamicReady
    ? rawDynamicTarget
    : manualMax > 0
      ? manualMax
      : manualMin;

  const reasonCodes = [
    ...(forecast?.reasonCodes || [])
  ];
  const warningCodes = [];

  let targetStock;

  if (!dynamicReady) {
    targetStock = manualMin;
    reasonCodes.push('MANUAL_SEED_FALLBACK');
  } else if (mode === INTELLIGENCE_MODES.SEED) {
    if (confidence === 'LOW') {
      targetStock = Math.max(manualMin, rawDynamicTarget);
      reasonCodes.push('SEED_LOW_CONFIDENCE_FLOOR');
    } else {
      targetStock = rawDynamicTarget;
      reasonCodes.push('SEED_DYNAMIC_TARGET');
    }
  } else if (mode === INTELLIGENCE_MODES.ADAPTIVE) {
    targetStock = rawDynamicTarget;
    reasonCodes.push('ADAPTIVE_DYNAMIC_TARGET');
  } else {
    targetStock = rawDynamicTarget;

    if (targetStock < manualMin) {
      targetStock = manualMin;
      warningCodes.push('DEMAND_BELOW_HARD_MIN');
    }

    if (manualMax > 0 && targetStock > manualMax) {
      targetStock = manualMax;
      warningCodes.push('DEMAND_ABOVE_HARD_MAX');
    }

    reasonCodes.push('HARD_LIMIT_APPLIED');
  }

  if (pendingInbound > 0) {
    reasonCodes.push('PENDING_INBOUND_INCLUDED');
  }

  const suggestedQuantity = Math.max(
    0,
    Math.ceil(targetStock - projectedAvailable)
  );

  const coverageDays = calculateCoverageDays(
    stock,
    forecastDaily
  );
  const projectedCoverageDays = calculateCoverageDays(
    projectedAvailable,
    forecastDaily
  );

  return {
    mode,
    confidence,
    forecastDaily: round(forecastDaily),
    forecastWeekly: round(forecastDaily * 7),
    targetDays: round(targetDays),
    safetyDays: round(safetyDays),
    manualMin: round(manualMin),
    manualMax: round(manualMax),
    vigiaRecommendedMin: round(recommendedMin),
    vigiaRecommendedMax: round(recommendedMax),
    rawDynamicTarget: round(rawDynamicTarget),
    vigiaTargetStock: round(targetStock),
    stock: round(stock),
    pendingInbound: round(pendingInbound),
    projectedAvailable: round(projectedAvailable),
    suggestedQuantity,
    coverageDays: finiteOrNull(coverageDays),
    projectedCoverageDays: finiteOrNull(projectedCoverageDays),
    reasonCodes: uniqueCodes(reasonCodes),
    warningCodes: uniqueCodes(warningCodes),
    dynamicReady
  };
}

export function buildWeeklySeasonality(
  movements,
  productId,
  now = new Date(),
  {
    lookbackDays = 84,
    minHistoryDays = 56,
    minMovements = 12
  } = {}
) {
  const days = Math.max(28, Math.floor(Number(lookbackDays) || 84));
  const end = now.getTime();
  const start = end - (days * DAY_MS);

  const relevant = movements
    .filter(movement => movement.productId === productId)
    .filter(movement => movement.type === MOVEMENT_TYPES.SUPPLY)
    .filter(movement => movement.voided !== true)
    .map(movement => ({
      quantity: Number(movement.quantity || 0),
      at: new Date(movement.effectiveAt || movement.createdAt)
    }))
    .filter(item =>
      Number.isFinite(item.quantity) &&
      item.quantity > 0 &&
      !Number.isNaN(item.at.getTime()) &&
      item.at.getTime() <= end &&
      item.at.getTime() > start
    );

  if (!relevant.length) {
    return emptySeasonality(days);
  }

  const firstAt = Math.min(...relevant.map(item => item.at.getTime()));
  const historyDays = Math.max(
    1,
    Math.ceil((end - firstAt) / DAY_MS)
  );

  if (
    historyDays < minHistoryDays ||
    relevant.length < minMovements
  ) {
    return {
      ...emptySeasonality(days),
      historyDays,
      movementCount: relevant.length
    };
  }

  const totals = Array(7).fill(0);
  for (const item of relevant) {
    totals[item.at.getUTCDay()] += item.quantity;
  }

  const occurrences = weekdayOccurrences(start, end);
  const dailyAverages = totals.map((total, weekday) => {
    const count = occurrences[weekday] || 1;
    return total / count;
  });

  const overallDailyAverage =
    relevant.reduce((sum, item) => sum + item.quantity, 0) / days;

  const factors = dailyAverages.map(average => {
    if (!(overallDailyAverage > 0)) return 1;
    return round(
      Math.min(1.75, Math.max(0.5, average / overallDailyAverage))
    );
  });

  const strongestDay = factors.indexOf(Math.max(...factors));
  const weakestDay = factors.indexOf(Math.min(...factors));

  return {
    lookbackDays: days,
    historyDays,
    movementCount: relevant.length,
    confidence: historyDays >= 84 && relevant.length >= 24
      ? 'MEDIUM'
      : 'LOW',
    overallDailyAverage: round(overallDailyAverage),
    weekdayTotals: totals.map(round),
    weekdayDailyAverages: dailyAverages.map(round),
    weekdayFactors: factors,
    strongestDay,
    weakestDay
  };
}

export function getTrendAwareReplenishmentSuggestion(
  product,
  context = {}
) {
  const baseDaily = nonNegative(context.dailyConsumption);
  const trend = context.trend || null;
  const safetyDays = nonNegative(context.safetyDays ?? 0);
  const adjustedDailyConsumption = adjustDailyConsumptionForTrend(
    baseDaily,
    trend
  );

  const targetDays = positiveOr(context.targetDays, 7);
  const demandDays = targetDays + safetyDays;

  const suggestion = getReplenishmentSuggestion(product, {
    ...context,
    dailyConsumption: adjustedDailyConsumption,
    targetDays: demandDays
  });

  return {
    ...suggestion,
    baseDailyConsumption: round(baseDaily),
    adjustedDailyConsumption: round(adjustedDailyConsumption),
    safetyDays: round(safetyDays),
    originalTargetDays: targetDays,
    trendDirection: trend?.direction || 'STABLE',
    trendConfidence: trend?.confidence || 'INSUFFICIENT',
    trendPercentChange: trend?.percentChange ?? null
  };
}

export function getReplenishmentSuggestion(product, context = {}) {
  const stock = nonNegative(context.stock);
  const pendingInbound = nonNegative(context.pendingInbound);
  const dailyConsumption = nonNegative(context.dailyConsumption);
  const targetDays = positiveOr(context.targetDays, 7);

  const minStock = nonNegative(product?.minStock);
  const maxStock = nonNegative(product?.maxStock);

  const projectedAvailable = stock + pendingInbound;
  const hardMinimumTarget = minStock;
  const predictiveTarget = dailyConsumption > 0
    ? dailyConsumption * targetDays
    : 0;

  let targetStock = Math.max(hardMinimumTarget, predictiveTarget);

  if (maxStock > 0) {
    targetStock = Math.min(targetStock, maxStock);
  }

  const minimumDeficit = Math.max(0, minStock - projectedAvailable);
  const suggestedQuantity = Math.max(
    0,
    Math.ceil(targetStock - projectedAvailable)
  );

  const coverageDays = calculateCoverageDays(stock, dailyConsumption);
  const futureCoverageDays = calculateCoverageDays(
    projectedAvailable,
    dailyConsumption
  );

  return {
    stock,
    pendingInbound,
    projectedAvailable,
    minStock,
    maxStock,
    targetDays,
    targetStock: round(targetStock),
    minimumDeficit: round(minimumDeficit),
    suggestedQuantity,
    coverageDays: finiteOrNull(coverageDays),
    futureCoverageDays: finiteOrNull(futureCoverageDays),
    reason: determineReason({
      minimumDeficit,
      dailyConsumption,
      targetStock,
      minStock,
      suggestedQuantity
    })
  };
}

export function classifyStockRisk(product, context = {}) {
  const suggestion = getReplenishmentSuggestion(product, context);

  if (suggestion.stock <= suggestion.minStock && suggestion.minStock > 0) {
    return { level: 'CRITICAL', suggestion };
  }

  if (
    suggestion.coverageDays !== null &&
    suggestion.coverageDays <= Math.min(3, suggestion.targetDays)
  ) {
    return { level: 'CRITICAL', suggestion };
  }

  if (suggestion.suggestedQuantity > 0) {
    return { level: 'LOW', suggestion };
  }

  return { level: 'GOOD', suggestion };
}

function adjustDailyConsumptionForTrend(baseDaily, trend) {
  let adjustedDailyConsumption = nonNegative(baseDaily);

  if (
    trend &&
    trend.confidence !== 'INSUFFICIENT' &&
    Number.isFinite(Number(trend.percentChange))
  ) {
    const change = Number(trend.percentChange) / 100;

    if (trend.direction === 'UP') {
      adjustedDailyConsumption =
        adjustedDailyConsumption * Math.min(1.5, 1 + (change * 0.5));
    } else if (trend.direction === 'DOWN') {
      adjustedDailyConsumption =
        adjustedDailyConsumption * Math.max(0.85, 1 + (change * 0.25));
    }
  }

  return adjustedDailyConsumption;
}

function emptySeasonality(lookbackDays) {
  return {
    lookbackDays,
    historyDays: 0,
    movementCount: 0,
    confidence: 'INSUFFICIENT',
    overallDailyAverage: 0,
    weekdayTotals: Array(7).fill(0),
    weekdayDailyAverages: Array(7).fill(0),
    weekdayFactors: Array(7).fill(1),
    strongestDay: null,
    weakestDay: null
  };
}

function weekdayOccurrences(startMs, endMs) {
  const counts = Array(7).fill(0);
  const cursor = new Date(startMs);
  cursor.setUTCHours(0, 0, 0, 0);

  const end = new Date(endMs);
  end.setUTCHours(0, 0, 0, 0);

  while (cursor <= end) {
    counts[cursor.getUTCDay()] += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return counts;
}

function chooseDailyEstimate(averages, historyDays) {
  if (historyDays >= 30) {
    return round(
      (averages[7] * 0.5) +
      (averages[14] * 0.3) +
      (averages[30] * 0.2)
    );
  }

  if (historyDays >= 14) {
    return round(
      (averages[7] * 0.6) +
      (averages[14] * 0.4)
    );
  }

  if (historyDays >= 7) {
    return averages[7];
  }

  return 0;
}

function confidenceForHistory(historyDays, movementCount) {
  if (historyDays >= 60 && movementCount >= 12) return 'HIGH';
  if (historyDays >= 28 && movementCount >= 6) return 'MEDIUM';
  if (historyDays >= 7 && movementCount >= 2) return 'LOW';
  return 'INSUFFICIENT';
}

function determineReason({
  minimumDeficit,
  dailyConsumption,
  targetStock,
  minStock,
  suggestedQuantity
}) {
  if (suggestedQuantity <= 0) return 'ENOUGH_STOCK';
  if (minimumDeficit > 0 && dailyConsumption <= 0) return 'BELOW_MINIMUM';
  if (minimumDeficit > 0 && targetStock <= minStock) return 'BELOW_MINIMUM';
  if (minimumDeficit > 0) return 'BELOW_MINIMUM_AND_PREDICTED_DEMAND';
  return 'PREDICTED_DEMAND';
}

function uniqueCodes(values) {
  return [...new Set(values.filter(Boolean))];
}

function nonNegative(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return number;
}

function positiveOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? round(value) : null;
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}
