// Solo DB aislada de pruebas; nunca ejecutar con datos de El Establo.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {buildSupplierOrderGroups,supplierOrderFingerprint} from '../../src/replenishment/monitorSupplierOrders.js';
if(process.env.NODE_ENV!=='test')throw Error('Solo NODE_ENV=test');
const base=process.env.SMOKE_BASE_URL||'http://127.0.0.1:5190';
const seed=randomUUID().slice(0,8);let headers={};
async function call(path,body,method=body?'POST':'GET',h=headers){
 const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...h},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();assert.ok(r.status<500,JSON.stringify(data));return {status:r.status,...data};
}
const a=await call('/api/v1/dev/bootstrap',{workspaceKey:'supplier-smoke-'+seed,externalUserId:'supplier-'+seed,displayName:'Supplier CI'});
headers={'x-workspace-id':a.workspace.id,'x-user-id':a.user.id};
const route='/api/v1/monitor';const week='2026-10-19',scope=route+'/reviews/'+week;
let r=await call(route+'/suppliers');assert.equal(r.status,200,'supplier route installed');
const supplierId='supplier-'+seed;
r=await call(route+'/suppliers/'+supplierId,{name:'Sumervalca',phone:'0414-1234567',expectedVersion:0},'PUT');assert.equal(r.status,200);assert.equal(r.supplier.phone,'584141234567');
assert.equal((await call(route+'/suppliers/'+supplierId,{name:'Old write',phone:'04141234567',expectedVersion:0},'PUT')).status,409);
const now=new Date().toISOString(),productId='supplier-product-'+seed;
await call('/api/v1/sync/push',{events:[{id:'evt-'+seed,entityType:'product',entityId:productId,operation:'CREATE',payload:{
 id:productId,sku:'S-'+seed,name:'Servilletas',nameNormalized:'servilletas',aliases:[],barcode:'',categoryId:null,
 inventoryUnitId:'unit_und',purchaseUnitId:'unit_und',purchaseConversion:1,minStock:0,maxStock:0,replenishmentMethod:'BOTH',supplierId:null,
 active:true,version:1,createdAt:now,updatedAt:now}}]});
let v=0;
async function choose(quantity,unit='CAJA'){
 const q=await call(scope+'/items',{kind:'PRODUCT',itemId:productId,decision:'ORDER',quantity,unit,round:1,expectedVersion:v,mutationId:randomUUID()},'PUT');
 assert.ok([200,201].includes(q.status));v=q.item.version;
}
await choose(null);
const key='product:'+productId;
r=await call(scope+'/supplier-assignments/'+encodeURIComponent(key),{round:1,supplierId,expectedVersion:0},'PUT');assert.equal(r.status,200);
assert.equal((await call(scope+'/supplier-orders',{round:1,fingerprint:'invalid'})).status,400,'quantity mandatory');
await choose(3,'');
assert.equal((await call(scope+'/supplier-orders',{round:1,fingerprint:'invalid'})).status,400,'package mandatory');
await choose(3);
await call(route+'/suppliers/'+supplierId,{name:'Sumervalca',phone:'04141234567',active:false,expectedVersion:1},'PUT');
assert.equal((await call(scope+'/supplier-orders',{round:1,fingerprint:'invalid'})).status,400,'inactive supplier blocked');
await call(route+'/suppliers/'+supplierId,{name:'Sumervalca',phone:'04141234567',active:true,expectedVersion:2},'PUT');
r=await call(scope+'/supplier-orders');assert.equal(r.items[0].quantity,3);
let groups=buildSupplierOrderGroups({items:r.items,suppliers:r.suppliers,selections:{[key]:supplierId}});
const signature=supplierOrderFingerprint(groups);
let finalized=await call(scope+'/supplier-orders',{round:1,fingerprint:signature});assert.equal(finalized.status,200);assert.equal(finalized.orders.length,1);
for(const retry of await Promise.all([call(scope+'/supplier-orders',{round:1,fingerprint:signature}),call(scope+'/supplier-orders',{round:1,fingerprint:signature})]))assert.equal(retry.orders[0].id,finalized.orders[0].id,'concurrent idempotent finalize');
const id=finalized.orders[0].id;
for(const sent of await Promise.all([call(route+'/supplier-orders/'+id+'/sent',{}),call(route+'/supplier-orders/'+id+'/sent',{})]))assert.equal(sent.status,200,'concurrent idempotent sent');
r=await call(scope+'/supplier-orders');assert.equal(r.preferences[productId],supplierId);
await choose(4);
assert.equal((await call(scope+'/supplier-orders',{round:1,fingerprint:signature})).status,409,'stale preview blocked');
r=await call(scope+'/supplier-orders');groups=buildSupplierOrderGroups({items:r.items,suppliers:r.suppliers,selections:{[key]:supplierId}});
finalized=await call(scope+'/supplier-orders',{round:1,fingerprint:supplierOrderFingerprint(groups)});assert.equal(finalized.orders[0].replacesOrderId,id);
const fourId=finalized.orders[0].id;
assert.equal((await call(route+'/supplier-orders/'+fourId+'/sent',{})).status,200);
await choose(3);
r=await call(scope+'/supplier-orders');groups=buildSupplierOrderGroups({items:r.items,suppliers:r.suppliers,selections:{[key]:supplierId}});
const reverted=await call(scope+'/supplier-orders',{round:1,fingerprint:supplierOrderFingerprint(groups)});
assert.notEqual(reverted.orders[0].id,id,'reverting to earlier sent content needs a NEW correction');
assert.equal(reverted.orders[0].replacesOrderId,fourId);
assert.equal(reverted.orders[0].status,'FINALIZED');
const foreign=await call('/api/v1/dev/bootstrap',{workspaceKey:'foreign-supplier-'+seed,externalUserId:'foreign-'+seed,displayName:'Foreign'},'POST',{});
const other={'x-workspace-id':foreign.workspace.id,'x-user-id':foreign.user.id};
assert.equal((await call(route+'/supplier-orders/'+id+'/sent',{},'POST',other)).status,404);
assert.equal((await call(scope+'/supplier-orders',{round:2,fingerprint:signature})).status,409,'stale cycle blocked');
const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();
try{
 assert.equal((await c.query('SELECT count(*)::int n FROM movements WHERE workspace_id=$1',[a.workspace.id])).rows[0].n,0);
 assert.equal((await c.query('SELECT uses FROM monitor_supplier_preferences WHERE workspace_id=$1',[a.workspace.id])).rows[0].uses,2);
 assert.equal((await c.query('SELECT items FROM monitor_supplier_orders WHERE workspace_id=$1 AND id=$2',[a.workspace.id,id])).rows[0].items[0].quantity,3,'immutable old order');
}finally{await c.end();}
console.log('MONITOR_SUPPLIER_ORDERS_SMOKE_PASS: mandatory fields, conflict, isolation, immutable snapshots, learned supplier, idempotency, zero stock');
