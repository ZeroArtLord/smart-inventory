export const REPLENISHMENT_METHODS = Object.freeze({
  PURCHASE: 'PURCHASE',
  ORDER: 'ORDER',
  BOTH: 'BOTH',
  NONE: 'NONE'
});

export const INTELLIGENCE_MODES = Object.freeze({
  SEED: 'SEED',
  ADAPTIVE: 'ADAPTIVE',
  HARD_LIMIT: 'HARD_LIMIT'
});

export const DEFAULT_INTELLIGENCE_POLICY = Object.freeze({
  mode: INTELLIGENCE_MODES.SEED,
  targetDays: 7,
  safetyDays: 0
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

export function assertPositiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${fieldName} debe ser un número mayor que cero`);
  }
  return number;
}

export function normalizeIntelligenceMode(value) {
  const source = String(
    value ?? DEFAULT_INTELLIGENCE_POLICY.mode
  )
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

  const mode = source || DEFAULT_INTELLIGENCE_POLICY.mode;

  if (!Object.values(INTELLIGENCE_MODES).includes(mode)) {
    throw new Error('Modo de inteligencia inválido');
  }

  return mode;
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
