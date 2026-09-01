export const PERMISSIONS = Object.freeze({
  CATALOG_VIEW: 'catalog.view',
  CATALOG_WRITE: 'catalog.write',
  INVENTORY_WRITE: 'inventory.write',
  COUNT_WRITE: 'count.write',
  ENTRY_WRITE: 'entry.write',
  SUPPLY_WRITE: 'supply.write',
  ADJUSTMENT_WRITE: 'adjustment.write',
  PURCHASE_WRITE: 'purchases.write',
  COST_VIEW: 'costs.view',
  REPORT_VIEW: 'reports.view',
  REPORT_EXPORT: 'reports.export',
  USERS_MANAGE: 'users.manage',
  AUDIT_VIEW: 'audit.view',
  SAINT_SEND: 'saint.send'
});

export function hasPermission(auth, permission) {
  const permissions = Array.isArray(auth?.permissions)
    ? auth.permissions
    : [];

  return permissions.includes('*') ||
    permissions.includes(permission) ||
    (
      permission !== PERMISSIONS.CATALOG_WRITE &&
      permissions.includes(PERMISSIONS.INVENTORY_WRITE)
    );
}

export function assertEventPermission(auth, event) {
  const required = permissionForEvent(event);

  if (!hasPermission(auth, required)) {
    const error = new Error(
      `Permiso requerido: ${required}`
    );
    error.code = 'PERMISSION_DENIED';
    throw error;
  }

  return required;
}

export function permissionForEvent(event) {
  const entityType = event?.entityType;
  const operation = event?.operation;
  const payload = event?.payload || {};

  if (
    entityType === 'product' ||
    entityType === 'category' ||
    entityType === 'supplier' ||
    entityType === 'location'
  ) {
    return PERMISSIONS.CATALOG_WRITE;
  }

  if (entityType === 'document') {
    return permissionForDocumentType(payload.type);
  }

  if (entityType === 'documentLine') {
    return payload.documentType
      ? permissionForDocumentType(payload.documentType)
      : PERMISSIONS.INVENTORY_WRITE;
  }

  if (entityType === 'lot') {
    return operation === 'CREATE'
      ? PERMISSIONS.ENTRY_WRITE
      : PERMISSIONS.SUPPLY_WRITE;
  }

  if (entityType === 'replenishment') {
    return PERMISSIONS.PURCHASE_WRITE;
  }

  if (entityType === 'movement') {
    return permissionForMovementType(payload.type);
  }

  return PERMISSIONS.INVENTORY_WRITE;
}

function permissionForDocumentType(type) {
  switch (type) {
    case 'COUNT':
      return PERMISSIONS.COUNT_WRITE;
    case 'ENTRY':
      return PERMISSIONS.ENTRY_WRITE;
    case 'SUPPLY':
      return PERMISSIONS.SUPPLY_WRITE;
    case 'ADJUSTMENT':
      return PERMISSIONS.ADJUSTMENT_WRITE;
    default:
      return PERMISSIONS.INVENTORY_WRITE;
  }
}

function permissionForMovementType(type) {
  switch (type) {
    case 'ENTRY':
      return PERMISSIONS.ENTRY_WRITE;
    case 'SUPPLY':
      return PERMISSIONS.SUPPLY_WRITE;
    case 'ADJUSTMENT':
    case 'REVERSAL':
      return PERMISSIONS.ADJUSTMENT_WRITE;
    case 'TRANSFER':
      return PERMISSIONS.INVENTORY_WRITE;
    default:
      return PERMISSIONS.INVENTORY_WRITE;
  }
}
