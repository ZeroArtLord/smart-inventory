import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MONITOR_SUPPLY_STATUS as S,
  createMonitorSupplyDraft,
  addMonitorSupplyLine,
  updateMonitorSupplyLine,
  removeMonitorSupplyLine,
  recordMonitorSupply,
  summarizeMonitorSupplies
} from '../src/documents/monitorSupplyModel.js';

function draft(id='sur-001',destinationAreaId='cocina'){
  return createMonitorSupplyDraft({
    id,workspaceId:'establo',operationalDate:'2026-10-11',
    destinationAreaId,actorId:'warehouse-operator',
    createdAt:'2026-10-11T16:00:00Z'
  });
}
function line(productId='agua',quantity=6,unit='UND'){
  return {productId,productName:productId==='agua'?'Agua':'Arroz',quantity,unit};
}
test('crea carrito de surtidos sin existencias o mínimo/máximo',()=>{
 const d=draft();
 assert.equal(d.status,S.DRAFT);
 assert.deepEqual(d.lines,{});
 assert.equal(d.destinationAreaId,'cocina');
 assert.equal('stock' in d,false);
});
test('añadir un producto registra entrega aun sin stock',()=>{
 const d=addMonitorSupplyLine(draft(),line('agua',40));
 const row=Object.values(d.lines)[0];
 assert.equal(row.quantity,40);
 assert.equal(d.status,S.DRAFT);
});
test('agregar repetidamente misma unidad acumula, no duplica líneas',()=>{
 let d=addMonitorSupplyLine(draft(),line('agua',2));
 d=addMonitorSupplyLine(d,line('agua',3));
 assert.equal(Object.keys(d.lines).length,1);
 assert.equal(Object.values(d.lines)[0].quantity,5);
});
test('unidades diferentes no se suman erróneamente',()=>{
 let d=addMonitorSupplyLine(draft(),line('agua',2,'CAJA'));
 d=addMonitorSupplyLine(d,line('agua',4,'UND'));
 assert.equal(Object.keys(d.lines).length,2);
});
test('editar cantidad y nota funciona sin ningún movimiento de inventario',()=>{
 const d=addMonitorSupplyLine(draft(),line());
 const next=updateMonitorSupplyLine(d,{productId:'agua',unit:'UND',quantity:8,note:'entrega parcial'});
 assert.equal(Object.values(next.lines)[0].quantity,8);
 assert.equal(Object.values(next.lines)[0].note,'entrega parcial');
 assert.equal('movements' in next,false);
});
test('eliminar una línea no afecta origen',()=>{
 const d=addMonitorSupplyLine(draft(),line());
 const next=removeMonitorSupplyLine(d,{productId:'agua',unit:'UND'});
 assert.equal(Object.keys(next.lines).length,0);
 assert.equal(Object.keys(d.lines).length,1);
});
test('registrar un surtido sin líneas se rechaza',()=>{
 assert.throws(()=>recordMonitorSupply(draft()),/debe tener productos/);
});
test('cerrar carrito registra entregas, no hace ajustes de stock',()=>{
 const d=addMonitorSupplyLine(draft(),line());
 const result=recordMonitorSupply(d);
 assert.equal(result.status,S.RECORDED);
 assert.equal(result.lines.length,1);
 assert.equal(result.lines[0].quantity,6);
 assert.equal('stock' in result,false);
});
test('documento cerrado es inmutable a través del modelo',()=>{
 const result=recordMonitorSupply(addMonitorSupplyLine(draft(),line()));
 assert.throws(()=>addMonitorSupplyLine(result,line()),/no editable/);
 assert.throws(()=>updateMonitorSupplyLine(result,{productId:'agua',unit:'UND',quantity:1}),/no editable/);
});
test('rechazar cero, negativos y cantidades que redondean a cero',()=>{
 for(const qty of [0,-1,'',null,'mal','0.0000001']){
  assert.throws(()=>addMonitorSupplyLine(draft(),line('agua',qty)),/cantidad entregada/i);
 }
});
test('reporte por área y producto agrupa solo cantidades de igual unidad',()=>{
 const a=recordMonitorSupply(addMonitorSupplyLine(draft('s1'),line('agua',2,'CAJA')));
 const b=recordMonitorSupply(addMonitorSupplyLine(draft('s2'),line('agua',3,'CAJA')));
 const c=recordMonitorSupply(addMonitorSupplyLine(draft('s3','barra'),line('agua',8,'UND')));
 const report=summarizeMonitorSupplies([a,b,c]);
 assert.equal(report.documents,3);
 assert.equal(report.lines.length,2);
 assert.equal(report.lines.find(x=>x.areaId==='cocina').quantity,5);
 assert.equal(report.lines.find(x=>x.areaId==='barra').quantity,8);
});
test('filtro de reportes por fecha y área',()=>{
 const a=recordMonitorSupply(addMonitorSupplyLine(draft('s1'),line()));
 const b=recordMonitorSupply(addMonitorSupplyLine(draft('s2','barra'),line('agua',8)));
 const report=summarizeMonitorSupplies([a,b],{areaId:'barra',from:'2026-10-10',to:'2026-10-12'});
 assert.equal(report.documents,1);
 assert.equal(report.lines[0].quantity,8);
 assert.equal(summarizeMonitorSupplies([a,b],{from:'2026-10-12'}).documents,0);
});
test('resumen excluye borradores no entregados',()=>{
 const a=addMonitorSupplyLine(draft('s1'),line());
 assert.equal(summarizeMonitorSupplies([a]).documents,0);
});
test('valida fecha operativa y área de destino',()=>{
 assert.throws(()=>createMonitorSupplyDraft({
   id:'x',workspaceId:'establo',operationalDate:'2026-02-30',
   actorId:'u',destinationAreaId:'cocina'}),/Fecha/);
 assert.throws(()=>createMonitorSupplyDraft({
   id:'x',workspaceId:'establo',operationalDate:'2026-10-11',
   actorId:'u',destinationAreaId:''}),/Área/);
});
test('una línea desconocida no puede editarse',()=>{
 assert.throws(()=>updateMonitorSupplyLine(draft(),{productId:'no-existe',unit:'UND',quantity:1}),/no encontrado/);
});
test('origen preservado tras nuevas operaciones',()=>{
 const d=draft();
 addMonitorSupplyLine(d,line());
 assert.deepEqual(d.lines,{});
});
