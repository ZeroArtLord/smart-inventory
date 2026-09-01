import test from 'node:test';
import assert from 'node:assert/strict';

const {
  rowsToCsv,
  buildDocumentExportRows
} = await import('../src/export/exportService.js');

test('CSV escapa comas, comillas y saltos de línea', () => {
  const csv = rowsToCsv([
    {
      Producto: 'ARROZ, PREMIUM',
      Notas: 'Dice "nuevo"\nLote A'
    }
  ]);

  assert.equal(
    csv,
    'Producto,Notas\r\n"ARROZ, PREMIUM","Dice ""nuevo""\nLote A"'
  );
});

test('exporta líneas de conteo con esperado contado y diferencia', () => {
  const rows = buildDocumentExportRows(
    { type: 'COUNT' },
    [
      {
        productName: 'ACEITE',
        expectedStock: 12,
        countedStock: 15,
        difference: 3,
        countedAt: '2026-09-01T12:00:00.000Z'
      }
    ]
  );

  assert.deepEqual(rows[0], {
    Producto: 'ACEITE',
    Esperado: 12,
    Contado: 15,
    Diferencia: 3,
    'Fecha conteo': '2026-09-01T12:00:00.000Z'
  });
});

test('exporta Entrada/Surtido con lote costo y vencimiento', () => {
  const rows = buildDocumentExportRows(
    { type: 'ENTRY' },
    [
      {
        productName: 'LECHE',
        quantity: 8,
        lotNumber: 'L-001',
        expiresAt: '2026-12-01T00:00:00.000Z',
        unitCost: 2.5,
        notes: 'Frío'
      }
    ]
  );

  assert.deepEqual(rows[0], {
    Producto: 'LECHE',
    Cantidad: 8,
    Lote: 'L-001',
    Vencimiento: '2026-12-01T00:00:00.000Z',
    'Costo unitario': 2.5,
    Notas: 'Frío'
  });
});
