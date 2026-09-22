import { normalizeText } from '../core/catalog.js';

export const MAX_BARCODES_PER_PRODUCT = 32;

export function normalizeBarcodeCode(value) {
  return String(value ?? '').trim();
}

export function barcodeKey(value) {
  return normalizeBarcodeCode(value).toLocaleLowerCase('es');
}

export function normalizeProductBarcodes(
  barcodes = [],
  { legacyBarcode = '' } = {}
) {
  if (
    barcodes !== undefined &&
    barcodes !== null &&
    !Array.isArray(barcodes)
  ) {
    throw new Error('Los códigos de barras deben ser una lista');
  }

  const source = Array.isArray(barcodes)
    ? barcodes
    : [];

  if (source.length > MAX_BARCODES_PER_PRODUCT) {
    throw new Error(
      `Un producto no puede tener más de ${MAX_BARCODES_PER_PRODUCT} códigos de barras`
    );
  }

  const normalized = [];
  const seen = new Set();

  for (const raw of source) {
    const item = typeof raw === 'string'
      ? { code: raw }
      : (raw || {});

    const code = normalizeBarcodeCode(item.code);
    if (!code) {
      throw new Error('Cada código de barras requiere un código');
    }

    const key = barcodeKey(code);
    if (seen.has(key)) {
      throw new Error(`Código de barras duplicado: ${code}`);
    }

    const conversion = Number(item.conversion ?? 1);
    if (!Number.isFinite(conversion) || conversion <= 0) {
      throw new Error(
        `La conversión del código ${code} debe ser mayor que cero`
      );
    }

    seen.add(key);
    normalized.push({
      code,
      label: normalizeText(item.label || item.name || code) || code,
      conversion,
      active: item.active !== false
    });
  }

  const legacy = normalizeBarcodeCode(legacyBarcode);
  if (legacy) {
    const key = barcodeKey(legacy);

    if (!seen.has(key)) {
      normalized.unshift({
        code: legacy,
        label: 'Código principal',
        conversion: 1,
        active: true
      });
    }
  }

  return normalized;
}

export function addProductBarcode(product = {}, mapping = {}) {
  const current = normalizeProductBarcodes(
    product.barcodes,
    { legacyBarcode: product.barcode }
  );

  return normalizeProductBarcodes([
    ...current,
    mapping
  ]);
}

export function barcodeSearchTerms(product = {}) {
  return normalizeProductBarcodes(
    product.barcodes,
    { legacyBarcode: product.barcode }
  )
    .flatMap(item => [item.code, item.label])
    .filter(Boolean);
}
