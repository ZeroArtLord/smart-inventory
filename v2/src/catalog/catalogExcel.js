import {
  REPLENISHMENT_METHODS,
  normalizeSearchText,
  normalizeText
} from '../core/catalog.js';
import {
  createCategory,
  createProduct,
  listProducts,
  updateProduct
} from './catalogService.js';
import {
  STORES,
  getAll
} from '../storage/database.js';

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const VALID_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

const HEADER_ALIASES = Object.freeze({
  name: [
    'producto', 'nombre', 'descripcion', 'articulo', 'product', 'name'
  ],
  sku: [
    'sku', 'codigo', 'codigo interno', 'cod interno', 'referencia', 'ref'
  ],
  barcode: [
    'codigo de barras', 'cod barras', 'barcode', 'ean', 'upc'
  ],
  minStock: [
    'minimo', 'stock minimo', 'minimo semanal', 'existencia minima', 'min'
  ],
  maxStock: [
    'maximo', 'stock maximo', 'maximo semanal', 'existencia maxima', 'max'
  ],
  currentStock: [
    'existencia', 'stock actual', 'existencia actual', 'stock', 'actual'
  ],
  category: [
    'categoria', 'rubro', 'departamento', 'category'
  ],
  unit: [
    'unidad', 'unidad inventario', 'unidad de inventario', 'udm', 'unit'
  ],
  replenishmentMethod: [
    'reposicion', 'metodo reposicion', 'tipo reposicion', 'replenishment'
  ]
});

const UNIT_IDS = Object.freeze({
  UND: 'unit_und',
  UNIDAD: 'unit_und',
  UNIDADES: 'unit_und',
  KG: 'unit_kg',
  KGS: 'unit_kg',
  KILO: 'unit_kg',
  KILOS: 'unit_kg',
  LT: 'unit_lt',
  LTS: 'unit_lt',
  LITRO: 'unit_lt',
  LITROS: 'unit_lt',
  CAJA: 'unit_box',
  CAJAS: 'unit_box',
  BULTO: 'unit_bulto',
  BULTOS: 'unit_bulto'
});

export function validateCatalogFile(file) {
  if (!file) return { valid: false, message: 'Selecciona un archivo' };

  const fileName = String(file.name || '').toLowerCase();
  if (!VALID_EXTENSIONS.some(extension => fileName.endsWith(extension))) {
    return {
      valid: false,
      message: 'Formato no válido. Usa .xlsx, .xls o .csv'
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      message: 'El archivo supera el máximo de 8 MB'
    };
  }

  return { valid: true, message: 'Archivo válido' };
}

export async function readCatalogFile(file, xlsx = globalThis.XLSX) {
  const validation = validateCatalogFile(file);
  if (!validation.valid) throw new Error(validation.message);
  if (!xlsx?.read || !xlsx?.utils?.sheet_to_json) {
    throw new Error('El lector Excel no está disponible');
  }

  const buffer = await file.arrayBuffer();
  const workbook = xlsx.read(new Uint8Array(buffer), { type: 'array' });

  if (!workbook.SheetNames?.length) {
    throw new Error('El archivo no contiene hojas');
  }

  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const matrix = xlsx.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false
  });

  return {
    sheetName: firstSheetName,
    fileName: file.name,
    ...parseCatalogMatrix(matrix)
  };
}

