export const MOVEMENT_TYPES = Object.freeze({
  ENTRY: 'ENTRY',
  SUPPLY: 'SUPPLY',
  ADJUSTMENT: 'ADJUSTMENT',
  TRANSFER: 'TRANSFER',
  REVERSAL: 'REVERSAL'
});

export function stockDeltaForMovement(movement) {
  const quantity = Number(movement?.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error('Cantidad de movimiento inválida');
  }

  switch (movement.type) {
    case MOVEMENT_TYPES.ENTRY:
      return quantity;
    case MOVEMENT_TYPES.SUPPLY:
      return -quantity;
    case MOVEMENT_TYPES.ADJUSTMENT:
      if (!Number.isFinite(Number(movement.delta))) {
        throw new Error('Ajuste inválido');
      }
      return Number(movement.delta);
    case MOVEMENT_TYPES.TRANSFER:
      return 0;
    case MOVEMENT_TYPES.REVERSAL:
      if (!Number.isFinite(Number(movement.delta))) {
        throw new Error('Reverso inválido');
      }
      return Number(movement.delta);
    default:
      throw new Error('Tipo de movimiento desconocido');
  }
}
