import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const ui = await fs.readFile(
  new URL('../src/ui/liveSupplyUi.js', import.meta.url),
  'utf8'
);

test('V8.7 muestra fecha operativa como input date, con hoy como máximo y sin hora editable', () => {
  assert.match(ui, /setLiveSupplyOperationalDate/);
  assert.match(ui, /todayOperationalDate/);
  assert.match(ui, /data-v87-operational-date/);
  assert.match(ui, /type=["']date["']/);
  assert.match(ui, /max=.*todayOperationalDate/s);
  assert.match(ui, /operationalDate/);
  assert.doesNotMatch(ui, /type=["'](?:datetime-local|time)["']/);
});

test('V8.7 bloquea la fecha después de la primera entrega física', () => {
  assert.match(ui, /closedDeliveryCount/);
  assert.match(
    ui,
    /closedDeliveryCount\s*>\s*0[\s\S]{0,260}disabled|disabled[\s\S]{0,260}closedDeliveryCount\s*>\s*0/
  );
});

test('V8.7 change de fecha llama al setter de servicio y rerenderiza el carrito', () => {
  assert.match(ui, /addEventListener\(["']change["']/);
  assert.match(ui, /data-v87-operational-date/);
  assert.match(ui, /setLiveSupplyOperationalDate\(/);
  assert.match(ui, /rerenderLivePanel\(/);
});

test('V8.7 editar fecha no despacha ni finaliza una entrega', () => {
  const changeHandler = ui.match(
    /addEventListener\(["']change["'][\s\S]*?\n\s*}\);/
  )?.[0] || '';

  assert.ok(changeHandler, 'Debe existir un handler change para la fecha operativa');
  assert.doesNotMatch(changeHandler, /dispatchLiveSupply\(/);
  assert.doesNotMatch(changeHandler, /finalizeLiveSupplyCart\(/);
});
