import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { buildOperationalDomRenderKey } from '../src/ui/operationalDomRenderGuard.js';

const ui = await fs.readFile(
  new URL('../src/ui/godOperationalOversightUi.js', import.meta.url),
  'utf8'
);

test('V8.7 historial UI consume agrupador puro y movimientos reales', () => {
  assert.match(ui, /buildSupplyHistoryGroups/);
  assert.match(ui, /STORES\.MOVEMENTS/);
  assert.match(ui, /renderSupplyHistory/);
});

test('V8.7 padre muestra fecha operativa y solo acciones Resumen + Ver entregas', () => {
  assert.match(ui, /data-v87-supply-history-parent/);
  assert.match(ui, /Fecha operativa/);
  assert.match(ui, />Resumen</);
  assert.match(ui, /Ver entregas \(\$\{group\.summary\.deliveryCount\}\)/);
  assert.match(ui, /data-v87-history-summary/);
  assert.match(ui, /data-v87-history-toggle/);
});

test('V8.7 hijos conservan ID físico y contrato de exportación térmica/SAINT', () => {
  assert.match(ui, /renderSupplyDeliveryRow/);
  assert.match(ui, /closed-document-row/);
  assert.match(ui, /data-v82-document-id/);
  assert.match(ui, /document-export-actions/);
  assert.match(ui, /data-action="export-document"/);
  assert.match(ui, /data-v87-delivery-list/);
  assert.match(ui, /hidden/);
});

test('V8.7 render key cambia con fecha operativa, resumen o entregas hijas', () => {
  const parent = {
    id: 'cart-1',
    type: 'SUPPLY',
    status: 'CLOSED',
    ownerId: 'warehouse-1',
    createdAt: '2026-09-14T10:00:00.000Z',
    updatedAt: '2026-09-14T11:00:00.000Z',
    closedAt: '2026-09-14T11:00:00.000Z',
    metadata: {
      kind: 'LIVE_SUPPLY_CART',
      operationalDate: '2026-09-12'
    }
  };
  const child = {
    id: 'delivery-1',
    type: 'SUPPLY',
    status: 'CLOSED',
    ownerId: 'live-delivery:cart-1',
    closedAt: '2026-09-14T10:30:00.000Z',
    metadata: {
      kind: 'LIVE_SUPPLY_DELIVERY',
      parentCartId: 'cart-1',
      operationalDate: '2026-09-12'
    }
  };
  const baseGroup = {
    kind: 'LIVE_CART',
    document: parent,
    operationalDate: '2026-09-12',
    summary: {
      deliveryCount: 1,
      deliveredTotal: 4,
      plannedTotal: 10,
      pendingTotal: 6,
      cancelledTotal: 0,
      status: 'CLOSED'
    },
    deliveries: [{ document: child, deliveredTotal: 4 }]
  };

  const key = group => buildOperationalDomRenderKey({
    type: 'SUPPLY',
    actor: { ownerId: 'warehouse-1', roleCode: 'WAREHOUSE' },
    drafts: [],
    history: [group],
    members: []
  });

  const original = key(baseGroup);
  assert.notEqual(
    original,
    key({ ...baseGroup, operationalDate: '2026-09-11' })
  );
  assert.notEqual(
    original,
    key({
      ...baseGroup,
      summary: { ...baseGroup.summary, deliveredTotal: 5 }
    })
  );
  assert.notEqual(
    original,
    key({
      ...baseGroup,
      deliveries: [
        ...baseGroup.deliveries,
        {
          document: { ...child, id: 'delivery-2' },
          deliveredTotal: 1
        }
      ]
    })
  );
});