export function parseCatalogMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return emptyPreview('El archivo está vacío');
  }

  const firstUsefulRowIndex = matrix.findIndex(row =>
    Array.isArray(row) && row.some(cell => normalizeText(cell))
  );

  if (firstUsefulRowIndex < 0) {
    return emptyPreview('El archivo está vacío');
  }

  const headerRow = matrix[firstUsefulRowIndex];
  const detected = detectHeaders(headerRow);
  const hasRecognizedHeader = detected.name !== undefined;
  const columns = hasRecognizedHeader
    ? detected
    : {
        name: 0,
        minStock: 1,
        maxStock: 2,
        currentStock: 3,
        category: 4
      };

  const startRow = hasRecognizedHeader
    ? firstUsefulRowIndex + 1
    : firstUsefulRowIndex;

  const rows = [];
  const errors = [];
  const warnings = [];

  if (!hasRecognizedHeader) {
    warnings.push(
      'No se reconocieron encabezados. Se asumió el formato clásico: Producto, Mínimo, Máximo, Existencia, Categoría.'
    );
  }

  let ignoredStockRows = 0;

  for (let index = startRow; index < matrix.length; index++) {
    const raw = Array.isArray(matrix[index]) ? matrix[index] : [];
    if (!raw.some(cell => normalizeText(cell))) continue;

    const excelRow = index + 1;
    const name = normalizeText(raw[columns.name]);

    if (!name) {
      errors.push(`Fila ${excelRow}: producto sin nombre`);
      continue;
    }

    const minParsed = parseQuantityCell(raw[columns.minStock]);
    const maxParsed = parseQuantityCell(raw[columns.maxStock]);

    if (minParsed.error) {
      errors.push(`Fila ${excelRow}: mínimo inválido (${minParsed.error})`);
      continue;
    }

    if (maxParsed.error) {
      errors.push(`Fila ${excelRow}: máximo inválido (${maxParsed.error})`);
      continue;
    }

    const minStock = minParsed.value ?? 0;
    const maxStock = maxParsed.value ?? 0;

    if (maxStock > 0 && minStock > maxStock) {
      errors.push(
        `Fila ${excelRow}: mínimo ${minStock} supera máximo ${maxStock}`
      );
      continue;
    }

    const explicitUnit = normalizeUnit(raw[columns.unit]);
    const inferredUnit = explicitUnit ||
      normalizeUnit(minParsed.unit) ||
      normalizeUnit(maxParsed.unit) ||
      detectUnitFromName(name) ||
      'UND';

    const inventoryUnitId = UNIT_IDS[inferredUnit] || 'unit_und';
    if (!UNIT_IDS[inferredUnit]) {
      warnings.push(
        `Fila ${excelRow}: unidad "${inferredUnit}" no reconocida; se usará UND`
      );
    }

    const stockParsed = parseQuantityCell(raw[columns.currentStock]);
    const ignoredStock = stockParsed.error ? null : stockParsed.value;
    if (ignoredStock !== null && ignoredStock !== undefined && columns.currentStock !== undefined) {
      ignoredStockRows++;
    }

    rows.push({
      excelRow,
      name,
      sku: normalizeText(raw[columns.sku]),
      barcode: normalizeText(raw[columns.barcode]),
      categoryName: normalizeText(raw[columns.category]),
      minStock,
      maxStock,
      inventoryUnitId,
      unitCode: UNIT_IDS[inferredUnit] ? inferredUnit : 'UND',
      replenishmentMethod: parseReplenishmentMethod(
        raw[columns.replenishmentMethod]
      ),
      ignoredStock
    });
  }

  if (ignoredStockRows > 0) {
    warnings.unshift(
      `Se detectó existencia en ${ignoredStockRows} fila(s). No se importará como stock: el stock V2 nace de Conteos, Entradas y movimientos trazables.`
    );
  }

  return {
    rows,
    errors,
    warnings: unique(warnings),
    detectedHeaders: columns,
    usedFallbackColumns: !hasRecognizedHeader,
    ignoredStockRows,
    totalRows: rows.length
  };
}

export async function applyCatalogImport(preview) {
  if (!preview?.rows?.length) {
    throw new Error('No hay filas válidas para importar');
  }

  const products = await listProducts({ includeInactive: true });
  const categories = await getAll(STORES.CATEGORIES);

  const bySku = new Map();
  const byBarcode = new Map();
  const byName = new Map();
  const categoryByName = new Map();

  for (const product of products) addProductToIndexes(product, {
    bySku,
    byBarcode,
    byName
  });

  for (const category of categories) {
    categoryByName.set(normalizeSearchText(category.name), category);
  }

  const result = {
    created: 0,
    updated: 0,
    categoriesCreated: 0,
    errors: [],
    warnings: [...(preview.warnings || [])]
  };

  for (const row of preview.rows) {
    try {
      let categoryId = null;
      if (row.categoryName) {
        const key = normalizeSearchText(row.categoryName);
        let category = categoryByName.get(key);

        if (!category) {
          category = await createCategory(row.categoryName);
          categoryByName.set(key, category);
          result.categoriesCreated++;
        }

        categoryId = category.id;
      }

      const existing =
        (row.sku && bySku.get(normalizeSearchText(row.sku))) ||
        (row.barcode && byBarcode.get(normalizeSearchText(row.barcode))) ||
        byName.get(normalizeSearchText(row.name));

      const data = {
        name: row.name,
        sku: row.sku,
        barcode: row.barcode,
        categoryId,
        inventoryUnitId: row.inventoryUnitId,
        purchaseUnitId: row.inventoryUnitId,
        minStock: row.minStock,
        maxStock: row.maxStock,
        replenishmentMethod: row.replenishmentMethod
      };

      let saved;
      if (existing) {
        saved = await updateProduct(existing.id, data);
        result.updated++;
      } else {
        saved = await createProduct(data);
        result.created++;
      }

      addProductToIndexes(saved, { bySku, byBarcode, byName });
    } catch (error) {
      result.errors.push(
        `Fila ${row.excelRow}: ${error?.message || String(error)}`
      );
    }
  }

  return result;
}

