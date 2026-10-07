import { createLocalId } from '../core/ids.js';
import { nextEntityVersion } from '../core/versioning.js';
import {
  MOVEMENT_TYPES,
  stockDeltaForMovement
} from '../core/movementTypes.js';
import {
  STORES,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { SYNC_STATUS } from '../sync/localQueue.js';
import { calculateStock } from '../inventory/stockEngine.js';
import {
  buildMovement,
  buildMovementSyncItem
} from '../inventory/movementService.js';
import { DOCUMENT_STATUS, DOCUMENT_TYPES } from './documentTypes.js';
import {
  COUNT_RECONCILIATION_KIND,
  RECONCILIATION_DECISION
} from './countReconciliationService.js';

/**
 * Aplica en UNA sola decisión GOD todas las diferencias normales pendientes
 * de una conciliación de conteo.
 *
 * Seguridad:
 * - hace preflight de TODAS las líneas antes de escribir el primer movimiento;
 * - si una sola línea es insegura, no se escribe ninguna;
 * - bloquea mientras exista un puente SAINT pendiente;
 * - conserva la misma regla temporal del ajuste individual;
 * - cada movimiento queda trazado con un bulkAdjustmentId compartido.
 *
 * La atomicidad aquí es local (IndexedDB + outbox). La sincronización con
 * PostgreSQL mantiene el contrato idempotente existente del sistema.
 */
export async function adjustAllPendingReconciliationLines(
  reconciliationId,
  {
    userId = null,
    roleCode = null,
    reason = 'Primer conteo físico confirmado · ajuste masivo'
  } = {}
) {
  assertGod(roleCode);
  const id = clean(reconciliationId);
  if (!id) throw new Error('Conciliación no identificada');

  return runTransaction(
    [
      STORES.DOCUMENTS,
      STORES.DOCUMENT_LINES,
      STORES.MOVEMENTS,
      STORES.SYNC_QUEUE
    ],
    'readwrite',
    async (documentStore, lineStore, movementStore, queueStore) => {
      const reconciliation = await requestToPromise(documentStore.get(id));
      assertGodReconciliationDraft(reconciliation);

      const sourceCountId = clean(
        reconciliation.metadata?.sourceCountDocumentId
      );
      const sourceCount = sourceCountId
        ? await requestToPromise(documentStore.get(sourceCountId))
        : null;

      const bridgePlans = source(
        reconciliation.metadata?.saintBridgePlans?.length
          ? reconciliation.metadata.saintBridgePlans
          : sourceCount?.metadata?.saintBridgePlans
      );
      const pendingBridge = bridgePlans.filter(plan =>
        plan && plan.status !== 'APPLIED'
      );

      if (pendingBridge.length) {
        throw new Error(
          `Primero aplica ${pendingBridge.length} reclasificación(es) del puente SAINT. ` +
          'El ajuste masivo no mezclará una reclasificación especial con diferencias normales.'
        );
      }

      const lines = await requestToPromise(
        lineStore.index('documentId').getAll(reconciliation.id)
      );
      const pendingLines = lines.filter(line =>
        !line.decision ||
        line.decision === RECONCILIATION_DECISION.PENDING
      );

      if (!pendingLines.length) {
        throw new Error('No quedan diferencias normales pendientes para ajustar');
      }

      const allMovements = await requestToPromise(movementStore.getAll());
      const locationId = reconciliation.locationId || null;
      const decisionReason = clean(reason) ||
        'Primer conteo físico confirmado · ajuste masivo';
      const bulkAdjustmentId = createLocalId('bulk_reconciliation');
      const now = new Date().toISOString();

      // PRE-FLIGHT COMPLETO. No escribimos nada hasta que TODAS las líneas
      // demuestren que pueden ajustarse con seguridad.
      const plans = pendingLines.map(line => {
        const referenceAt = normalizeDate(
          line.recountAt || line.sourceCountedAt
        );
        if (!referenceAt) {
          throw new Error(
            `${line.productName || line.productId}: no existe hora confiable del conteo. ` +
            'Recuenta ese producto antes del ajuste masivo.'
          );
        }

        const movements = allMovements.filter(movement =>
          movement?.productId === line.productId
        );
        const later = movementsAfterReference(
          movements,
          referenceAt,
          locationId,
          reconciliation.id
        );
        const sensitiveLater = later.filter(movement =>
          movement.type === MOVEMENT_TYPES.ADJUSTMENT ||
          movement.type === MOVEMENT_TYPES.REVERSAL
        );

        if (sensitiveLater.length) {
          throw new Error(
            `${line.productName || line.productId}: tiene ${sensitiveLater.length} ` +
            'ajuste(s)/reverso(s) posterior(es) al conteo. Recuenta ese producto antes de continuar.'
          );
        }

        const currentStock = round(
          calculateStock(movements, line.productId, { locationId })
        );
        const delta = round(
          finite(line.countedStock, 'Existencia contada') -
          finite(line.expectedStock, 'Existencia esperada')
        );

        if (almostEqual(delta, 0)) {
          throw new Error(
            `${line.productName || line.productId}: ya no tiene diferencia que ajustar`
          );
        }

        const targetStock = round(currentStock + delta);
        if (targetStock < -0.000001) {
          throw new Error(
            `${line.productName || line.productId}: el ajuste dejaría stock negativo. ` +
            'Recuenta ese producto antes de continuar.'
          );
        }

        const laterOperationalDelta = round(
          later.reduce(
            (sum, movement) => sum + stockDeltaForMovement(movement),
            0
          )
        );

        return {
          line,
          referenceAt,
          currentStock,
          delta,
          targetStock,
          later,
          laterOperationalDelta
        };
      });

      // Solo llegamos aquí si todas las líneas pasaron el preflight.
      const movements = [];
      const updatedLines = [];

      for (const plan of plans) {
        const movement = buildMovement({
          productId: plan.line.productId,
          type: MOVEMENT_TYPES.ADJUSTMENT,
          quantity: 0,
          delta: plan.delta,
          documentId: reconciliation.id,
          locationId,
          userId,
          effectiveAt: now,
          metadata: {
            reconciliationKind: COUNT_RECONCILIATION_KIND,
            sourceCountDocumentId:
              reconciliation.metadata?.sourceCountDocumentId || null,
            reconciliationDocumentId: reconciliation.id,
            reconciliationLineId: plan.line.id,
            sourceCountLineId: plan.line.sourceCountLineId || null,
            referenceAt: plan.referenceAt,
            laterOperationalMovementCount: plan.later.length,
            laterOperationalDelta: plan.laterOperationalDelta,
            stockBeforeDecision: plan.currentStock,
            targetStock: plan.targetStock,
            expectedStockAtCount: plan.line.expectedStock,
            countedStockAtCount: plan.line.countedStock,
            reason: decisionReason,
            authorizedRole: 'GOD',
            bulkReconciliationAdjustment: true,
            bulkAdjustmentId,
            bulkAdjustmentLineCount: plans.length
          }
        });

        await requestToPromise(movementStore.add(movement));
        await requestToPromise(queueStore.add(buildMovementSyncItem(movement)));

        const updatedLine = {
          ...plan.line,
          decision: RECONCILIATION_DECISION.ADJUSTED,
          decisionReason,
          decisionBy: userId,
          decisionAt: now,
          decisionExpectedStock: plan.currentStock,
          decisionTargetStock: plan.targetStock,
          decisionDelta: plan.delta,
          movementId: movement.id,
          bulkAdjustmentId,
          version: nextEntityVersion(plan.line),
          updatedAt: now
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

        movements.push(movement);
        updatedLines.push(updatedLine);
      }

      return {
        reconciliationId: reconciliation.id,
        bulkAdjustmentId,
        adjustedCount: updatedLines.length,
        movements,
        lines: updatedLines,
        netDelta: round(plans.reduce((sum, plan) => sum + plan.delta, 0)),
        absoluteDelta: round(
          plans.reduce((sum, plan) => sum + Math.abs(plan.delta), 0)
        ),
        reason: decisionReason
      };
    }
  );
}

function assertGod(roleCode) {
  if (String(roleCode || '').trim().toUpperCase() !== 'GOD') {
    throw new Error('Solo el rol DIOS puede conciliar existencias');
  }
}

function assertGodReconciliationDraft(document) {
  if (!document) throw new Error('Conciliación no encontrada');
  if (
    document.type !== DOCUMENT_TYPES.ADJUSTMENT ||
    document.metadata?.kind !== COUNT_RECONCILIATION_KIND
  ) {
    throw new Error('Documento de conciliación inválido');
  }
  if (document.status !== DOCUMENT_STATUS.DRAFT) {
    throw new Error('La conciliación ya fue cerrada');
  }
}

function movementsAfterReference(
  movements,
  referenceAt,
  locationId,
  reconciliationDocumentId
) {
  const referenceMs = Date.parse(referenceAt);
  if (!Number.isFinite(referenceMs)) return [];

  return movements.filter(movement => {
    if (!movement || movement.voided === true) return false;
    if (locationId && movement.locationId !== locationId) return false;
    if (movement.documentId === reconciliationDocumentId) return false;

    const at = movement.effectiveAt || movement.createdAt;
    const movementMs = Date.parse(at || '');
    return Number.isFinite(movementMs) && movementMs > referenceMs;
  });
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

function source(value) {
  return Array.isArray(value) ? value : [];
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} inválida`);
  }
  return number;
}

function almostEqual(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= 0.000001;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function round(value) {
  const number = Number(value || 0);
  return Math.round((number + Number.EPSILON) * 1e6) / 1e6;
}

function clean(value) {
  return String(value ?? '').trim();
}
