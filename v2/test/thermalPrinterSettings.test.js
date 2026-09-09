import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

async function read(relativePath) {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

test('Configuración contiene impresora 80mm y prueba solo dentro de ajustes', async () => {
  const ui = await read('../src/ui/thermalPrinterSettingsUi.js');
  const print = await read('../src/ui/procurementWorkspaceV6Print.js');

  for (const text of [
    'Impresión 80mm',
    'Nombre del negocio en el ticket',
    'Impresora compartida / Windows',
    'CAFETERIA',
    'Tamaño base',
    'Interlineado',
    'Margen interno',
    'Imprimir prueba de calibración',
    'vigia.procurement.businessName',
    'window.print()'
  ]) {
    assert.ok(ui.includes(text), `Falta contrato de configuración térmica: ${text}`);
  }

  assert.equal(
    print.includes('Imprimir prueba de calibración'),
    false,
    'La prueba de impresión no debe aparecer en el flujo cotidiano de Mis listas'
  );
  assert.equal(
    print.includes('v6pBusinessName'),
    false,
    'El nombre del negocio ya no se edita dentro de cada ticket'
  );
  assert.equal(
    print.includes('save-business-name'),
    false,
    'El guardado del encabezado debe vivir solo en Configuración'
  );
  assert.ok(print.includes('Configuración → Impresión 80mm'));
});

test('prueba 80mm incluye texto útil para calibrar tipografía espacios signos y wrapping', async () => {
  const ui = await read('../src/ui/thermalPrinterSettingsUi.js');

  for (const text of [
    'PRUEBA DE IMPRESIÓN 80MM',
    '1234567890123456789012345678901234567890',
    'ÁÉÍÓÚ Ñ ñ / - + ( ) [ ] # * %',
    'PRODUCTO CON NOMBRE MUY LARGO PARA PROBAR SALTO DE LÍNEA',
    'verdes para guasacaca',
    'EXTRAS',
    'TEIPE ELÉCTRICO NEGRO'
  ]) {
    assert.ok(ui.includes(text), `Falta muestra de calibración: ${text}`);
  }
});

test('CSS elimina la explicación duplicada y aplica calibración al ticket real', async () => {
  const css = await read('../css/v6-thermal-printer.css');

  assert.match(css, /\[data-vigia-intelligence-panel="replenishment"\][\s\S]*display:\s*none\s*!important/);
  assert.match(css, /--vigia-ticket-font-size/);
  assert.match(css, /--vigia-ticket-line-height/);
  assert.match(css, /--vigia-ticket-padding/);
  assert.match(css, /\.v6t-printer-settings/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
