const EPSILON = 0.000001;

export function movementStockDelta(movement = {}) {
  const quantity = Number(movement.quantity || 0);

  switch (movement.type) {
    case 'ENTRY':
      return quantity;
    case 'SUPPLY':
      return -quantity;
    case 'ADJUSTMENT':
    case 'REVERSAL':
      return Number(movement.delta || 0);
    case 'TRANSFER':
      return 0;
    default:
      throw new Error('Tipo de movimiento inválido');
  }
}

export async function assertMovementKeepsStockNonNegative(
  client,
  workspaceId,
  movement
) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [
      String(workspaceId),
      `${movement.productId}|${movement.locationId || ''}`
    ]
  );

  const existing = await client.query(
    'SELECT 1 FROM movements WHERE workspace_id = $1 AND id = $2 LIMIT 1',
    [workspaceId, movement.id]
  );

  if (existing.rowCount > 0) {
    return { duplicateMovement: true };
  }

  const result = await client.query(
    `SELECT COALESCE(SUM(
      CASE
        WHEN type = 'ENTRY' THEN quantity
        WHEN type = 'SUPPLY' THEN -quantity
        WHEN type IN ('ADJUSTMENT','REVERSAL') THEN COALESCE(delta, 0)
        ELSE 0
      END
    ), 0) AS stock
    FROM movements
    WHERE workspace_id = $1
      AND product_id = $2
      AND location_id IS NOT DISTINCT FROM $3`,
    [
      workspaceId,
      movement.productId,
      movement.locationId || null
    ]
  );

  const currentStock = Number(result.rows[0]?.stock || 0);
  const delta = movementStockDelta(movement);
  const resultingStock = currentStock + delta;

  if (resultingStock < -EPSILON) {
    const error = new Error(
      `Movimiento rechazado: stock insuficiente. Disponible ${currentStock}, resultado ${resultingStock}.`
    );
    error.code = 'STOCK_NEGATIVE';
    error.statusCode = 409;
    error.details = {
      productId: movement.productId,
      locationId: movement.locationId || null,
      currentStock,
      movementDelta: delta,
      resultingStock
    };
    throw error;
  }

  return {
    duplicateMovement: false,
    currentStock,
    delta,
    resultingStock
  };
}
