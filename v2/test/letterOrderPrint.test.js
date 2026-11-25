import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLetterOrderPrintHtml } from '../src/printing/letterOrderPrint.js';

test('solo pedidos usa carta, agrupa por proveedor y conserva dos copias',()=>{
  const html=renderLetterOrderPrintHtml({
    id:'ped-1',kind:'ORDER',code:'PED-MON-001',dateLabel:'Semana 2026-11-23',ownerLabel:'Armando',
    source:'monitor-weekly-review',items:[
      {productName:'SERVILLETAS',printQuantity:2,printUnit:'CAJAS',printCategory:'PROVEEDOR: SUMERVALCA',status:'DRAFT'},
      {productName:'ACEITE',printQuantity:3,printUnit:'BULTOS',printCategory:'PROVEEDOR: SUMERVALCA',notes:'Presentación 1 L'},
      {productName:'AGUA',printQuantity:10,printUnit:'CJ',printCategory:'SIN PROVEEDOR ASIGNADO'},
      {productName:'DESCARTADO',printQuantity:1,printUnit:'UND',printCategory:'PROVEEDOR: OTRO',status:'CANCELLED'}
    ]
  },'EL ESTABLO');
  assert.match(html,/@page\{size:letter;margin:0\}/);
  assert.match(html,/PROVEEDOR: SUMERVALCA/);
  assert.match(html,/SIN PROVEEDOR ASIGNADO/);
  assert.ok(html.indexOf('PROVEEDOR: SUMERVALCA')<html.indexOf('SIN PROVEEDOR ASIGNADO'));
  assert.match(html,/2 CJ/);
  assert.match(html,/3 BUL/);
  assert.match(html,/Presentación 1 L/);
  assert.doesNotMatch(html,/DESCARTADO/);
  assert.match(html,/COPIA PEDIDO \/ PROVEEDOR/);
  assert.match(html,/COPIA DEPÓSITO/);
  assert.match(html,/paginate\(copies\[0\]\);paginate\(copies\[1\]\)/);
});

test('no inventa cantidad, conserva nombres completos y escapa contenido',()=>{
  const html=renderLetterOrderPrintHtml({kind:'ORDER',items:[
    {productName:'LÍNEA <especial> & larga',printQuantity:null,printUnit:'CAJA',printCategory:'PROVEEDOR: R&L',notes:'Verificar <tamaño>'}
  ]},"El Establo 'Central' \\ Sede");
  assert.match(html,/LÍNEA &lt;especial&gt; &amp; larga/);
  assert.match(html,/________ CJ/);
  assert.match(html,/Verificar &lt;tamaño&gt;/);
  assert.match(html,/El Establo &#39;Central&#39;/);
  assert.doesNotMatch(html,/<especial>/);
  assert.throws(()=>renderLetterOrderPrintHtml({kind:'PURCHASE',items:[]}),/solo a pedidos/);
});
