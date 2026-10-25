import { createHash } from 'node:crypto';
import { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import { hasPermission, PERMISSIONS } from '../security/permissions.js';
import { writeAuditEvent } from '../audit/auditService.js';
import { requireActiveMonitorRound } from './monitorReviewCycles.js';

export const monitorReviewRouter = Router();

const choices = new Set(['UNREVIEWED','BUY','ORDER','NOT_NEEDED','PENDING','ASK']);
const methods = new Set(['BUY','ORDER']);
const safeId = /^[a-zA-Z0-9_.:-]{1,150}$/;

monitorReviewRouter.get('/reviews/:weekStart', async (req, res, next) => {
  try {
    requireReviewAccess(req.auth, false);
    const weekStart = validWeek(req.params.weekStart);
    const roundRecord = await pool.query(
      "SELECT current_round FROM monitor_review_cycles WHERE workspace_id=$1 AND week_start=$2::date",
      [req.auth.workspaceId,weekStart]);
    const currentRound=roundRecord.rows[0]?.current_round||1;
    const result = await pool.query(
      `SELECT item_key,kind,product_id,description,decision,quantity,unit,notes,
              deleted,version,updated_by,updated_at
       FROM monitor_weekly_review_items
       WHERE workspace_id=$1 AND week_start=$2::date
       ORDER BY item_key ASC`,
      [req.auth.workspaceId, weekStart]
    );
    res.set('Cache-Control', 'no-store').json({
      ok:true, workspaceId:req.auth.workspaceId, weekStart,currentRound,
      items:result.rows.map(mapRow)
    });
  } catch (error) { next(error); }
});

monitorReviewRouter.put('/reviews/:weekStart/items', async (req, res, next) => {
  try {
    requireReviewAccess(req.auth, true);
    const weekStart = validWeek(req.params.weekStart);
    const item = normalizeItem(req.body);
    const expectedVersion = req.body?.expectedVersion;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw bad('Versión esperada inválida', 'REVIEW_EXPECTED_VERSION_INVALID');
    }
    const mutationId = String(req.body?.mutationId || '');
    if (!/^[a-zA-Z0-9_.:-]{8,128}$/.test(mutationId)) {
      throw bad('ID del evento inválido', 'REVIEW_MUTATION_INVALID');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({
      weekStart, item, expectedVersion,
      ...(Number(req.body?.round||1)>1?{round:Number(req.body.round)}:{})
    })).digest('hex');

    const result = await withTransaction(async client => {
      // Una fila de control por semana bloquea cierres simultáneos.
      const requestedRound=req.body?.round==null?1:Number(req.body.round);
      if(!Number.isSafeInteger(requestedRound)||requestedRound<1)
        throw bad('Ciclo inválido','MONITOR_ROUND_INVALID');
      await requireActiveMonitorRound(client,req.auth.workspaceId,weekStart,requestedRound);
      // Serializa las ediciones del MISMO elemento sin bloquear categorías distintas.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        req.auth.workspaceId + ':' + weekStart + ':' + item.itemKey
      ]);

      const oldMutation = await client.query(
        `SELECT week_start::text AS week_start,item_key,request_fingerprint,version
         FROM monitor_weekly_review_mutations
         WHERE workspace_id=$1 AND mutation_id=$2`,
        [req.auth.workspaceId,mutationId]
      );
      if (oldMutation.rowCount) {
        const past = oldMutation.rows[0];
        if (past.item_key !== item.itemKey || past.week_start !== weekStart ||
            past.request_fingerprint !== fingerprint) {
          throw conflict('El ID de evento ya se usó con otros datos', 'REVIEW_MUTATION_MISMATCH');
        }
        const current = await client.query(
          `SELECT item_key,kind,product_id,description,decision,quantity,unit,notes,
                  deleted,version,updated_by,updated_at
           FROM monitor_weekly_review_items
           WHERE workspace_id=$1 AND week_start=$2::date AND item_key=$3`,
          [req.auth.workspaceId,weekStart,item.itemKey]
        );
        return { item:mapRow(current.rows[0]),replayed:true,appliedVersion:past.version,created:false };
      }

      if (item.kind === 'PRODUCT') {
        const catalog = await client.query(
          `SELECT 1 FROM products WHERE workspace_id=$1 AND id=$2 AND active=true`,
          [req.auth.workspaceId,item.productId]
        );
        if (!catalog.rowCount) {
          throw bad('Producto activo no encontrado en este almacén', 'REVIEW_PRODUCT_NOT_FOUND');
        }
      }

      const existing = await client.query(
        `SELECT item_key,kind,product_id,description,decision,quantity,unit,notes,
                deleted,version,updated_by,updated_at
         FROM monitor_weekly_review_items
         WHERE workspace_id=$1 AND week_start=$2::date AND item_key=$3
         FOR UPDATE`,
        [req.auth.workspaceId,weekStart,item.itemKey]
      );
      const old = existing.rows[0] || null;
      if (expectedVersion !== (old?.version ?? 0)) {
        const err = conflict('Otro usuario actualizó este artículo. Revisa su decisión antes de guardar.', 'REVIEW_CONFLICT');
        err.details = { latest:old ? mapRow(old) : null };
        throw err;
      }
      if (old && old.kind !== item.kind) {
        throw conflict('No se puede cambiar el tipo del artículo', 'REVIEW_KIND_MISMATCH');
      }
      const newVersion = (old?.version ?? 0) + 1;
      const saved = await client.query(
        `INSERT INTO monitor_weekly_review_items
           (workspace_id,week_start,item_key,kind,product_id,description,decision,quantity,
            unit,notes,deleted,version,updated_by,updated_at)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
         ON CONFLICT (workspace_id,week_start,item_key)
         DO UPDATE SET
           description=EXCLUDED.description,
           decision=EXCLUDED.decision,
           quantity=EXCLUDED.quantity,
           unit=EXCLUDED.unit,
           notes=EXCLUDED.notes,
           deleted=EXCLUDED.deleted,
           version=EXCLUDED.version,
           updated_by=EXCLUDED.updated_by,
           updated_at=now()
         RETURNING item_key,kind,product_id,description,decision,quantity,unit,notes,
                   deleted,version,updated_by,updated_at`,
        [req.auth.workspaceId,weekStart,item.itemKey,item.kind,item.productId,
          item.description,item.decision,item.quantity,item.unit,item.notes,
          item.deleted,newVersion,req.auth.userId]
      );
      await client.query(
        `INSERT INTO monitor_weekly_review_mutations
           (workspace_id,mutation_id,week_start,item_key,request_fingerprint,version)
         VALUES ($1,$2,$3::date,$4,$5,$6)`,
        [req.auth.workspaceId,mutationId,weekStart,item.itemKey,fingerprint,newVersion]
      );
      await writeAuditEvent(client,req.auth,{
        action:'MONITOR_WEEKLY_REVIEW_ITEM_SAVED',
        entityType:'monitorWeeklyReview',
        entityId:weekStart + ':' + item.itemKey,
        metadata:{
          method:item.decision,kind:item.kind,
          version:newVersion, quantityKnown:item.quantity !== null,
          deleted:item.deleted,mutationId
        }
      });
      return {item:mapRow(saved.rows[0]),replayed:false,
        appliedVersion:newVersion,created:!old};
    });

    res.set('Cache-Control','no-store')
      .status(result.created ? 201 : 200).json({ok:true,...result});
  } catch (error) {
    if (error?.code === '23505') {
      return next(conflict('Evento ya registrado o artículo cambiado. Recarga el estado.', 'REVIEW_CONFLICT'));
    }
    next(error);
  }
});

