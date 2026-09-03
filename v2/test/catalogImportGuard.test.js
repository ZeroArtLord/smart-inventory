import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeCatalogImportConflicts,
  buildCatalogIdentityIndexes,
  replaceCatalogProductInIdentityIndexes,
  resolveCatalogProductIdentity
} from '../src/catalog/catalogImportGuard.js';

test('bloquea SKU duplicado dentro del mismo Excel', () => {
  const result = analyzeCatalogImportConflicts([
    {
      excelRow: 2,
      name: 'PRODUCTO A',
      sku: 'SKU-001',
      barcode: ''
    },
    {
      excelRow: 3,
      name: 'PRODUCTO B',
      sku: 'SKU-001',
      barcode: ''
    }
  ], []);

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /SKU duplicado/i);
});

test('bloquea código de barras duplicado dentro del mismo Excel', () => {
  const result = analyzeCatalogImportConflicts([
    {
      excelRow: 2,
      name: 'PRODUCTO A',
      sku: 'A',
      barcode: '7590001'
    },
    {
      excelRow: 3,
      name: 'PRODUCTO B',
      sku: 'B',
      barcode: '7590001'
    }
  ], []);

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /código de barras duplicado/i);
});

test('bloquea fila cuyos identificadores apuntan a productos distintos', () => {
  const products = [
    {
      id: 'prd_a',
      name: 'PRODUCTO A',
      sku: 'SKU-A',
      barcode: '111'
    },
    {
      id: 'prd_b',
      name: 'PRODUCTO B',
      sku: 'SKU-B',
      barcode: '222'
    }
  ];

  const indexes = buildCatalogIdentityIndexes(products);

  const result = resolveCatalogProductIdentity(
    {
      name: 'PRODUCTO A',
      sku: 'SKU-A',
      barcode: '222'
    },
    indexes
  );

  assert.equal(result.product, null);
  assert.match(result.error, /no apuntan al mismo producto/i);
});

test('bloquea dos filas que terminarían actualizando el mismo producto', () => {
  const products = [
    {
      id: 'prd_a',
      name: 'PRODUCTO A',
      sku: 'SKU-A',
      barcode: '111'
    }
  ];

  const result = analyzeCatalogImportConflicts([
    {
      excelRow: 2,
      name: 'PRODUCTO A',
      sku: 'SKU-A',
      barcode: ''
    },
    {
      excelRow: 3,
      name: 'PRODUCTO A RENOMBRADO',
      sku: '',
      barcode: '111'
    }
  ], products);

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /mismo producto existente/i);
});

test('reindexar elimina los identificadores anteriores del producto', () => {
  const previous = {
    id: 'prd_a',
    name: 'PRODUCTO A',
    sku: 'OLD',
    barcode: '111'
  };

  const next = {
    ...previous,
    name: 'PRODUCTO A NUEVO',
    sku: 'NEW',
    barcode: '222'
  };

  const indexes = buildCatalogIdentityIndexes([previous]);

  replaceCatalogProductInIdentityIndexes(
    indexes,
    previous,
    next
  );

  assert.equal(
    resolveCatalogProductIdentity(
      { sku: 'OLD' },
      indexes
    ).product,
    null
  );

  assert.equal(
    resolveCatalogProductIdentity(
      { sku: 'NEW' },
      indexes
    ).product?.id,
    'prd_a'
  );
});
