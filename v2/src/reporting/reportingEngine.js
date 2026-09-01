import { MOVEMENT_TYPES, stockDeltaForMovement } from '../core/movementTypes.js';
import { calculateStocksByProduct } from '../inventory/stockEngine.js';
import {
  buildConsumptionProfile,
  buildDemandTrend,
  getTrendAwareReplenishmentSuggestion,
  classifyStockRisk
} from '../intelligence/replenishmentEngine.js';

const DAY_MS = 86400000;

export function buildInventoryReport(
  products,
  movements,
  {
    pendingInboundByProduct = new Map(),
    now = new Date(),
    targetDays = 7,
    safetyDays = 1
  } = {}
) {
  const productList = Array.isArray(products) ? products : [];
  const movementList = Array.isArray(movements) ? movements : [];
  const stocks = calculateStocksByProduct(movementList);

  return productList
    .filter(product => product.active !== false)
    .map(product => {
      const stock = Number(stocks.get(product.id) || 0);
      const profile = buildConsumptionProfile(
        movementList,
        product.id,
        now
      );
      const pendingInbound = lookupNumber(
        pendingInboundByProduct,
        product.id
      );

      const trend = buildDemandTrend(
        movementList,
        product.id,
        now
      );

      const trendSuggestion = getTrendAwareReplenishmentSuggestion(
        product,
        {
          stock,
          pendingInbound,
          dailyConsumption: profile.estimatedDailyConsumption,
          targetDays,
          safetyDays,
          trend
        }
      );

      const risk = classifyStockRisk(product, {
        stock,
        pendingInbound,
        dailyConsumption: profile.estimatedDailyConsumption,
        targetDays
      });

      return {
        productId: product.id,
        sku: product.sku || '',
        name: product.name,
        categoryId: product.categoryId || null,
        inventoryUnitId: product.inventoryUnitId || null,
        replenishmentMethod: product.replenishmentMethod || 'BOTH',
        stock,
        minStock: Number(product.minStock || 0),
        maxStock: Number(product.maxStock || 0),
        pendingInbound,
        riskLevel: risk.level,
        suggestedQuantity: trendSuggestion.suggestedQuantity,
        targetStock: trendSuggestion.targetStock,
        coverageDays: risk.suggestion.coverageDays,
        consumptionConfidence: profile.confidence,
        estimatedDailyConsumption: profile.estimatedDailyConsumption,
        adjustedDailyConsumption: trendSuggestion.adjustedDailyConsumption,
        estimatedWeeklyConsumption: profile.estimatedWeeklyConsumption,
        trendDirection: trend.direction,
        trendPercentChange: trend.percentChange,
        trendConfidence: trend.confidence,
        safetyDays: trendSuggestion.safetyDays
      };
    })
    .sort(compareInventoryRows);
}

export function summarizeInventoryReport(rows) {
  const list = Array.isArray(rows) ? rows : [];

  return list.reduce((summary, row) => {
    summary.products += 1;

    if (row.riskLevel === 'CRITICAL') summary.critical += 1;
    else if (row.riskLevel === 'LOW') summary.low += 1;
    else summary.good += 1;

    if (Number(row.suggestedQuantity || 0) > 0) {
      summary.replenishmentNeeded += 1;
    }

    return summary;
  }, {
    products: 0,
    critical: 0,
    low: 0,
    good: 0,
    replenishmentNeeded: 0
  });
}

export function listExpiringLots(
  lots,
  {
    now = new Date(),
    withinDays = 30,
    includeExpired = true
  } = {}
) {
  const from = startOfDay(now).getTime();
  const until = from + (Math.max(0, Number(withinDays) || 0) * DAY_MS);

  return (Array.isArray(lots) ? lots : [])
    .filter(lot => Number(lot.remainingQuantity || 0) > 0)
    .map(lot => {
      const expiry = new Date(lot.expiresAt);
      if (!lot.expiresAt || Number.isNaN(expiry.getTime())) return null;

      const expiryDay = startOfDay(expiry).getTime();
      const daysRemaining = Math.ceil((expiryDay - from) / DAY_MS);

      return {
        ...lot,
        daysRemaining,
        expired: daysRemaining < 0
      };
    })
    .filter(Boolean)
    .filter(lot => includeExpired || !lot.expired)
    .filter(lot => lot.expired || startOfDay(new Date(lot.expiresAt)).getTime() <= until)
    .sort((a, b) => {
      const expiryCompare =
        new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();

      if (expiryCompare !== 0) return expiryCompare;
      return String(a.productId || '').localeCompare(String(b.productId || ''));
    });
}

