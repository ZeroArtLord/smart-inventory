import { stockDeltaForMovement } from '../core/movementTypes.js';
import { resolveDocumentOperationalDate } from './operationalDate.js';

const SUPPLY = 'SUPPLY';
const CLOSED = 'CLOSED';
const LIVE_CART = 'LIVE_SUPPLY_CART';
const LIVE_DELIVERY = 'LIVE_SUPPLY_DELIVERY';
const EPSILON = 0.000001;

/**
 * Construye un historial de Surtidos sin ocultar documentos físicos.
 *
 * - Un carrito V5-E aparece una sola vez y contiene sus hijos.
 * - Un hijo sin padre visible se conserva como fallback técnico.
 * - Un SUPPLY legacy sigue siendo una fila independiente.
 * - Los totales entregados se derivan de movimientos, no de metadata mutable.
 *
 * La función es deliberadamente pura: no accede a DOM, IndexedDB ni red.
 */
export function buildSupplyHistoryGroups({
  documents = [],
  movements = []
} = {}) {
  const visibleDocuments = dedupeDocuments(documents)
    .filter(document => document?.type === SUPPLY);
  const documentById = new Map(
    visibleDocuments.map(document => [document.id, document])
  );
  const childIdsByParent = new Map();

  for (const document of visibleDocuments) {
    if (!isLiveDelivery(document)) continue;
    const parentCartId = clean(document.metadata?.parentCartId);
    const parent = documentById.get(parentCartId);
    if (!parent || !isLiveCart(parent)) continue;

    if (!childIdsByParent.has(parentCartId)) {
      childIdsByParent.set(parentCartId, []);
    }
    childIdsByParent.get(parentCartId).push(document.id);
  }

  const movementsByDocument = indexMovements(movements);
  const groupedChildIds = new Set(
    [...childIdsByParent.values()].flat()
  );
  const groups = [];

  for (const document of visibleDocuments) {
    if (isLiveCart(document)) {
      const childIds = childIdsByParent.get(document.id) || [];
      const deliveries = childIds
        .map(id => documentById.get(id))
        .filter(Boolean)
        .map(child => buildDeliveryItem(
          child,
          movementsByDocument.get(child.id) || []
        ))
        .sort(compareDeliveriesByTechnicalTime);

      groups.push(buildGroup({
        document,
        kind: 'LIVE_CART',
        deliveries,
        movements: []
      }));
      continue;
    }

    if (isLiveDelivery(document)) {
      if (groupedChildIds.has(document.id)) continue;
      groups.push(buildGroup({
        document,
        kind: 'ORPHAN_DELIVERY',
        deliveries: [],
        movements: movementsByDocument.get(document.id) || []
      }));
      continue;
    }

    groups.push(buildGroup({
      document,
      kind: 'LEGACY_SUPPLY',
      deliveries: [],
      movements: movementsByDocument.get(document.id) || []
    }));
  }

  return groups.sort(compareGroups);
}

function buildGroup({ document, kind, deliveries, movements }) {
  const operationalDate = resolveDocumentOperationalDate(document);
  const technicalAt = technicalTimestamp(document);
  const closedDeliveries = deliveries.filter(
    delivery => delivery.document?.status === CLOSED
  );
  const deliveredTotal = kind === 'LIVE_CART'
    ? round(closedDeliveries.reduce(
        (sum, delivery) => sum + delivery.deliveredTotal,
        0
      ))
    : netDeliveredFromMovements(movements);
  const plannedTotal = nonNegativeMetadataNumber(
    document.metadata?.liveSupplyPlannedTotal
  );
  const cancelledTotal = nonNegativeMetadataNumber(
    document.metadata?.liveSupplyCancelledRemainingTotal
  );
  const pendingTotal = plannedTotal === null
    ? null
    : Math.max(0, round(plannedTotal - deliveredTotal - (cancelledTotal || 0)));

  return {
    id: document.id,
    kind,
    document,
    operationalDate,
    technicalAt,
    deliveries,
    summary: {
      deliveryCount: kind === 'LIVE_CART'
        ? closedDeliveries.length
        : document.status === CLOSED ? 1 : 0,
      deliveredTotal,
      plannedTotal,
      pendingTotal,
      cancelledTotal,
      status: document.status || null
    }
  };
}

function buildDeliveryItem(document, movements) {
  return {
    id: document.id,
    document,
    operationalDate: resolveDocumentOperationalDate(document),
    technicalAt: technicalTimestamp(document),
    deliveredTotal: document.status === CLOSED
      ? netDeliveredFromMovements(movements)
      : 0
  };
}

function indexMovements(movements) {
  const byDocument = new Map();

  for (const movement of Array.isArray(movements) ? movements : []) {
    const documentId = clean(movement?.documentId);
    if (!documentId || movement?.voided === true) continue;
    const current = byDocument.get(documentId) || [];
    current.push(movement);
    byDocument.set(documentId, current);
  }

  return byDocument;
}

function netDeliveredFromMovements(movements) {
  let total = 0;

  for (const movement of movements) {
    try {
      total -= stockDeltaForMovement(movement);
    } catch {
      // Un movimiento ajeno o incompleto no debe hacer desaparecer historial.
    }
  }

  return Math.max(0, round(total));
}

function dedupeDocuments(documents) {
  const byId = new Map();

  for (const document of Array.isArray(documents) ? documents : []) {
    const id = clean(document?.id);
    if (!id) continue;
    const current = byId.get(id);
    if (!current || isNewerDocument(document, current)) {
      byId.set(id, document);
    }
  }

  return [...byId.values()];
}

function isNewerDocument(candidate, current) {
  const candidateVersion = Number(candidate?.version);
  const currentVersion = Number(current?.version);
  if (Number.isFinite(candidateVersion) && Number.isFinite(currentVersion)) {
    if (candidateVersion !== currentVersion) {
      return candidateVersion > currentVersion;
    }
  }

  return technicalTime(candidate) >= technicalTime(current);
}

function isLiveCart(document) {
  return document?.metadata?.kind === LIVE_CART;
}

function isLiveDelivery(document) {
  return document?.metadata?.kind === LIVE_DELIVERY;
}

function compareDeliveriesByTechnicalTime(a, b) {
  const time = technicalTime(a.document) - technicalTime(b.document);
  if (time !== 0) return time;
  return String(a.document?.id || '').localeCompare(String(b.document?.id || ''));
}

function compareGroups(a, b) {
  const dateA = a.operationalDate || '';
  const dateB = b.operationalDate || '';
  if (dateA !== dateB) return dateB.localeCompare(dateA);

  const time = technicalTime(b.document) - technicalTime(a.document);
  if (time !== 0) return time;
  return String(b.document?.id || '').localeCompare(String(a.document?.id || ''));
}

function technicalTimestamp(document) {
  for (const value of [
    document?.closedAt,
    document?.updatedAt,
    document?.createdAt
  ]) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return null;
}

function technicalTime(document) {
  const value = technicalTimestamp(document);
  return value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY;
}

function nonNegativeMetadataNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function round(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || Math.abs(number) <= EPSILON) return 0;
  return Math.round((number + Number.EPSILON) * 1000000) / 1000000;
}

function clean(value) {
  return String(value ?? '').trim();
}
