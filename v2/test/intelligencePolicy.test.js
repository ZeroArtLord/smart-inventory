import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  INTELLIGENCE_MODES,
  DEFAULT_INTELLIGENCE_POLICY,
  normalizeIntelligenceMode
} = await import('../src/core/catalog.js');

const {
  createProduct,
  updateProduct
} = await import('../src/catalog/catalogService.js');

test('V4-A define modos y política compatible por defecto', () => {
  assert.deepEqual(INTELLIGENCE_MODES, {
    SEED: 'SEED',
    ADAPTIVE: 'ADAPTIVE',
    HARD_LIMIT: 'HARD_LIMIT'
  });

  assert.deepEqual(DEFAULT_INTELLIGENCE_POLICY, {
    mode: 'SEED',
    targetDays: 7,
    safetyDays: 0
  });
});

test('normaliza el modo interno y rechaza valores desconocidos', () => {
  assert.equal(normalizeIntelligenceMode('seed'), 'SEED');
  assert.equal(normalizeIntelligenceMode('hard-limit'), 'HARD_LIMIT');
  assert.throws(
    () => normalizeIntelligenceMode('MAGIA'),
    /Modo de inteligencia inválido/i
  );
});

test('producto nuevo recibe política V4 segura sin configuración manual', async () => {
  const product = await createProduct({
    name: 'V4 DEFAULT POLICY',
    saintCode: 'V4-DEFAULT',
    inventoryUnitId: 'unit_und',
    minStock: 2,
    maxStock: 8
  });

  assert.equal(product.intelligenceMode, 'SEED');
  assert.equal(product.targetDays, 7);
  assert.equal(product.safetyDays, 0);
});

test('producto permite política adaptativa explícita y actualización trazable', async () => {
  const product = await createProduct({
    name: 'V4 ADAPTIVE POLICY',
    saintCode: 'V4-ADAPTIVE',
    intelligenceMode: 'ADAPTIVE',
    targetDays: 10,
    safetyDays: 2,
    inventoryUnitId: 'unit_und',
    minStock: 1,
    maxStock: 4
  });

  assert.equal(product.intelligenceMode, 'ADAPTIVE');
  assert.equal(product.targetDays, 10);
  assert.equal(product.safetyDays, 2);

  const updated = await updateProduct(product.id, {
    intelligenceMode: 'HARD_LIMIT',
    targetDays: 14,
    safetyDays: 3
  });

  assert.equal(updated.intelligenceMode, 'HARD_LIMIT');
  assert.equal(updated.targetDays, 14);
  assert.equal(updated.safetyDays, 3);
  assert.equal(updated.version, product.version + 1);
});

test('V4-A rechaza cobertura inválida antes de sincronizar', async () => {
  await assert.rejects(
    () => createProduct({
      name: 'V4 BAD TARGET',
      saintCode: 'V4-BAD-TARGET',
      targetDays: 0,
      inventoryUnitId: 'unit_und'
    }),
    /Días objetivo/i
  );

  await assert.rejects(
    () => createProduct({
      name: 'V4 BAD SAFETY',
      saintCode: 'V4-BAD-SAFETY',
      safetyDays: -1,
      inventoryUnitId: 'unit_und'
    }),
    /Días de seguridad/i
  );
});
