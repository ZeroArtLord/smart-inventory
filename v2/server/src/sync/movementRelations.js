import { movementStockDelta } from './stockInvariant.js';

const EPSILON = 0.000001;

export async function assertMovementRelations(
  client,
  workspaceId,
  movement
) {
  const product = await client.query(
    'SELECT 1 FROM products WHERE workspace_id = $1 AND id = $2 LIMIT 1',
    [workspaceId, movement.productId]
  );

  if (product.rowCount === 0) {
    throw integrityError(
      'MOVEMENT_PRODUCT_NOT_FOUND',
      'El producto del movimiento no existe.'
    );
  }

  if (movement.documentId) {
    const document = await client.query(
      'SELECT type, status FROM documents WHERE workspace_id = $1 AND id = $2 LIMIT 1',
      [workspaceId, movement.documentId]
    );

    if (document.rowCount === 0) {
      throw integrityError(
        'MOVEMENT_DOCUMENT_NOT_FOUND',
        'El documento del movimiento no existe.'
      );
    }

    const expected = expectedDocumentTypes(movement.type);
    if (
      expected.length > 0 &&
      !expected.includes(document.rows[0].type)
    ) {
      throw integrityError(
        'MOVEMENT_DOCUMENT_TYPE_MISMATCH',
        'El tipo de documento no corresponde al movimiento.'
      );
    }
  }

  if (movement.lotId) {
    const lot = await client.query(
      'SELECT product_id FROM lots WHERE workspace_id = $1 AND id = $2 LIMIT 1',
      [workspaceId, movement.lotId]
    );

    if (lot.rowCount === 0) {
      throw integrityError(
        'MOVEMENT_LOT_NOT_FOUND',
        'El lote del movimiento no existe.'
      );
    }

    if (lot.rows[0].product_id !== movement.productId) {
      throw integrityError(
        'MOVEMENT_LOT_PRODUCT_MISMATCH',
        'El lote pertenece a otro producto.'
      );
    }
  }

  if (movement.type !== 'REVERSAL') {
    if (movement.reversedMovementId) {
      throw integrityError(
        'INVALID_REVERSAL_LINK',
        'Solo un REVERSAL puede indicar reversedMovementId.'
      );
    }
    return;
  }

  if (!movement.reversedMovementId) {
    throw integrityError(
      'REVERSAL_TARGET_REQUIRED',
      'El reverso debe indicar el movimiento original.'
    );
  }

  const originalResult = await client.query(
    `SELECT id, product_id, type, quantity, delta, location_id
     FROM movements
     WHERE workspace_id = $1
       AND id = $2
     LIMIT 1`,
    [workspaceId, movement.reversedMovementId]
  );

  if (originalResult.rowCount === 0) {
    throw integrityError(
      'REVERSAL_TARGET_NOT_FOUND',
      'El movimiento original del reverso no existe.'
    );
  }

  const original = {
    id: originalResult.rows[0].id,
    productId: originalResult.rows[0].product_id,
    type: originalResult.rows[0].type,
    quantity: Number(originalResult.rows[0].quantity || 0),
    delta: originalResult.rows[0].delta === null
      ? null
      : Number(originalResult.rows[0].delta),
    locationId: originalResult.rows[0].location_id || null
  };

  if (original.type === 'REVERSAL') {
    throw integrityError(
      'REVERSAL_OF_REVERSAL_BLOCKED',
      'No se puede reversar un reverso directamente.'
    );
  }

  if (original.productId !== movement.productId) {
    throw integrityError(
      'REVERSAL_PRODUCT_MISMATCH',
      'El reverso debe usar el mismo producto.'
    );
  }

  if ((original.locationId || null) !== (movement.locationId || null)) {
    throw integrityError(
      'REVERSAL_LOCATION_MISMATCH',
      'El reverso debe usar la misma ubicación.'
    );
  }

  const expectedDelta = -movementStockDelta(original);
  const actualDelta = Number(movement.delta || 0);

  if (Math.abs(expectedDelta - actualDelta) > EPSILON) {
    throw integrityError(
      'REVERSAL_DELTA_MISMATCH',
      'El delta del reverso no compensa exactamente al movimiento original.'
    );
  }

  const existing = await client.query(
    `SELECT 1 FROM movements
     WHERE workspace_id = $1
       AND reversed_movement_id = $2
     LIMIT 1`,
    [workspaceId, movement.reversedMovementId]
  );

  if (existing.rowCount > 0) {
    throw integrityError(
      'REVERSAL_ALREADY_EXISTS',
      'El movimiento original ya fue compensado.'
    );
  }
}

export function expectedDocumentTypes(movementType) {
  switch (movementType) {
    case 'ENTRY':
      return ['ENTRY'];
    case 'SUPPLY':
      return ['SUPPLY'];
    case 'ADJUSTMENT':
      return ['COUNT', 'ADJUSTMENT'];
    case 'REVERSAL':
      return ['COUNT', 'ENTRY', 'SUPPLY', 'ADJUSTMENT'];
    default:
      return [];
  }
}

function integrityError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}
