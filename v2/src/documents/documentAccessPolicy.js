import { DOCUMENT_TYPES } from './documentTypes.js';

const TEAM_OPERATIONAL_TYPES = new Set([
  DOCUMENT_TYPES.ENTRY,
  DOCUMENT_TYPES.SUPPLY
]);
const LIVE_SUPPLY_CART_KIND = 'LIVE_SUPPLY_CART';
const LIVE_SUPPLY_DELIVERY_KIND = 'LIVE_SUPPLY_DELIVERY';

export function isTeamOperationalDocument(document) {
  return TEAM_OPERATIONAL_TYPES.has(normalizeType(document?.type));
}

export function canActorAccessOperationalDocument(
  document,
  { ownerId = null, roleCode = null } = {},
  { parentDocument = null } = {}
) {
  if (!document) return false;

  const type = normalizeType(document.type);
  const role = String(roleCode || '').trim().toUpperCase();

  // El bypass de supervisión pertenece exclusivamente a la cuenta DIOS.
  // ADMIN puede tener muchos permisos, pero no hereda esta visibilidad por
  // accidente solo por tener wildcard.
  if (TEAM_OPERATIONAL_TYPES.has(type) && role === 'GOD') {
    return true;
  }

  const actorOwnerId = String(ownerId || '').trim();
  const documentOwnerId = effectiveOperationalOwnerId(document, parentDocument);

  // Fail closed: un documento operativo sin dueño no se filtra hacia otro
  // almacenista. Las entregas V5-E no confían en su ownerId técnico; solo
  // heredan el dueño cuando el carrito padre válido está disponible.
  return Boolean(
    actorOwnerId &&
    documentOwnerId &&
    actorOwnerId === documentOwnerId
  );
}

export function filterOperationalDocumentsForActor(documents = [], actor = {}) {
  const rows = Array.isArray(documents) ? documents : [];
  const documentById = new Map(
    rows
      .filter(document => document?.id)
      .map(document => [String(document.id), document])
  );

  return rows.filter(document => {
    const parentDocument = isLiveSupplyDelivery(document)
      ? documentById.get(String(document?.metadata?.parentCartId || '').trim()) || null
      : null;

    return canActorAccessOperationalDocument(document, actor, {
      parentDocument
    });
  });
}

function effectiveOperationalOwnerId(document, parentDocument) {
  if (isLiveSupplyDelivery(document)) {
    if (!isValidLiveSupplyParent(document, parentDocument)) {
      return '';
    }
    return String(parentDocument.ownerId || '').trim();
  }

  return String(document?.ownerId || '').trim();
}

function isValidLiveSupplyParent(delivery, parentDocument) {
  if (!parentDocument) return false;
  if (normalizeType(delivery?.type) !== DOCUMENT_TYPES.SUPPLY) return false;
  if (normalizeType(parentDocument?.type) !== DOCUMENT_TYPES.SUPPLY) return false;
  if (parentDocument?.metadata?.kind !== LIVE_SUPPLY_CART_KIND) return false;

  const parentCartId = String(delivery?.metadata?.parentCartId || '').trim();
  const parentId = String(parentDocument?.id || '').trim();
  return Boolean(parentCartId && parentId && parentCartId === parentId);
}

function isLiveSupplyDelivery(document) {
  return normalizeType(document?.type) === DOCUMENT_TYPES.SUPPLY &&
    document?.metadata?.kind === LIVE_SUPPLY_DELIVERY_KIND;
}

function normalizeType(value) {
  return String(value || '').trim().toUpperCase();
}
