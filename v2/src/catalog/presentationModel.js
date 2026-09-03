import {
  normalizeSearchText,
  normalizeText
} from '../core/catalog.js';

const KNOWN_UNIT_CODES = Object.freeze({
  unit_und: 'UND',
  unit_kg: 'KG',
  unit_lt: 'LT',
  unit_box: 'CAJA',
  unit_bulto: 'BULTO'
});

const UNIT_IDS_BY_CODE = Object.freeze(
  Object.fromEntries(
    Object.entries(KNOWN_UNIT_CODES)
      .map(([id, code]) => [code, id])
  )
);

export const MAX_PRESENTATIONS_PER_PRODUCT = 8;

export function normalizePresentations(
  presentations = [],
  {
    inventoryUnitId = 'unit_und',
    purchaseUnitId = null,
    purchaseConversion = 1
  } = {}
) {
  if (
    presentations !== undefined &&
    presentations !== null &&
    !Array.isArray(presentations)
  ) {
    throw new Error(
      'Las presentaciones deben ser una lista'
    );
  }

  const source = Array.isArray(presentations)
    ? presentations
    : [];

  if (
    source.length >
    MAX_PRESENTATIONS_PER_PRODUCT
  ) {
    throw new Error(
      `Un producto no puede tener más de ${MAX_PRESENTATIONS_PER_PRODUCT} presentaciones`
    );
  }

  const normalized = [];
  const seen = new Set();

  source.forEach((item, index) => {
      const presentation = normalizePresentation(item, index);

      if (!presentation || presentation.active === false) return;

      const key =
        normalizeSearchText(
          presentation.code ||
          presentation.name ||
          presentation.unitId
        );

      if (seen.has(key)) {
        throw new Error(
          `Presentación duplicada: ${presentation.code || presentation.name}`
        );
      }

      seen.add(key);
      normalized.push(presentation);
    });

  if (normalized.length === 0) {
    const legacy = presentationFromLegacy({
      inventoryUnitId,
      purchaseUnitId,
      purchaseConversion
    });

    if (legacy) normalized.push(legacy);
  }

  let primaryAssigned = false;

  return normalized.map((item, index) => {
    const wantsPrimary = item.primary === true;

    if (!primaryAssigned && (wantsPrimary || index === 0)) {
      primaryAssigned = true;
      return {
        ...item,
        primary: true
      };
    }

    return {
      ...item,
      primary: false
    };
  });
}

export function normalizePresentation(item = {}, index = 0) {
  const conversion = Number(
    item.conversion ??
    item.unitsPerPresentation ??
    item.factor
  );

  if (!Number.isFinite(conversion) || conversion <= 0) {
    throw new Error('La conversión de presentación debe ser mayor que cero');
  }

  let code = normalizeText(
    item.code ??
    item.unitCode ??
    item.label ??
    item.name
  ).toUpperCase();

  let unitId = normalizeText(
    item.unitId ??
    item.purchaseUnitId
  );

  if (!unitId && code) {
    unitId = UNIT_IDS_BY_CODE[code] || '';
  }

  if (!code && unitId) {
    code = KNOWN_UNIT_CODES[unitId] || '';
  }

  if (!code && !unitId) {
    throw new Error('La presentación requiere nombre/código o unidad');
  }

  const name = normalizeText(item.name || item.label || code) || code;

  return {
    id: normalizeText(item.id) || `presentation_${index + 1}`,
    unitId: unitId || null,
    code: code || name.toUpperCase(),
    name,
    conversion,
    primary: item.primary === true,
    active: item.active !== false
  };
}

export function getPrimaryPresentation(product = {}) {
  const presentations = normalizePresentations(
    product.presentations,
    {
      inventoryUnitId: product.inventoryUnitId,
      purchaseUnitId: product.purchaseUnitId,
      purchaseConversion: product.purchaseConversion
    }
  );

  return presentations.find(item => item.primary) || presentations[0] || null;
}

export function deriveLegacyPurchaseFields(
  presentations = [],
  inventoryUnitId = 'unit_und'
) {
  const normalized = normalizePresentations(
    presentations,
    { inventoryUnitId }
  );

  const primary = normalized.find(item => item.primary) || normalized[0];

  if (!primary) {
    return {
      purchaseUnitId: inventoryUnitId,
      purchaseConversion: 1
    };
  }

  return {
    purchaseUnitId: primary.unitId || inventoryUnitId,
    purchaseConversion: primary.conversion
  };
}

