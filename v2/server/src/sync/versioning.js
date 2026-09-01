const ENTITY_TABLES = Object.freeze({
  product: 'products',
  category: 'categories',
  supplier: 'suppliers',
  location: 'locations',
  document: 'documents',
  documentLine: 'document_lines',
  lot: 'lots',
  replenishment: 'replenishments'
});

export async function assertMutableEntityVersion(
  client,
  event,
  { allowLegacy = false } = {}
) {
  const table = ENTITY_TABLES[event?.entityType];
  if (!table) return null;

  const { operation, entityId, payload } = event;
  const result = await client.query(
    `SELECT version
     FROM ${table}
     WHERE workspace_id = $1
       AND id = $2
     FOR UPDATE`,
    [event.workspaceId, entityId]
  );

  const exists = result.rowCount > 0;
  const serverVersion = exists
    ? Number(result.rows[0].version || 1)
    : 0;

  let clientVersion = Number(payload.version);
  if (!Number.isInteger(clientVersion) || clientVersion < 1) {
    if (!allowLegacy) {
      throw conflictError(event, {
        serverVersion,
        clientVersion: null,
        reason: 'VERSION_REQUIRED'
      });
    }

    clientVersion = operation === 'CREATE'
      ? 1
      : serverVersion + 1;

    payload.version = clientVersion;
  }

  if (operation === 'CREATE') {
    if (exists || clientVersion !== 1) {
      throw conflictError(event, {
        serverVersion,
        clientVersion,
        reason: exists ? 'ENTITY_ALREADY_EXISTS' : 'INVALID_CREATE_VERSION'
      });
    }

    return {
      serverVersion,
      clientVersion
    };
  }

  if (operation === 'UPDATE') {
    if (!exists) {
      throw conflictError(event, {
        serverVersion: 0,
        clientVersion,
        reason: 'ENTITY_NOT_FOUND'
      });
    }

    const expectedVersion = serverVersion + 1;
    if (clientVersion !== expectedVersion) {
      throw conflictError(event, {
        serverVersion,
        clientVersion,
        reason: 'STALE_WRITE'
      });
    }

    return {
      serverVersion,
      clientVersion
    };
  }

  return null;
}

function conflictError(event, {
  serverVersion,
  clientVersion,
  reason
}) {
  const error = new Error(
    `Conflicto de versión en ${event.entityType} ${event.entityId}`
  );

  error.code = 'SYNC_CONFLICT';
  error.statusCode = 409;
  error.details = {
    eventId: event.id || null,
    entityType: event.entityType,
    entityId: event.entityId,
    operation: event.operation,
    serverVersion,
    clientVersion,
    reason
  };

  return error;
}
