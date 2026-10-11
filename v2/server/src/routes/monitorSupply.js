import { createHash } from 'node:crypto';
import { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import { hasPermission, PERMISSIONS } from '../security/permissions.js';
import { writeAuditEvent } from '../audit/auditService.js';

// Intentionally separate from V2's documents and /sync; no stock mutations.
export const monitorSupplyRouter = Router();
const deliveryIdPattern=/^[a-zA-Z0-9_.:-]{8,128}$/;

monitorSupplyRouter.post('/supplies', async (req,res,next)=>{
  try {
    requireSupplyAccess(req.auth,true);
    const input=normalizeDelivery(req.body);
    const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const output=await withTransaction(async client=>{
      // Lock just this delivery key; retries cannot create concurrent copies.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[
        'monitor:supply:'+req.auth.workspaceId+':'+input.id
      ]);
      const existing=await client.query(
        `SELECT id,operational_date,destination_area_id,destination_area_name,
                notes,lines,request_fingerprint,recorded_by,recorded_at
           FROM monitor_supply_deliveries WHERE workspace_id=$1 AND id=$2`,
        [req.auth.workspaceId,input.id]
      );
      if(existing.rowCount){
        if(existing.rows[0].request_fingerprint!==fingerprint)
          throw err('Ese identificador pertenece a otro surtido. No se sobrescribió.','MONITOR_SUPPLY_ID_CONFLICT',409);
        return {delivery:mapDelivery(existing.rows[0]),replayed:true};
      }

      const area=await client.query(
        'SELECT id,name FROM areas WHERE workspace_id=$1 AND id=$2 AND active=true',
        [req.auth.workspaceId,input.destinationAreaId]
      );
      if(!area.rowCount)throw err('Área de destino activa no encontrada','MONITOR_SUPPLY_AREA_UNKNOWN',400);

      const productIds=input.lines.map(x=>x.productId);
      const found=await client.query(
        `SELECT id,name,category_id FROM products
          WHERE workspace_id=$1 AND active=true AND id=ANY($2::text[])`,
        [req.auth.workspaceId,productIds]
      );
      const products=new Map(found.rows.map(p=>[p.id,p]));
      if(products.size!==productIds.length)
        throw err('Algún producto no existe o no está activo en este almacén','MONITOR_SUPPLY_PRODUCT_UNKNOWN',400);
      const lines=input.lines.map(line=>{
        const product=products.get(line.productId);
        return {
          productId:line.productId,
          productName:product.name,
          categoryId:product.category_id||null,
          quantity:line.quantity,
          unit:line.unit,
          note:line.note
        };
      });
      const saved=await client.query(
        `INSERT INTO monitor_supply_deliveries
           (workspace_id,id,operational_date,destination_area_id,destination_area_name,
            notes,lines,request_fingerprint,recorded_by)
          VALUES ($1,$2,$3::date,$4,$5,$6,$7::jsonb,$8,$9)
          RETURNING id,operational_date,destination_area_id,destination_area_name,
                    notes,lines,request_fingerprint,recorded_by,recorded_at`,
        [req.auth.workspaceId,input.id,input.operationalDate,input.destinationAreaId,
          area.rows[0].name,input.notes,JSON.stringify(lines),fingerprint,req.auth.userId]
      );
      await writeAuditEvent(client,req.auth,{
        action:'MONITOR_SUPPLY_RECORDED',
        entityType:'monitorSupply',
        entityId:input.id,
        metadata:{
          operationalDate:input.operationalDate,
          destinationAreaId:input.destinationAreaId,
          lineCount:lines.length,
          quantityUnits:[...new Set(lines.map(x=>x.unit))].sort()
        }
      });
      return {delivery:mapDelivery(saved.rows[0]),replayed:false};
    });
    res.set('Cache-Control','no-store').status(output.replayed?200:201).json({
      ok:true,...output
    });
  }catch(error){next(error);}
});

