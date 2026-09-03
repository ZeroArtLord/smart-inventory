import {
  normalizeSearchText
} from '../core/catalog.js';

export function buildCatalogIdentityIndexes(
  products = []
) {
  const indexes = {
    bySaintCode: new Map(),
    bySku: new Map(),
    byBarcode: new Map(),
    byName: new Map()
  };

  for (const product of products) {
    indexCatalogProduct(
      indexes,
      product
    );
  }

  return indexes;
}

export function indexCatalogProduct(
  indexes,
  product
) {
  addIndexValue(
    indexes.bySaintCode,
    product?.saintCode,
    product
  );
  addIndexValue(
    indexes.bySku,
    product?.sku,
    product
  );
  addIndexValue(
    indexes.byBarcode,
    product?.barcode,
    product
  );
  addIndexValue(
    indexes.byName,
    product?.name,
    product
  );

  return indexes;
}

export function replaceCatalogProductInIdentityIndexes(
  indexes,
  previousProduct,
  nextProduct
) {
  removeIndexValue(
    indexes.bySaintCode,
    previousProduct?.saintCode,
    previousProduct?.id
  );
  removeIndexValue(
    indexes.bySku,
    previousProduct?.sku,
    previousProduct?.id
  );
  removeIndexValue(
    indexes.byBarcode,
    previousProduct?.barcode,
    previousProduct?.id
  );
  removeIndexValue(
    indexes.byName,
    previousProduct?.name,
    previousProduct?.id
  );

  return indexCatalogProduct(
    indexes,
    nextProduct
  );
}

export function buildCatalogImportPlan(
  rows = [],
  products = [],
  categories = []
) {
  const indexes =
    buildCatalogIdentityIndexes(products);
  const categoryNames = new Set(
    categories
      .filter(category => category?.active !== false)
      .map(category =>
        normalized(category.name)
      )
      .filter(Boolean)
  );

  const newCategoryNames = new Set();
  let creates = 0;
  let updates = 0;
  let unresolved = 0;

  for (const row of rows) {
    const resolution =
      resolveCatalogProductIdentity(
        row,
        indexes
      );

    if (resolution.error) {
      unresolved++;
      continue;
    }

    if (resolution.product) {
      updates++;
    } else {
      creates++;
    }

    const categoryKey =
      normalized(row?.categoryName);

    if (
      categoryKey &&
      !categoryNames.has(categoryKey)
    ) {
      newCategoryNames.add(categoryKey);
    }
  }

  return {
    creates,
    updates,
    unresolved,
    categoriesToCreate:
      newCategoryNames.size
  };
}

export function analyzeCatalogImportConflicts(
  rows = [],
  products = [],
  movements = []
) {
  const errors = [];
  const warnings = [];
  const indexes =
    buildCatalogIdentityIndexes(products);
  const productsWithHistory = new Set(
    movements
      .map(movement => movement?.productId)
      .filter(Boolean)
  );

  detectDuplicatePreviewKeys(
    rows,
    errors,
    warnings
  );

  const targetRowsByProductId =
    new Map();

  for (const row of rows) {
    const resolution =
      resolveCatalogProductIdentity(
        row,
        indexes
      );

    if (resolution.error) {
      errors.push(
        rowPrefix(row) +
        resolution.error
      );
      continue;
    }

    const product =
      resolution.product;

    if (!product) continue;

    if (
      productsWithHistory.has(product.id) &&
      row.hasExplicitUnit === true &&
      row.inventoryUnitId &&
      product.inventoryUnitId &&
      row.inventoryUnitId !== product.inventoryUnitId
    ) {
      errors.push(
        `${rowPrefix(row)}no puede cambiar la unidad base de ${product.name} porque el producto ya tiene movimientos.`
      );
      continue;
    }

    const previous =
      targetRowsByProductId.get(
        product.id
      );

    if (previous) {
      errors.push(
        `${rowPrefix(row)}apunta al mismo producto existente que la fila ${previous.excelRow || '?'} (${product.name}).`
      );
      continue;
    }

    targetRowsByProductId.set(
      product.id,
      row
    );
  }

  return {
    errors: unique(errors),
    warnings: unique(warnings)
  };
}

