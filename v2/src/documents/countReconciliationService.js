import { createLocalId } from '../core/ids.js';
import {
  initialEntityVersion,
  nextEntityVersion
} from '../core/versioning.js';
import {
  MOVEMENT_TYPES,
  stockDeltaForMovement
} from '../core/movementTypes.js';
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
import {
  buildMovement,
  buildMovementSyncItem
} from '../inventory/movementService.js';
import {
  DOCUMENT_STATUS,
  DOCUMENT_TYPES
} from './documentTypes.js';

export const COUNT_RECONCILIATION_KIND = 'COUNT_RECONCILIATION';

export const RECONCILIATION_STATE = Object.freeze({
  PENDING: 'PENDING',
  REVIEWING: 'REVIEWING',
  RESOLVED: 'RESOLVED',
  NOT_REQUIRED: 'NOT_REQUIRED'
});

export const RECONCILIATION_DECISION = Object.freeze({
  PENDING: 'PENDING',
  ADJUSTED: 'ADJUSTED',
  IGNORED: 'IGNORED',
  MATCHED: 'MATCHED'
});

/**
 * V5-D cierra la medición física SIN convertir diferencias en movimientos.
 * El stock permanece exactamente igual hasta una decisión explícita de GOD.
 */
export async function submitCountForReconciliation(
  documentId,
  { userId = null } = {}
) {
  const id = clean(documentId);
  if (!id) throw new Error('Conteo no identificado');

  return runTransaction(
    [
      STORES.DOCUMENTS,
      STORES.DOCUMENT_LINES,
      STORES.PRODUCTS,
      STORES.SYNC_QUEUE
    ],
    'readwrite',
    async (documentStore, lineStore, productStore, queueStore) => {
      const document = await requestToPromise(documentStore.get(id));
      assertDraftCount(document);

      const [lines, products] = await Promise.all([
        requestToPromise(lineStore.index('documentId').getAll(id)),
        requestToPromise(productStore.getAll())
      ]);

      if (!lines.length) {
        throw new Error('No se puede cerrar un conteo vacío');
      }

      const activeProductIds = new Set(
        products
          .filter(product => product?.active !== false)
          .map(product => product.id)
      );
      const countedIds = new Set(lines.map(line => line.productId));
      const missing = [...activeProductIds]
        .filter(productId => !countedIds.has(productId));

      if (missing.length) {
        throw new Error(
          `Aún faltan ${missing.length} producto(s) por contar. Revisa pendientes antes de cerrar.`
        );
      }

      const differences = lines.filter(line => {
        const expected = finite(line.expectedStock, 'Existencia esperada');
        const counted = finite(line.countedStock, 'Existencia contada');
        return !almostEqual(counted, expected);
      });

      const now = new Date().toISOString();
      const state = differences.length
        ? RECONCILIATION_STATE.PENDING
        : RECONCILIATION_STATE.NOT_REQUIRED;

      const closed = {
        ...document,
        status: DOCUMENT_STATUS.CLOSED,
        version: nextEntityVersion(document),
        closedAt: now,
        closedBy: userId,
        updatedAt: now,
        metadata: {
          ...(document.metadata || {}),
          closeMode: COUNT_RECONCILIATION_KIND,
          countedLines: lines.length,
          differenceLines: differences.length,
          adjustmentLines: 0,
          reconciliationState: state,
          reconciliationSubmittedAt: now,
          reconciliationSubmittedBy: userId,
          reconciliationDocumentId: null,
          reconciliationResolvedAt: differences.length ? null : now,
          reconciliationResolvedBy: differences.length ? null : userId
        }
      };

      await requestToPromise(documentStore.put(closed));
      await requestToPromise(
        queueStore.add(createSyncItem('document', closed.id, 'UPDATE', closed))
      );

      return {
        document: closed,
        differenceLines: differences.length,
        movements: []
      };
    }
  );
}