monitorSupplyRouter.get('/supplies',async(req,res,next)=>{
  try{
    requireSupplyAccess(req.auth,false);
    const query=parseReportQuery(req.query);
    const result=await pool.query(
      `SELECT id,operational_date,destination_area_id,destination_area_name,
              notes,lines,recorded_by,recorded_at
        FROM monitor_supply_deliveries
        WHERE workspace_id=$1
          AND ($2::date IS NULL OR operational_date >= $2::date)
          AND ($3::date IS NULL OR operational_date <= $3::date)
          AND ($4::text IS NULL OR destination_area_id=$4)
        ORDER BY operational_date DESC,recorded_at DESC,id DESC
        LIMIT $5 OFFSET $6`,
      [req.auth.workspaceId,query.from,query.to,query.areaId,query.limit+1,query.offset]
    );
    const hasMore=result.rows.length>query.limit;
    res.set('Cache-Control','no-store').json({
      ok:true,deliveries:result.rows.slice(0,query.limit).map(mapDelivery),
      nextOffset:hasMore?query.offset+query.limit:null
    });
  }catch(error){next(error);}
});

monitorSupplyRouter.get('/supplies/consumption',async(req,res,next)=>{
  try{
    requireSupplyAccess(req.auth,false);
    const query=parseReportQuery(req.query);
    // Group only like-for-like quantities (area + product + UNIT).
    // These are delivered quantities, never official inventory balances.
    const result=await pool.query(
      `SELECT d.destination_area_id AS area_id,d.destination_area_name AS area_name,
              line->>'productId' AS product_id,
              MAX(line->>'productName') AS product_name,
              line->>'unit' AS unit,
              SUM((line->>'quantity')::numeric) AS quantity,
              COUNT(*)::integer AS deliveries
        FROM monitor_supply_deliveries d
        CROSS JOIN LATERAL jsonb_array_elements(d.lines) AS line
        WHERE d.workspace_id=$1
          AND ($2::date IS NULL OR d.operational_date >= $2::date)
          AND ($3::date IS NULL OR d.operational_date <= $3::date)
          AND ($4::text IS NULL OR d.destination_area_id=$4)
        GROUP BY d.destination_area_id,d.destination_area_name,line->>'productId',line->>'unit'
        ORDER BY d.destination_area_name ASC,product_name ASC,unit ASC`,
      [req.auth.workspaceId,query.from,query.to,query.areaId]
    );
    res.set('Cache-Control','no-store').json({
      ok:true,basis:'RECORDED_MONITOR_SUPPLIES_ONLY',
      filters:{from:query.from,to:query.to,areaId:query.areaId},
      lines:result.rows.map(row=>({
        areaId:row.area_id,areaName:row.area_name,
        productId:row.product_id,productName:row.product_name,
        unit:row.unit,quantity:Number(row.quantity),deliveries:row.deliveries
      }))
    });
  }catch(error){next(error);}
});

monitorSupplyRouter.get('/supplies/:deliveryId',async(req,res,next)=>{
  try{
    requireSupplyAccess(req.auth,false);
    const id=validId(req.params.deliveryId);
    const result=await pool.query(
      `SELECT id,operational_date,destination_area_id,destination_area_name,
              notes,lines,recorded_by,recorded_at
        FROM monitor_supply_deliveries WHERE workspace_id=$1 AND id=$2`,
      [req.auth.workspaceId,id]
    );
    if(!result.rowCount)throw err('Surtido no encontrado','MONITOR_SUPPLY_NOT_FOUND',404);
    res.set('Cache-Control','no-store').json({ok:true,delivery:mapDelivery(result.rows[0])});
  }catch(error){next(error);}
});