export function resolveCatalogProductIdentity(
  row,
  indexes
) {
  const matches = [];

  collectMatches(
    matches,
    'Código SAINT',
    row?.saintCode,
    indexes?.bySaintCode
  );

  collectMatches(
    matches,
    'SKU Smart',
    row?.sku,
    indexes?.bySku
  );

  collectMatches(
    matches,
    'código de barras',
    row?.barcode,
    indexes?.byBarcode
  );

  collectMatches(
    matches,
    'nombre',
    row?.name,
    indexes?.byName
  );

  const ambiguousIndex =
    matches.find(match =>
      match.products.length > 1
    );

  if (ambiguousIndex) {
    return {
      product: null,
      error:
        `${ambiguousIndex.label} "${ambiguousIndex.value}" ya corresponde a más de un producto del catálogo.`
    };
  }

  const resolved = matches
    .flatMap(match =>
      match.products
    );

  const uniqueProducts =
    new Map();

  for (const product of resolved) {
    uniqueProducts.set(
      product.id,
      product
    );
  }

  if (uniqueProducts.size > 1) {
    const details = matches
      .filter(match =>
        match.products.length === 1
      )
      .map(match =>
        `${match.label} → ${match.products[0].name}`
      )
      .join(' · ');

    return {
      product: null,
      error:
        `los identificadores no apuntan al mismo producto (${details}).`
    };
  }

  return {
    product:
      uniqueProducts.values()
        .next().value ||
      null,
    error: null
  };
}

function detectDuplicatePreviewKeys(
  rows,
  errors,
  warnings
) {
  const saintCodeRows = new Map();
  const skuRows = new Map();
  const barcodeRows = new Map();
  const nameOnlyRows = new Map();

  for (const row of rows) {
    addPreviewKey(
      saintCodeRows,
      row?.saintCode,
      row,
      'Código SAINT',
      errors
    );

    addPreviewKey(
      skuRows,
      row?.sku,
      row,
      'SKU Smart',
      errors
    );

    addPreviewKey(
      barcodeRows,
      row?.barcode,
      row,
      'código de barras',
      errors
    );

    if (
      !clean(row?.saintCode) &&
      !clean(row?.sku) &&
      !clean(row?.barcode)
    ) {
      addPreviewKey(
        nameOnlyRows,
        row?.name,
        row,
        'nombre sin Código SAINT/SKU/código de barras',
        errors
      );
    }
  }

  const names = new Map();

  for (const row of rows) {
    const key = normalized(row?.name);
    if (!key) continue;

    const current =
      names.get(key) || [];
    current.push(row);
    names.set(key, current);
  }

  for (const sameNameRows of names.values()) {
    if (sameNameRows.length <= 1) {
      continue;
    }

    errors.push(
      `Nombre duplicado "${sameNameRows[0].name}" en filas ${sameNameRows.map(row => row.excelRow || '?').join(', ')}. Cada fila de carga debe identificar un solo producto.`
    );
  }
}

function addPreviewKey(
  map,
  value,
  row,
  label,
  errors
) {
  const key = normalized(value);
  if (!key) return;

  const previous =
    map.get(key);

  if (previous) {
    errors.push(
      `${rowPrefix(row)}${label} duplicado "${clean(value)}"; ya aparece en la fila ${previous.excelRow || '?'}.`
    );
    return;
  }

  map.set(key, row);
}

function addIndexValue(
  map,
  value,
  product
) {
  const key = normalized(value);
  if (!key || !product) return;

  const items =
    map.get(key) || [];

  if (
    !items.some(
      item => item.id === product.id
    )
  ) {
    items.push(product);
  }

  map.set(key, items);
}

function removeIndexValue(
  map,
  value,
  productId
) {
  const key = normalized(value);
  if (!key || !productId) return;

  const items =
    map.get(key) || [];

  const remaining =
    items.filter(
      item => item.id !== productId
    );

  if (remaining.length) {
    map.set(key, remaining);
  } else {
    map.delete(key);
  }
}

function collectMatches(
  matches,
  label,
  value,
  map
) {
  const key = normalized(value);
  if (!key || !map) return;

  const products =
    map.get(key) || [];

  if (!products.length) return;

  matches.push({
    label,
    value: clean(value),
    products
  });
}

function rowPrefix(row) {
  return `Fila ${row?.excelRow || '?'}: `;
}

function normalized(value) {
  return normalizeSearchText(
    clean(value)
  );
}

function clean(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values)];
}