export async function listCountReconciliationCases({
  includeResolved = false
} = {}) {
  const [documents, lines] = await Promise.all([
    getAll(STORES.DOCUMENTS),
    getAll(STORES.DOCUMENT_LINES)
  ]);

  const linesByDocument = groupBy(lines, line => line.documentId);

  return documents
    .filter(document => document.type === DOCUMENT_TYPES.COUNT)
    .filter(document => document.status === DOCUMENT_STATUS.CLOSED)
    .filter(document =>
      document.metadata?.closeMode === COUNT_RECONCILIATION_KIND
    )
    .filter(document => {
      const state = document.metadata?.reconciliationState;
      return includeResolved
        ? [
            RECONCILIATION_STATE.PENDING,
            RECONCILIATION_STATE.REVIEWING,
            RECONCILIATION_STATE.RESOLVED,
            RECONCILIATION_STATE.NOT_REQUIRED
          ].includes(state)
        : [
            RECONCILIATION_STATE.PENDING,
            RECONCILIATION_STATE.REVIEWING
          ].includes(state);
    })
    .map(document => {
      const countLines = linesByDocument.get(document.id) || [];
      const differences = countLines.filter(line =>
        !almostEqual(Number(line.countedStock), Number(line.expectedStock))
      );

      return {
        document,
        lineCount: countLines.length,
        differenceCount: differences.length,
        shortageCount: differences
          .filter(line => Number(line.difference) < 0).length,
        surplusCount: differences
          .filter(line => Number(line.difference) > 0).length,
        absoluteDifference: round(
          differences.reduce(
            (sum, line) => sum + Math.abs(Number(line.difference || 0)),
            0
          )
        )
      };
    })
    .sort((a, b) =>
      String(b.document.closedAt || b.document.updatedAt || '')
        .localeCompare(String(a.document.closedAt || a.document.updatedAt || ''))
    );
}

/**
 * Crea un ADJUSTMENT separado para las decisiones de conciliación.
 * La creación del documento y sus líneas todavía NO cambia stock.
 */
export async function ensureCountReconciliationDraft(
  countDocumentId,
  { userId = null, roleCode = null } = {}
) {
  assertGod(roleCode);
  const countId = clean(countDocumentId);
  if (!countId) throw new Error('Conteo no identificado');
  const reconciliationId = reconciliationDocumentId(countId);

  return runTransaction(
    [STORES.DOCUMENTS, STORES.DOCUMENT_LINES, STORES.SYNC_QUEUE],
    'readwrite',
    async (documentStore, lineStore, queueStore) => {
      const count = await requestToPromise(documentStore.get(countId));
      assertReconcilableCount(count);

      const existing = await requestToPromise(
        documentStore.get(reconciliationId)
      );

      if (existing) {
        if (existing.status !== DOCUMENT_STATUS.DRAFT) {
          throw new Error('La conciliación de este conteo ya fue cerrada');
        }

        return {
          count,
          reconciliation: existing,
          lines: await requestToPromise(
            lineStore.index('documentId').getAll(existing.id)
          ),
          reused: true
        };
      }

      const countLines = await requestToPromise(
        lineStore.index('documentId').getAll(countId)
      );
      const differenceLines = countLines.filter(line =>
        !almostEqual(Number(line.countedStock), Number(line.expectedStock))
      );

      if (!differenceLines.length) {
        throw new Error('Este conteo no tiene diferencias para conciliar');
      }

      const now = new Date().toISOString();
      const reconciliation = {
        id: reconciliationId,
        type: DOCUMENT_TYPES.ADJUSTMENT,
        status: DOCUMENT_STATUS.DRAFT,
        ownerId: userId,
        locationId: count.locationId || null,
        destinationId: null,
        supplierId: null,
        reference: `Conciliación ${count.id}`,
        notes: '',
        metadata: {
          kind: COUNT_RECONCILIATION_KIND,
          sourceCountDocumentId: count.id,
          sourceCountClosedAt: count.closedAt || null,
          createdByRole: 'GOD'
        },
        version: initialEntityVersion(),
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        closedBy: null
      };

      await requestToPromise(documentStore.add(reconciliation));
      await requestToPromise(
        queueStore.add(
          createSyncItem(
            'document',
            reconciliation.id,
            'CREATE',
            reconciliation
          )
        )
      );

      const reconciliationLines = [];

      for (const source of differenceLines) {
        const expectedStock = finite(
          source.expectedStock,
          'Existencia esperada'
        );
        const countedStock = finite(
          source.countedStock,
          'Existencia contada'
        );

        const line = {
          id: reconciliationLineId(reconciliation.id, source.productId),
          documentId: reconciliation.id,
          productId: source.productId,
          productName: source.productName,
          documentType: DOCUMENT_TYPES.ADJUSTMENT,
          expectedStock,
          countedStock,
          difference: round(countedStock - expectedStock),
          reconciliationKind: COUNT_RECONCILIATION_KIND,
          sourceCountDocumentId: count.id,
          sourceCountLineId: source.id,
          sourceCountedAt: source.countedAt || null,
          decision: RECONCILIATION_DECISION.PENDING,
          decisionReason: null,
          decisionBy: null,
          decisionAt: null,
          decisionExpectedStock: null,
          decisionTargetStock: null,
          decisionDelta: null,
          movementId: null,
          recountAt: null,
          recountBy: null,
          version: initialEntityVersion(),
          createdAt: now,
          updatedAt: now
        };

        await requestToPromise(lineStore.add(line));
        await requestToPromise(
          queueStore.add(
            createSyncItem('documentLine', line.id, 'CREATE', line)
          )
        );
        reconciliationLines.push(line);
      }

      const updatedCount = {
        ...count,
        version: nextEntityVersion(count),
        updatedAt: now,
        metadata: {
          ...(count.metadata || {}),
          reconciliationState: RECONCILIATION_STATE.REVIEWING,
          reconciliationDocumentId: reconciliation.id,
          reconciliationStartedAt: now,
          reconciliationStartedBy: userId
        }
      };

      await requestToPromise(documentStore.put(updatedCount));
      await requestToPromise(
        queueStore.add(
          createSyncItem('document', updatedCount.id, 'UPDATE', updatedCount)
        )
      );

      return {
        count: updatedCount,
        reconciliation,
        lines: reconciliationLines,
        reused: false
      };
    }
  );
}

