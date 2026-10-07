import test from 'node:test';
import assert from 'node:assert/strict';

const {
  DEFAULT_THERMAL_CONFIG,
  normalizeThermalConfig,
  normalizePrintList,
  buildCalibrationJob,
  buildProcurementJob,
  buildSupplyJob,
  encodeCp437
} = await import('../server/src/printing/thermalEscPos.js');

test(
  'configuración RC-8002 queda calibrada a 80mm, 44 columnas y margen seguro',
  () => {
    const config = normalizeThermalConfig({});
    assert.equal(config.host, '192.168.1.165');
    assert.equal(config.port, 9100);
    assert.equal(config.charsPerLine, 44);
    assert.equal(config.leftMarginDots, 24);
    assert.equal(config.printWidthDots, 528);
    assert.equal(config.feedLines, 6);
    assert.equal(config.cut, true);
  }
);

test(
  'configuración rechaza IP pública para no convertir impresión en TCP arbitrario',
  () => {
    assert.throws(
      () => normalizeThermalConfig({ host: '8.8.8.8' }),
      /IPv4 privada/
    );
  }
);

test(
  'encoder CP437 conserva español soportado y degrada acentos mayúsculos sin comandos',
  () => {
    const bytes = encodeCp437('áéíóúñÑ ÁÍÓÚ');
    assert.ok(bytes.includes(0xa0));
    assert.ok(bytes.includes(0x82));
    assert.ok(bytes.includes(0xa4));
    assert.ok(bytes.includes(0xa5));

    const latin = bytes.toString('latin1');
    assert.ok(latin.includes('A'));
    assert.ok(latin.includes('I'));
    assert.ok(latin.includes('O'));
    assert.ok(latin.includes('U'));
  }
);

test(
  'calibración genera columnas, categorías, observaciones, feed y corte ESC/POS',
  () => {
    const buffer = buildCalibrationJob(
      DEFAULT_THERMAL_CONFIG
    );
    const text = buffer.toString('latin1');

    for (const value of [
      'PRODUCTO',
      'CANT.',
      'OK',
      'VIVERES',
      'HORTALIZAS',
      'BEBIDAS',
      'EXTRAS',
      'MAYONESA KRAFT SACHETS',
      'AGUACATE',
      '30 KG',
      'Observaciones:',
      'Firma:'
    ]) {
      assert.ok(
        text.includes(value),
        `Falta texto ESC/POS: ${value}`
      );
    }

    assert.ok(
      hasSequence(buffer, [0x1b, 0x64, 0x06])
    );
    assert.ok(
      hasSequence(buffer, [0x1d, 0x56, 0x00])
    );
  }
);

test(
  'compra genera chófer + depósito, incluye extras/notas y corta cada copia',
  () => {
    const job = buildProcurementJob(
      DEFAULT_THERMAL_CONFIG,
      {
        id: 'buy-list-1',
        code: 'COM-0001',
        kind: 'PURCHASE',
        dateLabel: '09/09/2026 11:00',
        ownerLabel: 'Armando',
        items: [
          {
            name: 'AGUACATE',
            quantityText: '30 KG',
            category: 'HORTALIZAS',
            note: 'verdes para guasacaca'
          },
          {
            name: 'TEIPE ELECTRICO NEGRO',
            quantityText: '3 UND',
            category: 'EXTRAS',
            note: 'para mantenimiento',
            extra: true
          },
          {
            name: 'NO DEBE SALIR',
            quantityText: '1 UND',
            category: 'VARIOS',
            status: 'CANCELLED'
          }
        ]
      }
    );

    const text = job.buffer.toString('latin1');
    assert.equal(job.copies, 2);
    assert.equal(job.itemCount, 2);
    assert.ok(text.includes('COPIA CHOFER'));
    assert.ok(text.includes('COPIA DEPOSITO'));
    assert.ok(text.includes('AGUACATE'));
    assert.ok(text.includes('TEIPE ELECTRICO NEGRO'));
    assert.ok(text.includes('verdes para guasacaca'));
    assert.equal(text.includes('NO DEBE SALIR'), false);
    assert.equal(
      countSequence(
        job.buffer,
        [0x1d, 0x56, 0x00]
      ),
      2
    );
  }
);

