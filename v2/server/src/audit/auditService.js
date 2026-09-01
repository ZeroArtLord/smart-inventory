export async function writeAuditEvent(
  client,
  auth,
  {
    action,
    entityType = null,
    entityId = null,
    metadata = {}
  } = {}
) {
  if (!action) throw new Error('Acción de auditoría requerida');

  await client.query(
    `INSERT INTO audit_events (
      workspace_id,user_id,action,entity_type,entity_id,metadata
    ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      auth.workspaceId,
      auth.userId || null,
      action,
      entityType,
      entityId,
      JSON.stringify(sanitizeAuditMetadata(metadata))
    ]
  );
}

export function buildSyncAuditMetadata(event) {
  const payload = event?.payload || {};

  return sanitizeAuditMetadata({
    eventId: event?.id || null,
    operation: event?.operation || null,
    version: payload.version ?? null,
    documentType: payload.type && event?.entityType === 'document'
      ? payload.type
      : null,
    documentStatus: payload.status && event?.entityType === 'document'
      ? payload.status
      : null,
    movementType: event?.entityType === 'movement'
      ? payload.type || null
      : null,
    quantity: event?.entityType === 'movement'
      ? payload.quantity ?? null
      : null,
    delta: event?.entityType === 'movement'
      ? payload.delta ?? null
      : null,
    replenishmentStatus: event?.entityType === 'replenishment'
      ? payload.status || null
      : null
  });
}

export function sanitizeAuditMetadata(metadata = {}) {
  const blocked = new Set([
    'unitCost',
    'password',
    'token',
    'authorization',
    'secret',
    'credential',
    'credentials'
  ]);

  const cleaned = {};

  for (const [key, value] of Object.entries(metadata || {})) {
    if (blocked.has(key)) continue;
    if (value === undefined) continue;
    cleaned[key] = value;
  }

  return cleaned;
}
