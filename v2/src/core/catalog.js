export const REPLENISHMENT_METHODS = Object.freeze({
  PURCHASE: 'PURCHASE',
  ORDER: 'ORDER',
  BOTH: 'BOTH',
  NONE: 'NONE'
});

export const DEFAULT_UNITS = Object.freeze([
  { id: 'unit_und', code: 'UND', name: 'Unidad', decimals: 0 },
  { id: 'unit_kg', code: 'KG', name: 'Kilogramo', decimals: 3 },
  { id: 'unit_lt', code: 'LT', name: 'Litro', decimals: 3 },
  { id: 'unit_box', code: 'CAJA', name: 'Caja', decimals: 0 },
  { id: 'unit_bulto', code: 'BULTO', name: 'Bulto', decimals: 0 }
]);

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeSearchText(value) {
  return normalizeText(value).toLowerCase();
}

export function assertNonNegativeNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${fieldName} debe ser un número mayor o igual a cero`);
  }
  return number;
}


export function buildSmartSkuFromSaintCode(
  saintCode
) {
  const source = normalizeText(
    saintCode
  ).toUpperCase();

  if (!source) return '';

  const safe = source
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return safe
    ? `SM-${safe}`
    : '';
}
