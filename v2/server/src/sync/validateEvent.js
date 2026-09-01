const MOVEMENT_TYPES = new Set([
  'ENTRY',
  'SUPPLY',
  'ADJUSTMENT',
  'TRANSFER',
  'REVERSAL'
]);

const DOCUMENT_TYPES = new Set([
  'COUNT',
  'ENTRY',
  'SUPPLY',
  'ADJUSTMENT'
]);

const DOCUMENT_STATUS = new Set([
  'DRAFT',
  'CLOSED',
  'VERIFIED',
  'READY_FOR_SAINT',
  'SENT_TO_SAINT',
  'SAINT_PENDING',
  'POSTED',
  'CANCELLED'
]);

const REPLENISHMENT_METHODS = new Set([
  'PURCHASE',
  'ORDER',
  'BOTH',
  'NONE'
]);

const UPSERT_OPERATIONS = new Set(['CREATE', 'UPDATE']);

export function validateSyncEvent(event) {
  if (!event || typeof event !== 'object') {
    throw new Error('Evento de sincronización inválido');
  }

  const { entityType, entityId, operation, payload } = event;

  if (!entityType || !entityId || !operation || !payload) {
    throw new Error('Evento de sincronización incompleto');
  }

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Payload de sincronización inválido');
  }

  if (payload.id !== entityId) {
    throw new Error('El id del evento no coincide con el payload');
  }

  switch (entityType) {
    case 'product':
      requireUpsert(operation);
      validateProduct(payload);
      break;
    case 'category':
    case 'supplier':
    case 'location':
      requireUpsert(operation);
      requireText(payload.name, 'Nombre');
      break;
    case 'document':
      requireUpsert(operation);
      validateDocument(payload);
      break;
    case 'documentLine':
      requireUpsert(operation);
      validateDocumentLine(payload);
      break;
    case 'lot':
      requireUpsert(operation);
      validateLot(payload);
      break;
    case 'replenishment':
      requireUpsert(operation);
      validateReplenishment(payload);
      break;
    case 'movement':
      if (operation !== 'CREATE') {
        throw new Error('Los movimientos solo admiten CREATE');
      }
      validateMovement(payload);
      break;
    default:
      throw new Error(`Entidad no soportada: ${entityType}`);
  }

  return event;
}

function validateProduct(product) {
  requireText(product.name, 'Nombre de producto');

  const min = finiteNonNegative(product.minStock ?? 0, 'Stock mínimo');
  const max = finiteNonNegative(product.maxStock ?? 0, 'Stock máximo');

  if (max > 0 && min > max) {
    throw new Error('El stock mínimo no puede superar el máximo');
  }

  const conversion = Number(product.purchaseConversion ?? 1);
  if (!Number.isFinite(conversion) || conversion <= 0) {
    throw new Error('Conversión de compra inválida');
  }

  const method = product.replenishmentMethod || 'BOTH';
  if (!REPLENISHMENT_METHODS.has(method)) {
    throw new Error('Método de reposición inválido');
  }
}

function validateDocument(document) {
  if (!DOCUMENT_TYPES.has(document.type)) {
    throw new Error('Tipo de documento inválido');
  }

  if (!DOCUMENT_STATUS.has(document.status)) {
    throw new Error('Estado de documento inválido');
  }

  requireDate(document.createdAt, 'createdAt');
  requireDate(document.updatedAt, 'updatedAt');

  if (document.closedAt) requireDate(document.closedAt, 'closedAt');
}

function validateDocumentLine(line) {
  requireText(line.documentId, 'documentId');
  requireText(line.productId, 'productId');
  requireDate(line.createdAt, 'createdAt');
  requireDate(line.updatedAt, 'updatedAt');

  const hasCount = line.countedStock !== undefined || line.expectedStock !== undefined;
  const hasQuantity = line.quantity !== undefined;

  if (!hasCount && !hasQuantity) {
    throw new Error('Línea de documento sin cantidad ni conteo');
  }

  if (hasCount) {
    finiteNonNegative(line.countedStock, 'Existencia contada');
    finiteNonNegative(line.expectedStock, 'Existencia esperada');
  }

  if (hasQuantity) {
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Cantidad de línea inválida');
    }
  }

  if (line.unitCost !== null && line.unitCost !== undefined) {
    finiteNonNegative(line.unitCost, 'Costo');
  }
}

