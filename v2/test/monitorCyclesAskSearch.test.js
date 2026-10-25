import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchMonitorProducts } from '../src/replenishment/monitorProductSearch.js';
import {
  reviewLocalKey,readMonitorReview,queueMonitorReviewChange,
  closeMonitorReviewRound,resolveMonitorActiveRound
} from '../src/replenishment/monitorReviewOffline.js';
import { buildMonitorNativeLists } from '../src/replenishment/monitorNativeTicketAdapter.js';
import { projectMonitorToNormal } from '../src/replenishment/monitorToNormalMirror.js';
import { buildThermalPrintPayload } from '../src/printing/thermalPrinterClient.js';
import { renderProcurementTickets } from '../src/ui/procurementWorkspaceV6Print.js';
import { DEFAULT_THERMAL_CONFIG,buildProcurementJob } from '../server/src/printing/thermalEscPos.js';

const opts={workspaceId:'w-cycles',userId:'u-cycles',weekStart:'2026-10-19'};
test('buscador local encuentra por nombre sin acento, SKU y código, sin red',()=>{
 const rows=[{id:'p1',name:'Agua mineral',sku:'0811',saintCode:'J-811'},
   {id:'p2',name:'Café molido',sku:'CAFE-02',barcode:'750888222'}];
 assert.deepEqual(searchMonitorProducts(rows,'cafe').map(x=>x.id),['p2']);
 assert.deepEqual(searchMonitorProducts(rows,'750888222').map(x=>x.id),['p2']);
 assert.deepEqual(searchMonitorProducts(rows,'agua 0811').map(x=>x.id),['p1']);
 assert.equal(searchMonitorProducts(rows,'sin resultado').length,0);
});
test('ciclos 1 y 2 usan colas separadas y no borran una revisión anterior',async()=>{
 const one={...opts,round:1},two={...opts,round:2};
 await queueMonitorReviewChange(one,{kind:'PRODUCT',itemId:'p1',decision:'BUY'});
 await queueMonitorReviewChange(two,{kind:'PRODUCT',itemId:'p1',decision:'ASK'});
 assert.notEqual(reviewLocalKey(one),reviewLocalKey(two));
 assert.equal((await readMonitorReview(one)).items[0].decision,'BUY');
 assert.equal((await readMonitorReview(two)).items[0].decision,'ASK');
});
test('Preguntar aparece en proyección pero nunca en lista de compra o pedido',()=>{
 const p=[{id:'p1',name:'Café',categoryId:'c1'}],c=[{id:'c1',name:'BEBIDAS'}];
 const snapshot=projectMonitorToNormal({products:p,categories:c,round:3,weekStart:opts.weekStart,
  serverItems:[{itemKey:'product:p1',kind:'PRODUCT',productId:'p1',
    decision:'ASK',quantity:null,unit:'CJ',notes:'Consultar producción'}]});
 assert.equal(snapshot.counts.asking,1);
 assert.equal(snapshot.lists.PURCHASE.length,0);
 assert.equal(snapshot.lists.ORDER.length,0);
 assert.equal(snapshot.lists.INQUIRY.length,1);
 const list=buildMonitorNativeLists(snapshot,{ownerLabel:'Almacén'}).find(x=>x.kind==='INQUIRY');
 assert.match(list.code,/-R3$/);
 const payload=buildThermalPrintPayload(list);
 assert.equal(payload.kind,'INQUIRY');
 assert.equal(payload.items[0].quantityText,'________ CJ');
 assert.match(renderProcurementTickets({list,businessName:'El Establo'}),/LISTA PARA PREGUNTAR/);
 assert.equal((renderProcurementTickets({list,businessName:'El Establo'}).match(/COPIA ÚNICA/g)||[]).length,2);
 const job=buildProcurementJob(DEFAULT_THERMAL_CONFIG,payload);
 assert.equal(job.copies,1);
 assert.equal((job.buffer.toString('latin1').match(/LISTA PARA PREGUNTAR/g)||[]).length>=1,true);
});
test('cierre se bloquea antes de HTTP cuando hay cambios sin sincronizar',async()=>{
 const o={...opts,userId:'u-queue-not-synced',round:1};
 await queueMonitorReviewChange(o,{kind:'PRODUCT',itemId:'p1',decision:'BUY'});
 let called=false;
 await assert.rejects(()=>closeMonitorReviewRound(o,{request:async()=>{called=true;}}),/cambios locales pendientes/);
 assert.equal(called,false);
});
test('cierre confirmado avanza ronda sin borrar archivo local anterior',async()=>{
 const o={...opts,userId:'u-close-verified',round:1};
 const calls=[];
 const result=await closeMonitorReviewRound(o,{request:async(path,config)=>{
  calls.push({path,body:config?.body});
  return {ok:true,closedRound:1,currentRound:2};
 }});
 assert.equal(result.currentRound,2);
 assert.equal(calls.length,1);
 assert.equal(calls[0].body.expectedRound,1);
 assert.equal((await resolveMonitorActiveRound(o,{request:async()=>{throw Error('VPN')}})).round,2);
 assert.equal((await readMonitorReview({...o,round:2})).items.length,0);
});
