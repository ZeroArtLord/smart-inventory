import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveSyncConfig } from '../src/sync/syncSettings.js';
import { queueMonitorReviewChange, readMonitorReview } from '../src/replenishment/monitorReviewOffline.js';
import { fetchMonitorMirrorForNormal, assertMonitorPrintable } from '../src/ui/monitorNormalMirrorUi.js';

// Falla si imprimir sincroniza la cola del ciclo 1 cuando el servidor ya va por el 2.
test('imprimir Preguntar sincroniza el ciclo activo y conserva la cola del ciclo anterior',async()=>{
  const options={workspaceId:'print-workspace',userId:'print-user',weekStart:'2026-10-19',round:2};
  await saveSyncConfig({workspaceId:options.workspaceId,serverUserId:options.userId,authMode:'dev'});
  await queueMonitorReviewChange({...options,round:1},{kind:'PRODUCT',itemId:'old',decision:'BUY'});
  await queueMonitorReviewChange(options,{kind:'PRODUCT',itemId:'coffee',decision:'ASK',
    quantity:null,unit:'CAJA',notes:'Consultar producción'});
  const remote=[],puts=[];
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async(url,config={})=>{
    assert.match(String(url),/\/api\/v1\/monitor\/reviews\/2026-10-19(?:\/items)?$/);
    if(config.method==='PUT'){
      const body=JSON.parse(config.body);puts.push(body);
      if(body.round!==2)return Response.json({ok:false,code:'MONITOR_CYCLE_CHANGED'}, {status:409});
      const item={itemKey:'product:coffee',kind:'PRODUCT',productId:'coffee',decision:body.decision,
        quantity:body.quantity,unit:body.unit,notes:body.notes,version:1};
      remote.push(item);
      return Response.json({ok:true,item,appliedVersion:1,replayed:false});
    }
    return Response.json({ok:true,workspaceId:options.workspaceId,weekStart:options.weekStart,
      currentRound:2,items:remote});
  };
  try{
    const snapshot=await fetchMonitorMirrorForNormal({session:options,weekStart:options.weekStart,
      products:[{id:'coffee',name:'Café',categoryId:'drinks',unitCode:'UND'}],
      categories:[{id:'drinks',name:'BEBIDAS'}],syncBeforeFetch:true});
    assert.equal(snapshot.counts.pendingLocal,0,'el ciclo activo debe enviarse antes de imprimir');
    assert.equal(snapshot.round,2);
    assert.equal(snapshot.lists.INQUIRY[0].notes,'Consultar producción');
    assert.equal(assertMonitorPrintable(snapshot),true);
    assert.deepEqual(puts.map(x=>x.round),[2]);
    assert.equal((await readMonitorReview({...options,round:1})).pendingCount,1);
  }finally{globalThis.fetch=previousFetch;}
});

test('imprimir rechaza un cierre de ciclo ocurrido durante la sincronización',async()=>{
  const session={workspaceId:'race-print-workspace',userId:'race-print-user'};
  const weekStart='2026-10-19';
  await saveSyncConfig({workspaceId:session.workspaceId,serverUserId:session.userId,authMode:'dev'});
  const previousFetch=globalThis.fetch;
  let reads=0;
  globalThis.fetch=async()=>Response.json({ok:true,workspaceId:session.workspaceId,
    weekStart,currentRound:++reads>=3?3:2,items:[]});
  try{
    await assert.rejects(()=>fetchMonitorMirrorForNormal({session,weekStart,products:[],categories:[],
      syncBeforeFetch:true}),/otro ciclo activo/);
  }finally{globalThis.fetch=previousFetch;}
});

test('un fallo de red bloquea imprimir y conserva la decisión Preguntar pendiente',async()=>{
  const options={workspaceId:'offline-print-workspace',userId:'offline-print-user',weekStart:'2026-10-19',round:2};
  await saveSyncConfig({workspaceId:options.workspaceId,serverUserId:options.userId,authMode:'dev'});
  await queueMonitorReviewChange(options,{kind:'PRODUCT',itemId:'coffee',decision:'ASK',unit:'KG'});
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async(url,config={})=>{
    if(config.method==='PUT')throw new TypeError('Failed to fetch');
    return Response.json({ok:true,workspaceId:options.workspaceId,weekStart:options.weekStart,
      currentRound:2,items:[]});
  };
  try{
    await assert.rejects(()=>fetchMonitorMirrorForNormal({session:options,weekStart:options.weekStart,
      products:[],categories:[],syncBeforeFetch:true}),/sincronizar el ciclo activo/);
    assert.equal((await readMonitorReview(options)).pendingCount,1);
    assert.equal((await readMonitorReview(options)).items[0].decision,'ASK');
  }finally{globalThis.fetch=previousFetch;}
});