function validateLot(lot) {
  requireText(lot.productId, 'productId');
  requireDate(lot.receivedAt, 'receivedAt');
  requireDate(lot.createdAt, 'createdAt');
  requireDate(lot.updatedAt, 'updatedAt');

  if (lot.expiresAt) requireDate(lot.expiresAt, 'expiresAt');

  const original = finiteNonNegative(
    lot.originalQuantity,
    'Cantidad original del lote'
  );
  const remaining = finiteNonNegative(
    lot.remainingQuantity,
    'Cantidad restante del lote'
  );

  if (remaining > original) {
    throw new Error('La cantidad restante del lote supera la original');
  }

  if (lot.unitCost !== null && lot.unitCost !== undefined) {
    finiteNonNegative(lot.unitCost, 'Costo del lote');
  }
}

function validateReplenishment(item) {
  requireText(item.productId, 'productId');

  if (!new Set(['PURCHASE', 'ORDER']).has(item.method)) {
    throw new Error('Método de compra/pedido inválido');
  }

  if (!new Set([
    'DRAFT',
    'ORDERED',
    'IN_TRANSIT',
    'PARTIALLY_RECEIVED',
    'RECEIVED',
    'CANCELLED'
  ]).has(item.status)) {
    throw new Error('Estado de compra/pedido inválido');
  }

  const requested = finiteNonNegative(
    item.requestedQuantity,
    'Cantidad solicitada'
  );
  const received = finiteNonNegative(
    item.receivedQuantity ?? 0,
    'Cantidad recibida'
  );
  const pending = finiteNonNegative(
    item.pendingQuantity,
    'Cantidad pendiente'
  );

  if (requested <= 0) {
    throw new Error('La cantidad solicitada debe ser mayor que cero');
  }

  if (received > requested) {
    throw new Error('La cantidad recibida supera la solicitada');
  }

  if (Math.abs((requested - received) - pending) > 0.000001) {
    throw new Error('Las cantidades de compra/pedido no cuadran');
  }

  if (item.expectedAt) requireDate(item.expectedAt, 'expectedAt');
  if (item.orderedAt) requireDate(item.orderedAt, 'orderedAt');
  if (item.receivedAt) requireDate(item.receivedAt, 'receivedAt');
  if (item.cancelledAt) requireDate(item.cancelledAt, 'cancelledAt');

  requireDate(item.createdAt, 'createdAt');
  requireDate(item.updatedAt, 'updatedAt');
}

function validateMovement(movement) {
  requireText(movement.productId, 'productId');

  if (!MOVEMENT_TYPES.has(movement.type)) {
    throw new Error('Tipo de movimiento inválido');
  }

  const quantity = Number(movement.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error('Cantidad de movimiento inválida');
  }

  if (
    movement.type === 'ENTRY' ||
    movement.type === 'SUPPLY' ||
    movement.type === 'TRANSFER'
  ) {
    if (quantity <= 0) {
      throw new Error('La cantidad del movimiento debe ser mayor que cero');
    }
  }

  if (movement.type === 'ADJUSTMENT' || movement.type === 'REVERSAL') {
    const delta = Number(movement.delta);
    if (!Number.isFinite(delta)) {
      throw new Error('Delta de movimiento inválido');
    }
  }

  requireDate(movement.effectiveAt, 'effectiveAt');
  requireDate(movement.createdAt, 'createdAt');
}

function requireUpsert(operation) {
  if (!UPSERT_OPERATIONS.has(operation)) {
    throw new Error('Operación de sincronización no permitida');
  }
}

function finiteNonNegative(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${fieldName} inválido`);
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} requerido`);
  }
}

function requireDate(value, fieldName) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} inválido`);
  }
}
