import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSupplier,buildSupplierOrderGroups,supplierOrderFingerprint,buildSupplierMessage,supplierWhatsAppUrl } from '../src/replenishment/monitorSupplierOrders.js';
const suppliers=[{id:'s1',name:'Sumervalca',phone:'584141234567',active:true},{id:'s2',name:'Toledo',phone:'584241234567',active:true}];
const items=[{itemKey:'product:p1',productId:'p1',name:'Servilletas',quantity:3,unit:'CAJA',notes:'Blancas',version:1},
 {itemKey:'product:p2',productId:'p2',name:'Aceite',quantity:2,unit:'BULTO',notes:'',version:2}];
test('normaliza proveedor y teléfono internacional sin inventar números',()=>{
 assert.deepEqual(normalizeSupplier({name:' Sumervalca ',phone:'0414-1234567'}),{name:'Sumervalca',phone:'584141234567',active:true});
 assert.equal(normalizeSupplier({name:'USA',phone:'+1 (212) 555-1234'}).phone,'12125551234');
 assert.throws(()=>normalizeSupplier({name:'',phone:'04141234567'}),/nombre/i);
 assert.throws(()=>normalizeSupplier({name:'X',phone:'123'}),/teléfono/i);
});
test('bloquea cantidad, empaque o proveedor faltante y proveedores inactivos',()=>{
 for(const row of [{...items[0],quantity:null},{...items[0],quantity:0},{...items[0],unit:''}])
   assert.throws(()=>buildSupplierOrderGroups({items:[row],suppliers,selections:{'product:p1':'s1'}}),/cantidad|empaque/i);
 assert.throws(()=>buildSupplierOrderGroups({items,suppliers,selections:{}}),/proveedor/i);
 assert.throws(()=>buildSupplierOrderGroups({items:[items[0]],suppliers:[{...suppliers[0],active:false}],selections:{'product:p1':'s1'}}),/proveedor/i);
});
test('agrupa sin convertir unidades y firma cambia por cualquier detalle del pedido',()=>{
 const groups=buildSupplierOrderGroups({items,suppliers,selections:{'product:p1':'s1','product:p2':'s1'}});
 assert.equal(groups.length,1);assert.equal(groups[0].items[0].quantity,3);assert.equal(groups[0].items[0].unit,'CAJA');
 assert.notEqual(supplierOrderFingerprint(groups),supplierOrderFingerprint([{...groups[0],items:[{...groups[0].items[0],quantity:4},groups[0].items[1]]}]));
 assert.equal(supplierOrderFingerprint(groups),supplierOrderFingerprint(buildSupplierOrderGroups({items:[...items].reverse(),suppliers,selections:{'product:p2':'s1','product:p1':'s1'}})));
});
test('mensaje usa saludo de Venezuela, texto acordado, notas y enlace codificado',()=>{
 const [order]=buildSupplierOrderGroups({items,suppliers,selections:{'product:p1':'s1','product:p2':'s1'}});
 const now=new Date('2026-10-26T14:00:00Z');
 const text=buildSupplierMessage(order,{now});
 assert.match(text,/Hola, buenos días/);assert.match(text,/Club social deportivo y campestre el establo, c\.a/);
 assert.match(text,/3 CAJA — Servilletas \(Blancas\)/);assert.match(text,/2 BULTO — Aceite/);
 assert.match(text,/confirma despacho y facturación/);
 assert.match(buildSupplierMessage(order,{now:new Date('2026-10-26T19:00:00Z')}),/buenas tardes/);
 assert.match(buildSupplierMessage(order,{now:new Date('2026-10-27T01:00:00Z')}),/buenas noches/);
 const url=new URL(supplierWhatsAppUrl(order,{now}));assert.equal(url.hostname,'wa.me');assert.equal(url.pathname,'/584141234567');assert.equal(url.searchParams.get('text'),text);
});
