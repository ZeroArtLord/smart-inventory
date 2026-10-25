// CI only: create a disposable workspace; never run on El Establo's real DB.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const url=process.env.SMOKE_BASE_URL||'http://127.0.0.1:5190';
if(process.env.NODE_ENV!=='test')throw Error('Smoke de ciclos solo en CI (NODE_ENV=test)');
const seed=Date.now().toString(36),workspaceKey='cycle-smoke-'+seed;
async function call(path,body,headers={},method=body?'POST':'GET'){
 const res=await fetch(url+path,{
  method,headers:{'content-type':'application/json',...headers},
  body:body?JSON.stringify(body):undefined
 });
 const data=await res.json();
 if(res.status>=500)throw Error('Server '+res.status+' '+JSON.stringify(data));
 return {status:res.status,body:data};
}
function eq(a,b,label){if(a!==b)throw Error(label+': '+JSON.stringify(a)+' !== '+JSON.stringify(b));}
const bootstrap=await call('/api/v1/dev/bootstrap',{
 workspaceKey,externalUserId:'ci-cycles-'+seed,displayName:'Cycle CI'
});
eq(bootstrap.status,200,'bootstrap');
const a=bootstrap.body;
const headers={'x-workspace-id':a.workspace.id,'x-user-id':a.user.id};
const monday='2026-10-19',route='/api/v1/monitor/reviews/'+monday;
const productId='p_cycle_'+seed;
const now=new Date().toISOString();
const event={id:'evt_cycle_'+seed,entityType:'product',entityId:productId,operation:'CREATE',
 payload:{id:productId,sku:'CI-'+seed,name:'Producto solo smoke',
 nameNormalized:'producto solo smoke',aliases:[],barcode:'',categoryId:null,
 inventoryUnitId:'unit_und',purchaseUnitId:'unit_und',purchaseConversion:1,
 minStock:0,maxStock:0,replenishmentMethod:'BOTH',supplierId:null,
 active:true,version:1,createdAt:now,updatedAt:now}};
eq((await call('/api/v1/sync/push',{events:[event]},headers)).status,200,'product');
let r=await call(route,undefined,headers);
eq(r.body.currentRound,1,'initial round');
r=await call(route+'/items',{kind:'PRODUCT',itemId:productId,decision:'ASK',quantity:null,
 round:1,expectedVersion:0,mutationId:randomUUID()},headers,'PUT');
eq(r.status,201,'ASK saved');
r=await call(route+'/close',{expectedRound:1},headers);
eq(r.status,409,'cannot close with ASK unresolved');
eq(r.body.code,'MONITOR_CYCLE_INCOMPLETE','ASK close rejection');
r=await call(route+'/items',{kind:'PRODUCT',itemId:productId,decision:'BUY',
 quantity:2,unit:'CAJA',notes:'rebanadas',round:1,expectedVersion:1,
 mutationId:randomUUID()},headers,'PUT');
eq(r.status,200,'ASK promoted BUY');
r=await call(route+'/close',{expectedRound:1},headers);
eq(r.status,200,'closed');
eq(r.body.closedRound,1,'closed round');
eq(r.body.currentRound,2,'new round');
r=await call(route,undefined,headers);
eq(r.body.currentRound,2,'active round two');
eq(r.body.items.length,0,'fresh list no old decisions');
r=await call(route+'/items',{kind:'PRODUCT',itemId:productId,decision:'ORDER',
 round:1,expectedVersion:0,mutationId:randomUUID()},headers,'PUT');
eq(r.status,409,'stale device blocked');
eq(r.body.code,'MONITOR_CYCLE_CHANGED','typed stale error');
r=await call(route+'/items',{kind:'PRODUCT',itemId:productId,decision:'ORDER',
 round:2,expectedVersion:0,mutationId:randomUUID()},headers,'PUT');
eq(r.status,201,'new round can select product');
r=await call('/api/v1/monitor/review-history',undefined,headers);
eq(r.status,200,'all-week history');
eq(r.body.archives.length,1,'one archived cycle');
r=await call(route+'/history/1',undefined,headers);
eq(r.status,200,'archive get');
eq(r.body.items[0].decision,'BUY','old decision kept');
eq(r.body.items[0].quantity,2,'old quantity kept');
eq(r.body.items[0].notes,'rebanadas','old note kept');
const c=new pg.Client({connectionString:process.env.DATABASE_URL});
await c.connect();
try{
 const m=await c.query('SELECT COUNT(*)::int AS n FROM movements WHERE workspace_id=$1',[a.workspace.id]);
 eq(m.rows[0].n,0,'no stock movements');
 const ar=await c.query('SELECT COUNT(*)::int AS n FROM monitor_review_archives WHERE workspace_id=$1',[a.workspace.id]);
 eq(ar.rows[0].n,1,'immutable archive persisted');
}finally{await c.end();}
console.log('MONITOR_CYCLE_CLOSURE_SMOKE_PASS: ASK blocks close, archived lists preserved, round2 empty, stale device 409, zero stock');
