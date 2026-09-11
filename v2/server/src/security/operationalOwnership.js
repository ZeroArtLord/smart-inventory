const TEAM_OPERATIONAL_TYPES = new Set(['ENTRY', 'SUPPLY']);
const OWNERSHIP_GUARDED_ENTITIES = new Set([
  'document',
  'documentLine',
  'movement'
]);

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

    const requestedOwnerId = String(event.payload?.ownerId || '').trim();
    if (!requestedOwnerId || requestedOwnerId !== actorOwnerId) {
      throw forbidden('No puedes crear Entradas o Surtidos a nombre de otro usuario.');
    }
    return;
  }

  const documentId = resolveDocumentId(event);
  if (!documentId) return;

  const result = await client.query(
    `SELECT type, owner_id
     FROM documents
     WHERE workspace_id = $1
       AND id = $2
     LIMIT 1`,
    [auth.workspaceId, documentId]
  );

  // Si aún no existe un documento canónico, el flujo normal de validación
  // decidirá si el evento es válido. No inventamos propiedad desde el payload.
  if (result.rowCount !== 1) return;

  const document = result.rows[0];
  const type = normalizeType(document.type);
  if (!TEAM_OPERATIONAL_TYPES.has(type)) return;

  const ownerId = String(document.owner_id || '').trim();
  if (!ownerId || ownerId !== actorOwnerId) {
    throw forbidden('Este documento operativo pertenece a otro usuario.');
  }
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
    `SELECT type, owner_id
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

  if (TEAM_OPERATIONAL_TYPES.has(type)) {
    const ownerId = String(document.owner_id || '').trim();
    if (!ownerId || ownerId !== actorOwnerId) {
      throw forbidden('Este documento operativo pertenece a otro usuario.');
    }
  }

  return document;
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