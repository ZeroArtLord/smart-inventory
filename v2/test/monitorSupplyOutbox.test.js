import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monitorSupplyOutboxKey,stageMonitorSupplyDelivery,getMonitorSupplyOutboxEntry,
  listMonitorSupplyOutbox,flushPendingMonitorSupplies,
  flushMonitorSupplyDelivery,getMonitorRecordedSupplies,getMonitorSupplyConsumption
} from '../src/documents/monitorSupplyOutbox.js';
import { STORES,get } from '../src/storage/database.js';

const identity=t=>({workspaceId:'workspace-'+t,userId:'operator-'+t});
const document=(id='supply-xyz')=>({
  id,status:'RECORDED',operationalDate:'2026-10-11',
  destinationAreaId:'cocina',notes:'Entrega real',
  lines:[{productId:'agua',productName:'Agua',quantity:5,unit:'UND',note:''}]
});
test('prepara surtido duradero con identificador estable sin tocar V2',async()=>{
  const ident=identity('one');
  const value=await stageMonitorSupplyDelivery(ident,document('supply-01'));
  assert.equal(value.status,'PENDING');
  assert.equal(value.delivery.id,'supply-01');
  assert.equal((await getMonitorSupplyOutboxEntry(ident,'supply-01')).delivery.lines[0].quantity,5);
  assert.equal(await get(STORES.SYNC_QUEUE,'supply-01'),undefined);
});
test('reintentar preparación de mismo documento no duplica ni cambia el ID',async()=>{
  const ident=identity('two');
  const a=await stageMonitorSupplyDelivery(ident,document('supply-02'));
  const b=await stageMonitorSupplyDelivery(ident,document('supply-02'));
  assert.deepEqual(a,b);
});
test('rechaza reutilizar ID para un surtido diferente',async()=>{
  const ident=identity('three');
  await stageMonitorSupplyDelivery(ident,document('supply-03'));
  await assert.rejects(stageMonitorSupplyDelivery(ident,{
    ...document('supply-03'),notes:'Otra entrega'
  }),/No se permite cambiar/);
});
test('si está sin Internet el pendiente permanece guardado',async()=>{
  const ident=identity('four');
  await stageMonitorSupplyDelivery(ident,document('supply-04'));
  const result=await flushMonitorSupplyDelivery(ident,'supply-04',{
    isOnline:()=>false,request:async()=>{throw Error('No request expected');}
  });
  assert.equal(result.status,'PENDING');
});
test('envía exactamente el mismo identificador y marca como sincronizado',async()=>{
  const ident=identity('five');const id='supply-05';
  await stageMonitorSupplyDelivery(ident,document(id));
  let attempts=0;
  const request=async(path,options)=>{
    attempts++;
    assert.equal(path,'/api/v1/monitor/supplies');
    assert.equal(options.body.id,id);
    return {ok:true,delivery:{recordedAt:'2026-10-11T20:00:00Z'}};
  };
  const sent=await flushMonitorSupplyDelivery(ident,id,{request});
  assert.equal(sent.status,'SYNCED');
  assert.equal(sent.recordedAt,'2026-10-11T20:00:00Z');
  await flushMonitorSupplyDelivery(ident,id,{request});
  assert.equal(attempts,1);
});
test('error de red no borra surtido y el siguiente envío mantiene ID',async()=>{
  const ident=identity('six');const id='supply-06';
  await stageMonitorSupplyDelivery(ident,document(id));
  const failed=await flushMonitorSupplyDelivery(ident,id,{
    request:async()=>{throw Object.assign(Error('Timeout'),{status:503});}
  });
  assert.equal(failed.status,'PENDING');
  const retried=await flushMonitorSupplyDelivery(ident,id,{
    request:async(_,{body})=>{
      assert.equal(body.id,id);
      return {ok:true,delivery:{recordedAt:'2026-10-11T20:00:00Z'}};
    }
  });
  assert.equal(retried.status,'SYNCED');
});
test('conflicto preserva registro local y evita reenviarlo silenciosamente',async()=>{
  const ident=identity('seven');const id='supply-07';
  await stageMonitorSupplyDelivery(ident,document(id));
  const response=await flushMonitorSupplyDelivery(ident,id,{
    request:async()=>{throw Object.assign(Error('Collision'),{status:409,code:'MONITOR_SUPPLY_ID_CONFLICT'});}
  });
  assert.equal(response.status,'CONFLICT');
  assert.equal(response.delivery.id,id);
  assert.equal(response.conflict.code,'MONITOR_SUPPLY_ID_CONFLICT');
});
test('identidad diferente tiene outbox aislada',()=>{
  assert.notEqual(monitorSupplyOutboxKey(identity('a'),'supply-01'),
    monitorSupplyOutboxKey(identity('b'),'supply-01'));
});
test('consulta los reportes sin inferir stock',async()=>{
  let paths=[];
  const request=async path=>{paths.push(path);return {ok:true,basis:'RECORDED_MONITOR_SUPPLIES_ONLY',lines:[]};};
  await getMonitorRecordedSupplies({from:'2026-10-10',areaId:'cocina'},request);
  await getMonitorSupplyConsumption({to:'2026-10-12'},request);
  assert.match(paths[0],/from=2026-10-10/);
  assert.match(paths[0],/areaId=cocina/);
  assert.match(paths[1],/supplies\/consumption\?to=2026-10-12/);
});
test('solo acepta documentos registrados para la cola de envío',async()=>{
  await assert.rejects(stageMonitorSupplyDelivery(identity('eight'),{
    ...document('supply-08'),status:'DRAFT'
  }),/Solo se preparan/);
});

