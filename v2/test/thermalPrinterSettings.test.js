import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

async function read(relativePath) {
  return readFile(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8'
  );
}

test(
  'Configuración contiene RC-8002 ESC/POS directo y prueba solo dentro de ajustes',
  async () => {
    const ui = await read('../src/ui/thermalPrinterSettingsUi.js');
    const print = await read('../src/ui/procurementWorkspaceV6Print.js');
    const client = await read('../src/printing/thermalPrinterClient.js');

    for (const text of [
      'Impresión 80mm',
      'Nombre del negocio en el ticket',
      'IP de la comandera',
      'Puerto RAW',
      '192.168.1.165',
      '9100',
      'Caracteres por línea',
      'Margen izquierdo',
      'Ancho útil',
      'Papel antes del corte',
      'ESC/POS directo',
      'Imprimir prueba de calibración',
      'printThermalCalibration',
      'testThermalPrinterConnection'
    ]) {
      assert.ok(
        ui.includes(text),
        `Falta contrato de configuración térmica: ${text}`
      );
    }

    assert.equal(ui.includes('window.print()'), false);
    assert.ok(client.includes('/api/v1/thermal-printer/test'));
    assert.ok(client.includes('/api/v1/thermal-printer/ticket'));

    assert.equal(
      print.includes('Imprimir prueba de calibración'),
      false,
      'La prueba no debe aparecer en Mis listas'
    );
    assert.equal(print.includes('browser-print'), false);
    assert.ok(
      print.includes('data-v6p-action="direct-print"')
    );
    assert.ok(print.includes('data-list-id='));
  }
);

test(
  'impresión diaria usa módulo directo y carga lista completa desde IndexedDB',
  async () => {
    const direct = await read('../src/ui/thermalDirectPrintUi.js');
    const client = await read('../src/printing/thermalPrinterClient.js');

    for (const text of [
      'direct-print',
      'listProcurementLists',
      'printThermalProcurementList',
      'includeTerminal: true',
      'Enviando a comandera'
    ]) {
      assert.ok(
        direct.includes(text),
        `Falta contrato de impresión directa: ${text}`
      );
    }

    for (const text of [
      'procurementCategoryOf',
      'procurementDisplayQuantity',
      'isProcurementExtra',
      "status || '').toUpperCase() !== 'CANCELLED'",
      'quantityText',
      'extra:'
    ]) {
      assert.ok(
        client.includes(text),
        `Falta payload completo del ticket: ${text}`
      );
    }
  }
);

test(
  'servidor limita configuración a GOD y tickets a purchases.write',
  async () => {
    const route = await read('../server/src/routes/thermalPrinter.js');
    const app = await read('../server/src/app.js');
    const escpos = await read('../server/src/printing/thermalEscPos.js');
    const service = await read('../server/src/printing/thermalPrinterService.js');

    assert.ok(app.includes("'/api/v1/thermal-printer'"));
    assert.ok(app.includes("namespace: 'thermal-printer'"));
    assert.ok(route.includes('assertGod(req.auth)'));
    assert.ok(route.includes('PERMISSIONS.PURCHASE_WRITE'));
    assert.ok(route.includes("'/ticket'"));
    assert.ok(route.includes("'/test'"));
    assert.ok(route.includes("'/connection-test'"));
    assert.ok(escpos.includes('isPrivateIpv4'));
    assert.ok(escpos.includes('192.168.1.165'));
    assert.ok(escpos.includes('printWidthDots: 528'));
    assert.ok(escpos.includes('leftMarginDots: 24'));
    assert.ok(escpos.includes('feedLines: 6'));
    assert.ok(service.includes('net.createConnection'));
    assert.ok(service.includes('THERMAL_PRINTER_UNREACHABLE'));
  }
);

test(
  'surtidos térmicos usan endpoint propio protegido por supply.write y auditado',
  async () => {
    const route = await read('../server/src/routes/thermalPrinter.js');
    const service = await read('../server/src/printing/thermalPrinterService.js');
    const client = await read('../src/printing/thermalPrinterClient.js');

    assert.ok(route.includes("'/supply-ticket'"));
    assert.ok(route.includes('PERMISSIONS.SUPPLY_WRITE'));
    assert.ok(route.includes('printSupplyReceipt'));
    assert.ok(route.includes('SUPPLY_TICKET_PRINTED'));
    assert.ok(service.includes('printSupplyReceipt'));
    assert.ok(service.includes('buildSupplyJob'));
    assert.ok(client.includes('printThermalSupplyDocument'));
    assert.ok(client.includes('/api/v1/thermal-printer/supply-ticket'));
  }
);

test(
  'CSS sigue ocultando la explicación duplicada y protege móvil',
  async () => {
    const css = await read('../css/v6-thermal-printer.css');

    assert.match(
      css,
      /\[data-vigia-intelligence-panel="replenishment"\][\s\S]*display:\s*none\s*!important/
    );
    assert.match(css, /\.v6t-printer-settings/);
    assert.match(css, /@media \(max-width: 760px\)/);
  }
);
