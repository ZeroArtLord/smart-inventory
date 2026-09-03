import { evaluateNumericExpression } from '../core/mathExpression.js';
import { REPLENISHMENT_METHODS } from '../core/catalog.js';
import {
  getPrimaryPresentation,
  normalizePresentations,
  presentationDisplay,
  quantityToBase
} from './presentationModel.js';

const BASE_UNITS = Object.freeze([
  { id: 'unit_und', code: 'UND', label: 'Unidad (UND)' },
  { id: 'unit_kg', code: 'KG', label: 'Kilogramo (KG)' },
  { id: 'unit_lt', code: 'LT', label: 'Litro (LT)' }
]);

const UNIT_CODE_BY_ID = Object.freeze(
  Object.fromEntries(BASE_UNITS.map(item => [item.id, item.code]))
);

export function catalogUnitCode(product = {}) {
  return UNIT_CODE_BY_ID[product.inventoryUnitId] || 'UND';
}

export function catalogPresentations(product = {}) {
  return normalizePresentations(
    product.presentations,
    {
      inventoryUnitId: product.inventoryUnitId,
      purchaseUnitId: product.purchaseUnitId,
      purchaseConversion: product.purchaseConversion
    }
  );
}

export function catalogQuantityDisplay(product, baseQuantity) {
  const baseCode = catalogUnitCode(product);
  const primary = getPrimaryPresentation(product);
  const baseText = `${formatNumber(baseQuantity)} ${baseCode}`;

  if (!primary) {
    return {
      baseText,
      humanText: '',
      presentation: null
    };
  }

  const human = presentationDisplay(
    Number(baseQuantity || 0),
    primary,
    {
      baseCode,
      includeBaseTotal: false
    }
  );

  return {
    baseText,
    humanText: human.text,
    presentation: primary
  };
}

export function catalogPresentationSummary(product = {}) {
  const baseCode = catalogUnitCode(product);
  const presentations = catalogPresentations(product);

  if (!presentations.length) {
    return `Unidad base: ${baseCode}`;
  }

  return presentations
    .map(item =>
      `${item.primary ? '★ ' : ''}${item.code} = ${formatNumber(item.conversion)} ${baseCode}`
    )
    .join(' · ');
}

export function buildProductPayloadFromEditor(
  source,
  existingProduct = null
) {
  const inventoryUnitId =
    clean(field(source, 'inventoryUnitId')) ||
    existingProduct?.inventoryUnitId ||
    'unit_und';

  const presentations = buildPresentationsFromEditor(source);
  const minStock = editorStockToBase(
    field(source, 'minStockValue'),
    field(source, 'minStockUnit'),
    presentations
  );
  const maxStock = editorStockToBase(
    field(source, 'maxStockValue'),
    field(source, 'maxStockUnit'),
    presentations
  );

  if (maxStock > 0 && minStock > maxStock) {
    throw new Error('El mínimo no puede superar el máximo');
  }

  return {
    name: field(source, 'name'),
    sku: field(source, 'sku'),
    barcode: field(source, 'barcode'),
    inventoryUnitId,
    presentations,
    minStock,
    maxStock,
    replenishmentMethod:
      clean(field(source, 'replenishmentMethod')) ||
      REPLENISHMENT_METHODS.BOTH
  };
}

export function buildPresentationsFromEditor(source) {
  const presentations = [];

  const primary = readPresentation(source, {
    codeField: 'primaryPresentationCode',
    conversionField: 'primaryPresentationConversion',
    id: 'presentation_primary',
    primary: true,
    label: 'presentación principal'
  });

  if (primary) presentations.push(primary);

  const secondary = readPresentation(source, {
    codeField: 'secondaryPresentationCode',
    conversionField: 'secondaryPresentationConversion',
    id: 'presentation_secondary',
    primary: false,
    label: 'presentación secundaria'
  });

  if (secondary) presentations.push(secondary);

  return presentations;
}

export function editorStockToBase(
  rawValue,
  mode,
  presentations = []
) {
  const value = evaluateNumericExpression(
    clean(rawValue) || '0'
  );

  const normalizedMode = clean(mode).toUpperCase() || 'BASE';

  if (normalizedMode === 'BASE') return value;

  const target = normalizedMode === 'PRIMARY'
    ? presentations.find(item => item.primary)
    : presentations.find(item => !item.primary);

  if (!target) {
    throw new Error(
      normalizedMode === 'PRIMARY'
        ? 'Configura la presentación principal antes de usarla en mínimo/máximo'
        : 'Configura la presentación secundaria antes de usarla en mínimo/máximo'
    );
  }

  return quantityToBase(value, target);
}

