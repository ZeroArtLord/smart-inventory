const LIVE_SUPPLY_DELIVERY_KIND = 'LIVE_SUPPLY_DELIVERY';
const EPSILON = 0.000001;

export function buildAreaConsumptionReport({
  documents = [],
  lines = [],
  movements = [],
  lots = [],
  products = [],
  areas = [],
  from = null,
  to = null
} = {}) {
  const fromTime = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
  const toTime = to ? new Date(to).getTime() : Number.POSITIVE_INFINITY;
  const areaById = new Map(areas.map(area => [area.id, area]));
  const productById = new Map(products.map(product => [product.id, product]));
  const lotById = new Map(lots.map(lot => [lot.id, lot]));
  const reversedMovementIds = new Set(
    movements
      .filter(movement => movement.type === 'REVERSAL' && movement.reversedMovementId)
      .map(movement => movement.reversedMovementId)
  );

  const deliveryIds = new Set(
    documents
      .filter(document => document.type === 'SUPPLY')
      .filter(document => document.status === 'CLOSED')
      .filter(document => document.metadata?.kind === LIVE_SUPPLY_DELIVERY_KIND)
      .filter(document => {
        const time = new Date(document.closedAt || document.updatedAt || document.createdAt).getTime();
        return Number.isFinite(time) && time >= fromTime && time <= toTime;
      })
      .map(document => document.id)
  );

  const movementByLine = new Map();
  for (const movement of movements) {
    if (movement.type !== 'SUPPLY') continue;
    if (reversedMovementIds.has(movement.id)) continue;
    if (!deliveryIds.has(movement.documentId)) continue;
    const lineId = movement.metadata?.lineId;
    if (!lineId) continue;
    const current = movementByLine.get(lineId) || [];
    current.push(movement);
    movementByLine.set(lineId, current);
  }

  const areaRows = new Map();
  let trackedDeliveryLines = 0;
  let unassignedDeliveryLines = 0;
  let allocatedQuantity = 0;
  let knownCost = 0;
  let costedQuantity = 0;
  let totalMovementQuantity = 0;

  for (const line of lines) {
    if (!deliveryIds.has(line.documentId)) continue;

    const lineQuantity = positiveNumber(line.quantity);
    if (lineQuantity <= 0) continue;

    const allocations = normalizeAllocations(line.areaAllocations, lineQuantity);
    if (!allocations.length) {
      unassignedDeliveryLines += 1;
      continue;
    }

    trackedDeliveryLines += 1;
    allocatedQuantity += allocations.reduce((sum, item) => sum + item.quantity, 0);

    const lineMovements = movementByLine.get(line.id) || [];
    let lineKnownCost = 0;
    let lineCostedQuantity = 0;
    let lineMovementQuantity = 0;

    for (const movement of lineMovements) {
      const quantity = positiveNumber(movement.quantity);
      if (quantity <= 0) continue;
      lineMovementQuantity += quantity;

      const lot = movement.lotId ? lotById.get(movement.lotId) : null;
      const unitCost = optionalCost(
        movement.metadata?.unitCost ?? lot?.unitCost
      );

      if (unitCost !== null) {
        lineKnownCost += quantity * unitCost;
        lineCostedQuantity += quantity;
      }
    }

    knownCost += lineKnownCost;
    costedQuantity += lineCostedQuantity;
    totalMovementQuantity += lineMovementQuantity;

    const product = productById.get(line.productId);
    const costPerAllocatedUnit = lineQuantity > EPSILON
      ? lineKnownCost / lineQuantity
      : 0;
    const costCoverage = lineMovementQuantity > EPSILON
      ? Math.min(1, lineCostedQuantity / lineMovementQuantity)
      : 0;

    for (const allocation of allocations) {
      const area = areaRows.get(allocation.areaId) || createAreaRow(
        allocation,
        areaById.get(allocation.areaId)
      );

      area.allocationCount += 1;
      area.quantity += allocation.quantity;
      area.knownCost += allocation.quantity * costPerAllocatedUnit;
      area.costedQuantity += allocation.quantity * costCoverage;
      area.products.set(
        line.productId,
        addProduct(area.products.get(line.productId), {
          productId: line.productId,
          productName: product?.name || line.productName || line.productId,
          quantity: allocation.quantity,
          knownCost: allocation.quantity * costPerAllocatedUnit,
          costedQuantity: allocation.quantity * costCoverage
        })
      );

      area.deliveryIds.add(line.documentId);
      areaRows.set(allocation.areaId, area);
    }
  }

  const rows = [...areaRows.values()]
    .map(finalizeAreaRow)
    .sort((a, b) =>
      Number(b.knownCost || 0) - Number(a.knownCost || 0) ||
      Number(b.allocationCount || 0) - Number(a.allocationCount || 0) ||
      a.areaName.localeCompare(b.areaName, 'es')
    );

  return {
    rows,
    trackedDeliveryLines,
    unassignedDeliveryLines,
    allocatedQuantity,
    knownCost,
    costedQuantity,
    totalMovementQuantity,
    costCoveragePercent: totalMovementQuantity > EPSILON
      ? Math.round((costedQuantity / totalMovementQuantity) * 1000) / 10
      : 0
  };
}

function createAreaRow(allocation, currentArea) {
  return {
    areaId: allocation.areaId,
    areaName: allocation.areaName || currentArea?.name || allocation.areaId,
    areaActive: currentArea ? currentArea.active !== false : null,
    allocationCount: 0,
    quantity: 0,
    knownCost: 0,
    costedQuantity: 0,
    deliveryIds: new Set(),
    products: new Map()
  };
}

function finalizeAreaRow(row) {
  const products = [...row.products.values()]
    .map(item => ({
      ...item,
      costCoveragePercent: item.quantity > EPSILON
        ? Math.round((item.costedQuantity / item.quantity) * 1000) / 10
        : 0
    }))
    .sort((a, b) =>
      Number(b.knownCost || 0) - Number(a.knownCost || 0) ||
      Number(b.quantity || 0) - Number(a.quantity || 0)
    );

  return {
    areaId: row.areaId,
    areaName: row.areaName,
    areaActive: row.areaActive,
    allocationCount: row.allocationCount,
    deliveryCount: row.deliveryIds.size,
    quantity: row.quantity,
    knownCost: roundMoney(row.knownCost),
    costedQuantity: row.costedQuantity,
    costCoveragePercent: row.quantity > EPSILON
      ? Math.round((row.costedQuantity / row.quantity) * 1000) / 10
      : 0,
    products
  };
}

function normalizeAllocations(value, lineQuantity) {
  if (!Array.isArray(value)) return [];

  const rows = value
    .map(item => ({
      areaId: String(item?.areaId || '').trim(),
      areaName: String(item?.areaName || '').trim(),
      quantity: positiveNumber(item?.quantity)
    }))
    .filter(item => item.areaId && item.quantity > 0);

  const total = rows.reduce((sum, item) => sum + item.quantity, 0);
  if (Math.abs(total - lineQuantity) > EPSILON) return [];
  return rows;
}

function addProduct(current, next) {
  if (!current) return { ...next };
  return {
    ...current,
    quantity: current.quantity + next.quantity,
    knownCost: current.knownCost + next.knownCost,
    costedQuantity: current.costedQuantity + next.costedQuantity
  };
}

function positiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function optionalCost(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}