export async function getCountReconciliationDetails(countDocumentId) {
  const countId = clean(countDocumentId);
  if (!countId) throw new Error('Conteo no identificado');

  const count = await get(STORES.DOCUMENTS, countId);
  if (!count) throw new Error('Conteo no encontrado');

  const reconciliationId =
    count.metadata?.reconciliationDocumentId ||
    reconciliationDocumentId(countId);
  const reconciliation = await get(STORES.DOCUMENTS, reconciliationId);
  const lines = reconciliation
    ? await getAllByIndex(
        STORES.DOCUMENT_LINES,
        'documentId',
        reconciliation.id
      )
    : [];

  return {
    count,
    reconciliation,
    lines: lines.sort((a, b) =>
      String(a.productName || '')
        .localeCompare(String(b.productName || ''), 'es')
    ),
    summary: summarizeReconciliationLines(lines)
  };
}

/**
 * Recontar siempre toma el stock VIGÍA ACTUAL de la ubicación como referencia.
 */
export async function recountReconciliationLine(
  reconciliationId,
  productId,
  {
    countedStock,
    userId = null,
    roleCode = null,
    reason = null
  } = {}
) {
  assertGod(roleCode);
  const newCount = nonNegative(countedStock, 'Existencia recontada');

  return runTransaction(
    [
      STORES.DOCUMENTS,
      STORES.DOCUMENT_LINES,
      STORES.MOVEMENTS,
      STORES.SYNC_QUEUE
    ],
    'readwrite',
    async (documentStore, lineStore, movementStore, queueStore) => {
      const reconciliation = await requestToPromise(
        documentStore.get(reconciliationId)
      );
      assertGodReconciliationDraft(reconciliation);

      const id = reconciliationLineId(reconciliation.id, productId);
      const line = await requestToPromise(lineStore.get(id));
      if (!line) throw new Error('Diferencia no encontrada');
      assertLinePendingOrMatched(line);

      const movements = await requestToPromise(
        movementStore.index('productId').getAll(productId)
      );
      const currentStock = round(
        calculateStock(movements, productId, {
          locationId: reconciliation.locationId || null
        })
      );
      const difference = round(newCount - currentStock);
      const now = new Date().toISOString();
      const matched = almostEqual(difference, 0);

      const updated = {
        ...line,
        expectedStock: currentStock,
        countedStock: newCount,
        difference,
        decision: matched
          ? RECONCILIATION_DECISION.MATCHED
          : RECONCILIATION_DECISION.PENDING,
        decisionReason: clean(reason) || 'Reconteo físico',
        decisionBy: matched ? userId : null,
        decisionAt: matched ? now : null,
        decisionExpectedStock: matched ? currentStock : null,
        decisionTargetStock: matched ? currentStock : null,
        decisionDelta: matched ? 0 : null,
        recountAt: now,
        recountBy: userId,
        version: nextEntityVersion(line),
        updatedAt: now
      };

      await requestToPromise(lineStore.put(updated));
      await requestToPromise(
        queueStore.add(
          createSyncItem('documentLine', updated.id, 'UPDATE', updated)
        )
      );

      return updated;
    }
  );
}