export function quantityToBase(quantity, presentation) {
  const value = finiteNonNegative(quantity, 'Cantidad');
  const factor = presentationFactor(presentation);
  return value * factor;
}

export function quantityFromBase(quantity, presentation) {
  const value = finiteNonNegative(quantity, 'Cantidad base');
  const factor = presentationFactor(presentation);
  return value / factor;
}

export function decomposeBaseQuantity(
  baseQuantity,
  presentation,
  { precision = 6 } = {}
) {
  const value = finiteNonNegative(baseQuantity, 'Cantidad base');
  const factor = presentationFactor(presentation);

  const whole = Math.floor((value + Number.EPSILON) / factor);
  const remainder = roundTo(
    value - (whole * factor),
    precision
  );

  return {
    whole,
    remainder: Math.abs(remainder) < (10 ** -precision)
      ? 0
      : remainder,
    factor
  };
}

export function presentationDisplay(
  baseQuantity,
  presentation,
  {
    baseCode = 'UND',
    includeBaseTotal = true,
    precision = 6
  } = {}
) {
  if (!presentation) {
    return {
      baseQuantity: finiteNonNegative(baseQuantity, 'Cantidad base'),
      baseCode,
      whole: 0,
      remainder: finiteNonNegative(baseQuantity, 'Cantidad base'),
      presentationCode: null,
      text: `${formatNumber(baseQuantity)} ${baseCode}`
    };
  }

  const parts = decomposeBaseQuantity(
    baseQuantity,
    presentation,
    { precision }
  );

  const presentationCode =
    normalizeText(presentation.code || presentation.name) || 'PRESENTACIÓN';

  const presentationLabel =
    pluralizePresentationCode(
      presentationCode,
      parts.whole
    );

  const human = parts.remainder > 0
    ? `${formatNumber(parts.whole)} ${presentationLabel} + ${formatNumber(parts.remainder)} ${baseCode}`
    : `${formatNumber(parts.whole)} ${presentationLabel}`;

  return {
    baseQuantity: Number(baseQuantity),
    baseCode,
    whole: parts.whole,
    remainder: parts.remainder,
    presentationCode,
    text: includeBaseTotal
      ? `${formatNumber(baseQuantity)} ${baseCode} · ${human}`
      : human
  };
}

function presentationFromLegacy({
  inventoryUnitId,
  purchaseUnitId,
  purchaseConversion
}) {
  const factor = Number(purchaseConversion ?? 1);

  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error('Conversión de compra inválida');
  }

  const unitId = purchaseUnitId || inventoryUnitId;

  if (
    unitId === inventoryUnitId &&
    Math.abs(factor - 1) < 0.0000001
  ) {
    return null;
  }

  const code = KNOWN_UNIT_CODES[unitId] || 'EMPAQUE';

  return {
    id: 'presentation_primary',
    unitId,
    code,
    name: titleCase(code),
    conversion: factor,
    primary: true,
    active: true
  };
}

function presentationFactor(presentation) {
  const factor = Number(
    presentation?.conversion ??
    presentation?.unitsPerPresentation ??
    presentation?.factor
  );

  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error('Conversión de presentación inválida');
  }

  return factor;
}

function finiteNonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} debe ser un número mayor o igual a cero`);
  }
  return number;
}

function roundTo(value, precision) {
  const safePrecision = Math.min(
    12,
    Math.max(0, Number(precision) || 0)
  );
  const factor = 10 ** safePrecision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';

  return new Intl.NumberFormat('es-VE', {
    maximumFractionDigits: 6
  }).format(number);
}

function pluralizePresentationCode(
  code,
  count
) {
  const value =
    normalizeText(code).toUpperCase();

  if (Number(count) === 1) {
    return value;
  }

  if (
    value.endsWith('S') ||
    value.endsWith('X')
  ) {
    return value;
  }

  if (/[AEIOUÁÉÍÓÚ]$/.test(value)) {
    return value + 'S';
  }

  return value + 'ES';
}

function titleCase(value) {
  const text = normalizeText(value).toLowerCase();
  return text
    ? text.charAt(0).toUpperCase() + text.slice(1)
    : '';
}