function requireReviewAccess(auth, write) {
  if (!auth) throw fail('Autenticación requerida','AUTH_REQUIRED',401);
  const canRead = hasPermission(auth,PERMISSIONS.CATALOG_VIEW) ||
    hasPermission(auth,PERMISSIONS.PURCHASE_WRITE) ||
    hasPermission(auth,PERMISSIONS.COUNT_WRITE);
  const canWrite = hasPermission(auth,PERMISSIONS.PURCHASE_WRITE) ||
    hasPermission(auth,PERMISSIONS.COUNT_WRITE) ||
    hasPermission(auth,PERMISSIONS.SUPPLY_WRITE);
  if (!(write ? canWrite : canRead)) throw fail('Sin permiso para esta revisión','PERMISSION_DENIED',403);
}

function validWeek(value) {
  const week=String(value||'');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw bad('Semana inválida','REVIEW_WEEK_INVALID');
  const date=new Date(week+'T00:00:00Z');
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0,10)!==week ||
      date.getUTCDay()!==1) throw bad('Se requiere fecha de lunes válida','REVIEW_WEEK_INVALID');
  return week;
}
function normalizeItem(body) {
  const kind=String(body?.kind||'');
  if (kind!=='PRODUCT' && kind!=='EXTRA') throw bad('Tipo inválido','REVIEW_KIND_INVALID');
  const itemId=String(body?.itemId||'');
  if (!safeId.test(itemId)) throw bad('Identificador inválido','REVIEW_ITEM_INVALID');
  const decision=String(body?.decision||'');
  if (!choices.has(decision) || (kind==='EXTRA' && !methods.has(decision))) {
    throw bad('Decisión inválida','REVIEW_DECISION_INVALID');
  }
  const quantity=body?.quantity;
  const n=quantity==null || quantity==='' ? null : Number(quantity);
  if (n!==null && (!Number.isFinite(n)||n<=0||n>1000000000)) {
    throw bad('Cantidad debe ser positiva o estar vacía','REVIEW_QUANTITY_INVALID');
  }
  const unit=optionalText(body?.unit,40,'Unidad');
  const notes=optionalText(body?.notes,500,'Observaciones');
  const deleted=body?.deleted === true;
  const description=kind==='EXTRA' ? requiredText(body?.description,180,'Descripción') : null;
  if (kind==='PRODUCT' && deleted) throw bad('No se elimina un producto del catálogo desde la revisión','REVIEW_DELETE_INVALID');
  return {
    itemKey:(kind==='PRODUCT'?'product:':'extra:')+itemId,
    productId:kind==='PRODUCT'?itemId:null,
    description,kind,decision,quantity:n,unit,notes,deleted
  };
}
function optionalText(value,max,label) {
  const text=String(value??'').trim();
  if (text.length>max) throw bad(label+' demasiado largo','REVIEW_TEXT_TOO_LONG');
  return text;
}
function requiredText(value,max,label) {
  const text=optionalText(value,max,label);
  if (!text) throw bad(label+' obligatoria','REVIEW_TEXT_REQUIRED');
  return text;
}
function mapRow(r) {
  if (!r) return null;
  return {
    itemKey:r.item_key,kind:r.kind,productId:r.product_id,
    description:r.description,decision:r.decision,
    quantity:r.quantity==null?null:Number(r.quantity),
    unit:r.unit,notes:r.notes,deleted:r.deleted,
    version:r.version,updatedBy:r.updated_by,updatedAt:r.updated_at
  };
}
function fail(message,code,statusCode) {
  const error=new Error(message); error.code=code;error.statusCode=statusCode;return error;
}
function bad(message,code) { return fail(message,code,400); }
function conflict(message,code) { return fail(message,code,409); }
