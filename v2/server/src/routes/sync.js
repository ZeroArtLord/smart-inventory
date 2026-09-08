import { Router } from 'express';
import { withTransaction } from '../db.js';
import { applyEvent } from '../sync/applyEvent.js';
import {
  writeAuditEvent,
  buildSyncAuditMetadata
} from '../audit/auditService.js';

export const syncRouter = Router();

syncRouter.post('/push', async (req, res, next) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];

    if (events.length === 0) {
      return res.json({ ok: true, applied: [], cursor: null });
    }

    if (events.length > 500) {
      return res.status(413).json({
        ok: false,
        code: 'TOO_MANY_EVENTS',
        message: 'Máximo 500 eventos por lote.'
      });
    }

    const result = await withTransaction(async client => {
      const applied = [];
      let lastCursor = null;

      for (const event of events) {
        if (!event?.id) {
          throw new Error('Evento sin ID');
        }

        const inserted = await client.query(
          `INSERT INTO sync_events (
            workspace_id,client_event_id,entity_type,entity_id,operation,payload,user_id
          ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
          ON CONFLICT (workspace_id,client_event_id) DO NOTHING
          RETURNING server_seq`,
          [
            req.auth.workspaceId,
            event.id,
            event.entityType,
            event.entityId,
            event.operation,
            JSON.stringify(event.payload || {}),
            req.auth.userId
          ]
        );

        if (inserted.rowCount === 0) {
          applied.push({ id: event.id, duplicate: true });
          continue;
        }

        // Antes del upsert protegemos la configuración del puente. Así una
        // edición normal de catálogo no puede reactivar el producto fuente ni
        // cambiar el código externo que recibirá SAINT.
        await canonicalizeProtectedProductBridgeFields(
          client,
          req.auth.workspaceId,
          event,
          { beforeApply: true }
        );

        await applyEvent(client, req.auth, event);

        // Después del upsert volvemos a leer PostgreSQL para que el evento que
        // descargan otros dispositivos contenga los valores canónicos.
        await canonicalizeProtectedProductBridgeFields(
          client,
          req.auth.workspaceId,
          event
        );

        await writeAuditEvent(client, req.auth, {
          action: `SYNC_${event.operation}`,
          entityType: event.entityType,
          entityId: event.entityId,
          metadata: buildSyncAuditMetadata(event)
        });

        await client.query(
          `UPDATE sync_events
           SET payload = $2::jsonb
           WHERE server_seq = $1`,
          [
            inserted.rows[0].server_seq,
            JSON.stringify(event.payload || {})
          ]
        );

        lastCursor = Number(inserted.rows[0].server_seq);
        applied.push({
          id: event.id,
          duplicate: false,
          cursor: lastCursor
        });
      }

      return { applied, cursor: lastCursor };
    });

    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

syncRouter.get('/pull', async (req, res, next) => {
  try {
    const cursor = Math.max(0, Number(req.query.cursor || 0));
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 250)));

    const { pool } = await import('../db.js');
    const result = await pool.query(
      `SELECT
        server_seq,
        client_event_id,
        entity_type,
        entity_id,
        operation,
        payload,
        user_id,
        applied_at
       FROM sync_events
       WHERE workspace_id = $1
         AND server_seq > $2
       ORDER BY server_seq ASC
       LIMIT $3`,
      [req.auth.workspaceId, cursor, limit]
    );

    const events = result.rows.map(row => ({
      cursor: Number(row.server_seq),
      id: row.client_event_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      operation: row.operation,
      payload: row.payload,
      userId: row.user_id,
      appliedAt: row.applied_at
    }));

    res.json({
      ok: true,
      events,
      cursor: events.length ? events[events.length - 1].cursor : cursor
    });
  } catch (error) {
    next(error);
  }
});

async function canonicalizeProtectedProductBridgeFields(
  client,
  workspaceId,
  event,
  { beforeApply = false } = {}
) {
  if (event?.entityType !== 'product' || !event?.entityId) return;

  const result = await client.query(
    `SELECT
       active,
       saint_bridge_source,
       saint_bridge_source_product_id,
       saint_bridge_code,
       saint_bridge_name
     FROM products
     WHERE workspace_id = $1
       AND id = $2`,
    [workspaceId, event.entityId]
  );

  // En CREATE todavía no existe una fila canónica y applyEvent mantiene el
  // comportamiento normal. Los puentes se crean exclusivamente por el
  // bootstrap de servidor auditado.
  if (result.rowCount !== 1) return;
  const row = result.rows[0];

  event.payload = {
    ...(event.payload || {}),
    saintBridgeSource: row.saint_bridge_source === true,
    saintBridgeSourceProductId: row.saint_bridge_source_product_id || null,
    saintBridgeCode: row.saint_bridge_code || '',
    saintBridgeName: row.saint_bridge_name || '',
    ...(row.saint_bridge_source === true ? { active: false } : {})
  };

  if (beforeApply && row.saint_bridge_source === true) {
    event.payload.active = false;
  }
}
