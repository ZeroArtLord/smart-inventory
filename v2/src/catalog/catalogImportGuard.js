import {
  normalizeSearchText
} from '../core/catalog.js';

export function buildCatalogIdentityIndexes(
  products = []
) {
  const indexes = {
    bySku: new Map(),
    byBarcode: new Map(),
    byName: new Map()
  };

  for (const product of products) {
    addIndexValue(
      indexes.bySku,
      product.sku,
      product
    );
    addIndexValue(
      indexes.byBarcode,
      product.barcode,
      product
    );
    addIndexValue(
      indexes.byName,
      product.name,
      product
    );
  }

  return indexes;
}

export function analyzeCatalogImportConflicts(
  rows = [],
  products = []
) {
  const errors = [];
  const warnings = [];
  const indexes =
    buildCatalogIdentityIndexes(products);

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
    'SKU',
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
  const skuRows = new Map();
  const barcodeRows = new Map();
  const nameOnlyRows = new Map();

  for (const row of rows) {
    addPreviewKey(
      skuRows,
      row?.sku,
      row,
      'SKU',
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
      !clean(row?.sku) &&
      !clean(row?.barcode)
    ) {
      addPreviewKey(
        nameOnlyRows,
        row?.name,
        row,
        'nombre sin SKU/código de barras',
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

  for (const [key, sameNameRows] of names) {
    if (sameNameRows.length <= 1) {
      continue;
    }

    const allStrong =
      sameNameRows.every(row =>
        clean(row.sku) ||
        clean(row.barcode)
      );

    if (allStrong) {
      warnings.push(
        `Nombre repetido "${sameNameRows[0].name}" en filas ${sameNameRows.map(row => row.excelRow || '?').join(', ')}; se distinguirán por SKU/código de barras.`
      );
    }
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
  if (!key) return;

  const items =
    map.get(key) || [];

  items.push(product);
  map.set(key, items);
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
