import { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import { hasPermission, PERMISSIONS } from '../security/permissions.js';
import { writeAuditEvent } from '../audit/auditService.js';

// NO se modifica stock. Los cierres archivan en la misma transacción
// que prepara una revisión nueva, sin reutilizar ninguna decisión anterior.
export const monitorReviewCycleRouter = Router();
const weekPattern=/^\d{4}-\d{2}-\d{2}$/;
function error(message,code,statusCode=400){
  const e=new Error(message);e.code=code;e.statusCode=statusCode;return e;
}
function weekDate(raw){
  const week=String(raw||'');
  const date=new Date(week+'T00:00:00Z');
  if(!weekPattern.test(week)||!Number.isFinite(date.valueOf())||
     date.toISOString().slice(0,10)!==week||date.getUTCDay()!==1)
    throw error('Se requiere un lunes válido','MONITOR_WEEK_INVALID');
  return week;
}
function authorized(auth,write){
  if(!auth)throw error('Autenticación necesaria','AUTH_REQUIRED',401);
  const permissions=write
    ?[PERMISSIONS.PURCHASE_WRITE,PERMISSIONS.COUNT_WRITE,PERMISSIONS.SUPPLY_WRITE]
    :[PERMISSIONS.CATALOG_VIEW,PERMISSIONS.PURCHASE_WRITE,PERMISSIONS.COUNT_WRITE];
  if(!permissions.some(p=>hasPermission(auth,p)))
    throw error('Sin permiso de revisión Monitor','PERMISSION_DENIED',403);
}
export async function requireActiveMonitorRound(client,workspace,week,expectedRound){
  await client.query(
    `INSERT INTO monitor_review_cycles(workspace_id,week_start,current_round)
     VALUES($1,$2::date,1) ON CONFLICT DO NOTHING`,[workspace,week]);
  const result=await client.query(
    `SELECT current_round FROM monitor_review_cycles
       WHERE workspace_id=$1 AND week_start=$2::date FOR UPDATE`,[workspace,week]);
  const currentRound=result.rows[0]?.current_round;
  if(currentRound!==expectedRound){
    const e=error('La revisión anterior se cerró desde otro dispositivo. Conservamos tus cambios locales para revisarlos.','MONITOR_CYCLE_CHANGED',409);
    e.details={currentRound};throw e;
  }
  return currentRound;
}

monitorReviewCycleRouter.get('/reviews/:weekStart/history',async(req,res,next)=>{
  try{
    authorized(req.auth,false);
    const week=weekDate(req.params.weekStart);
    const r=await pool.query(
      `SELECT round_number,closed_at,closed_by,total_products,counts
       FROM monitor_review_archives
       WHERE workspace_id=$1 AND week_start=$2::date
       ORDER BY round_number DESC LIMIT 100`,[req.auth.workspaceId,week]);
    res.set('Cache-Control','no-store').json({
      ok:true,weekStart:week,archives:r.rows.map(x=>({
        round:x.round_number,closedAt:x.closed_at,closedBy:x.closed_by,
        totalProducts:x.total_products,counts:x.counts
      }))
    });
  }catch(e){next(e);}
});
monitorReviewCycleRouter.get('/reviews/:weekStart/history/:round',async(req,res,next)=>{
  try{
    authorized(req.auth,false);
    const week=weekDate(req.params.weekStart);
    const round=Number(req.params.round);
    if(!Number.isSafeInteger(round)||round<1)throw error('Ciclo inválido','MONITOR_ROUND_INVALID');
    const r=await pool.query(
      `SELECT round_number,closed_at,total_products,counts,items
       FROM monitor_review_archives
       WHERE workspace_id=$1 AND week_start=$2::date AND round_number=$3`,
       [req.auth.workspaceId,week,round]);
    if(!r.rowCount)throw error('Ciclo cerrado no encontrado','MONITOR_ARCHIVE_NOT_FOUND',404);
    const row=r.rows[0];
    res.set('Cache-Control','no-store').json({
      ok:true,weekStart:week,round:row.round_number,closedAt:row.closed_at,
      totalProducts:row.total_products,counts:row.counts,
      items:row.items.map(x=>({
        itemKey:x.item_key,kind:x.kind,productId:x.product_id,
        description:x.description,decision:x.decision,
        quantity:x.quantity==null?null:Number(x.quantity),
        unit:x.unit,notes:x.notes,deleted:x.deleted,
        version:x.version,updatedAt:x.updated_at
      }))
    });
  }catch(e){next(e);}
});
monitorReviewCycleRouter.post('/reviews/:weekStart/close',async(req,res,next)=>{
  try{
    authorized(req.auth,true);
    const week=weekDate(req.params.weekStart);
    const expectedRound=Number(req.body?.expectedRound);
    if(!Number.isSafeInteger(expectedRound)||expectedRound<1)
      throw error('Ciclo de cierre inválido','MONITOR_ROUND_INVALID');
    const outcome=await withTransaction(async client=>{
      // El PUT también bloquea la misma fila de ciclos: cierre y escritura
      // jamás se cruzan entre dos dispositivos.
      const round=await requireActiveMonitorRound(client,req.auth.workspaceId,week,expectedRound);
      const products=await client.query(
        `SELECT COUNT(*)::int AS total FROM products
         WHERE workspace_id=$1 AND active=true`,[req.auth.workspaceId]);
      const unresolved=await client.query(
        `SELECT COUNT(*)::int AS incomplete
         FROM products p
         LEFT JOIN monitor_weekly_review_items m
           ON m.workspace_id=p.workspace_id AND m.week_start=$2::date
           AND m.item_key='product:'||p.id
         WHERE p.workspace_id=$1 AND p.active=true
           AND (m.item_key IS NULL OR m.deleted=true
             OR m.decision NOT IN ('BUY','ORDER','NOT_NEEDED'))`,
         [req.auth.workspaceId,week]);
      const asking=await client.query(
        `SELECT COUNT(*)::int AS unresolved FROM monitor_weekly_review_items
         WHERE workspace_id=$1 AND week_start=$2::date
           AND deleted=false AND decision IN ('ASK','PENDING','UNREVIEWED')`,
         [req.auth.workspaceId,week]);
      if(unresolved.rows[0].incomplete||asking.rows[0].unresolved){
        const e=error('Resuelve Preguntar, Pendientes y productos sin revisar antes de cerrar.','MONITOR_CYCLE_INCOMPLETE',409);
        e.details={unreviewed:unresolved.rows[0].incomplete,questions:asking.rows[0].unresolved};throw e;
      }
      const total=products.rows[0].total;
      const all=await client.query(
        `SELECT * FROM monitor_weekly_review_items
         WHERE workspace_id=$1 AND week_start=$2::date ORDER BY item_key
         FOR UPDATE`,[req.auth.workspaceId,week]);
      if(!all.rowCount)throw error('No hay revisión para cerrar','MONITOR_CYCLE_EMPTY',409);
      const counts={buy:0,order:0,ask:0,notNeeded:0};
      for(const row of all.rows){
        if(row.deleted)continue;
        if(row.decision==='BUY')counts.buy++;
        if(row.decision==='ORDER')counts.order++;
        if(row.decision==='ASK')counts.ask++;
        if(row.decision==='NOT_NEEDED')counts.notNeeded++;
      }
      await client.query(
        `INSERT INTO monitor_review_archives
           (workspace_id,week_start,round_number,items,total_products,counts,closed_by)
         VALUES($1,$2::date,$3,$4::jsonb,$5,$6::jsonb,$7)`,
        [req.auth.workspaceId,week,round,JSON.stringify(all.rows),total,
         JSON.stringify(counts),req.auth.userId]);
      // Solo los renglones del borrador de MONITOR. Todos sus datos fueron
      // copiados íntegramente arriba; ante cualquier error se revierte TODO.
      await client.query(
        `DELETE FROM monitor_weekly_review_items
         WHERE workspace_id=$1 AND week_start=$2::date`,
         [req.auth.workspaceId,week]);
      await client.query(
        `UPDATE monitor_review_cycles SET current_round=$3,updated_at=now()
         WHERE workspace_id=$1 AND week_start=$2::date`,
         [req.auth.workspaceId,week,round+1]);
      await writeAuditEvent(client,req.auth,{
        action:'MONITOR_REVIEW_ROUND_CLOSED',entityType:'monitorReviewRound',
        entityId:week+':'+round,metadata:{round,weekStart:week,totalProducts:total,counts}
      });
      return {closedRound:round,currentRound:round+1,counts,totalProducts:total};
    });
    res.set('Cache-Control','no-store').json({ok:true,weekStart:week,...outcome});
  }catch(e){next(e);}
});
