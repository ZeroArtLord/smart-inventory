import { config } from '../config.js';
import { pool } from '../db.js';

export async function authContext(req, res, next) {
  try {
    if (!config.devAllowHeaderAuth) {
      return res.status(503).json({
        ok: false,
        code: 'AUTH_NOT_CONFIGURED',
        message: 'La autenticación de producción todavía no está configurada.'
      });
    }

    const workspaceId = req.header('x-workspace-id');
    const userId = req.header('x-user-id');

    if (!workspaceId || !userId) {
      return res.status(401).json({
        ok: false,
        code: 'DEV_AUTH_HEADERS_REQUIRED',
        message: 'Faltan x-workspace-id y x-user-id.'
      });
    }

    const membership = await pool.query(
      `SELECT role_code, permissions
       FROM workspace_members
       WHERE workspace_id = $1
         AND user_id = $2
         AND active = true`,
      [workspaceId, userId]
    );

    if (membership.rowCount === 0) {
      return res.status(403).json({
        ok: false,
        code: 'WORKSPACE_ACCESS_DENIED',
        message: 'El usuario no pertenece a este almacén.'
      });
    }

    req.auth = {
      workspaceId,
      userId,
      roleCode: membership.rows[0].role_code,
      permissions: membership.rows[0].permissions || []
    };

    next();
  } catch (error) {
    next(error);
  }
}