test('reconexión procesa pendientes del mismo operador sin tocar otra identidad',async()=>{
  const ident=identity('retry-batch'),other=identity('other-batch');
  await stageMonitorSupplyDelivery(ident,document('batch-one'));
  await stageMonitorSupplyDelivery(ident,document('batch-two'));
  await stageMonitorSupplyDelivery(other,document('batch-other'));
  const sent=[];
  const result=await flushPendingMonitorSupplies(ident,{
    request:async(_,{body})=>{
      sent.push(body.id);
      return {ok:true,delivery:{recordedAt:'2026-10-11T20:00:00Z'}};
    }
  });
  assert.deepEqual(sent,['batch-one','batch-two']);
  assert.deepEqual({attempted:result.attempted,synchronized:result.synchronized,pending:result.pending},
    {attempted:2,synchronized:2,pending:0});
  assert.equal((await listMonitorSupplyOutbox(other)).length,1);
});
test('dos envíos simultáneos del mismo documento emiten una sola petición',async()=>{
  const ident=identity('parallel');const id='parallel-one';
  await stageMonitorSupplyDelivery(ident,document(id));
  let count=0;
  const request=async()=>{count++;await new Promise(resolve=>setTimeout(resolve,5));
    return {ok:true,delivery:{recordedAt:'2026-10-11T20:00:00Z'}};
  };
  const [a,b]=await Promise.all([
    flushMonitorSupplyDelivery(ident,id,{request}),
    flushMonitorSupplyDelivery(ident,id,{request})
  ]);
  assert.equal(a.status,'SYNCED');assert.equal(b.status,'SYNCED');
  assert.equal(count,1);
});
test('reintentos batch conservan conflicto y otros pendientes',async()=>{
  const ident=identity('batch-conflict');
  await stageMonitorSupplyDelivery(ident,document('conflict-one'));
  await stageMonitorSupplyDelivery(ident,document('good-two'));
  const summary=await flushPendingMonitorSupplies(ident,{
    request:async(_,{body})=>{
      if(body.id==='conflict-one')throw Object.assign(new Error('Conflicto'),{status:409});
      return {ok:true,delivery:{recordedAt:'2026-10-11T20:00:00Z'}};
    }
  });
  assert.equal(summary.conflicts,1);
  assert.equal(summary.synchronized,1);
  assert.equal(summary.pending,0);
  assert.equal((await listMonitorSupplyOutbox(ident)).length,1);
  assert.equal((await listMonitorSupplyOutbox(ident))[0].status,'CONFLICT');
});
