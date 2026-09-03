import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePresentations,
  getPrimaryPresentation,
  deriveLegacyPurchaseFields,
  quantityToBase,
  quantityFromBase,
  decomposeBaseQuantity,
  presentationDisplay
} from '../src/catalog/presentationModel.js';

test('normaliza una presentación principal y conserva compatibilidad legacy', () => {
  const presentations = normalizePresentations([
    {
      unitId: 'unit_box',
      code: 'CAJA',
      name: 'Caja',
      conversion: 24,
      primary: true
    }
  ], {
    inventoryUnitId: 'unit_und'
  });

  assert.equal(presentations.length, 1);
  assert.equal(presentations[0].code, 'CAJA');
  assert.equal(presentations[0].conversion, 24);
  assert.equal(presentations[0].primary, true);

  assert.deepEqual(
    deriveLegacyPurchaseFields(presentations, 'unit_und'),
    {
      purchaseUnitId: 'unit_box',
      purchaseConversion: 24
    }
  );
});

test('admite múltiples presentaciones pero deja una sola principal', () => {
  const presentations = normalizePresentations([
    {
      id: 'box',
      code: 'CAJA',
      unitId: 'unit_box',
      conversion: 24,
      primary: true
    },
    {
      id: 'bundle',
      code: 'BULTO',
      unitId: 'unit_bulto',
      conversion: 96,
      primary: true
    }
  ]);

  assert.equal(presentations.length, 2);
  assert.equal(
    presentations.filter(item => item.primary).length,
    1
  );
  assert.equal(presentations[0].primary, true);
  assert.equal(presentations[1].primary, false);
});

test('recupera presentación legacy desde purchaseUnitId/purchaseConversion', () => {
  const product = {
    inventoryUnitId: 'unit_und',
    purchaseUnitId: 'unit_box',
    purchaseConversion: 24
  };

  const primary = getPrimaryPresentation(product);

  assert.ok(primary);
  assert.equal(primary.code, 'CAJA');
  assert.equal(primary.conversion, 24);
});

test('convierte siempre contra la unidad base sin perder precisión', () => {
  const box = {
    code: 'CAJA',
    conversion: 24
  };

  assert.equal(quantityToBase(5, box), 120);
  assert.equal(quantityFromBase(120, box), 5);

  assert.deepEqual(
    decomposeBaseQuantity(485, box),
    {
      whole: 20,
      remainder: 5,
      factor: 24
    }
  );
});

test('formatea stock humano manteniendo el total base', () => {
  const display = presentationDisplay(
    485,
    {
      code: 'CAJA',
      conversion: 24
    },
    {
      baseCode: 'UND'
    }
  );

  assert.equal(display.whole, 20);
  assert.equal(display.remainder, 5);
  assert.match(display.text, /485 UND/);
  assert.match(display.text, /20 CAJAS \+ 5 UND/);
});

test('rechaza conversiones inválidas', () => {
  assert.throws(
    () => normalizePresentations([
      {
        code: 'CAJA',
        conversion: 0
      }
    ]),
    /mayor que cero/
  );
});


test('rechaza dos presentaciones con el mismo código aunque tengan distinta conversión', () => {
  assert.throws(
    () => normalizePresentations([
      {
        code: 'CAJA',
        conversion: 24,
        primary: true
      },
      {
        code: 'CAJA',
        conversion: 36,
        primary: false
      }
    ]),
    /Presentación duplicada/i
  );
});


test('rechaza más de ocho presentaciones en vez de truncarlas silenciosamente', () => {
  const presentations = Array.from(
    { length: 9 },
    (_, index) => ({
      code: `PACK${index + 1}`,
      conversion: index + 1,
      primary: index === 0
    })
  );

  assert.throws(
    () => normalizePresentations(presentations),
    /no puede tener más de 8 presentaciones/i
  );
});

test('rechaza estructura de presentaciones que no sea una lista', () => {
  assert.throws(
    () => normalizePresentations({
      code: 'CAJA',
      conversion: 24
    }),
    /deben ser una lista/i
  );
});