export async function ignoreReconciliationLine(
  reconciliationId,
  productId,
  {
    userId = null,
    roleCode = null,
    reason = 'Diferencia revisada y no aplicada'
  } = {}
) {
  assertGod(roleCode);

  return updateReconciliationLine(
    reconciliationId,
    productId,
    async line => {
      if (line.decision === RECONCILIATION_DECISION.ADJUSTED) {
        throw new Error('La línea ya fue ajustada');
      }
      if (line.decision === RECONCILIATION_DECISION.IGNORED) {
        throw new Error('La línea ya fue ignorada');
      }
      if (line.decision === RECONCILIATION_DECISION.MATCHED) {
        throw new Error('La línea ya quedó cuadrada por reconteo');
      }

      const now = new Date().toISOString();
      return {
        ...line,
        decision: RECONCILIATION_DECISION.IGNORED,
        decisionReason:
          clean(reason) || 'Diferencia revisada y no aplicada',
        decisionBy: userId,
        decisionAt: now,
        decisionExpectedStock: line.expectedStock,
        decisionTargetStock: null,
        decisionDelta: 0,
        version: nextEntityVersion(line),
        updatedAt: now
      };
    }
  );
}

/**
 * Único punto V5-D que puede modificar stock.
 *
 * La diferencia de un conteo (físico - esperado) se mantiene válida si luego
 * ocurren movimientos operativos normales ENTRY/SUPPLY: ambos lados cambian
 * en la misma magnitud. En cambio, un ADJUSTMENT/REVERSAL posterior puede
 * haber corregido ya la discrepancia; en ese caso bloqueamos el ajuste y
 * exigimos RECONTAR. Esto evita aplicar dos veces una corrección sensible.
 */