function addProductToIndexes(product, indexes) {
  if (product.sku) {
    indexes.bySku.set(normalizeSearchText(product.sku), product);
  }
  if (product.barcode) {
    indexes.byBarcode.set(normalizeSearchText(product.barcode), product);
  }
  indexes.byName.set(normalizeSearchText(product.name), product);
}

function detectHeaders(row) {
  const detected = {};

  row.forEach((cell, index) => {
    const normalized = normalizeSearchText(cell);
    if (!normalized) return;

    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (detected[field] !== undefined) continue;
      if (aliases.some(alias => normalized === alias || normalized.includes(alias))) {
        detected[field] = index;
        break;
      }
    }
  });

  return detected;
}

export function parseQuantityCell(rawValue) {
  if (rawValue === undefined || rawValue === null || normalizeText(rawValue) === '') {
    return { value: 0, unit: '', error: null };
  }

  const text = normalizeText(rawValue).replace(',', '.');
  const match = /^(-?\d+(?:\.\d+)?)\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)?$/.exec(text);

  if (!match) {
    return {
      value: null,
      unit: '',
      error: `"${normalizeText(rawValue)}"`
    };
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) {
    return {
      value: null,
      unit: '',
      error: `"${normalizeText(rawValue)}"`
    };
  }

  return {
    value,
    unit: normalizeUnit(match[2]),
    error: null
  };
}

function normalizeUnit(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized) return '';

  if (['UN', 'UD', 'UND'].includes(normalized)) return 'UND';
  if (['KILOGRAMO', 'KILOGRAMOS'].includes(normalized)) return 'KG';
  if (['L', 'LTS'].includes(normalized)) return 'LT';

  return normalized;
}

function detectUnitFromName(name) {
  const text = ` ${normalizeSearchText(name)} `;

  if (/\b(kg|kilo|kilos|kilogramo|kilogramos)\b/.test(text)) return 'KG';
  if (/\b(lt|lts|litro|litros)\b/.test(text)) return 'LT';
  if (/\b(caja|cajas)\b/.test(text)) return 'CAJA';
  if (/\b(bulto|bultos)\b/.test(text)) return 'BULTO';
  if (/\b(und|unidad|unidades)\b/.test(text)) return 'UND';

  return '';
}

function parseReplenishmentMethod(value) {
  const text = normalizeSearchText(value);

  if (!text) return REPLENISHMENT_METHODS.BOTH;
  if (text.includes('compra') && text.includes('pedido')) {
    return REPLENISHMENT_METHODS.BOTH;
  }
  if (text.includes('compra') || text === 'purchase') {
    return REPLENISHMENT_METHODS.PURCHASE;
  }
  if (text.includes('pedido') || text === 'order') {
    return REPLENISHMENT_METHODS.ORDER;
  }
  if (
    text.includes('ningun') ||
    text.includes('sin reposicion') ||
    text === 'none'
  ) {
    return REPLENISHMENT_METHODS.NONE;
  }

  return REPLENISHMENT_METHODS.BOTH;
}

function emptyPreview(message) {
  return {
    rows: [],
    errors: [message],
    warnings: [],
    detectedHeaders: {},
    usedFallbackColumns: false,
    ignoredStockRows: 0,
    totalRows: 0
  };
}

function unique(values) {
  return [...new Set(values)];
}