export function summarizeMovements(
  movements,
  {
    from = null,
    to = null
  } = {}
) {
  const summary = {
    movementCount: 0,
    entryCount: 0,
    supplyCount: 0,
    adjustmentCount: 0,
    reversalCount: 0,
    transferCount: 0
  };

  for (const movement of filterMovementsByRange(movements, { from, to })) {
    summary.movementCount += 1;

    switch (movement.type) {
      case MOVEMENT_TYPES.ENTRY:
        summary.entryCount += 1;
        break;
      case MOVEMENT_TYPES.SUPPLY:
        summary.supplyCount += 1;
        break;
      case MOVEMENT_TYPES.ADJUSTMENT:
        summary.adjustmentCount += 1;
        break;
      case MOVEMENT_TYPES.REVERSAL:
        summary.reversalCount += 1;
        break;
      case MOVEMENT_TYPES.TRANSFER:
        summary.transferCount += 1;
        break;
    }
  }

  return summary;
}

export function buildProductMovementTotals(
  movements,
  {
    from = null,
    to = null
  } = {}
) {
  const totals = new Map();

  for (const movement of filterMovementsByRange(movements, { from, to })) {
    if (!movement.productId) continue;

    const current = totals.get(movement.productId) || {
      productId: movement.productId,
      entry: 0,
      supply: 0,
      adjustment: 0,
      reversal: 0,
      net: 0,
      movementCount: 0
    };

    const quantity = Number(movement.quantity || 0);

    if (movement.type === MOVEMENT_TYPES.ENTRY) current.entry += quantity;
    if (movement.type === MOVEMENT_TYPES.SUPPLY) current.supply += quantity;
    if (movement.type === MOVEMENT_TYPES.ADJUSTMENT) {
      current.adjustment += Number(movement.delta || 0);
    }
    if (movement.type === MOVEMENT_TYPES.REVERSAL) {
      current.reversal += Number(movement.delta || 0);
    }

    current.net += stockDeltaForMovement(movement);
    current.movementCount += 1;
    totals.set(movement.productId, current);
  }

  return [...totals.values()]
    .map(row => roundObject(row))
    .sort((a, b) => b.supply - a.supply || b.movementCount - a.movementCount);
}

function filterMovementsByRange(movements, { from, to }) {
  const fromMs = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
  const toMs = to ? new Date(to).getTime() : Number.POSITIVE_INFINITY;

  return (Array.isArray(movements) ? movements : [])
    .filter(movement => movement.voided !== true)
    .filter(movement => {
      const timestamp = new Date(
        movement.effectiveAt || movement.createdAt
      ).getTime();

      return !Number.isNaN(timestamp) &&
        timestamp >= fromMs &&
        timestamp <= toMs;
    });
}

function compareInventoryRows(a, b) {
  const rank = { CRITICAL: 0, LOW: 1, GOOD: 2 };
  const riskCompare =
    (rank[a.riskLevel] ?? 9) - (rank[b.riskLevel] ?? 9);

  if (riskCompare !== 0) return riskCompare;

  const suggestionCompare =
    Number(b.suggestedQuantity || 0) - Number(a.suggestedQuantity || 0);

  if (suggestionCompare !== 0) return suggestionCompare;

  return String(a.name || '').localeCompare(String(b.name || ''), 'es');
}

function lookupNumber(source, key) {
  const value = source instanceof Map
    ? source.get(key)
    : source?.[key];

  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function startOfDay(value) {
  const date = new Date(value);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}

function roundObject(value) {
  const copy = { ...value };

  for (const key of ['entry', 'supply', 'adjustment', 'reversal', 'net']) {
    copy[key] = Math.round((Number(copy[key]) + Number.EPSILON) * 1000) / 1000;
  }

  return copy;
}
