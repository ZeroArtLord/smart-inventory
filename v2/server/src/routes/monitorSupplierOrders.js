import {Router} from 'express';
import {createHash} from 'node:crypto';
import {pool,withTransaction} from '../db.js';
import {hasPermission,PERMISSIONS} from '../security/permissions.js';
import {writeAuditEvent} from '../audit/auditService.js';
import {requireActiveMonitorRound} from './monitorReviewCycles.js';
import {normalizeSupplier,buildSupplierOrderGroups,supplierOrderFingerprint} from '../../../src/replenishment/monitorSupplierOrders.js';
export const monitorSupplierOrderRouter=Router();
function fail(message,code='MONITOR_SUPPLIER_INVALID',statusCode=400){const e=Error(message);e.code=code;e.statusCode=statusCode;return e;}
function access(auth,write=false){
 const perms=write?[PERMISSIONS.PURCHASE_WRITE,PERMISSIONS.COUNT_WRITE,PERMISSIONS.SUPPLY_WRITE]:[PERMISSIONS.CATALOG_VIEW,PERMISSIONS.PURCHASE_WRITE,PERMISSIONS.COUNT_WRITE];
 if(!auth||!perms.some(p=>hasPermission(auth,p)))throw fail('Sin permiso de proveedores','PERMISSION_DENIED',403);
}
function id(raw){const s=String(raw||'');if(!/^[a-zA-Z0-9_.:-]{1,150}$/.test(s))throw fail('Identificador inválido');return s;}
function week(raw){const s=String(raw||''),d=new Date(s+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s||d.getUTCDay()!==1)throw fail('Semana inválida');return s;}
function integer(raw,min=0){const n=Number(raw);if(raw==null||!Number.isSafeInteger(n)||n<min)throw fail('Versión o ciclo inválido');return n;}
function supplier(row){return {id:row.id,name:row.name,phone:row.phone,active:row.active,version:row.version};}
function order(row){return {id:row.id,weekStart:row.week_start,round:row.round_number,supplierId:row.supplier_id,
 supplier:row.supplier_snapshot,items:row.items,status:row.status,replacesOrderId:row.replaces_order_id,
 finalizedAt:row.finalized_at,sentAt:row.sent_at};}
