const TEAM_OPERATIONAL_TYPES = new Set(['ENTRY', 'SUPPLY']);
const OWNERSHIP_GUARDED_ENTITIES = new Set([
  'document',
  'documentLine',
  'movement'
]);
const LIVE_SUPPLY_CART_KIND = 'LIVE_SUPPLY_CART';
const LIVE_SUPPLY_DELIVERY_KIND = 'LIVE_SUPPLY_DELIVERY';
const LIVE_DELIVERY_OWNER_PREFIX = 'live-delivery:';

export function operationalActorOwnerId(auth = {}) {
  if (String(auth.authMode || '').toLowerCase() === 'firebase') {
    return String(auth.externalAuthId || '').trim();
  }

  return String(auth.userId || '').trim();
}

export async function assertOperationalEventOwnership(client, auth, event) {
  if (!OWNERSHIP_GUARDED_ENTITIES.has(event?.entityType)) return;

  const roleCode = String(auth?.roleCode || '').toUpperCase();
  const authMode = String(auth?.authMode || '').toLowerCase();

  // DIOS puede supervisar cualquier ENTRY/SUPPLY del workspace. Este bypass
  // es deliberadamente por rol, no por wildcard de permisos.
  if (roleCode === 'GOD') return;

  // El bootstrap DEV crea un DEV_ADMIN para los smoke tests históricos. Su
  // bypass existe únicamente en authMode=dev; jamás se extiende a Firebase
  // ni convierte ADMIN/wildcard en GOD dentro de producción.
  if (roleCode === 'DEV_ADMIN' && authMode === 'dev') return;

  const actorOwnerId = operationalActorOwnerId(auth);
  if (!actorOwnerId) {
    throw forbidden('No se pudo resolver el propietario operativo del usuario.');
  }

  if (event.entityType === 'document' && event.operation === 'CREATE') {
    const type = normalizeType(event.payload?.type);
    if (!TEAM_OPERATIONAL_TYPES.has(type)) return;

    if (isLiveSupplyDelivery(event.payload)) {
      const parentCartId = liveSupplyDeliveryParentId(event.payload);
      if (!parentCartId) {
        throw forbidden('La entrega física de Surtido Vivo no tiene una identidad válida.');
      }

      await assertLiveSupplyParentOwnership(
        client,
        auth.workspaceId,
        actorOwnerId,
        parentCartId
      );
      return;
    }

    const requestedOwnerId = String(event.payload?.ownerId || '').trim();
    if (!requestedOwnerId || requestedOwnerId !== actorOwnerId) {
      throw forbidden('No puedes crear Entradas o Surtidos a nombre de otro usuario.');
    }
    return;
  }

  const documentId = resolveDocumentId(event);
  if (!documentId) return;

  const result = await client.query(
    `SELECT type, owner_id, metadata
     FROM documents
     WHERE workspace_id = $1
       AND id = $2
     LIMIT 1`,
    [auth.workspaceId, documentId]
  );

  // Si aún no existe un documento canónico, el flujo normal de validación
  // decidirá si el evento es válido. No inventamos propiedad desde el payload.
  if (result.rowCount !== 1) return;

  await assertCanonicalOperationalDocumentOwner(
    client,
    auth.workspaceId,
    actorOwnerId,
    result.rows[0]
  );
}

export async function assertOperationalDocumentOwnership(
  client,
  auth,
  documentId,
  { expectedType = null } = {}
) {
  const id = String(documentId || '').trim();
  if (!id) {
    throw notFound('No se encontró el documento operativo.');
  }

  const result = await client.query(
    `SELECT type, owner_id, metadata
     FROM documents
     WHERE workspace_id = $1
       AND id = $2
     LIMIT 1`,
    [auth.workspaceId, id]
  );

  if (result.rowCount !== 1) {
    throw notFound('No se encontró el documento operativo.');
  }

  const document = result.rows[0];
  const type = normalizeType(document.type);
  const requiredType = expectedType ? normalizeType(expectedType) : null;

  if (requiredType && type !== requiredType) {
    throw invalidType(`El documento debe ser de tipo ${requiredType}.`);
  }

  const roleCode = String(auth?.roleCode || '').toUpperCase();
  const authMode = String(auth?.authMode || '').toLowerCase();

  if (roleCode === 'GOD') return document;
  if (roleCode === 'DEV_ADMIN' && authMode === 'dev') return document;

  const actorOwnerId = operationalActorOwnerId(auth);
  if (!actorOwnerId) {
    throw forbidden('No se pudo resolver el propietario operativo del usuario.');
  }

  await assertCanonicalOperationalDocumentOwner(
    client,
    auth.workspaceId,
    actorOwnerId,
    document
  );

  return document;
}

