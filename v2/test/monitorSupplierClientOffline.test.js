import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {saveSyncConfig} from '../src/sync/syncSettings.js';
import {queueMonitorReviewChange,readMonitorReview} from '../src/replenishment/monitorReviewOffline.js';
import {supplierApi} from '../src/replenishment/monitorSupplierClient.js';
for(const mode of ['offline','conflict'])test('finalizar proveedores bloquea revisión '+mode+' sin perder cantidades',async()=>{
 const ctx={workspaceId:'supplier-'+mode,userId:'u-'+mode,weekStart:'2026-10-19',round:2};
 await saveSyncConfig({workspaceId:ctx.workspaceId,serverUserId:ctx.userId,authMode:'dev'});
 await queueMonitorReviewChange(ctx,{kind:'PRODUCT',itemId:'p1',decision:'ORDER',quantity:8,unit:'CAJA'});
 let finalized=0;const previous=globalThis.fetch;
 globalThis.fetch=async(url,config={})=>{
   if(config.method==='PUT'){
     assert.equal(JSON.parse(config.body).round,2);
     if(mode==='offline')throw new TypeError('Failed to fetch');
     return Response.json({ok:false,code:'REVIEW_CONFLICT',message:'Conflicto'},{status:409});
   }
   if(config.method==='POST'){finalized++;return Response.json({ok:true,orders:[]});}
   return Response.json({ok:true,workspaceId:ctx.workspaceId,weekStart:ctx.weekStart,currentRound:2,items:[]});
 };
 try{
   await assert.rejects(()=>supplierApi.finalize(ctx,'old-preview'),/sincronizar|conflicto/i);
   assert.equal(finalized,0,'no se debe finalizar con cantidad local distinta');
   const local=await readMonitorReview(ctx);assert.equal(local.items[0].quantity,8);
   assert.equal(mode==='offline'?local.pendingCount:local.conflictCount,1);
 }finally{globalThis.fetch=previous;}
});
test('recupera un ACK perdido solo si coincide exactamente el proveedor guardado',async()=>{
 const {reconcileSupplierDraft}=await import('../src/replenishment/monitorSupplierClient.js');
 const draft={'product:p1':{supplierId:'s1',expectedVersion:0},'product:p2':{supplierId:'s2',expectedVersion:0},
   'product:removed':{supplierId:'s1',expectedVersion:0}};
 const data={items:[{itemKey:'product:p1'},{itemKey:'product:p2'}],assignments:[
   {itemKey:'product:p1',supplierId:'s1',version:1},{itemKey:'product:p2',supplierId:'s3',version:1}]};
 assert.deepEqual(reconcileSupplierDraft(draft,data),{'product:p2':{supplierId:'s2',expectedVersion:0}});
});
