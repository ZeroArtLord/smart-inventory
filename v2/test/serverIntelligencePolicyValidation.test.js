import test from 'node:test';
import assert from 'node:assert/strict';

const {
  validateSyncEvent
} = await import('../server/src/sync/validateEvent.js');

function product(overrides = {}) {
  return {
    id: 'prd_v4_policy',
    name: 'Producto V4',
    minStock: 2,
    maxStock: 12,
    purchaseConversion: 1,
    replenishmentMethod: 'BOTH',
    ...overrides
  };
}

function event(payload) {
  return {
    entityType: 'product',
    entityId: payload.id,
    operation: 'UPDATE',
    payload
  };
}

test('servidor mantiene compatibilidad con producto legacy sin campos V4', () => {
  assert.doesNotThrow(() =>
    validateSyncEvent(event(product()))
  );
});

test('servidor acepta los tres modos V4 y cobertura válida', () => {
  for (const intelligenceMode of ['SEED', 'ADAPTIVE', 'HARD_LIMIT']) {
    assert.doesNotThrow(() =>
      validateSyncEvent(event(product({
        intelligenceMode,
        targetDays: 10,
        safetyDays: 2
      })))
    );
  }
});

test('servidor rechaza modo de inteligencia desconocido', () => {
  assert.throws(
    () => validateSyncEvent(event(product({
      intelligenceMode: 'AUTOPILOT'
    }))),
    /Modo de inteligencia inválido/i
  );
});

test('servidor rechaza targetDays no positivo y safetyDays negativo', () => {
  assert.throws(
    () => validateSyncEvent(event(product({
      targetDays: 0
    }))),
    /Días objetivo/i
  );

  assert.throws(
    () => validateSyncEvent(event(product({
      safetyDays: -0.5
    }))),
    /Días de seguridad/i
  );
});
