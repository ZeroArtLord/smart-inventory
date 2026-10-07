import { createLocalId } from '../core/ids.js';
import { nextEntityVersion, initialEntityVersion } from '../core/versioning.js';
import { MOVEMENT_TYPES, stockDeltaForMovement } from '../core/movementTypes.js';
import {
  STORES,
  get,
  getAll,
  getAllByIndex,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { SYNC_STATUS } from '../sync/localQueue.js';
import { calculateStock } from '../inventory/stockEngine.js';
import { buildMovement, buildMovementSyncItem } from '../inventory/movementService.js';
import {
  COUNT_RECONCILIATION_KIND,
  RECONCILIATION_STATE,
  RECONCILIATION_DECISION,
  submitCountForReconciliation,
  ensureCountReconciliationDraft
} from './countReconciliationService.js';
import { DOCUMENT_STATUS, DOCUMENT_TYPES } from './documentTypes.js';
import {
  SAINT_BRIDGE_RECLASSIFICATION_KIND,
  buildCountSaintBridgePlans
} from '../catalog/saintBridge.js';

export async function submitCountWithSaintBridge(
  documentId,
  { userId = null } = {}
) {
  const [products, lines, movements] = await Promise.all([
    getAll(STORES.PRODUCTS),
    getAllByIndex(STORES.DOCUMENT_LINES, 'documentId', documentId),
    getAll(STORES.MOVEMENTS)
  ]);

  const stockByProductId = stockMap(products, movements);
  const plans = buildCountSaintBridgePlans({
    products,
    lines,
    stockByProductId
  });

  const result = await submitCountForReconciliation(documentId, { userId });
  if (!plans.length) return { ...result, bridgePlans: [] };

  const now = new Date().toISOString();
  const updated = await runTransaction(
    [STORES.DOCUMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (documentStore, queueStore) => {
      const current = await requestToPromise(documentStore.get(documentId));
      if (!current) throw new Error('Conteo cerrado no encontrado');

      const next = {
        ...current,
        version: nextEntityVersion(current),
        updatedAt: now,
        metadata: {
          ...(current.metadata || {}),
          reconciliationState: RECONCILIATION_STATE.PENDING,
          reconciliationResolvedAt: null,
          reconciliationResolvedBy: null,
          saintBridgePlans: plans,
          saintBridgePlanCount: plans.length,
          saintBridgePendingCount: plans.length
        }
      };

      await requestToPromise(documentStore.put(next));
      await requestToPromise(
        queueStore.add(createSyncItem('document', next.id, 'UPDATE', next))
      );
      return next;
    }
  );

  return {
    ...result,
    document: updated,
    bridgePlans: plans
  };
}

export async function ensureSaintBridgeReconciliationDraft(
  countDocumentId,
  { userId = null, roleCode = null } = {}
) {
  assertGod(roleCode);
  const count = await get(STORES.DOCUMENTS, countDocumentId);
  if (!count) throw new Error('Conteo no encontrado');
  const plans = pendingPlans(count.metadata?.saintBridgePlans);

  if (!plans.length) {
    return ensureCountReconciliationDraft(countDocumentId, {
      userId,
      roleCode
    });
  }

  const reconciliationId = `adj_recon_${countDocumentId}`;
  const existing = await get(STORES.DOCUMENTS, reconciliationId);
  if (existing) {
    return ensureReconciliationCarriesPlans(
      count,
      existing,
      plans
    );
  }

  const countLines = await getAllByIndex(
    STORES.DOCUMENT_LINES,
    'documentId',
    countDocumentId
  );
  const hasNormalDifference = countLines.some(line =>
    !almostEqual(Number(line.countedStock), Number(line.expectedStock))
  );

  if (hasNormalDifference) {
    const opened = await ensureCountReconciliationDraft(countDocumentId, {
      userId,
      roleCode
    });
    return ensureReconciliationCarriesPlans(
      opened.count,
      opened.reconciliation,
      plans,
      opened.lines,
      opened.reused
    );
  }

  const now = new Date().toISOString();
  return runTransaction(
    [STORES.DOCUMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (documentStore, queueStore) => {
      const liveCount = await requestToPromise(documentStore.get(countDocumentId));
      if (!liveCount || liveCount.status !== DOCUMENT_STATUS.CLOSED) {
        throw new Error('El conteo no está listo para conciliación');
      }

      const reconciliation = {
        id: reconciliationId,
        type: DOCUMENT_TYPES.ADJUSTMENT,
        status: DOCUMENT_STATUS.DRAFT,
        ownerId: userId,
        locationId: liveCount.locationId || null,
        destinationId: null,
        supplierId: null,
        reference: `Conciliación ${liveCount.id}`,
        notes: '',
        metadata: {
          kind: COUNT_RECONCILIATION_KIND,
          sourceCountDocumentId: liveCount.id,
          sourceCountClosedAt: liveCount.closedAt || null,
          createdByRole: 'GOD',
          saintBridgePlans: plans
        },
        version: initialEntityVersion(),
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        closedBy: null
      };

      const updatedCount = {
        ...liveCount,
        version: nextEntityVersion(liveCount),
        updatedAt: now,
        metadata: {
          ...(liveCount.metadata || {}),
          reconciliationState: RECONCILIATION_STATE.REVIEWING,
          reconciliationDocumentId: reconciliation.id,
          reconciliationStartedAt: now,
          reconciliationStartedBy: userId
        }
      };

      await requestToPromise(documentStore.add(reconciliation));
      await requestToPromise(documentStore.put(updatedCount));
      await requestToPromise(
        queueStore.add(
          createSyncItem('document', reconciliation.id, 'CREATE', reconciliation)
        )
      );
      await requestToPromise(
        queueStore.add(
          createSyncItem('document', updatedCount.id, 'UPDATE', updatedCount)
        )
      );

      return {
        count: updatedCount,
        reconciliation,
        lines: [],
        reused: false
      };
    }
  );
}

export async function getSaintBridgePlansForReconciliation(reconciliationId) {
  const reconciliation = await get(STORES.DOCUMENTS, reconciliationId);
  if (!reconciliation) return [];

  const direct = source(reconciliation.metadata?.saintBridgePlans);
  if (direct.length) return direct;

  const countId = reconciliation.metadata?.sourceCountDocumentId;
  const count = countId ? await get(STORES.DOCUMENTS, countId) : null;
  return source(count?.metadata?.saintBridgePlans);
}

export async function applySaintBridgeReclassification(
  reconciliationId,
  sourceProductId,
  {
    userId = null,
    roleCode = null,
    reason = 'Reclasificación de familia SAINT a productos VIGÍA'
  } = {}
) {
  assertGod(roleCode);

  return runTransaction(
    [
      STORES.DOCUMENTS,
      STORES.DOCUMENT_LINES,
      STORES.PRODUCTS,
      STORES.MOVEMENTS,
      STORES.SYNC_QUEUE
    ],
    'readwrite',
    async (
      documentStore,
      lineStore,
      productStore,
      movementStore,
      queueStore
    ) => {
      const reconciliation = await requestToPromise(
        documentStore.get(reconciliationId)
      );
      assertBridgeReconciliation(reconciliation);

      const countId = reconciliation.metadata?.sourceCountDocumentId;
      const count = await requestToPromise(documentStore.get(countId));
      if (!count) throw new Error('Conteo origen no encontrado');

      const plans = source(
        reconciliation.metadata?.saintBridgePlans?.length
          ? reconciliation.metadata.saintBridgePlans
          : count.metadata?.saintBridgePlans
      );
      const planIndex = plans.findIndex(
        plan => clean(plan?.sourceProductId) === clean(sourceProductId)
      );
      if (planIndex < 0) throw new Error('Grupo SAINT no encontrado');

      const plan = plans[planIndex];
      if (plan.status === 'APPLIED') {
        return { reused: true, plan, movements: [] };
      }

      const products = await requestToPromise(productStore.getAll());
      const productById = new Map(products.map(item => [item.id, item]));
      const sourceProduct = productById.get(plan.sourceProductId);
      if (!sourceProduct?.saintBridgeSource) {
        throw new Error('El producto fuente ya no está marcado como puente SAINT');
      }

      const countLines = await requestToPromise(
        lineStore.index('documentId').getAll(count.id)
      );
      const countLineByProduct = new Map(
        countLines.map(line => [line.productId, line])
      );

      for (const variant of source(plan.variants)) {
        if (!countLineByProduct.has(variant.productId)) {
          throw new Error(
            `${variant.productName || variant.productId}: falta conteo físico. No se reclasificó nada.`
          );
        }
      }

      const allMovements = await requestToPromise(movementStore.getAll());
      const locationId = reconciliation.locationId || null;
      const created = [];
      const movementByProduct = new Map();
      const now = new Date().toISOString();
      const decisionReason = clean(reason) ||
        'Reclasificación de familia SAINT a productos VIGÍA';

      const sourceLine = countLineByProduct.get(plan.sourceProductId) || null;
      const sourceReference = normalizeDate(
        sourceLine?.countedAt || count.closedAt || count.updatedAt
      );
      const sourceMovements = forProduct(
        allMovements,
        plan.sourceProductId,
        locationId
      );
      const laterSource = afterReference(
        sourceMovements,
        sourceReference,
        reconciliation.id
      );
      if (laterSource.length) {
        throw new Error(
          `REFRESCO BOT 350ML tiene ${laterSource.length} movimiento(s) posterior(es) al conteo. ` +
          'No puedo repartirlos entre sabores de forma segura.'
        );
      }

      const sourceCurrentStock = round(
        calculateStock(sourceMovements, plan.sourceProductId, { locationId })
      );
      const sourceDelta = round(-sourceCurrentStock);
      if (!almostEqual(sourceDelta, 0)) {
        const movement = bridgeMovement({
          productId: plan.sourceProductId,
          delta: sourceDelta,
          reconciliation,
          count,
          userId,
          now,
          plan,
          reason: decisionReason,
          role: 'SOURCE',
          stockBefore: sourceCurrentStock,
          targetStock: 0
        });
        await requestToPromise(movementStore.add(movement));
        await requestToPromise(queueStore.add(buildMovementSyncItem(movement)));
        created.push(movement);
        movementByProduct.set(plan.sourceProductId, movement);
      }

      for (const variant of source(plan.variants)) {
        const line = countLineByProduct.get(variant.productId);
        const counted = nonNegative(line.countedStock, variant.productName);
        const referenceAt = normalizeDate(line.countedAt || count.closedAt);
        if (!referenceAt) {
          throw new Error(`${variant.productName}: falta hora confiable del conteo`);
        }

        const movements = forProduct(
          allMovements,
          variant.productId,
          locationId
        );
        const later = afterReference(movements, referenceAt, reconciliation.id);
        const sensitive = later.filter(item =>
          item.type === MOVEMENT_TYPES.ADJUSTMENT ||
          item.type === MOVEMENT_TYPES.REVERSAL
        );
        if (sensitive.length) {
          throw new Error(
            `${variant.productName}: tiene ajustes/reversos posteriores al conteo. Revisa antes de reclasificar.`
          );
        }

        const laterOperationalDelta = round(
          later.reduce((sum, item) => sum + stockDeltaForMovement(item), 0)
        );
        const targetStock = round(counted + laterOperationalDelta);
        const currentStock = round(
          calculateStock(movements, variant.productId, { locationId })
        );
        const delta = round(targetStock - currentStock);

        if (targetStock < -0.000001) {
          throw new Error(`${variant.productName}: la reclasificación dejaría stock negativo`);
        }

        if (!almostEqual(delta, 0)) {
          const movement = bridgeMovement({
            productId: variant.productId,
            delta,
            reconciliation,
            count,
            userId,
            now,
            plan,
            reason: decisionReason,
            role: 'VARIANT',
            stockBefore: currentStock,
            targetStock,
            countedStock: counted,
            laterOperationalDelta
          });
          await requestToPromise(movementStore.add(movement));
          await requestToPromise(queueStore.add(buildMovementSyncItem(movement)));
          created.push(movement);
          movementByProduct.set(variant.productId, movement);
        }
      }

      const bridgeIds = new Set([
        plan.sourceProductId,
        ...source(plan.variants).map(item => item.productId)
      ]);
      const reconciliationLines = await requestToPromise(
        lineStore.index('documentId').getAll(reconciliation.id)
      );

      for (const line of reconciliationLines) {
        if (!bridgeIds.has(line.productId)) continue;
        if (
          line.decision &&
          ![
            RECONCILIATION_DECISION.PENDING,
            RECONCILIATION_DECISION.MATCHED
          ].includes(line.decision)
        ) {
          throw new Error(
            `${line.productName}: la diferencia ya fue resuelta por otro camino`
          );
        }

        const movement = movementByProduct.get(line.productId) || null;
        const targetStock = line.productId === plan.sourceProductId
          ? 0
          : nonNegative(
              countLineByProduct.get(line.productId)?.countedStock,
              line.productName
            );
        const updatedLine = {
          ...line,
          decision: RECONCILIATION_DECISION.ADJUSTED,
          decisionReason,
          decisionBy: userId,
          decisionAt: now,
          decisionExpectedStock: Number(line.expectedStock || 0),
          decisionTargetStock: targetStock,
          decisionDelta: movement?.delta || 0,
          movementId: movement?.id || null,
          version: nextEntityVersion(line),
          updatedAt: now,
          bridgeResolutionKind: SAINT_BRIDGE_RECLASSIFICATION_KIND
        };
        await requestToPromise(lineStore.put(updatedLine));
        await requestToPromise(
          queueStore.add(
            createSyncItem(
              'documentLine',
              updatedLine.id,
              'UPDATE',
              updatedLine
            )
          )
        );
      }

      const appliedPlan = {
        ...plan,
        status: 'APPLIED',
        appliedAt: now,
        appliedBy: userId,
        movementIds: created.map(item => item.id),
        sourceStockBefore: sourceCurrentStock,
        sourceTargetStock: 0,
        reason: decisionReason
      };
      const nextPlans = plans.slice();
      nextPlans[planIndex] = appliedPlan;
      const pendingCount = nextPlans.filter(item => item.status !== 'APPLIED').length;
      const updatedReconciliation = {
        ...reconciliation,
        version: nextEntityVersion(reconciliation),
        updatedAt: now,
        metadata: {
          ...(reconciliation.metadata || {}),
          saintBridgePlans: nextPlans,
          saintBridgePendingCount: pendingCount
        }
      };

      await requestToPromise(documentStore.put(updatedReconciliation));
      await requestToPromise(
        queueStore.add(
          createSyncItem(
            'document',
            updatedReconciliation.id,
            'UPDATE',
            updatedReconciliation
          )
        )
      );

      return {
        reused: false,
        plan: appliedPlan,
        movements: created,
        reconciliation: updatedReconciliation
      };
    }
  );
}

export async function finalizeBridgeOnlyReconciliation(
  reconciliationId,
  { userId = null, roleCode = null } = {}
) {
  assertGod(roleCode);
  const lines = await getAllByIndex(
    STORES.DOCUMENT_LINES,
    'documentId',
    reconciliationId
  );
  if (lines.length) return null;

  return runTransaction(
    [STORES.DOCUMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (documentStore, queueStore) => {
      const reconciliation = await requestToPromise(
        documentStore.get(reconciliationId)
      );
      assertBridgeReconciliation(reconciliation);
      const plans = source(reconciliation.metadata?.saintBridgePlans);
      if (!plans.length) return null;
      const pending = plans.filter(item => item.status !== 'APPLIED');
      if (pending.length) {
        throw new Error(`Quedan ${pending.length} grupo(s) SAINT sin reclasificar`);
      }

      const countId = reconciliation.metadata?.sourceCountDocumentId;
      const count = await requestToPromise(documentStore.get(countId));
      if (!count) throw new Error('Conteo origen no encontrado');
      const now = new Date().toISOString();
      const summary = {
        total: 0,
        pending: 0,
        adjusted: 0,
        ignored: 0,
        matched: 0,
        shortages: 0,
        surpluses: 0,
        netDifference: 0,
        absoluteDifference: 0,
        bridgeGroupsApplied: plans.length
      };

      const closedReconciliation = {
        ...reconciliation,
        status: DOCUMENT_STATUS.CLOSED,
        closedAt: now,
        closedBy: userId,
        version: nextEntityVersion(reconciliation),
        updatedAt: now,
        metadata: {
          ...(reconciliation.metadata || {}),
          resolvedAt: now,
          resolvedBy: userId,
          summary
        }
      };
      const resolvedCount = {
        ...count,
        version: nextEntityVersion(count),
        updatedAt: now,
        metadata: {
          ...(count.metadata || {}),
          reconciliationState: RECONCILIATION_STATE.RESOLVED,
          reconciliationDocumentId: reconciliation.id,
          reconciliationResolvedAt: now,
          reconciliationResolvedBy: userId,
          reconciliationSummary: summary,
          adjustmentLines: 0,
          saintBridgePendingCount: 0
        }
      };

      await requestToPromise(documentStore.put(closedReconciliation));
      await requestToPromise(documentStore.put(resolvedCount));
      await requestToPromise(
        queueStore.add(
          createSyncItem(
            'document',
            closedReconciliation.id,
            'UPDATE',
            closedReconciliation
          )
        )
      );
      await requestToPromise(
        queueStore.add(
          createSyncItem('document', resolvedCount.id, 'UPDATE', resolvedCount)
        )
      );

      return {
        reconciliation: closedReconciliation,
        count: resolvedCount,
        summary
      };
    }
  );
}

async function ensureReconciliationCarriesPlans(
  count,
  reconciliation,
  plans,
  lines = null,
  reused = true
) {
  const currentPlans = source(reconciliation.metadata?.saintBridgePlans);
  if (currentPlans.length) {
    return {
      count,
      reconciliation,
      lines: lines || await getAllByIndex(
        STORES.DOCUMENT_LINES,
        'documentId',
        reconciliation.id
      ),
      reused
    };
  }

  const now = new Date().toISOString();
  const updated = await runTransaction(
    [STORES.DOCUMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (documentStore, queueStore) => {
      const live = await requestToPromise(documentStore.get(reconciliation.id));
      const next = {
        ...live,
        version: nextEntityVersion(live),
        updatedAt: now,
        metadata: {
          ...(live.metadata || {}),
          saintBridgePlans: plans,
          saintBridgePendingCount: plans.filter(item => item.status !== 'APPLIED').length
        }
      };
      await requestToPromise(documentStore.put(next));
      await requestToPromise(
        queueStore.add(createSyncItem('document', next.id, 'UPDATE', next))
      );
      return next;
    }
  );

  return {
    count,
    reconciliation: updated,
    lines: lines || await getAllByIndex(
      STORES.DOCUMENT_LINES,
      'documentId',
      updated.id
    ),
    reused
  };
}

function bridgeMovement({
  productId,
  delta,
  reconciliation,
  count,
  userId,
  now,
  plan,
  reason,
  role,
  stockBefore,
  targetStock,
  countedStock = null,
  laterOperationalDelta = 0
}) {
  return buildMovement({
    productId,
    type: MOVEMENT_TYPES.ADJUSTMENT,
    quantity: 0,
    delta,
    documentId: reconciliation.id,
    locationId: reconciliation.locationId || null,
    userId,
    effectiveAt: now,
    metadata: {
      reconciliationKind: COUNT_RECONCILIATION_KIND,
      bridgeReclassificationKind: SAINT_BRIDGE_RECLASSIFICATION_KIND,
      sourceCountDocumentId: count.id,
      reconciliationDocumentId: reconciliation.id,
      saintBridgeSourceProductId: plan.sourceProductId,
      saintBridgeCode: plan.saintCode,
      saintBridgeName: plan.bridgeName,
      bridgeRole: role,
      controlCountedStock: plan.controlCountedStock,
      variantCountedTotal: plan.variantCountedTotal,
      countedStock,
      laterOperationalDelta,
      stockBeforeDecision: stockBefore,
      targetStock,
      reason,
      authorizedRole: 'GOD'
    }
  });
}

function stockMap(products, movements) {
  const map = new Map();
  for (const product of source(products)) {
    map.set(
      product.id,
      round(calculateStock(movements, product.id))
    );
  }
  return map;
}

function forProduct(movements, productId, locationId) {
  return source(movements).filter(item => {
    if (!item || item.productId !== productId || item.voided === true) return false;
    if (locationId && item.locationId !== locationId) return false;
    return true;
  });
}

function afterReference(movements, referenceAt, excludedDocumentId) {
  const referenceMs = Date.parse(referenceAt || '');
  if (!Number.isFinite(referenceMs)) return [];
  return source(movements).filter(item => {
    if (item.documentId === excludedDocumentId) return false;
    const at = Date.parse(item.effectiveAt || item.createdAt || '');
    return Number.isFinite(at) && at > referenceMs;
  });
}

function assertBridgeReconciliation(document) {
  if (!document) throw new Error('Conciliación no encontrada');
  if (
    document.type !== DOCUMENT_TYPES.ADJUSTMENT ||
    document.metadata?.kind !== COUNT_RECONCILIATION_KIND ||
    document.status !== DOCUMENT_STATUS.DRAFT
  ) {
    throw new Error('Conciliación SAINT no está abierta');
  }
}

function assertGod(roleCode) {
  if (String(roleCode || '').trim().toUpperCase() !== 'GOD') {
    throw new Error('Solo el rol DIOS puede reclasificar el puente SAINT');
  }
}

function pendingPlans(plans) {
  return source(plans).filter(plan => plan?.status !== 'APPLIED');
}

function createSyncItem(entityType, entityId, operation, payload) {
  const now = new Date().toISOString();
  return {
    id: createLocalId('sync'),
    entityType,
    entityId,
    operation,
    payload,
    status: SYNC_STATUS.PENDING,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastError: null
  };
}

function nonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label || 'Cantidad'}: existencia inválida`);
  }
  return round(number);
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function almostEqual(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= 0.000001;
}

function source(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value) {
  return String(value ?? '').trim();
}

function round(value) {
  const number = Number(value || 0);
  return Math.round((number + Number.EPSILON) * 1e6) / 1e6;
}
