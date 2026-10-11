import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewLocalKey,readMonitorReview,queueMonitorReviewChange,
  syncMonitorReview,inspectMonitorReviewConflicts
} from '../src/replenishment/monitorReviewOffline.js';
import { STORES,get } from '../src/storage/database.js';

const opts=tag=>({workspaceId:'warehouse-'+tag,userId:'user-'+tag,weekStart:'2026-10-12'});
const buy=id=>({kind:'PRODUCT',itemId:id,decision:'BUY',quantity:null});
const extra=(id='cinta')=>({kind:'EXTRA',itemId:id,description:'Cinta métrica',decision:'BUY'});
const api=()=>{
  const items=new Map();
  const mutations=new Map();
  const requests=[];
  let failNext=0;
  const request=async(path,options={})=>{
    const body=options.body;
    requests.push({path,body});
    if(failNext>0){failNext--;throw Object.assign(new Error('Sin conexión'),{code:'OFFLINE'});}
    if(!options.method){return {ok:true,items:[...items.values()]};}
    const key=(body.kind==='PRODUCT'?'product:':'extra:')+body.itemId;
    if(mutations.has(body.mutationId))return {ok:true,item:items.get(key),replayed:true};
    const old=items.get(key);
    if(body.expectedVersion!==(old?.version||0))throw Object.assign(new Error('Cambio concurrente'),{
      status:409,code:'REVIEW_CONFLICT',details:{latest:old||null}
    });
    const next={itemKey:key,...body,version:(old?.version||0)+1};
    items.set(key,next);
    mutations.set(body.mutationId,true);
    return {ok:true,item:next};
  };
  return {request,requests,items,failOnce:()=>{failNext++;}};
};

