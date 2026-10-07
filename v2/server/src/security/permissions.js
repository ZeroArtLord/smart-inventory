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

const COUNT_RECONCILIATION_KIND = 'COUNT_RECONCILIATION';
const QUICK_STOCK_CORRECTION_KIND = 'GOD_QUICK_STOCK_CORRECTION';

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
  // V5-D: el permiso genérico adjustment.write no es suficiente para
  // conciliaciones de conteo. En este flujo la autorización es jerárquica:
  // únicamente el rol GOD puede iniciar/revisar decisiones o crear el
  // ADJUSTMENT que modifica stock. La simple entrega del conteo en estado
  // PENDING continúa usando count.write para que el almacenista pueda contar.
  if (requiresGodCountReconciliation(event)) {
    assertGodRole(auth, 'Solo el rol DIOS puede conciliar diferencias de conteo');
    return 'role:GOD';
  }

  // Una corrección rápida cambia directamente la realidad lógica del stock
  // mediante ADJUSTMENT. Aunque otro rol tuviera adjustment.write, esta vía
  // administrativa queda reservada exclusivamente a GOD.
  if (requiresGodQuickStockCorrection(event)) {
    assertGodRole(auth, 'Solo el rol DIOS puede corregir stock directamente');
    return 'role:GOD';
  }

  if (event?.entityType === 'initialLoad') {
    const required = [
      PERMISSIONS.CATALOG_WRITE,
      PERMISSIONS.ADJUSTMENT_WRITE
    ];

    const missing = required.filter(
      permission => !hasPermission(auth, permission)
    );

    if (missing.length) {
      const error = new Error(
        `Permisos requeridos: ${missing.join(', ')}`
      );
      error.code = 'PERMISSION_DENIED';
      error.statusCode = 403;
      throw error;
    }

    return required.join(' + ');
  }

  const required = permissionForEvent(event);

  if (!hasPermission(auth, required)) {
    const error = new Error(
      `Permiso requerido: ${required}`
    );
    error.code = 'PERMISSION_DENIED';
    error.statusCode = 403;
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

  if (entityType === 'initialLoad') {
    return PERMISSIONS.ADJUSTMENT_WRITE;
  }

  return PERMISSIONS.INVENTORY_WRITE;
}

export function requiresGodCountReconciliation(event) {
  const payload = event?.payload || {};
  const metadata = payload.metadata || {};

  if (
    event?.entityType === 'document' &&
    payload.type === 'ADJUSTMENT' &&
    metadata.kind === COUNT_RECONCILIATION_KIND
  ) {
    return true;
  }

  if (
    event?.entityType === 'documentLine' &&
    payload.reconciliationKind === COUNT_RECONCILIATION_KIND
  ) {
    return true;
  }

  if (
    event?.entityType === 'movement' &&
    metadata.reconciliationKind === COUNT_RECONCILIATION_KIND
  ) {
    return true;
  }

  if (
    event?.entityType === 'document' &&
    payload.type === 'COUNT' &&
    metadata.closeMode === COUNT_RECONCILIATION_KIND &&
    ['REVIEWING', 'RESOLVED'].includes(metadata.reconciliationState)
  ) {
    return true;
  }

  return false;
}

export function requiresGodQuickStockCorrection(event) {
  const payload = event?.payload || {};
  const metadata = payload.metadata || {};

  return (
    event?.entityType === 'movement' &&
    event?.operation === 'CREATE' &&
    payload.type === 'ADJUSTMENT' &&
    metadata.quickStockCorrectionKind === QUICK_STOCK_CORRECTION_KIND
  );
}

function assertGodRole(auth, message) {
  if (String(auth?.roleCode || '').trim().toUpperCase() === 'GOD') return;
  const error = new Error(message);
  error.code = 'PERMISSION_DENIED';
  error.statusCode = 403;
  throw error;
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
