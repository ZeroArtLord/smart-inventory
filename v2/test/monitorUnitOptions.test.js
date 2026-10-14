import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorUnitOptions, selectedMonitorUnit, MONITOR_COMMON_UNITS } from '../src/replenishment/monitorUnitOptions.js';
import { buildMonitorNativeLists } from '../src/replenishment/monitorNativeTicketAdapter.js';
import { renderProcurementTickets } from '../src/ui/procurementWorkspaceV6Print.js';
import { buildThermalPrintPayload } from '../src/printing/thermalPrinterClient.js';

test('Opciones de Monitor respetan unidad guardada y presentaciones de catálogo', () => {
  const options=monitorUnitOptions({
    inventoryUnitId:'unit_und',
    unitCode:'UND',
    presentations:[
      {code:'CAJA',name:'Caja 24',conversion:24,primary:true},
      {code:'BULTO',name:'Bulto 6 cajas',conversion:144}
    ]
  },'CJ');
  assert.equal(options[0],'CJ'); // las selecciones antiguas nunca se pierden
  for(const code of ['CAJA','BULTO','KG','UND','CJ','LT','PAQ','SACO','CESTA']){
    assert.ok(options.includes(code),code);
  }
  assert.equal(options.filter(x=>x==='CAJA').length,1);
  assert.ok(MONITOR_COMMON_UNITS.length>=12);
});

test('Presentación especial se conserva aunque no exista hoy en catálogo',()=>{
  const unit=selectedMonitorUnit({selected:'__OTHER__',custom:'  gaveta '});
  assert.equal(unit,'GAVETA');
  assert.equal(monitorUnitOptions(null,'GAVETA')[0],'GAVETA');
  assert.throws(()=>selectedMonitorUnit({selected:'__OTHER__',custom:' '}),/unidad/);
  assert.throws(()=>selectedMonitorUnit({selected:'__OTHER__',custom:'X'.repeat(41)}),/40/);
});

test('Un producto con presentaciones antiguas inconsistentes sigue editable',()=>{
  const options=monitorUnitOptions({inventoryUnitId:'unit_kg',presentations:[{code:'CJA',conversion:0}]},'SACO');
  assert.deepEqual(options.slice(0,2),['SACO','KG']);
  assert.ok(options.includes('CAJA'));
});

test('Cantidad 2 + CAJA llega intacta a vista 80mm y ESC/POS',()=>{
  const snapshot={
    source:'monitor-weekly-review',weekStart:'2026-10-12',
    lists:{PURCHASE:[{itemKey:'product:a',kind:'PRODUCT',productId:'a',
      description:'Refresco prueba',category:'BEBIDAS',quantity:2,unit:'CAJA',notes:'sin azúcar'}],ORDER:[]}
  };
  const [list]=buildMonitorNativeLists(snapshot,{ownerLabel:'Operador'});
  const html=renderProcurementTickets({list,businessName:'El Establo'});
  assert.match(html,/2 CAJA/);
  assert.match(html,/Refresco prueba/);
  const thermal=buildThermalPrintPayload(list);
  assert.equal(thermal.items[0].quantityText,'2 CAJA');
  assert.equal(thermal.items[0].category,'BEBIDAS');
  assert.equal(thermal.items[0].note,'sin azúcar');
  assert.equal(snapshot.lists.PURCHASE[0].quantity,2);
  assert.equal(snapshot.lists.PURCHASE[0].unit,'CAJA');
});