export function catalogEditorDefaults(product = null) {
  if (!product) {
    return {
      productId: '',
      name: '',
      sku: '',
      barcode: '',
      inventoryUnitId: 'unit_und',
      primaryCode: '',
      primaryConversion: '',
      secondaryCode: '',
      secondaryConversion: '',
      minValue: 0,
      minUnit: 'BASE',
      maxValue: 0,
      maxUnit: 'BASE',
      replenishmentMethod: REPLENISHMENT_METHODS.BOTH
    };
  }

  const presentations = catalogPresentations(product);
  const primary =
    presentations.find(item => item.primary) ||
    presentations[0] ||
    null;
  const secondary =
    presentations.find(item => !item.primary) ||
    null;

  const min = preferredEditorQuantity(
    Number(product.minStock || 0),
    primary,
    secondary
  );
  const max = preferredEditorQuantity(
    Number(product.maxStock || 0),
    primary,
    secondary
  );

  return {
    productId: product.id || '',
    name: product.name || '',
    sku: product.sku || '',
    barcode: product.barcode || '',
    inventoryUnitId: product.inventoryUnitId || 'unit_und',
    primaryCode: primary?.code || '',
    primaryConversion: primary?.conversion ?? '',
    secondaryCode: secondary?.code || '',
    secondaryConversion: secondary?.conversion ?? '',
    minValue: min.value,
    minUnit: min.unit,
    maxValue: max.value,
    maxUnit: max.unit,
    replenishmentMethod:
      product.replenishmentMethod ||
      REPLENISHMENT_METHODS.BOTH
  };
}

export function renderCatalogProductEditor(product = null) {
  const value = catalogEditorDefaults(product);
  const editing = Boolean(value.productId);

  return `
    <form id="productForm" class="card stack catalog-create-card catalog-editor-card">
      <div class="section-head">
        <div>
          <h3>${editing ? '✎ Editar producto' : '＋ Nuevo producto'}</h3>
          <p>${editing
            ? 'Actualiza datos y empaques sin tocar la existencia.'
            : 'Alta al catálogo con unidad base y empaques opcionales.'}</p>
        </div>
        ${editing
          ? '<button class="secondary" data-action="cancel-product-edit" type="button">Cancelar</button>'
          : ''}
      </div>

      <input name="productId" type="hidden" value="${escapeHtml(value.productId)}">

      <label>
        Nombre
        <input
          name="name"
          autocomplete="off"
          required
          placeholder="Ej. REFRESCO COLA 350 ML"
          value="${escapeHtml(value.name)}"
        >
      </label>

      <div class="form-pair-v2">
        <label>
          Código SAINT / SKU
          <input name="sku" autocomplete="off" value="${escapeHtml(value.sku)}">
        </label>
        <label>
          Código de barras
          <input
            name="barcode"
            inputmode="numeric"
            autocomplete="off"
            value="${escapeHtml(value.barcode)}"
          >
        </label>
      </div>

      <label>
        Unidad base
        <select name="inventoryUnitId">
          ${BASE_UNITS.map(unit => `
            <option
              value="${unit.id}"
              ${unit.id === value.inventoryUnitId ? 'selected' : ''}
            >${unit.label}</option>
          `).join('')}
        </select>
        <small class="product-meta">
          Stock, movimientos y cálculos internos siempre usan esta unidad.
        </small>
      </label>

      <div class="catalog-editor-section">
        <div class="catalog-editor-section-head">
          <strong>Presentación principal</strong>
          <small>Ej. 1 CAJA = 24 UND</small>
        </div>

        <div class="form-pair-v2">
          <label>
            Nombre / código
            <input
              name="primaryPresentationCode"
              autocomplete="off"
              placeholder="CAJA"
              value="${escapeHtml(value.primaryCode)}"
            >
          </label>
          <label>
            Unidades base por empaque
            <input
              name="primaryPresentationConversion"
              inputmode="decimal"
              placeholder="24"
              value="${escapeHtml(value.primaryConversion)}"
            >
          </label>
        </div>
      </div>

      <div class="catalog-editor-section">
        <div class="catalog-editor-section-head">
          <strong>Presentación secundaria</strong>
          <small>Opcional · Ej. 1 BULTO = 96 UND</small>
        </div>

        <div class="form-pair-v2">
          <label>
            Nombre / código
            <input
              name="secondaryPresentationCode"
              autocomplete="off"
              placeholder="BULTO"
              value="${escapeHtml(value.secondaryCode)}"
            >
          </label>
          <label>
            Unidades base por empaque
            <input
              name="secondaryPresentationConversion"
              inputmode="decimal"
              placeholder="96"
              value="${escapeHtml(value.secondaryConversion)}"
            >
          </label>
        </div>
      </div>

      <div class="form-pair-v2 catalog-stock-editor-pair">
        ${renderStockEditor(
          'Mínimo',
          'minStock',
          value.minValue,
          value.minUnit
        )}
        ${renderStockEditor(
          'Máximo',
          'maxStock',
          value.maxValue,
          value.maxUnit
        )}
      </div>

      <label>
        Reposición
        <select name="replenishmentMethod">
          ${option(
            REPLENISHMENT_METHODS.BOTH,
            'Compra o pedido',
            value.replenishmentMethod
          )}
          ${option(
            REPLENISHMENT_METHODS.PURCHASE,
            'Compra',
            value.replenishmentMethod
          )}
          ${option(
            REPLENISHMENT_METHODS.ORDER,
            'Pedido',
            value.replenishmentMethod
          )}
          ${option(
            REPLENISHMENT_METHODS.NONE,
            'Sin reposición automática',
            value.replenishmentMethod
          )}
        </select>
      </label>

      <div class="catalog-safety-note">
        <strong>Existencia bloqueada.</strong>
        Editar este formulario nunca modifica stock.
      </div>

      <button class="primary" type="submit">
        ${editing ? 'Guardar cambios' : 'Agregar producto'}
      </button>
    </form>
  `;
}

