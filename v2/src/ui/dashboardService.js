import {
  STORES,
  getAll
} from '../storage/database.js';
import {
  buildInventoryReport,
  summarizeInventoryReport,
  listExpiringLots,
  summarizeMovements
} from '../reporting/reportingEngine.js';
import { DOCUMENT_STATUS } from '../documents/documentTypes.js';
import {
  calculatePendingInboundByProduct
} from '../replenishment/replenishmentService.js';

export async function getDashboardSnapshot({
  now = new Date(),
  expirationDays = 30,
  lowStockLimit = 6,
  recentMovementLimit = 8
} = {}) {
  const [
    products,
    movements,
    lots,
    documents,
    replenishments,
    syncQueue
  ] = await Promise.all([
    getAll(STORES.PRODUCTS),
    getAll(STORES.MOVEMENTS),
    getAll(STORES.LOTS),
    getAll(STORES.DOCUMENTS),
    getAll(STORES.REPLENISHMENTS),
    getAll(STORES.SYNC_QUEUE)
  ]);

  const pendingInboundByProduct =
    calculatePendingInboundByProduct(replenishments);

  const inventoryRows = buildInventoryReport(products, movements, {
    now,
    pendingInboundByProduct
  });
  const inventorySummary = summarizeInventoryReport(inventoryRows);
  const expiringLots = listExpiringLots(lots, {
    now,
    withinDays: expirationDays,
    includeExpired: true
  });

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const movementSummaryToday = summarizeMovements(movements, {
    from: start,
    to: now
  });

  const drafts = documents
    .filter(document => document.status === DOCUMENT_STATUS.DRAFT)
    .sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    );

  const conflicts = syncQueue.filter(
    item => item.status === 'CONFLICT'
  );

  const pendingSync = syncQueue.filter(item =>
    item.status === 'PENDING' ||
    item.status === 'FAILED' ||
    item.status === 'SYNCING' ||
    item.status === 'CONFLICT'
  );

  const lowStock = inventoryRows
    .filter(row => row.riskLevel !== 'GOOD')
    .slice(0, lowStockLimit);

  const recentMovements = [...movements]
    .filter(movement => movement.voided !== true)
    .sort((a, b) =>
      movementTime(b) - movementTime(a)
    )
    .slice(0, recentMovementLimit);

  return {
    generatedAt: now.toISOString(),
    inventorySummary,
    lowStock,
    expiringLots,
    movementSummaryToday,
    replenishments,
    drafts,
    pendingSyncCount: pendingSync.length,
    syncConflictCount: conflicts.length,
    recentMovements
  };
}

function movementTime(movement) {
  const value = new Date(
    movement.effectiveAt || movement.createdAt || 0
  ).getTime();

  return Number.isNaN(value) ? 0 : value;
}