export async function adjustReconciliationLine(
  reconciliationId,
  productId,
  {
    userId = null,
    roleCode = null,
    reason = 'Conciliación de conteo físico'
  } = {}
) {
  assertGod(roleCode);

  return runTransaction(
    [
      STORES.DOCUMENTS,
      STORES.DOCUMENT_LINES,
      STORES.MOVEMENTS,
      STORES.SYNC_QUEUE
    ],
    'readwrite',
    async (documentStore, lineStore, movementStore, queueStore) => {
      const reconciliation = await requestToPromise(
        documentStore.get(reconciliationId)
      );
      assertGodReconciliationDraft(reconciliation);

      const lineId = reconciliationLineId(reconciliation.id, productId);
      const line = await requestToPromise(lineStore.get(lineId));
      if (!line) throw new Error('Diferencia no encontrada');

      if (line.decision === RECONCILIATION_DECISION.ADJUSTED) {
        throw new Error('Esta diferencia ya fue ajustada');
      }
      if (line.decision === RECONCILIATION_DECISION.IGNORED) {
        throw new Error('Esta diferencia fue marcada como ignorada');
      }
      if (line.decision === RECONCILIATION_DECISION.MATCHED) {
        throw new Error('La diferencia ya quedó cuadrada');
      }

      const referenceAt = normalizeDate(
        line.recountAt || line.sourceCountedAt
      );
      if (!referenceAt) {
        throw new Error(
          'No existe hora confiable del conteo. Recuenta el producto antes de ajustar.'
        );
      }

      const movements = await requestToPromise(
        movementStore.index('productId').getAll(productId)
      );
      const locationId = reconciliation.locationId || null;
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
          `Hay ${sensitiveLater.length} ajuste(s)/reverso(s) posterior(es) a este conteo. Recuenta el producto antes de ajustar.`
        );
      }

      const currentStock = round(
        calculateStock(movements, productId, { locationId })
      );
      const delta = round(
        finite(line.countedStock, 'Existencia contada') -
        finite(line.expectedStock, 'Existencia esperada')
      );

      if (almostEqual(delta, 0)) {
        throw new Error('No existe diferencia que ajustar');
      }

      const targetStock = round(currentStock + delta);
      if (targetStock < -0.000001) {
        throw new Error(
          'Este ajuste dejaría stock negativo con la existencia actual. Recuenta el producto antes de ajustar.'
        );
      }

      const now = new Date().toISOString();
      const decisionReason =
        clean(reason) || 'Conciliación de conteo físico';
      const laterOperationalDelta = round(
        later.reduce(
          (sum, movement) => sum + stockDeltaForMovement(movement),
          0
        )
      );

      const movement = buildMovement({
        productId,
        type: MOVEMENT_TYPES.ADJUSTMENT,
        quantity: 0,
        delta,
        documentId: reconciliation.id,
        locationId,
        userId,
        effectiveAt: now,
        metadata: {
          reconciliationKind: COUNT_RECONCILIATION_KIND,
          sourceCountDocumentId:
            reconciliation.metadata?.sourceCountDocumentId || null,
          reconciliationDocumentId: reconciliation.id,
          reconciliationLineId: line.id,
          sourceCountLineId: line.sourceCountLineId || null,
          referenceAt,
          laterOperationalMovementCount: later.length,
          laterOperationalDelta,
          stockBeforeDecision: currentStock,
          targetStock,
          expectedStockAtCount: line.expectedStock,
          countedStockAtCount: line.countedStock,
          reason: decisionReason,
          authorizedRole: 'GOD'
        }
      });

      await requestToPromise(movementStore.add(movement));
      await requestToPromise(
        queueStore.add(buildMovementSyncItem(movement))
      );

      const updatedLine = {
        ...line,
        decision: RECONCILIATION_DECISION.ADJUSTED,
        decisionReason,
        decisionBy: userId,
        decisionAt: now,
        decisionExpectedStock: currentStock,
        decisionTargetStock: targetStock,
        decisionDelta: delta,
        movementId: movement.id,
        version: nextEntityVersion(line),
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

      return {
        line: updatedLine,
        movement,
        matched: false
      };
    }
  );
}

