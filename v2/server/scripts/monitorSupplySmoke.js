import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const host=process.env.SMOKE_BASE_URL||'http://127.0.0.1:5190';
const stamp=Date.now().toString(36);
const workspaceKey='monitor-sup-'+stamp;
const bootstrap=async(name,key=workspaceKey)=>{
  const r=await api('/api/v1/dev/bootstrap',{method:'POST',body:{
    workspaceKey:key,externalUserId:'monitor-sup-'+stamp+'-'+name,
    displayName:'Monitor supply smoke '+name
  }});
  verify(r.status,200,'bootstrap');
  return r.body;
};
const a=await bootstrap('a');
const b=await bootstrap('b');
const outsider=await bootstrap('outsider','monitor-sup-other-'+stamp);
verify(a.workspace.id,b.workspace.id,'same warehouse');
const headersOf=user=>({
  'x-workspace-id':user.workspace.id,'x-user-id':user.user.id
});
const headersA=headersOf(a),headersB=headersOf(b),headersOut=headersOf(outsider);
const skuId='prd_supply_'+stamp;
const now=new Date().toISOString();
const event={
  id:'evt_monitor_supply_'+stamp,
  entityType:'product',entityId:skuId,operation:'CREATE',
  payload:{
    id:skuId,sku:'MON-SUP-'+stamp,name:'PRODUCTO SURTIDO PRUEBA',
    nameNormalized:'producto surtido prueba',aliases:[],barcode:'',
    categoryId:null,inventoryUnitId:'unit_und',
    purchaseUnitId:'unit_und',purchaseConversion:1,
    minStock:0,maxStock:0,replenishmentMethod:'BOTH',supplierId:null,
    active:true,version:1,createdAt:now,updatedAt:now
  }
};
const pushed=await api('/api/v1/sync/push',{method:'POST',headers:headersA,body:{events:[event]}});
verify(pushed.status,200,'product sync');
const newArea=await api('/api/v1/areas',{method:'POST',headers:headersA,body:{
  name:'Cocina smoke '+stamp
}});
verify(newArea.status,201,'create area');
const areaId=newArea.body.area.id;
const id='ms_'+stamp+'_alpha';
const input={
  id,operationalDate:'2026-10-11',destinationAreaId:areaId,notes:'Surtido sin stock',
  recordedBy:'forged-actor',
  lines:[
    {productId:skuId,quantity:3,unit:'UND',note:'vasos'},
    {productId:skuId,quantity:2,unit:'CAJA',note:'agua'}
  ]
};
let result=await api('/api/v1/monitor/supplies',{method:'POST',headers:headersA,body:input});
verify(result.status,201,'first insert');
verify(result.body.replayed,false,'first insertion not replay');
verify(result.body.delivery.recordedBy,a.user.id,'server actor, not forged actor');
verify(result.body.delivery.lines.length,2,'two unit distinct lines');
verify(result.body.delivery.status,'RECORDED','informational status');
const retry=await api('/api/v1/monitor/supplies',{method:'POST',headers:headersB,body:{
  ...input,lines:[...input.lines].reverse()
}});
verify(retry.status,200,'idempotent replay');
verify(retry.body.replayed,true,'replay result');
verify(retry.body.delivery.recordedBy,a.user.id,'original recorder remains');
const mismatch=await api('/api/v1/monitor/supplies',{method:'POST',headers:headersB,body:{
  ...input,lines:[{productId:skuId,quantity:99,unit:'UND'}]
}});
verify(mismatch.status,409,'conflicting duplicate id');
verify(mismatch.body.code,'MONITOR_SUPPLY_ID_CONFLICT','conflict code');
const betaId='ms_'+stamp+'_beta';
result=await api('/api/v1/monitor/supplies',{method:'POST',headers:headersB,body:{
  id:betaId,operationalDate:'2026-10-11',destinationAreaId:areaId,
  lines:[{productId:skuId,quantity:5,unit:'CAJA',note:'second delivery'}]
}});
verify(result.status,201,'second actor delivered');
verify(result.body.delivery.recordedBy,b.user.id,'second actor tracked');
const list=await api('/api/v1/monitor/supplies?from=2026-10-11&to=2026-10-11',{headers:headersA});
verify(list.status,200,'list');
verify(list.body.deliveries.length,2,'two deliveries no duplicate replay');
const paged=await api('/api/v1/monitor/supplies?limit=1',{headers:headersB});
verify(paged.body.deliveries.length,1,'pagination');
verify(paged.body.nextOffset,1,'next page pointer');
const page2=await api('/api/v1/monitor/supplies?limit=1&offset=1',{headers:headersB});
verify(page2.body.deliveries.length,1,'next page');
const summary=await api('/api/v1/monitor/supplies/consumption?from=2026-10-11&to=2026-10-11&areaId='+encodeURIComponent(areaId),{headers:headersB});
verify(summary.status,200,'consumption summary');
verify(summary.body.basis,'RECORDED_MONITOR_SUPPLIES_ONLY','basis is informational deliveries');
verify(summary.body.lines.length,2,'unit-safe distinct groups');
verify(summary.body.lines.find(x=>x.unit==='CAJA')?.quantity,7,'two deliveries sum CAJA=7');
verify(summary.body.lines.find(x=>x.unit==='UND')?.quantity,3,'UND separated from CAJA');
verify(summary.body.lines.find(x=>x.unit==='CAJA')?.deliveries,2,'CAJA recorded in two deliveries');
const crossList=await api('/api/v1/monitor/supplies',{headers:headersOut});
verify(crossList.body.deliveries.length,0,'workspace isolation');
const crossOne=await api('/api/v1/monitor/supplies/'+id,{headers:headersOut});
verify(crossOne.status,404,'no cross-workspace document access');
for(const [kind,body,expected] of [
  ['unknown product',{...input,id:'ms_'+stamp+'_missing',lines:[{productId:'nonexistent',quantity:1,unit:'UND'}]},'MONITOR_SUPPLY_PRODUCT_UNKNOWN'],
  ['unknown area',{...input,id:'ms_'+stamp+'_bad_area',destinationAreaId:'missing-area'},'MONITOR_SUPPLY_AREA_UNKNOWN'],
  ['quantity zero',{...input,id:'ms_'+stamp+'_zero',lines:[{productId:skuId,quantity:0,unit:'UND'}]},'MONITOR_SUPPLY_QUANTITY_INVALID'],
  ['duplicate same unit',{...input,id:'ms_'+stamp+'_duplicate',lines:[{productId:skuId,quantity:1,unit:'UND'},{productId:skuId,quantity:2,unit:'UND'}]},'MONITOR_SUPPLY_DUPLICATE_LINE'],
  ['invalid date',{...input,id:'ms_'+stamp+'_bad_date',operationalDate:'2026-02-30'},'MONITOR_SUPPLY_DATE_INVALID']
]){
  const failed=await api('/api/v1/monitor/supplies',{method:'POST',headers:headersA,body});
  verify(failed.status,400,kind);
  verify(failed.body.code,expected,kind+' code');
}
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try{
  const movements=await client.query('SELECT COUNT(*)::int n FROM movements WHERE workspace_id=$1',[a.workspace.id]);
  verify(movements.rows[0].n,0,'zero movements in old stock book');
  const originalDocs=await client.query('SELECT COUNT(*)::int n FROM documents WHERE workspace_id=$1',[a.workspace.id]);
  verify(originalDocs.rows[0].n,0,'no old V2 documents');
  const saved=await client.query('SELECT COUNT(*)::int n FROM monitor_supply_deliveries WHERE workspace_id=$1',[a.workspace.id]);
  verify(saved.rows[0].n,2,'exactly two immutable deliveries');
  const audited=await client.query(
    "SELECT COUNT(*)::int n FROM audit_events WHERE workspace_id=$1 AND action='MONITOR_SUPPLY_RECORDED'",
    [a.workspace.id]
  );
  verify(audited.rows[0].n,2,'audit once each, replay does not duplicate audit');
  await client.query('UPDATE workspace_members SET permissions=$1::jsonb,role_code=$2 WHERE workspace_id=$3 AND user_id=$4',
    ['[]','VIEWER',a.workspace.id,b.user.id]);
  const noPermission=await api('/api/v1/monitor/supplies',{method:'POST',headers:headersB,body:{
    ...input,id:'ms_'+stamp+'_forbidden'
  }});
  verify(noPermission.status,403,'unauthorized write rejected');
  const noRead=await api('/api/v1/monitor/supplies',{headers:headersB});
  verify(noRead.status,403,'unauthorized read rejected');
}finally{await client.end();}
console.log('MONITOR_SUPPLY_SMOKE_PASS: idempotent retries, authors, units, areas, reports, pagination, workspace boundaries, permissions, audits, zero inventory movements');

async function api(path,{method='GET',headers={},body}={}){
  const res=await fetch(host+path,{
    method,
    headers:{'content-type':'application/json',...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const parsed=await res.json();
  if(res.status>=500)throw new Error('HTTP '+res.status+': '+JSON.stringify(parsed));
  return {status:res.status,body:parsed};
}
function verify(actual,expected,reason){
  if(actual!==expected)throw new Error(reason+': expected '+JSON.stringify(expected)+' got '+JSON.stringify(actual));
}