test(
  'pedido genera proveedor + depósito y sanitiza controles embebidos en notas',
  () => {
    const list = normalizePrintList({
      kind: 'ORDER',
      code: 'PED-0001',
      items: [
        {
          name: 'PEPSI MAX 350ML',
          quantityText: '11 CJ',
          category: 'BEBIDAS',
          note: 'distribuidor\u001b@ habitual'
        }
      ]
    });

    assert.equal(
      list.items[0].note.includes('\u001b'),
      false
    );

    const job = buildProcurementJob(
      DEFAULT_THERMAL_CONFIG,
      list
    );
    const text = job.buffer.toString('latin1');

    assert.ok(
      text.includes('COPIA PEDIDO / PROVEEDOR')
    );
    assert.ok(text.includes('COPIA DEPOSITO'));
    assert.equal(
      countSequence(
        job.buffer,
        [0x1d, 0x56, 0x00]
      ),
      2
    );
  }
);

test(
  'surtido térmico imprime una sola lista completa y un solo corte',
  () => {
    const job = buildSupplyJob(
      DEFAULT_THERMAL_CONFIG,
      {
        id: 'sur-closed-1',
        code: 'SUR-0001',
        dateLabel: '11/09/2026 11:30',
        ownerLabel: 'Deposito',
        items: [
          {
            name: 'COCA COLA ZERO 355ML',
            quantityText: '24 UND',
            category: 'BEBIDAS'
          },
          {
            name: 'MAYONESA KRAFT',
            quantityText: '2 CJ',
            category: 'VIVERES',
            note: 'cantidad real surtida'
          }
        ]
      }
    );

    const text = job.buffer.toString('latin1');
    assert.equal(job.copies, 1);
    assert.equal(job.itemCount, 2);
    assert.equal(job.documentId, 'sur-closed-1');
    assert.ok(text.includes('LISTA DE SURTIDO'));
    assert.ok(text.includes('COCA COLA ZERO 355ML'));
    assert.ok(text.includes('24 UND'));
    assert.ok(text.includes('VIVERES'));
    assert.ok(text.includes('cantidad real surtida'));
    assert.equal(text.includes('COPIA CHOFER'), false);
    assert.equal(text.includes('COPIA DEPOSITO'), false);
    assert.equal(
      countSequence(job.buffer, [0x1d, 0x56, 0x00]),
      1
    );
  }
);

test(
  'surtido térmico no trunca silenciosamente una lista completa',
  () => {
    const items = Array.from({ length: 251 }, (_, index) => ({
      name: `PRODUCTO ${String(index + 1).padStart(3, '0')}`,
      quantityText: '1 UND',
      category: 'GENERAL'
    }));

    const job = buildSupplyJob(
      DEFAULT_THERMAL_CONFIG,
      {
        id: 'sur-251',
        code: 'SUR-0251',
        items
      }
    );

    const text = job.buffer.toString('latin1');
    assert.equal(job.itemCount, 251);
    assert.ok(text.includes('PRODUCTO 251'));
    assert.equal(
      countSequence(job.buffer, [0x1d, 0x56, 0x00]),
      1
    );
  }
);

function hasSequence(buffer, sequence) {
  return countSequence(buffer, sequence) > 0;
}

function countSequence(buffer, sequence) {
  let total = 0;

  for (
    let index = 0;
    index <= buffer.length - sequence.length;
    index += 1
  ) {
    let match = true;

    for (
      let offset = 0;
      offset < sequence.length;
      offset += 1
    ) {
      if (buffer[index + offset] !== sequence[offset]) {
        match = false;
        break;
      }
    }

    if (match) total += 1;
  }

  return total;
}