async function assertCanonicalOperationalDocumentOwner(
  client,
  workspaceId,
  actorOwnerId,
  document
) {
  const type = normalizeType(document?.type);
  if (!TEAM_OPERATIONAL_TYPES.has(type)) return;

  if (isLiveSupplyDelivery(document)) {
    const parentCartId = liveSupplyDeliveryParentId(document);
    if (!parentCartId) {
      throw forbidden('La entrega física de Surtido Vivo no tiene una identidad válida.');
    }

    await assertLiveSupplyParentOwnership(
      client,
      workspaceId,
      actorOwnerId,
      parentCartId
    );
    return;
  }

  const ownerId = String(document?.owner_id ?? document?.ownerId ?? '').trim();
  if (!ownerId || ownerId !== actorOwnerId) {
    throw forbidden('Este documento operativo pertenece a otro usuario.');
  }
}

async function assertLiveSupplyParentOwnership(
  client,
  workspaceId,
  actorOwnerId,
  parentCartId
) {
  const result = await client.query(
    `SELECT type, owner_id, metadata
     FROM documents
     WHERE workspace_id = $1
       AND id = $2
     LIMIT 1`,
    [workspaceId, parentCartId]
  );

  if (result.rowCount !== 1) {
    throw forbidden('No se encontró el Surtido Vivo padre de esta entrega.');
  }

  const parent = result.rows[0];
  const parentType = normalizeType(parent.type);
  const parentKind = normalizeType(parent.metadata?.kind);
  const parentOwnerId = String(parent.owner_id ?? parent.ownerId ?? '').trim();

  if (
    parentType !== 'SUPPLY' ||
    parentKind !== LIVE_SUPPLY_CART_KIND ||
    !parentOwnerId ||
    parentOwnerId !== actorOwnerId
  ) {
    throw forbidden('La entrega física pertenece a un Surtido Vivo de otro usuario.');
  }
}

function isLiveSupplyDelivery(document) {
  return (
    normalizeType(document?.type) === 'SUPPLY' &&
    normalizeType(document?.metadata?.kind) === LIVE_SUPPLY_DELIVERY_KIND
  );
}

function liveSupplyDeliveryParentId(document) {
  if (!isLiveSupplyDelivery(document)) return '';

  const parentCartId = String(document?.metadata?.parentCartId || '').trim();
  if (!parentCartId) return '';

  const ownerId = String(document?.ownerId ?? document?.owner_id ?? '').trim();
  const expectedOwnerId = `${LIVE_DELIVERY_OWNER_PREFIX}${parentCartId}`;
  if (ownerId !== expectedOwnerId) return '';

  return parentCartId;
}

function resolveDocumentId(event) {
  if (event.entityType === 'document') {
    return String(event.entityId || event.payload?.id || '').trim();
  }

  return String(event.payload?.documentId || '').trim();
}

function normalizeType(value) {
  return String(value || '').trim().toUpperCase();
}

function forbidden(message) {
  const error = new Error(message);
  error.code = 'OPERATIONAL_DOCUMENT_FORBIDDEN';
  error.statusCode = 403;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.code = 'OPERATIONAL_DOCUMENT_NOT_FOUND';
  error.statusCode = 404;
  return error;
}

function invalidType(message) {
  const error = new Error(message);
  error.code = 'OPERATIONAL_DOCUMENT_TYPE_INVALID';
  error.statusCode = 400;
  return error;
}