test('clave local aislada por almacén, usuario y semana',()=>{
 const a=reviewLocalKey(opts('a'));
 const b=reviewLocalKey({...opts('a'),userId:'other'});
 assert.notEqual(a,b);
 assert.throws(()=>reviewLocalKey({...opts('a'),weekStart:'2026-10-11'}),/lunes/);
});
test('guardar offline mantiene cantidad nula en IndexedDB y no usa cola V2',async()=>{
 const o=opts('first');
 const saved=await queueMonitorReviewChange(o,buy('pepsi'));
 assert.equal(saved.status,'LOCAL');
 assert.equal(saved.items[0].quantity,null);
 assert.equal(saved.pendingCount,1);
 const record=await get(STORES.SETTINGS,reviewLocalKey(o));
 assert.equal(record.value.queue.length,1);
 assert.equal((await readMonitorReview(o)).items[0].decision,'BUY');
});
test('offline no quita pendientes ni finge sincronización',async()=>{
 const o=opts('offline');
 await queueMonitorReviewChange(o,buy('pepsi'));
 const mock=api();
 const result=await syncMonitorReview(o,{request:mock.request,isOnline:()=>false});
 assert.equal(result.network,'OFFLINE');
 assert.equal(result.pendingCount,1);
 assert.equal(mock.requests.length,0);
});
test('online envía cambio, lo conserva en servidor y limpia solo cola monitor',async()=>{
 const o=opts('sent'); const server=api();
 await queueMonitorReviewChange(o,buy('pepsi'));
 const result=await syncMonitorReview(o,{request:server.request,isOnline:()=>true});
 assert.equal(result.network,'ONLINE');
 assert.equal(result.status,'SYNCED');
 assert.equal(result.pendingCount,0);
 assert.equal(result.items[0].quantity,null);
 assert.equal(server.items.get('product:pepsi').version,1);
});
test('varios cambios offline sobre el mismo producto conservan orden y versiones',async()=>{
 const o=opts('double');const server=api();
 await queueMonitorReviewChange(o,buy('pepsi'));
 await queueMonitorReviewChange(o,{...buy('pepsi'),decision:'ORDER',quantity:3});
 const before=await readMonitorReview(o);
 assert.deepEqual(before.queue.map(x=>x.expectedVersion),[0,1]);
 const after=await syncMonitorReview(o,{request:server.request});
 assert.equal(after.items[0].decision,'ORDER');
 assert.equal(after.items[0].quantity,3);
 assert.equal(after.items[0].version,2);
 assert.equal(after.queue.length,0);
});
test('una caída del servidor preserva todo para reintentar',async()=>{
 const o=opts('network');const server=api();
 await queueMonitorReviewChange(o,buy('agua'));
 server.failOnce();
 const failed=await syncMonitorReview(o,{request:server.request});
 assert.equal(failed.network,'RETRY_LATER');
 assert.equal(failed.pendingCount,1);
 const recovered=await syncMonitorReview(o,{request:server.request});
 assert.equal(recovered.network,'ONLINE');
 assert.equal(recovered.pendingCount,0);
});
test('extra libre sin catálogo y sin cantidad llega al servidor',async()=>{
 const o=opts('extra');const server=api();
 await queueMonitorReviewChange(o,extra('cinta'));
 const result=await syncMonitorReview(o,{request:server.request});
 assert.equal(result.items[0].description,'Cinta métrica');
 assert.equal(result.items[0].quantity,null);
 assert.equal(result.items[0].kind,'EXTRA');
});
test('conflicto no borra decisión local ni pisa dato remoto',async()=>{
 const o=opts('conflict');const server=api();
 await queueMonitorReviewChange(o,buy('pepsi'));
 server.items.set('product:pepsi',{itemKey:'product:pepsi',itemId:'pepsi',kind:'PRODUCT',decision:'ORDER',quantity:9,version:4});
 const result=await syncMonitorReview(o,{request:server.request});
 assert.equal(result.conflictCount,1);
 assert.equal(result.status,'CONFLICT');
 assert.equal(result.queue[0].status,'CONFLICT');
 assert.equal(result.items[0].decision,'BUY'); // La decisión del usuario no se pierde.
 assert.equal((await inspectMonitorReviewConflicts(o))[0].conflict.remote.quantity,9);
});
test('conflictos de un artículo no bloquean otros',async()=>{
 const o=opts('partial');const server=api();
 await queueMonitorReviewChange(o,buy('pepsi'));
 await queueMonitorReviewChange(o,buy('agua'));
 server.items.set('product:pepsi',{itemKey:'product:pepsi',itemId:'pepsi',decision:'ORDER',version:1});
 const result=await syncMonitorReview(o,{request:server.request});
 assert.equal(result.conflictCount,1);
 assert.equal(result.pendingCount,0);
 assert.equal(server.items.get('product:agua').decision,'BUY');
});
test('sucesivas ediciones de un elemento conflictivo no se envían por detrás',async()=>{
 const o=opts('blocked');const server=api();
 await queueMonitorReviewChange(o,buy('pepsi'));
 await queueMonitorReviewChange(o,{...buy('pepsi'),decision:'ORDER'});
 server.items.set('product:pepsi',{itemKey:'product:pepsi',version:2,decision:'NOT_NEEDED'});
 const result=await syncMonitorReview(o,{request:server.request});
 assert.equal(result.conflictCount,1);
 assert.equal(result.pendingCount,1);
 assert.equal(server.items.get('product:pepsi').decision,'NOT_NEEDED');
});
test('los IDs de mutación permanecen iguales tras recarga o reintento',async()=>{
 const o=opts('retry');const server=api();
 await queueMonitorReviewChange(o,buy('arroz'));
 const first=(await readMonitorReview(o)).queue[0].mutationId;
 server.failOnce();
 await syncMonitorReview(o,{request:server.request});
 const second=(await readMonitorReview(o)).queue[0].mutationId;
 assert.equal(second,first);
});
test('validación protege el borrador ante valores 0 y decisión inválida',async()=>{
 const o=opts('validation');
 await assert.rejects(queueMonitorReviewChange(o,{...buy('pepsi'),quantity:0}),/Cantidad/);
 await assert.rejects(queueMonitorReviewChange(o,{...buy('pepsi'),decision:'WRONG'}),/Decisión/);
 assert.equal((await readMonitorReview(o)).pendingCount,0);
});
test('ningún archivo de revisión toca la cola compartida de V2',async()=>{
 const o=opts('legacy');
 await queueMonitorReviewChange(o,buy('pepsi'));
 const server=api();
 await syncMonitorReview(o,{request:server.request});
 assert.equal(await get(STORES.SYNC_QUEUE,'monitor'),undefined);
});
