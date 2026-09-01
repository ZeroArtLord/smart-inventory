import { MOVEMENT_TYPES } from '../core/movementTypes.js';
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

export function getTrendAwareReplenishmentSuggestion(
  product,
  context = {}
) {
  const baseDaily = nonNegative(context.dailyConsumption);
  const trend = context.trend || null;
  const safetyDays = nonNegative(context.safetyDays ?? 0);

  let adjustedDailyConsumption = baseDaily;

  if (
    trend &&
    trend.confidence !== 'INSUFFICIENT' &&
    Number.isFinite(Number(trend.percentChange))
  ) {
    const change = Number(trend.percentChange) / 100;

    if (trend.direction === 'UP') {
      adjustedDailyConsumption =
        baseDaily * Math.min(1.5, 1 + (change * 0.5));
    } else if (trend.direction === 'DOWN') {
      adjustedDailyConsumption =
        baseDaily * Math.max(0.85, 1 + (change * 0.25));
    }
  }

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
