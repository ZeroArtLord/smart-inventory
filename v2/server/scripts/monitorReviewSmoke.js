import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const api = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5190';
const stamp = Date.now().toString(36);
const workspaceKey = 'monitor-' + stamp;
const bootstrap = async suffix => (await call('/api/v1/dev/bootstrap',{
  method:'POST',body:{workspaceKey,externalUserId:'monitor-'+stamp+'-'+suffix,displayName:'Monitor CI '+suffix}
})).body;
const a=await bootstrap('a');
const b=await bootstrap('b');
if (a.workspace.id !== b.workspace.id) throw new Error('Mismo almacén debe compartir workspace');
const headersA={ 'x-workspace-id':a.workspace.id,'x-user-id':a.user.id };
const headersB={ 'x-workspace-id':b.workspace.id,'x-user-id':b.user.id };
const monday='2026-10-12';
const route='/api/v1/monitor/reviews/'+monday;
const productId='prd_monitor_'+stamp;
const now=new Date().toISOString();
const productEvent={
  id:'evt_monitor_'+stamp,entityType:'product',entityId:productId,operation:'CREATE',
  payload:{
    id:productId,sku:'MON-'+stamp,name:'ARTICULO DE PRUEBA MONITOR',
    nameNormalized:'articulo de prueba monitor',aliases:[],barcode:'',
    categoryId:null,inventoryUnitId:'unit_und',purchaseUnitId:'unit_und',purchaseConversion:1,
    minStock:0,maxStock:0,replenishmentMethod:'BOTH',supplierId:null,
    active:true,version:1,createdAt:now,updatedAt:now
  }
};
expect((await call('/api/v1/sync/push',{method:'POST',headers:headersA,body:{events:[productEvent]}})).status,200,'create catalog product');
let result=await call(route,{headers:headersA});
expect(result.body.items.length,0,'fresh list empty');
const buy={
  kind:'PRODUCT',itemId:productId,decision:'BUY',quantity:null,
  unit:'UND',expectedVersion:0,mutationId:randomUUID()
};
result=await call(route+'/items',{method:'PUT',headers:headersA,body:buy});
expect(result.status,201,'new product');
expect(result.body.item.quantity,null,'preserve null quantity');
expect(result.body.item.version,1,'initial version');
result=await call(route,{headers:headersB});
expect(result.body.items.length,1,'cross-user visibility');
expect(result.body.items[0].updatedBy,a.user.id,'server-enforced actor');
const replay=await call(route+'/items',{method:'PUT',headers:headersA,body:buy});
expect(replay.body.replayed,true,'exact retry idempotent');
expect(replay.body.appliedVersion,1,'replay original version');
result=await call(route+'/items',{method:'PUT',headers:headersB,body:{
  ...buy,decision:'ORDER',expectedVersion:0,mutationId:randomUUID()
}});
expect(result.status,409,'reject stale version');
expect(result.body.code,'REVIEW_CONFLICT','typed conflict');
result=await call(route+'/items',{method:'PUT',headers:headersB,body:{
  ...buy,decision:'ORDER',quantity:5,expectedVersion:1,mutationId:randomUUID()
}});
expect(result.status,200,'second user can edit');
expect(result.body.item.quantity,5,'quantity update');
expect(result.body.item.updatedBy,b.user.id,'updated actor');
result=await call(route+'/items',{method:'PUT',headers:headersB,body:{
  kind:'EXTRA',itemId:'cinta-metrica',description:'Cinta métrica',
  decision:'BUY',quantity:null,expectedVersion:0,mutationId:randomUUID()
}});
expect(result.status,201,'extra without catalog');
expect(result.body.item.description,'Cinta métrica','freeform item');
expect(result.body.item.quantity,null,'extra quantity blank');
const invalid=await call(route+'/items',{method:'PUT',headers:headersA,body:{
  ...buy,itemId:'product_missing',mutationId:randomUUID()
}});
expect(invalid.status,400,'unknown product rejected');
result=await call(route+'/items',{method:'PUT',headers:headersA,body:{
  ...buy,quantity:0,expectedVersion:2,mutationId:randomUUID()
}});
expect(result.status,400,'zero quantity rejected');
result=await call(route,{headers:headersA});
expect(result.body.items.length,2,'both items persisted');
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
try {
 const movements=await db.query('SELECT count(*)::int AS n FROM movements WHERE workspace_id=$1',[a.workspace.id]);
 expect(movements.rows[0].n,0,'no stock movements');
 const audits=await db.query(
   "SELECT count(*)::int AS n FROM audit_events WHERE workspace_id=$1 AND action='MONITOR_WEEKLY_REVIEW_ITEM_SAVED'",
   [a.workspace.id]
 );
 expect(audits.rows[0].n,3,'audits of 3 real edits, not retries/conflicts');
} finally { await db.end(); }
console.log('MONITOR_REVIEW_SMOKE_PASS: shared workspaces, two users, idempotency, versions, extras, null quantities, audits, zero stock movements');

async function call(path,{method='GET',headers={},body}={}) {
 const resp=await fetch(api+path,{
   method,headers:{'content-type':'application/json',...headers},
   body:body===undefined?undefined:JSON.stringify(body)
 });
 const value=await resp.json();
 if(resp.status>=500)throw new Error('API '+resp.status+': '+JSON.stringify(value));
 return {status:resp.status,body:value};
}
function expect(actual,expected,reason) {
 if(actual!==expected)throw new Error(reason+' expected '+JSON.stringify(expected)+' but got '+JSON.stringify(actual));
}
