import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSaintBridgeGroups,
  buildCountSaintBridgePlans,
  effectiveSaintCode,
  effectiveSaintName,
  isSaintBridgeSource,
  isSaintBridgeVariant
} from '../src/catalog/saintBridge.js';

const source = {
  id: 'prd_generic',
  name: 'REFRESCO BOT 350ML',
  saintCode: '344121',
  active: false,
  saintBridgeSource: true,
  saintBridgeCode: '344121',
  saintBridgeName: 'REFRESCOS BOTELLA 350ML'
};

const pepsi = {
  id: 'prd_pepsi',
  name: 'REFRESCO BOTELLA PEPSI MAX 350ML',
  saintCode: '1014761',
  active: true,
  saintBridgeSourceProductId: source.id,
  saintBridgeCode: '344121',
  saintBridgeName: 'REFRESCOS BOTELLA 350ML'
};

const sevenUp = {
  id: 'prd_7up',
  name: 'REFRESCO BOTELLA 7UP 350ML',
  saintCode: '80147',
  active: true,
  saintBridgeSourceProductId: source.id,
  saintBridgeCode: '344121',
  saintBridgeName: 'REFRESCOS BOTELLA 350ML'
};

test('puente distingue fuente, variantes y código SAINT efectivo', () => {
  assert.equal(isSaintBridgeSource(source), true);
  assert.equal(isSaintBridgeVariant(source), false);
  assert.equal(isSaintBridgeVariant(pepsi), true);
  assert.equal(effectiveSaintCode(pepsi), '344121');
  assert.equal(effectiveSaintCode(source), '344121');
  assert.equal(effectiveSaintName(pepsi), 'REFRESCOS BOTELLA 350ML');
});

test('agrupa sabores bajo una sola familia sin convertirlos en un solo producto VIGÍA', () => {
  const groups = buildSaintBridgeGroups([source, pepsi, sevenUp]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sourceProductId, source.id);
  assert.equal(groups[0].saintCode, '344121');
  assert.deepEqual(
    groups[0].variants.map(item => item.id).sort(),
    [pepsi.id, sevenUp.id].sort()
  );
});

test('plan de conteo preserva línea genérica como control y suma sabores reales', () => {
  const plans = buildCountSaintBridgePlans({
    products: [source, pepsi, sevenUp],
    lines: [
      {
        id: 'line_generic',
        productId: source.id,
        expectedStock: 430,
        countedStock: 425,
        countedAt: '2026-09-07T20:00:00.000Z'
      },
      {
        id: 'line_pepsi',
        productId: pepsi.id,
        expectedStock: 0,
        countedStock: 300,
        countedAt: '2026-09-07T20:10:00.000Z'
      },
      {
        id: 'line_7up',
        productId: sevenUp.id,
        expectedStock: 0,
        countedStock: 125,
        countedAt: '2026-09-07T20:11:00.000Z'
      }
    ],
    stockByProductId: new Map([[source.id, 430]])
  });

  assert.equal(plans.length, 1);
  assert.equal(plans[0].sourceStockAtSubmit, 430);
  assert.equal(plans[0].controlCountedStock, 425);
  assert.equal(plans[0].variantCountedTotal, 425);
  assert.equal(plans[0].controlDifference, 0);
  assert.equal(plans[0].countedVariantCount, 2);
  assert.equal(plans[0].status, 'PENDING');
});
