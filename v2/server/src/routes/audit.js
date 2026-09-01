import { Router } from 'express';
import { pool } from '../db.js';
import { PERMISSIONS } from '../security/permissions.js';
import { requirePermission } from '../middleware/requirePermission.js';

export const auditRouter = Router();

auditRouter.use(requirePermission(PERMISSIONS.AUDIT_VIEW));

auditRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(
      250,
      Math.max(1, Number(req.query.limit || 100))
    );

    const result = await pool.query(
      `SELECT
         id,
         user_id,
         action,
         entity_type,
         entity_id,
         metadata,
         created_at
       FROM audit_events
       WHERE workspace_id = $1
       ORDER BY id DESC
       LIMIT $2`,
      [req.auth.workspaceId, limit]
    );

    res.json({
      ok: true,
      events: result.rows.map(row => ({
        id: Number(row.id),
        userId: row.user_id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        metadata: row.metadata || {},
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
});