export async function finalizeCountReconciliation(
  reconciliationId,
  { userId = null, roleCode = null } = {}
) {
  assertGod(roleCode);

  return runTransaction(
    [STORES.DOCUMENTS, STORES.DOCUMENT_LINES, STORES.SYNC_QUEUE],
    'readwrite',
    async (documentStore, lineStore, queueStore) => {
      const reconciliation = await requestToPromise(
        documentStore.get(reconciliationId)
      );
      assertGodReconciliationDraft(reconciliation);

      const lines = await requestToPromise(
        lineStore.index('documentId').getAll(reconciliation.id)
      );
      if (!lines.length) {
        throw new Error('La conciliación no tiene diferencias');
      }

      const unresolved = lines.filter(line =>
        !line.decision ||
        line.decision === RECONCILIATION_DECISION.PENDING
      );
      if (unresolved.length) {
        throw new Error(
          `Quedan ${unresolved.length} diferencia(s) sin resolver`
        );
      }

      const sourceCountId =
        reconciliation.metadata?.sourceCountDocumentId;
      const sourceCount = await requestToPromise(
        documentStore.get(sourceCountId)
      );
      if (!sourceCount) throw new Error('Conteo origen no encontrado');

      const now = new Date().toISOString();
      const summary = summarizeReconciliationLines(lines);
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
        ...sourceCount,
        version: nextEntityVersion(sourceCount),
        updatedAt: now,
        metadata: {
          ...(sourceCount.metadata || {}),
          reconciliationState: RECONCILIATION_STATE.RESOLVED,
          reconciliationDocumentId: reconciliation.id,
          reconciliationResolvedAt: now,
          reconciliationResolvedBy: userId,
          reconciliationSummary: summary,
          adjustmentLines: summary.adjusted
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

export function summarizeReconciliationLines(lines = []) {
  const summary = {
    total: lines.length,
    pending: 0,
    adjusted: 0,
    ignored: 0,
    matched: 0,
    shortages: 0,
    surpluses: 0,
    netDifference: 0,
    absoluteDifference: 0
  };

  for (const line of lines) {
    const difference = Number(line.difference || 0);
    const decision =
      line.decision || RECONCILIATION_DECISION.PENDING;

    if (decision === RECONCILIATION_DECISION.ADJUSTED) {
      summary.adjusted++;
    } else if (decision === RECONCILIATION_DECISION.IGNORED) {
      summary.ignored++;
    } else if (decision === RECONCILIATION_DECISION.MATCHED) {
      summary.matched++;
    } else {
      summary.pending++;
    }

    if (difference < 0) summary.shortages++;
    if (difference > 0) summary.surpluses++;
    summary.netDifference += difference;
    summary.absoluteDifference += Math.abs(difference);
  }

  summary.netDifference = round(summary.netDifference);
  summary.absoluteDifference = round(summary.absoluteDifference);
  return summary;
}

async function updateReconciliationLine(
  reconciliationId,
  productId,
  updater
) {
  return runTransaction(
    [STORES.DOCUMENTS, STORES.DOCUMENT_LINES, STORES.SYNC_QUEUE],
    'readwrite',
    async (documentStore, lineStore, queueStore) => {
      const reconciliation = await requestToPromise(
        documentStore.get(reconciliationId)
      );
      assertGodReconciliationDraft(reconciliation);

      const id = reconciliationLineId(reconciliation.id, productId);
      const line = await requestToPromise(lineStore.get(id));
      if (!line) throw new Error('Diferencia no encontrada');

      const updated = await updater(line);
      await requestToPromise(lineStore.put(updated));
      await requestToPromise(
        queueStore.add(
          createSyncItem('documentLine', updated.id, 'UPDATE', updated)
        )
      );
      return updated;
    }
  );
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

function reconciliationDocumentId(countDocumentId) {
  return `adj_recon_${countDocumentId}`;
}

function reconciliationLineId(reconciliationId, productId) {
  return `line_${reconciliationId}_${productId}`;
}

function assertDraftCount(document) {
  if (!document) throw new Error('Conteo no encontrado');
  if (document.type !== DOCUMENT_TYPES.COUNT) {
    throw new Error('El documento no es un conteo');
  }
  if (document.status !== DOCUMENT_STATUS.DRAFT) {
    throw new Error('El conteo ya no está en borrador');
  }
}

function assertReconcilableCount(document) {
  if (!document) throw new Error('Conteo no encontrado');
  if (
    document.type !== DOCUMENT_TYPES.COUNT ||
    document.status !== DOCUMENT_STATUS.CLOSED
  ) {
    throw new Error('El conteo todavía no está listo para conciliación');
  }
  if (document.metadata?.closeMode !== COUNT_RECONCILIATION_KIND) {
    throw new Error('Este conteo no pertenece al flujo V5-D');
  }
  if (
    ![
      RECONCILIATION_STATE.PENDING,
      RECONCILIATION_STATE.REVIEWING
    ].includes(document.metadata?.reconciliationState)
  ) {
    throw new Error('Este conteo no tiene una conciliación pendiente');
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

function assertLinePendingOrMatched(line) {
  if (line.decision === RECONCILIATION_DECISION.ADJUSTED) {
    throw new Error('La línea ya fue ajustada');
  }
  if (line.decision === RECONCILIATION_DECISION.IGNORED) {
    throw new Error(
      'La línea fue ignorada; no puede recontarse después de resolverla'
    );
  }
}

function assertGod(roleCode) {
  if (String(roleCode || '').trim().toUpperCase() !== 'GOD') {
    throw new Error('Solo el rol DIOS puede conciliar existencias');
  }
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

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} inválida`);
  }
  return number;
}

function nonNegative(value, label) {
  const number = finite(value, label);
  if (number < 0) throw new Error(`${label} no puede ser negativa`);
  return round(number);
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