async function audit(c,auth,action,entityId,metadata={}){await writeAuditEvent(c,auth,{action,entityType:'monitorSupplierOrder',entityId,metadata});}
async function context(c,workspaceId,date,lock=false){
 const cycle=await c.query('SELECT current_round FROM monitor_review_cycles WHERE workspace_id=$1 AND week_start=$2::date',[workspaceId,date]);
 const round=cycle.rows[0]?.current_round||1;
 const suppliers=(await c.query('SELECT * FROM monitor_suppliers WHERE workspace_id=$1 ORDER BY name,id'+(lock?' FOR SHARE':''),[workspaceId])).rows.map(supplier);
 const items=(await c.query(`SELECT m.item_key,m.product_id,m.kind,COALESCE(p.name,m.description) AS name,
   m.quantity,m.unit,m.notes,m.version,(m.kind='PRODUCT' AND (p.id IS NULL OR p.active=false)) AS unavailable
   FROM monitor_weekly_review_items m LEFT JOIN products p ON p.workspace_id=m.workspace_id AND p.id=m.product_id
   WHERE m.workspace_id=$1 AND m.week_start=$2::date AND m.decision='ORDER' AND m.deleted=false
   ORDER BY m.item_key${lock?' FOR UPDATE OF m':''}`,[workspaceId,date])).rows.map(x=>({itemKey:x.item_key,productId:x.product_id,kind:x.kind,
     name:x.name,quantity:x.quantity==null?null:Number(x.quantity),unit:x.unit,notes:x.notes,version:x.version,unavailable:x.unavailable}));
 const assignments=(await c.query('SELECT item_key,supplier_id,version FROM monitor_supplier_assignments WHERE workspace_id=$1 AND week_start=$2::date AND round_number=$3',[workspaceId,date,round])).rows.map(x=>({itemKey:x.item_key,supplierId:x.supplier_id,version:x.version}));
 const prefs=await c.query(`SELECT DISTINCT ON(p.product_id) p.product_id,p.supplier_id FROM monitor_supplier_preferences p
   JOIN monitor_suppliers s ON s.workspace_id=p.workspace_id AND s.id=p.supplier_id AND s.active=true
   WHERE p.workspace_id=$1 ORDER BY p.product_id,p.last_confirmed_at DESC,p.uses DESC,p.supplier_id`,[workspaceId]);
 const orders=(await c.query('SELECT *,week_start::text AS week_start FROM monitor_supplier_orders WHERE workspace_id=$1 ORDER BY finalized_at DESC,id LIMIT 100',[workspaceId])).rows.map(order);
 return {weekStart:date,round,suppliers,items,assignments,preferences:Object.fromEntries(prefs.rows.map(x=>[x.product_id,x.supplier_id])),orders};
}
monitorSupplierOrderRouter.get('/suppliers',async(req,res,next)=>{try{
 access(req.auth);const r=await pool.query('SELECT * FROM monitor_suppliers WHERE workspace_id=$1 ORDER BY name,id',[req.auth.workspaceId]);
 res.set('Cache-Control','no-store').json({ok:true,suppliers:r.rows.map(supplier)});
}catch(e){next(e);}});
monitorSupplierOrderRouter.put('/suppliers/:id',async(req,res,next)=>{try{
 access(req.auth,true);const key=id(req.params.id),version=integer(req.body?.expectedVersion);
 let fields;try{fields=normalizeSupplier(req.body);}catch(e){throw fail(e.message);}
 const saved=await withTransaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[req.auth.workspaceId+':supplier:'+key]);
   const old=(await c.query('SELECT version FROM monitor_suppliers WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[req.auth.workspaceId,key])).rows[0];
   if((old?.version||0)!==version)throw fail('Proveedor modificado en otro dispositivo. Actualiza antes de guardar.','MONITOR_SUPPLIER_CONFLICT',409);
   const r=await c.query(`INSERT INTO monitor_suppliers(workspace_id,id,name,phone,active) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(workspace_id,id) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,active=EXCLUDED.active,
       version=monitor_suppliers.version+1,updated_at=now() RETURNING *`,[req.auth.workspaceId,key,fields.name,fields.phone,fields.active]);
   await audit(c,req.auth,'MONITOR_SUPPLIER_SAVED',key,{version:r.rows[0].version,active:fields.active});return supplier(r.rows[0]);
 });res.json({ok:true,supplier:saved});
}catch(e){next(e);}});
monitorSupplierOrderRouter.get('/reviews/:weekStart/supplier-orders',async(req,res,next)=>{try{
 access(req.auth);res.set('Cache-Control','no-store').json({ok:true,...await context(pool,req.auth.workspaceId,week(req.params.weekStart))});
}catch(e){next(e);}});
monitorSupplierOrderRouter.put('/reviews/:weekStart/supplier-assignments/:itemKey',async(req,res,next)=>{try{
 access(req.auth,true);const date=week(req.params.weekStart),round=integer(req.body?.round,1),key=id(req.params.itemKey),supplierId=id(req.body?.supplierId),expected=integer(req.body?.expectedVersion);
 const assignment=await withTransaction(async c=>{
   await requireActiveMonitorRound(c,req.auth.workspaceId,date,round);
   const s=await c.query('SELECT 1 FROM monitor_suppliers WHERE workspace_id=$1 AND id=$2 AND active=true',[req.auth.workspaceId,supplierId]);
   if(!s.rowCount)throw fail('Selecciona un proveedor activo');
   const item=await c.query("SELECT 1 FROM monitor_weekly_review_items WHERE workspace_id=$1 AND week_start=$2::date AND item_key=$3 AND decision='ORDER' AND deleted=false",[req.auth.workspaceId,date,key]);
   if(!item.rowCount)throw fail('Este producto ya no está marcado como Pedir','MONITOR_ORDER_CHANGED',409);
   const old=(await c.query('SELECT version FROM monitor_supplier_assignments WHERE workspace_id=$1 AND week_start=$2::date AND round_number=$3 AND item_key=$4',[req.auth.workspaceId,date,round,key])).rows[0];
   if((old?.version||0)!==expected)throw fail('Asignación modificada en otro dispositivo. Actualiza y vuelve a seleccionar.','MONITOR_ASSIGNMENT_CONFLICT',409);
   const r=await c.query(`INSERT INTO monitor_supplier_assignments(workspace_id,week_start,round_number,item_key,supplier_id) VALUES($1,$2::date,$3,$4,$5)
    ON CONFLICT(workspace_id,week_start,round_number,item_key) DO UPDATE SET supplier_id=EXCLUDED.supplier_id,version=monitor_supplier_assignments.version+1,updated_at=now() RETURNING version`,[req.auth.workspaceId,date,round,key,supplierId]);
   await audit(c,req.auth,'MONITOR_SUPPLIER_ASSIGNED',date+':'+round+':'+key,{supplierId});return {itemKey:key,supplierId,version:r.rows[0].version};
 });res.json({ok:true,assignment});
}catch(e){next(e);}});
monitorSupplierOrderRouter.post('/reviews/:weekStart/supplier-orders',async(req,res,next)=>{try{
 access(req.auth,true);const date=week(req.params.weekStart),round=integer(req.body?.round,1);
 const result=await withTransaction(async c=>{
   await requireActiveMonitorRound(c,req.auth.workspaceId,date,round);
   const draft=await context(c,req.auth.workspaceId,date,true);
   const selections=Object.fromEntries(draft.items.map(i=>[i.itemKey,draft.assignments.find(a=>a.itemKey===i.itemKey)?.supplierId||draft.preferences[i.productId]]));
   let groups;try{groups=buildSupplierOrderGroups({...draft,selections});}catch(e){throw fail(e.message);}
   if(req.body?.fingerprint!==supplierOrderFingerprint(groups))throw fail('El pedido cambió. Actualiza y revisa cantidades, empaque y proveedor antes de finalizar.','MONITOR_ORDER_CHANGED',409);
   await c.query("UPDATE monitor_supplier_orders SET status='REPLACED' WHERE workspace_id=$1 AND week_start=$2::date AND round_number=$3 AND status='FINALIZED'",[req.auth.workspaceId,date,round]);
   const orders=[];
   for(const group of groups){
     const fingerprint=createHash('sha256').update(supplierOrderFingerprint([{...group,items:group.items.map(i=>({...i,version:0}))}])).digest('hex');
     const previous=(await c.query("SELECT id FROM monitor_supplier_orders WHERE workspace_id=$1 AND week_start=$2::date AND round_number=$3 AND supplier_id=$4 AND status='SENT' ORDER BY sent_at DESC,id LIMIT 1",[req.auth.workspaceId,date,round,group.supplierId])).rows[0];
     const r=await c.query(`INSERT INTO monitor_supplier_orders(workspace_id,week_start,round_number,supplier_id,supplier_snapshot,items,fingerprint,replaces_order_id,finalized_by)
       VALUES($1,$2::date,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)
       ON CONFLICT(workspace_id,week_start,round_number,supplier_id,fingerprint) DO UPDATE SET
         status=CASE WHEN monitor_supplier_orders.status='REPLACED' THEN 'FINALIZED' ELSE monitor_supplier_orders.status END
       RETURNING *,week_start::text AS week_start`,[req.auth.workspaceId,date,round,group.supplierId,JSON.stringify(group.supplier),JSON.stringify(group.items),fingerprint,previous?.id||null,req.auth.userId]);
     orders.push(order(r.rows[0]));
   }
   await audit(c,req.auth,'MONITOR_SUPPLIER_ORDERS_FINALIZED',date+':'+round,{orders:orders.map(o=>o.id)});return orders;
 });res.json({ok:true,orders:result});
}catch(e){next(e);}});
monitorSupplierOrderRouter.post('/supplier-orders/:id/sent',async(req,res,next)=>{try{
 access(req.auth,true);const key=String(req.params.id);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key))throw fail('Pedido inválido');
 const saved=await withTransaction(async c=>{
   const r=await c.query('SELECT *,week_start::text AS week_start FROM monitor_supplier_orders WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[req.auth.workspaceId,key]);
   if(!r.rowCount)throw fail('Pedido no encontrado','MONITOR_ORDER_NOT_FOUND',404);
   const row=r.rows[0];if(row.status==='REPLACED')throw fail('Esta versión fue reemplazada. Revisa el pedido actualizado.','MONITOR_ORDER_REPLACED',409);
   if(row.status==='SENT')return order(row);
   const updated=await c.query("UPDATE monitor_supplier_orders SET status='SENT',sent_by=$3,sent_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *,week_start::text AS week_start",[req.auth.workspaceId,key,req.auth.userId]);
   for(const item of row.items){if(!item.productId)continue;
     await c.query(`INSERT INTO monitor_supplier_preferences(workspace_id,product_id,supplier_id) VALUES($1,$2,$3)
       ON CONFLICT(workspace_id,product_id,supplier_id) DO UPDATE SET uses=monitor_supplier_preferences.uses+1,last_confirmed_at=now()`,[req.auth.workspaceId,item.productId,row.supplier_id]);
   }
   await audit(c,req.auth,'MONITOR_SUPPLIER_ORDER_MARKED_SENT',key,{confirmation:'manual'});return order(updated.rows[0]);
 });res.json({ok:true,order:saved});
}catch(e){next(e);}});
