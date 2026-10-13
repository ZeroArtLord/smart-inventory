import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monitorSupplyDraftKey,newMonitorSupplyDraft,loadMonitorSupplyDraft,
  saveMonitorSupplyDraft,commitMonitorSupplyDraft
} from '../src/documents/monitorSupplyDraftStore.js';
import {addMonitorSupplyLine} from '../src/documents/monitorSupplyModel.js';
import {getMonitorSupplyOutboxEntry} from '../src/documents/monitorSupplyOutbox.js';
import {STORES,get} from '../src/storage/database.js';
const identity=x=>({workspaceId:'warehouse-'+x,userId:'worker-'+x});
test('crea borrador por almacén y empleado, sin área inicialmente',async()=>{
 const i=identity('draft1');const d=await loadMonitorSupplyDraft(i);
 assert.equal(d.status,'DRAFT');assert.equal(d.destinationAreaId,'');
 assert.equal(d.workspaceId,i.workspaceId);assert.ok(d.id.startsWith('ms_'));
});
test('conserva cambios del carrito y no toca cola de V2',async()=>{
 const i=identity('draft2');let d=await loadMonitorSupplyDraft(i);
 d={...d,destinationAreaId:'cocina'};
 d=addMonitorSupplyLine(d,{productId:'agua',productName:'Agua',quantity:5,unit:'UND'});
 await saveMonitorSupplyDraft(i,d);
 const after=await loadMonitorSupplyDraft(i);
 assert.equal(Object.values(after.lines)[0].quantity,5);
 assert.equal(await get(STORES.SYNC_QUEUE,d.id),undefined);
});
test('registrar tras elegir área mueve el documento a outbox y crea carrito nuevo',async()=>{
 const i=identity('draft3');let d=await loadMonitorSupplyDraft(i);
 d=addMonitorSupplyLine({...d,destinationAreaId:'cocina'},{
   productId:'agua',productName:'Agua',quantity:2,unit:'CAJA'
 });
 await saveMonitorSupplyDraft(i,d);
 const result=await commitMonitorSupplyDraft(i,d);
 assert.equal(result.queued.status,'PENDING');
 assert.equal(result.queued.delivery.id,d.id);
 assert.equal(result.queued.delivery.lines[0].quantity,2);
 assert.notEqual(result.next.id,d.id);
 assert.equal((await loadMonitorSupplyDraft(i)).id,result.next.id);
});
test('sin líneas o sin área no borra el borrador',async()=>{
 const i=identity('draft4');const d=await loadMonitorSupplyDraft(i);
 await assert.rejects(commitMonitorSupplyDraft(i,d),/área/);
 const chosen={...d,destinationAreaId:'barra'};
 await saveMonitorSupplyDraft(i,chosen);
 await assert.rejects(commitMonitorSupplyDraft(i,chosen),/productos entregados/);
 assert.equal((await loadMonitorSupplyDraft(i)).id,d.id);
});
test('si se interrumpe tras stage, al reabrir no reusa ID ya registrado',async()=>{
 const i=identity('draft5');let d=await loadMonitorSupplyDraft(i);
 d=addMonitorSupplyLine({...d,destinationAreaId:'cocina'},{
   productId:'agua',productName:'Agua',quantity:1,unit:'UND'
 });
 await saveMonitorSupplyDraft(i,d);
 // La cola se guarda y luego el borrador antiguo simula un fallo antes del reset.
 await commitMonitorSupplyDraft(i,d);
 await saveMonitorSupplyDraft(i,d);
 const next=await loadMonitorSupplyDraft(i);
 assert.notEqual(next.id,d.id);
 assert.equal((await getMonitorSupplyOutboxEntry(i,d.id)).delivery.lines[0].quantity,1);
});
test('se rechaza grabar borrador ajeno o de otro almacén',async()=>{
 const i=identity('draft6'),other=identity('draft-other');
 await assert.rejects(saveMonitorSupplyDraft(other,newMonitorSupplyDraft(i)),/otro usuario/);
 assert.notEqual(monitorSupplyDraftKey(i),monitorSupplyDraftKey(other));
});
