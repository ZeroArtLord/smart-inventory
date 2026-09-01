import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  readV1Snapshot,
  buildV1MigrationPreview,
  applyV1Migration,
  getV1MigrationStatus,
  serializeV1Archive,
  parseV1ArchiveText
} = await import('../src/migration/v1Migration.js');

const {
  listProducts
} = await import('../src/catalog/catalogService.js');

const {
  getCurrentStock
} = await import('../src/inventory/movementService.js');

test('lee snapshot V1 desde claves conocidas y tolera JSON inválido', () => {
  const values = new Map([
    [
      'smart_inventory_products',
      JSON.stringify([
        {
          id: 'legacy-1',
          name: 'HARINA PAN',
          currentStock: 8,
          minStock: 5,
          maxStock: 20,
          unit: 'KG'
        }
      ])
    ],
    [
      'smart_inventory_history',
      JSON.stringify([{ id: 'h1' }])
    ],
    [
      'smart_inventory_daily',
      'json roto'
    ]
  ]);

  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    }
  };

  const snapshot = readV1Snapshot(storage);

  assert.equal(snapshot.products.length, 1);
  assert.equal(snapshot.history.length, 1);
  assert.equal(snapshot.daily.length, 0);
  assert.equal(snapshot.audit.length, 0);
});

test('preview V1 normaliza unidades y preserva existencia como objetivo de migración', () => {
  const preview = buildV1MigrationPreview({
    products: [
      {
        id: 'legacy-aceite',
        name: 'ACEITE MIGRACION TEST',
        currentStock: 17,
        minStock: 10,
        maxStock: 30,
        unit: 'litros',
        category: 'Líquidos',
        supplier: 'Proveedor Uno'
      }
    ],
    history: [{ id: 'h1' }],
    daily: [],
    audit: [{ id: 'a1' }]
  });

  assert.equal(preview.errors.length, 0);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].unitId, 'unit_lt');
  assert.equal(preview.rows[0].currentStock, 17);
  assert.equal(preview.rows[0].categoryName, 'Liquidos');
  assert.equal(preview.sourceCounts.history, 1);
  assert.equal(preview.sourceCounts.audit, 1);
});

test('migración V1 crea catálogo y stock mediante ADJUSTMENT trazable', async () => {
  const preview = buildV1MigrationPreview({
    products: [
      {
        id: 'legacy-migration-product',
        name: 'PRODUCTO V1 MIGRATION UNIQUE',
        currentStock: 13,
        minStock: 4,
        maxStock: 25,
        unit: 'BULTO',
        category: 'MIGRACION CAT',
        supplier: 'MIGRACION SUP'
      }
    ],
    history: [{ id: 'hist-legacy' }],
    daily: [{ id: 'daily-legacy' }],
    audit: [{ id: 'audit-legacy' }]
  });

  const result = await applyV1Migration(preview, {
    ownerId: 'migration-admin-test'
  });

  assert.equal(result.created, 1);
  assert.equal(result.stockAdjustments, 1);
  assert.equal(result.categoriesCreated, 1);
  assert.equal(result.suppliersCreated, 1);

  const products = await listProducts({
    includeInactive: true
  });
  const product = products.find(
    item => item.name === 'PRODUCTO V1 MIGRATION UNIQUE'
  );

  assert.ok(product);
  assert.equal(product.inventoryUnitId, 'unit_bulto');
  assert.equal(await getCurrentStock(product.id), 13);

  const status = await getV1MigrationStatus();
  assert.equal(
    status.sourceCounts.history,
    1
  );
  assert.equal(
    status.migratedProducts[0].legacyId,
    'legacy-migration-product'
  );

  await assert.rejects(
    applyV1Migration(preview, {
      ownerId: 'migration-admin-test'
    }),
    /ya fue completada/i
  );
});

test('archivo V1 serializado conserva snapshot sin transformarlo en movimientos falsos', () => {
  const snapshot = {
    products: [{ id: 'p1' }],
    history: [{ consumption: 9 }],
    daily: [],
    audit: []
  };

  const archive = JSON.parse(
    serializeV1Archive(snapshot)
  );

  assert.equal(
    archive.schema,
    'smart-inventory-v1-archive'
  );
  assert.equal(
    archive.snapshot.history[0].consumption,
    9
  );
});


test('parseV1ArchiveText acepta archivo portable y snapshot directo', () => {
  const portable = parseV1ArchiveText(JSON.stringify({
    schema: 'smart-inventory-v1-archive',
    snapshot: {
      products: [{ id: 'p1' }],
      history: [{ id: 'h1' }],
      daily: [],
      audit: []
    }
  }));

  assert.equal(portable.products.length, 1);
  assert.equal(portable.history.length, 1);

  const direct = parseV1ArchiveText(JSON.stringify({
    products: [{ id: 'p2' }],
    history: [],
    daily: [],
    audit: []
  }));

  assert.equal(direct.products[0].id, 'p2');

  assert.throws(
    () => parseV1ArchiveText('{mal json'),
    /JSON válido/i
  );
});
