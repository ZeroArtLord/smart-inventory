import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProductPayloadFromEditor,
  catalogEditorDefaults,
  catalogPresentationSummary,
  catalogQuantityDisplay,
  editorStockToBase,
  renderCatalogProductEditor
} from '../src/catalog/catalogUi.js';

test('convierte mínimos y máximos desde empaques del editor', () => {
  const payload = buildProductPayloadFromEditor({
    name: 'REFRESCO COLA',
    sku: 'REF001',
    barcode: '',
    categoryId: 'cat_bebidas',
    inventoryUnitId: 'unit_und',
    primaryPresentationCode: 'CAJA',
    primaryPresentationConversion: '24',
    secondaryPresentationCode: 'BULTO',
    secondaryPresentationConversion: '96',
    minStockValue: '5',
    minStockUnit: 'PRIMARY',
    maxStockValue: '10',
    maxStockUnit: 'SECONDARY',
    replenishmentMethod: 'PURCHASE'
  });

  assert.equal(payload.categoryId, 'cat_bebidas');
  assert.equal(payload.minStock, 120);
  assert.equal(payload.maxStock, 960);
  assert.equal(payload.presentations.length, 2);
  assert.equal(payload.presentations[0].code, 'CAJA');
  assert.equal(payload.presentations[0].conversion, 24);
  assert.equal(payload.presentations[0].primary, true);
  assert.equal(payload.presentations[1].code, 'BULTO');
  assert.equal(payload.presentations[1].conversion, 96);
});

test('el editor acepta expresiones matemáticas en conversiones y cantidades', () => {
  const payload = buildProductPayloadFromEditor({
    name: 'PRODUCTO',
    inventoryUnitId: 'unit_und',
    primaryPresentationCode: 'CAJA',
    primaryPresentationConversion: '12*2',
    secondaryPresentationCode: '',
    secondaryPresentationConversion: '',
    minStockValue: '2+3',
    minStockUnit: 'PRIMARY',
    maxStockValue: '20',
    maxStockUnit: 'PRIMARY',
    replenishmentMethod: 'BOTH'
  });

  assert.equal(payload.presentations[0].conversion, 24);
  assert.equal(payload.minStock, 120);
  assert.equal(payload.maxStock, 480);
});

test('rechaza usar empaque secundario si no está configurado', () => {
  assert.throws(
    () => editorStockToBase(
      '5',
      'SECONDARY',
      [
        {
          id: 'presentation_primary',
          code: 'CAJA',
          conversion: 24,
          primary: true
        }
      ]
    ),
    /presentación secundaria/i
  );
});

test('muestra stock base y equivalencia humana', () => {
  const product = {
    inventoryUnitId: 'unit_und',
    presentations: [
      {
        id: 'presentation_primary',
        code: 'CAJA',
        conversion: 24,
        primary: true,
        active: true
      }
    ]
  };

  const display = catalogQuantityDisplay(product, 485);

  assert.equal(display.baseText, '485 UND');
  assert.match(display.humanText, /20 CAJAS \+ 5 UND/);
  assert.match(catalogPresentationSummary(product), /CAJA = 24 UND/);
});

test('al editar usa empaques cuando min/max equivalen a paquetes enteros', () => {
  const defaults = catalogEditorDefaults({
    id: 'prd_1',
    name: 'REFRESCO',
    inventoryUnitId: 'unit_und',
    presentations: [
      {
        id: 'presentation_primary',
        code: 'CAJA',
        conversion: 24,
        primary: true,
        active: true
      }
    ],
    minStock: 120,
    maxStock: 485,
    replenishmentMethod: 'BOTH'
  });

  assert.equal(defaults.minValue, 5);
  assert.equal(defaults.minUnit, 'PRIMARY');
  assert.equal(defaults.maxValue, 485);
  assert.equal(defaults.maxUnit, 'BASE');
});


test('defaults del editor conservan la categoría del producto', () => {
  const defaults = catalogEditorDefaults({
    id: 'prd_cat',
    name: 'PRODUCTO',
    categoryId: 'cat_1',
    inventoryUnitId: 'unit_und',
    minStock: 0,
    maxStock: 0,
    replenishmentMethod: 'BOTH'
  });

  assert.equal(defaults.categoryId, 'cat_1');
});


test('editor visual bloquea selector de unidad base cuando existe historial', () => {
  const html = renderCatalogProductEditor(
    {
      id: 'prd_locked',
      name: 'PRODUCTO CON HISTORIAL',
      inventoryUnitId: 'unit_und',
      minStock: 0,
      maxStock: 0,
      replenishmentMethod: 'BOTH'
    },
    [],
    {
      baseUnitLocked: true
    }
  );

  assert.match(
    html,
    /name="inventoryUnitId"[\s\S]*disabled/
  );
  assert.match(
    html,
    /Unidad base bloqueada/i
  );
});