function renderStockEditor(
  label,
  prefix,
  value,
  selectedUnit
) {
  return `
    <div class="catalog-stock-editor">
      <label>
        ${label}
        <input
          name="${prefix}Value"
          value="${escapeHtml(value)}"
          inputmode="decimal"
        >
      </label>
      <label>
        Medir en
        <select name="${prefix}Unit">
          <option value="BASE" ${selectedUnit === 'BASE' ? 'selected' : ''}>
            Unidad base
          </option>
          <option value="PRIMARY" ${selectedUnit === 'PRIMARY' ? 'selected' : ''}>
            Empaque principal
          </option>
          <option value="SECONDARY" ${selectedUnit === 'SECONDARY' ? 'selected' : ''}>
            Empaque secundario
          </option>
        </select>
      </label>
    </div>
  `;
}

function readPresentation(
  source,
  {
    codeField,
    conversionField,
    id,
    primary,
    label
  }
) {
  const code = clean(field(source, codeField)).toUpperCase();
  const rawConversion = clean(field(source, conversionField));

  if (!code && !rawConversion) return null;

  if (!code) {
    throw new Error(`La ${label} requiere nombre/código`);
  }

  if (!rawConversion) {
    throw new Error(`La ${label} requiere conversión`);
  }

  const conversion = evaluateNumericExpression(rawConversion);

  if (!(conversion > 0)) {
    throw new Error(`La conversión de ${label} debe ser mayor que cero`);
  }

  return {
    id,
    unitId: knownPresentationUnitId(code),
    code,
    name: titleCase(code),
    conversion,
    primary,
    active: true
  };
}

function preferredEditorQuantity(
  baseValue,
  primary,
  secondary
) {
  if (!(baseValue > 0)) {
    return {
      value: baseValue || 0,
      unit: 'BASE'
    };
  }

  for (const [unit, presentation] of [
    ['PRIMARY', primary],
    ['SECONDARY', secondary]
  ]) {
    if (!presentation) continue;

    const converted =
      baseValue / Number(presentation.conversion);

    if (Math.abs(converted - Math.round(converted)) < 0.000001) {
      return {
        value: Math.round(converted),
        unit
      };
    }
  }

  return {
    value: baseValue,
    unit: 'BASE'
  };
}

function knownPresentationUnitId(code) {
  switch (clean(code).toUpperCase()) {
    case 'CAJA':
      return 'unit_box';
    case 'BULTO':
      return 'unit_bulto';
    case 'UND':
      return 'unit_und';
    case 'KG':
      return 'unit_kg';
    case 'LT':
      return 'unit_lt';
    default:
      return null;
  }
}

function option(value, label, selectedValue) {
  return `
    <option
      value="${value}"
      ${value === selectedValue ? 'selected' : ''}
    >${label}</option>
  `;
}

function field(source, name) {
  if (typeof source?.get === 'function') {
    return source.get(name);
  }

  return source?.[name];
}

function clean(value) {
  return String(value ?? '').trim();
}

function titleCase(value) {
  const text = clean(value).toLowerCase();
  return text
    ? text.charAt(0).toUpperCase() + text.slice(1)
    : '';
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';

  return new Intl.NumberFormat('es-VE', {
    maximumFractionDigits: 6
  }).format(number);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