function normalizeDelivery(body){
  const input=body||{};
  const id=validId(input.id);
  const operationalDate=validDate(input.operationalDate);
  const destinationAreaId=requiredText(input.destinationAreaId,220,'Área');
  const notes=optionalText(input.notes,500,'Observaciones');
  if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>250)
    throw err('Indica entre 1 y 250 productos surtidos','MONITOR_SUPPLY_LINES_INVALID',400);
  const seen=new Set();
  const lines=input.lines.map(raw=>{
    const productId=requiredText(raw?.productId,220,'Producto');
    const unit=requiredText(raw?.unit,40,'Unidad');
    const quantity=positiveQuantity(raw?.quantity);
    const note=optionalText(raw?.note,250,'Observación');
    const key=JSON.stringify([productId,unit]);
    if(seen.has(key))throw err('Producto y unidad repetidos: consolida la cantidad antes de registrar','MONITOR_SUPPLY_DUPLICATE_LINE',400);
    seen.add(key);
    return {productId,unit,quantity,note};
  }).sort((a,b)=>a.productId.localeCompare(b.productId)||a.unit.localeCompare(b.unit));
  return {id,operationalDate,destinationAreaId,notes,lines};
}
function parseReportQuery(query={}){
  const from=query.from?validDate(query.from):null;
  const to=query.to?validDate(query.to):null;
  if(from&&to&&from>to)throw err('Rango de fechas invertido','MONITOR_SUPPLY_DATE_RANGE_INVALID',400);
  const areaId=query.areaId?requiredText(query.areaId,220,'Área'):null;
  const limit=query.limit===undefined?100:Number(query.limit);
  const offset=query.offset===undefined?0:Number(query.offset);
  if(!Number.isSafeInteger(limit)||limit<1||limit>500||
     !Number.isSafeInteger(offset)||offset<0||offset>1000000)
    throw err('Paginación inválida','MONITOR_SUPPLY_PAGE_INVALID',400);
  return {from,to,areaId,limit,offset};
}
function requireSupplyAccess(auth,write){
  if(!auth)throw err('Autenticación requerida','AUTH_REQUIRED',401);
  const allowed=write
    ?hasPermission(auth,PERMISSIONS.SUPPLY_WRITE)
    :hasPermission(auth,PERMISSIONS.SUPPLY_WRITE)||hasPermission(auth,PERMISSIONS.REPORT_VIEW);
  if(!allowed)throw err('Sin permisos para consultar o registrar surtidos','PERMISSION_DENIED',403);
}
function mapDelivery(row){
  const date=row.operational_date;
  return {
    schemaVersion:1,id:row.id,
    operationalDate:date instanceof Date?date.toISOString().slice(0,10):String(date).slice(0,10),
    destinationAreaId:row.destination_area_id,
    destinationAreaName:row.destination_area_name,
    notes:row.notes,
    lines:row.lines,
    status:'RECORDED',
    recordedBy:row.recorded_by,
    recordedAt:row.recorded_at
  };
}
function validId(value){
  const id=String(value||'');
  if(!deliveryIdPattern.test(id))throw err('Identificador de surtido inválido','MONITOR_SUPPLY_ID_INVALID',400);
  return id;
}
function validDate(value){
  const date=String(value||'');
  const parsed=new Date(date+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||
    parsed.toISOString().slice(0,10)!==date)
    throw err('Fecha de surtido inválida','MONITOR_SUPPLY_DATE_INVALID',400);
  return date;
}
function requiredText(value,max,label){
  const s=String(value??'').trim();
  if(!s||s.length>max)throw err(label+' inválido','MONITOR_SUPPLY_FIELD_INVALID',400);
  return s;
}
function optionalText(value,max,label){
  const s=String(value??'').trim();
  if(s.length>max)throw err(label+' demasiado largo','MONITOR_SUPPLY_FIELD_INVALID',400);
  return s;
}
function positiveQuantity(value){
  if(value===null||value===undefined||value==='')
    throw err('Cantidad entregada obligatoria','MONITOR_SUPPLY_QUANTITY_INVALID',400);
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0||n>1e9||Math.round(n*1e6)/1e6!==n)
    throw err('Cantidad positiva de hasta 6 decimales requerida','MONITOR_SUPPLY_QUANTITY_INVALID',400);
  return n;
}
function err(message,code,statusCode){
  const e=new Error(message);e.code=code;e.statusCode=statusCode;return e;
}
