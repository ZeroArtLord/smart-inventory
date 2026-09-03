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
import {
  analyzeCatalogImportConflicts,
  buildCatalogIdentityIndexes,
  indexCatalogProduct,
  replaceCatalogProductInIdentityIndexes,
  resolveCatalogProductIdentity
} from './catalogImportGuard.js';

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
  ],
  use: [
    'usar', 'importar', 'incluir', 'usar producto', 'importar producto'
  ],
  presentation: [
    'presentacion', 'presentacion principal', 'empaque', 'empaque principal',
    'unidad de compra', 'unidad compra'
  ],
  presentationConversion: [
    'unidades por presentacion', 'und por presentacion',
    'unidades por empaque', 'und por empaque',
    'contenido', 'conversion', 'factor'
  ],
  secondaryPresentation: [
    'presentacion secundaria', 'empaque secundario',
    'segunda presentacion', 'segundo empaque'
  ],
  secondaryPresentationConversion: [
    'und presentacion secundaria', 'unidades presentacion secundaria',
    'und empaque secundario', 'unidades empaque secundario',
    'conversion secundaria'
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

export function buildSaintInitialLoadTemplateMatrix() {
  return [
    [
      'USAR',
      'CÓDIGO SAINT',
      'PRODUCTO',
      'EXISTENCIA SAINT',
      'UNIDAD BASE',
      'PRESENTACIÓN',
      'UNIDADES POR PRESENTACIÓN',
      'PRESENTACIÓN SECUNDARIA',
      'UND PRESENTACIÓN SECUNDARIA',
      'MÍNIMO',
      'MÁXIMO',
      'CATEGORÍA',
      'REPOSICIÓN',
      'CÓDIGO DE BARRAS'
    ],
    [
      'SI',
      'REF001',
      'REFRESCO COLA 350 ML',
      '485 UND',
      'UND',
      'CAJA',
      24,
      'BULTO',
      96,
      '5 CAJAS',
      '10 BULTOS',
      'BEBIDAS',
      'COMPRA',
      ''
    ],
    [
      'NO',
      'OLD001',
      'PRODUCTO HISTÓRICO NO USADO',
      0,
      'UND',
      '',
      '',
      '',
      '',
      0,
      0,
      '',
      'NINGUNA',
      ''
    ]
  ];
}

export function downloadSaintInitialLoadTemplate(
  xlsx = globalThis.XLSX
) {
  if (
    !xlsx?.utils?.aoa_to_sheet ||
    !xlsx?.utils?.book_new ||
    !xlsx?.utils?.book_append_sheet ||
    !xlsx?.writeFile
  ) {
    throw new Error('El generador Excel no está disponible');
  }

  const worksheet = xlsx.utils.aoa_to_sheet(
    buildSaintInitialLoadTemplateMatrix()
  );

  worksheet['!cols'] = [
    { wch: 10 },
    { wch: 18 },
    { wch: 34 },
    { wch: 20 },
    { wch: 14 },
    { wch: 18 },
    { wch: 26 },
    { wch: 26 },
    { wch: 28 },
    { wch: 16 },
    { wch: 16 },
    { wch: 20 },
    { wch: 18 },
    { wch: 22 }
  ];

  const workbook = xlsx.utils.book_new();

  xlsx.utils.book_append_sheet(
    workbook,
    worksheet,
    'Carga inicial SAINT'
  );

  const date = new Date().toISOString().slice(0, 10);

  xlsx.writeFile(
    workbook,
    `smart_inventory_carga_inicial_saint_${date}.xlsx`
  );
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
    raw: true
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
  let skippedRows = 0;

  for (let index = startRow; index < matrix.length; index++) {
    const raw = Array.isArray(matrix[index]) ? matrix[index] : [];
    if (!raw.some(cell => normalizeText(cell))) continue;

    const excelRow = index + 1;

    if (
      columns.use !== undefined &&
      !parseUseFlag(raw[columns.use])
    ) {
      skippedRows++;
      continue;
    }

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

    const explicitUnit = normalizeUnit(raw[columns.unit]);
    const presentationResult = parsePresentations(
      raw,
      columns,
      excelRow
    );

    if (presentationResult.error) {
      errors.push(presentationResult.error);
      continue;
    }

    const presentations = presentationResult.presentations;

    const inferredUnit = explicitUnit ||
      inferBaseUnitFromQuantities(
        minParsed,
        maxParsed,
        presentations
      ) ||
      detectUnitFromName(name) ||
      'UND';

    const inventoryUnitId = UNIT_IDS[inferredUnit] || 'unit_und';
    if (!UNIT_IDS[inferredUnit]) {
      warnings.push(
        `Fila ${excelRow}: unidad "${inferredUnit}" no reconocida; se usará UND`
      );
    }

    let minStock;
    let maxStock;

    try {
      minStock = quantityToBaseStock(
        minParsed,
        inferredUnit,
        presentations,
        'mínimo'
      );
      maxStock = quantityToBaseStock(
        maxParsed,
        inferredUnit,
        presentations,
        'máximo'
      );
    } catch (error) {
      errors.push(
        `Fila ${excelRow}: ${error?.message || String(error)}`
      );
      continue;
    }

    if (maxStock > 0 && minStock > maxStock) {
      errors.push(
        `Fila ${excelRow}: mínimo ${minStock} supera máximo ${maxStock}`
      );
      continue;
    }

    const hasStockColumn =
      columns.currentStock !== undefined;
    const rawStock = hasStockColumn
      ? raw[columns.currentStock]
      : undefined;
    const hasExplicitStock =
      hasStockColumn &&
      normalizeText(rawStock) !== '';
    const stockParsed =
      hasExplicitStock
        ? parseQuantityCell(rawStock)
        : {
            value: null,
            unit: '',
            error: null
          };

    let ignoredStock = null;

    if (
      hasExplicitStock &&
      !stockParsed.error
    ) {
      try {
        ignoredStock = quantityToBaseStock(
          stockParsed,
          inferredUnit,
          presentations,
          'existencia'
        );
      } catch (_) {
        ignoredStock = stockParsed.value;
      }
    }

    if (
      hasExplicitStock &&
      ignoredStock !== null &&
      ignoredStock !== undefined
    ) {
      ignoredStockRows++;
    }

    rows.push({
      excelRow,
      name,
      use: true,
      sku: normalizeText(raw[columns.sku]),
      barcode: normalizeText(raw[columns.barcode]),
      categoryName: normalizeText(raw[columns.category]),
      minStock,
      maxStock,
      inventoryUnitId,
      unitCode: UNIT_IDS[inferredUnit] ? inferredUnit : 'UND',
      presentations,
      replenishmentMethod: parseReplenishmentMethod(
        raw[columns.replenishmentMethod]
      ),
      ignoredStock,
      saintInitialStock:
        hasExplicitStock
          ? ignoredStock
          : null
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
    skippedRows,
    hasInitialStockColumn:
      columns.currentStock !== undefined,
    totalRows: rows.length
  };
}

export async function applyCatalogImport(preview) {
  if (!preview?.rows?.length) {
    throw new Error('No hay filas válidas para importar');
  }

  if (preview.errors?.length) {
    throw new Error(
      `Corrige los errores del archivo antes de importar (${preview.errors.length})`
    );
  }

  const products = await listProducts({ includeInactive: true });
  const categories = await getAll(STORES.CATEGORIES);

  const guard = analyzeCatalogImportConflicts(
    preview.rows,
    products
  );

  if (guard.errors.length) {
    const error = new Error(
      `La importación tiene conflictos de identidad (${guard.errors.length})`
    );
    error.code = 'CATALOG_IMPORT_CONFLICT';
    error.details = guard.errors;
    throw error;
  }

  const identityIndexes =
    buildCatalogIdentityIndexes(products);
  const categoryByName = new Map();

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

      const resolution =
        resolveCatalogProductIdentity(
          row,
          identityIndexes
        );

      if (resolution.error) {
        throw new Error(
          resolution.error
        );
      }

      const existing =
        resolution.product;

      const baseData = {
        name: row.name,
        inventoryUnitId: row.inventoryUnitId,
        presentations: row.presentations || [],
        minStock: row.minStock,
        maxStock: row.maxStock
      };

      const hasColumn = field =>
        preview.detectedHeaders?.[field] !== undefined;

      let saved;
      if (existing) {
        const patch = { ...baseData };

        if (hasColumn('sku')) patch.sku = row.sku;
        if (hasColumn('barcode')) patch.barcode = row.barcode;
        if (hasColumn('category')) patch.categoryId = categoryId;
        if (hasColumn('replenishmentMethod')) {
          patch.replenishmentMethod = row.replenishmentMethod;
        }

        saved = await updateProduct(existing.id, patch);
        result.updated++;
      } else {
        saved = await createProduct({
          ...baseData,
          sku: row.sku,
          barcode: row.barcode,
          categoryId,
          replenishmentMethod: row.replenishmentMethod
        });
        result.created++;
      }

      if (existing) {
        replaceCatalogProductInIdentityIndexes(
          identityIndexes,
          existing,
          saved
        );
      } else {
        indexCatalogProduct(
          identityIndexes,
          saved
        );
      }
    } catch (error) {
      result.errors.push(
        `Fila ${row.excelRow}: ${error?.message || String(error)}`
      );
    }
  }

  return result;
}

function detectHeaders(row) {
  const detected = {};

  row.forEach((cell, index) => {
    const normalized = normalizeSearchText(cell);
    if (!normalized) return;

    let bestMatch = null;

    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (detected[field] !== undefined) continue;

      for (const alias of aliases) {
        const exact = normalized === alias;
        const contains = normalized.includes(alias);
        if (!exact && !contains) continue;

        const score = (exact ? 1000 : 0) + alias.length;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { field, score };
        }
      }
    }

    if (bestMatch) detected[bestMatch.field] = index;
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

  if (['UN', 'UD', 'UND', 'UNIDAD', 'UNIDADES'].includes(normalized)) {
    return 'UND';
  }
  if (['KILOGRAMO', 'KILOGRAMOS', 'KILO', 'KILOS'].includes(normalized)) {
    return 'KG';
  }
  if (['L', 'LTS', 'LITRO', 'LITROS'].includes(normalized)) {
    return 'LT';
  }
  if (['CAJA', 'CAJAS'].includes(normalized)) return 'CAJA';
  if (['BULTO', 'BULTOS'].includes(normalized)) return 'BULTO';

  return normalized;
}

function parseUseFlag(value) {
  const text = normalizeSearchText(value);

  if (!text) return true;

  return ![
    'no',
    'n',
    '0',
    'false',
    'falso',
    'omitir',
    'excluir'
  ].includes(text);
}

function parsePresentations(raw, columns, excelRow) {
  const presentations = [];

  const primary = parsePresentationColumns(
    raw,
    columns.presentation,
    columns.presentationConversion,
    {
      id: 'presentation_primary',
      primary: true,
      excelRow,
      label: 'presentación principal'
    }
  );

  if (primary.error) return primary;
  if (primary.presentation) {
    presentations.push(primary.presentation);
  }

  const secondary = parsePresentationColumns(
    raw,
    columns.secondaryPresentation,
    columns.secondaryPresentationConversion,
    {
      id: 'presentation_secondary',
      primary: false,
      excelRow,
      label: 'presentación secundaria'
    }
  );

  if (secondary.error) return secondary;
  if (secondary.presentation) {
    presentations.push(secondary.presentation);
  }

  return { presentations, error: null };
}

function parsePresentationColumns(
  raw,
  codeColumn,
  conversionColumn,
  {
    id,
    primary,
    excelRow,
    label
  }
) {
  const code = codeColumn !== undefined
    ? normalizeUnit(raw[codeColumn])
    : '';

  const rawConversion = conversionColumn !== undefined
    ? raw[conversionColumn]
    : '';

  const hasConversion = normalizeText(rawConversion) !== '';
  const conversion = hasConversion
    ? Number(String(rawConversion).replace(',', '.'))
    : null;

  if (!code && !hasConversion) {
    return { presentation: null, error: null };
  }

  if (!code) {
    return {
      presentation: null,
      error: `Fila ${excelRow}: ${label} sin nombre/código`
    };
  }

  if (!Number.isFinite(conversion) || conversion <= 0) {
    return {
      presentation: null,
      error: `Fila ${excelRow}: conversión inválida para ${label}`
    };
  }

  return {
    presentation: {
      id,
      unitId: UNIT_IDS[code] || null,
      code,
      name: presentationName(code),
      conversion,
      primary,
      active: true
    },
    error: null
  };
}

function inferBaseUnitFromQuantities(
  minParsed,
  maxParsed,
  presentations
) {
  const presentationCodes = new Set(
    (presentations || [])
      .map(item => normalizeUnit(item.code))
      .filter(Boolean)
  );

  for (const parsed of [minParsed, maxParsed]) {
    const unit = normalizeUnit(parsed?.unit);
    if (unit && !presentationCodes.has(unit)) {
      return unit;
    }
  }

  return '';
}

function quantityToBaseStock(
  parsed,
  baseUnitCode,
  presentations,
  label
) {
  const value = Number(parsed?.value ?? 0);
  const unit = normalizeUnit(parsed?.unit);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} inválido`);
  }

  if (!unit || unit === baseUnitCode) {
    return value;
  }

  const presentation = (presentations || []).find(
    item => normalizeUnit(item.code) === unit
  );

  if (!presentation) {
    throw new Error(
      `${label} usa unidad "${unit}" sin conversión configurada`
    );
  }

  return value * Number(presentation.conversion);
}

function presentationName(code) {
  const text = normalizeText(code).toLowerCase();
  return text
    ? text.charAt(0).toUpperCase() + text.slice(1)
    : '';
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
    skippedRows: 0,
    hasInitialStockColumn: false,
    totalRows: 0
  };
}

function unique(values) {
  return [...new Set(values)];
}
